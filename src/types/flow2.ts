/**
 * 流程编排 v2 的数据结构：**每个节点就是一个函数**，流程在运行期一步步构建出来。
 *
 * ## 与 v1（types/approval.ts）的根本差别
 *
 * v1：模板是静态结构（节点 + 连线 + 条件），**建单时**一次性展开成完整链路；
 *     运行期只做"按快照重放" —— `rebuildChain` 是纯同步函数，不许查库、不许有副作用，
 *     因为它被审批页渲染、首页抽屉、提交、催办等多处反复调用，必须每次算出同一条链。
 *
 * v2：模板只是一串**函数**。每一步由函数决定：它可以查库、可以循环（`next` 指回自己）、
 *     可以依据上一环的办理结果改变走向。好处是表达力不再受"能不能画出来"限制；
 *     代价是**执行结果必须落库**（本文件的 `Flow2Run`）：
 *
 *       · 链路的构建只发生在"推进"的那一刻（建单 / 办完一环），结果连同决策日志一起写进单据；
 *       · 展示、待办、催办、时间线全部只读落库的那份结果，**不再执行函数** ——
 *         否则同一单在不同时刻重算会漂移（历史单不再是可信凭证）；
 *       · 每个函数执行时输入了什么、查了什么、返回了什么，全部记在 `Flow2LogEntry` 里，
 *         这是"审计"能成立的唯一方式：函数代码会变，日志不会。
 *
 * ⚠️ 这是一套**实验**模型，用于与 v1 做对比。函数在浏览器里执行（`new Function`），
 * 只适合内部可信环境：它拿得到页面里的一切，没有真正的沙箱。生产化需要把执行搬到服务端，
 * 或改成受控算子集（可序列化、可校验、可重放），见 src/utils/flow2Engine.ts 文件头。
 */

/** v2 模板里的一个节点：一段 async 函数体，运行期被调用 */
export interface Flow2Node {
  id: string
  name: string
  /**
   * 函数体源码。可用：`ctx` / `decisions` / `state` / `q` / `org` / `log`，
   * 返回 `{ steps?, next, done? }`。契约全文见 flow2Engine.ts 的 NODE_API_DOC。
   */
  code: string
  /** 备注（只给人看，不参与执行） */
  note?: string
}

/** v2 模板本体（存 app_chain2.spec） */
export interface Flow2Template {
  /** 起始节点 id */
  entry: string
  nodes: Flow2Node[]
}

/** 函数产出的一环（即将被办理的环节） */
export interface Flow2Step {
  /** 落库后这一环的稳定标识：`${nodeId}#${序号}`（同一轮里按产出顺序编号） */
  id: string
  /** 由哪个节点产出（排查用） */
  nodeId: string
  name: string
  /** 办理人。会签 = 多个；`role` 形态与 v1 一致，交给 resolveFlowRoles 落人 */
  members: Flow2StepMember[]
}

/** 环节办理人：固定的人（name/email）或动态角色（role.dept_leader + dept） */
export interface Flow2StepMember {
  name?: string
  email?: string
  role?: { kind: 'dept_leader', dept?: string, deptFrom?: string }
}

/** 一次查询的记录（审计：当时查了什么、命中多少） */
export interface Flow2QueryRecord {
  collection: string
  filter: string
  params?: Record<string, unknown>
  total?: number
  ms: number
  error?: string
}

/** 一个节点的一次执行记录 */
export interface Flow2LogEntry {
  seq: number
  nodeId: string
  nodeName: string
  at: string
  ms: number
  /** 函数里 log() 写的内容 */
  logs: string[]
  queries: Flow2QueryRecord[]
  /** 函数返回的东西（已归一化） */
  out?: { steps: number, next: string, done: boolean }
  /** 执行失败（语法错、超时、抛异常、返回形状不对） */
  error?: string
}

/**
 * 一次"推进"的运行结果 —— **这就是要落库的东西**（对应 v1 里那份被展开的 flow 快照）。
 *
 * 落库后：展示层只读 steps + logs；下一次推进时把 cursor / state / decisions 传回来继续。
 */
export interface Flow2Run {
  /** 本次产出的环节（按产出顺序）。第一个即"当前待办" */
  steps: Flow2Step[]
  /** 下次从哪个节点继续（函数返回的 next；已结束为 'end'） */
  cursor: string
  /** 跨节点、跨次执行的可写状态（函数想记住什么都放这里）。**随单据落库** */
  state: Record<string, unknown>
  /** 流程是否已结束 */
  done: boolean
  /** 每个节点每次执行的决策日志 */
  logs: Flow2LogEntry[]
  /** 非空 = 这一轮没构建成功。调用方**不许静默继续**（表现为建单/办理失败并给出原因） */
  errors: string[]
}

/** 已办流水（v2 的口径：谁在哪一环选了什么） */
export interface Flow2Decision {
  stepId: string
  nodeId?: string
  name?: string
  /** 办理结论（与 v1 同一套取值，见 APPROVAL_RESULTS） */
  result: string
  opinion?: string
  extra?: Record<string, unknown>
  at?: string
}

/** 待办中、可提交的选择项（试算面板用来演示"选到终止项就提前结束"） */
export interface Flow2StepOption {
  /** `pass` = 继续（默认） */
  result: string
  label: string
}

/** 函数节点可用 API 的说明（编辑器里直接展示给使用者） */
export const NODE_API_DOC = `每个节点是一段 async 函数体，可用：

  ctx        当前审批单的数据快照（只读，中文列名，如 ctx['组别']）
  decisions  已办流水 [{ stepId, nodeId, name, result, opinion, extra, at }]
  state      跨节点/跨次执行的可写状态（随单据落库，函数靠它记住"办到第几个了"）
  q          查库：await q.list('bi_rows', filter, params?, { sort, limit })
                    await q.count(...) / await q.first(...)
             filter 里写**中文列名**（会自动翻译成 PocketBase 的 ASCII 列名），
             {:名字} 用 params 绑定（自动转义）。bi_rows 的行会转成中文列名的对象。
  org        org.sameTeamGroups('美1组') → 同团队的组别名（团队归属在组织架构里，不在数据表里）
  log(msg)   写一笔进决策日志（排查用，界面上能看到）

返回：{ steps: [{ name, members: [{ role: { kind: 'dept_leader', dept: '组名' } }] }], next: '节点id' | 'end' }
      产出 steps 即**在此停下等办理**；next 可以指回自己（这就是"运行期循环"）。`

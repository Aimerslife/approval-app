/*
 * 审批类型模板（`code → 选中这个结论后要填什么`）由 utils/approvalTypes 定义。
 * 这里只用它的**类型**：运行期读值一律经 typesFromSnapshot / typeTemplateFromSnapshot，
 * 不直接碰解析逻辑（那是建单期的事，见文件头「运行期不查这张表」）。
 */
import type { ApprovalTypeTemplate } from '@/utils/approvalTypes'

/**
 * 审批环节（ApprovalNode）提交上来的办理数据。
 * 由父组件负责上传附件并写回 approval_chain.chain。
 */
export interface NodeSubmitPayload {
  /** 环节在 chain 中的下标 */
  index: number
  /** 审批结论标识 */
  result: string
  /** 结论文案（如「通过」「驳回」） */
  result_label: string
  /** 各业务表单的补充值（数量、金额、二级原因等） */
  extra: Record<string, unknown>
  /** 备注 / 审批意见 */
  opinion: string
  /** 待上传的附件 */
  files: File[]
  /**
   * 落库结束后的回调。
   *
   * - `ok = false` → 校验失败 / 写入失败：保持弹窗打开，便于改错后重试；
   * - `ok = true` 且 `info.sameApproverNext` → **先别关**：写完这一环，紧挨着的下一环
   *   还是同一个人办 —— 父组件把新链路传回来后，弹窗会在同一个窗口里接着办那一环
   *   （见 ApprovalNode 的 handleConfirm / activeStep）。
   *
   * 为什么要回传这个判断：chain 只展开到第一个待办环节为止（见 rebuildChain），
   * 提交**前**组件看不到"下一环是谁"，只有落库侧拿着新链路才算得出来。
   */
  done: (ok: boolean, info?: { sameApproverNext?: boolean }) => void
}

/** 审批环节附件的引用（文件实体存在 approval_files 集合，这里只存索引） */
export interface ApprovalAttachment {
  /** approval_files 记录 id */
  id: string
  /** 原始文件名 */
  name: string
  /** 文件访问地址（PocketBase files 接口） */
  url: string
}

export interface ApprovalChainItem {
  name?: string
  email?: string
  /**
   * 头像 URL。
   *
   * **新单里不再有这一项**（见 slimFlowMembers）：它一个就 ~165 B，而同一份记录会被按环节
   * （轮询还要按组）复制很多遍 —— 实测 97 个成员对象里只有 15 个人。
   * 现在展示层按 `open_id`（退化用 `email`）现查（见 stores/avatarDirectory）；
   * 老单自带这一项，照旧直显。两边都支持，所以读取方统一走 `avatar ?? 现查`。
   */
  avatar?: string
  /** 飞书 open_id：查头像 / 认人用的稳定标识（通讯录选人时带上，见 components/OrgTree.vue） */
  open_id?: string
  is_tenant_manager?: boolean
  is_leader?: boolean
  type?: 'manager' | 'cc' | string
  /** 所属部门：该成员在组织架构中最近的上级部门 */
  department?: string
  /** 部门完整路径，如 "XX公司 / 技术部 / 前端组"，用于悬浮展示 */
  department_path?: string

  // ===== 办理信息：审批人提交后回填，随 chain 一起存库 =====
  /** 审批结论标识：pass / reject / receive / recycle / scrap / rework / discard */
  result?: string
  /** 结论文案（如「通过」「驳回」），便于列表直接展示 */
  result_label?: string
  /** 各选项的补充值：数量、金额、二级原因等 */
  extra?: Record<string, unknown>
  /** 备注 / 审批意见 */
  opinion?: string
  /** 该环节上传的附件 */
  files?: ApprovalAttachment[]
  /** 办理时间（ISO 字符串） */
  handled_at?: string

  // ===== 转办（运行期追加的成员带这几个字段，见 mergeExtraMembers）=====
  /** 转办来源：被接替的那位审批人姓名。带这个字段的成员 = 转办进来的人（type 为 manager） */
  delegated_from?: string
  /** 转办时间（ISO 字符串） */
  delegated_at?: string
  /** 仅用于展示：该审批人已把本环节转办给谁（重算时由 mergeExtraMembers 打上，不落库） */
  transferred_to?: string

  /** 动态审批人（角色）：模板里带这个字段、没有具体姓名，建单时解析成真人 */
  role?: ApprovalRole

  /**
   * 「按组轮询」：配了它就表示**这一环要展开成 N 环**（每个符合条件的组各一环，
   * 按销量顺序依次流转），而不是由一个人办 —— 见 RotationSpec 的说明。
   * 展开后每环的成员是 `role: { kind: 'dept_leader', dept: 组名 }`，
   * 也就是**复用现有角色解析**（含"该组没设负责人就往上级找"那套口径）。
   *
   * ⚠️ **已废弃（2026-09）**：组间流转改用画布上的「组间轮询」卡片
   *    （`ApprovalFlowLoopNode` —— 卡片内部能放条件分支与审批节点，**每个组各走一遍**）。
   *    编辑器里的入口已移除（见 components/flow/ApprovalNode.vue），新模板不会再产生这个字段。
   *
   *    但**类型与运行时展开（utils/approvalRotation 的 splitMembers）都保留**：
   *    旧模板、在途单还有数据带这个字段，删掉会让它们**静默地不再按组流转**
   *    （表面上"办完了"，实际漏掉几个组）—— 那种失败最难发现。
   *    真要下线，得先把旧模板迁移成卡片（迁移脚本另说）。
   */
  rotation?: RotationSpec

  /**
   * 仅「飞书提醒」环节会带（同时 type === 'notify'）：它是通知环节，**不办理**。
   *
   * 为什么要塞进 chain 的成员数组里、而不是另开一个字段：
   * 时间线（ApprovalNode.vue）是按 chain 逐环渲染的，放进来就**不用改任何页面的渲染入口**
   * 就能多出这一环 —— 三个页面（审批页 / 首页抽屉 / 我的）共用同一个组件。
   */
  notify?: {
    /** 节点上配置的补充文案（可选） */
    content?: string
    /** 提醒对象姓名（仅用于展示"通知谁"；真正发送时从 flow 的 members 取邮箱） */
    to?: string[]
  }
}

/**
 * 动态审批人（角色）：模板里**不写死人名**，建单时按组织架构解析成真人并快照进单。
 *
 * 为什么需要：白板上多处写的是「推送至相关部门负责人」「团队负责人审批」——
 * 这类环节的审批人不是某个固定的人，而是"某一层的负责人"。
 * 写死人名的话，人员一变动（换组长、换部门负责人）模板就得跟着改一遍。
 *
 * 取谁：**以 utils/organazation.ts 的表为准**（团队 → `manager`、部门 → `parentManager`），
 * 表里查不到才回退组织架构树（详见 utils/approvalRoles）。
 *
 * 解析口径（utils/approvalRoles.ts）：**建单时**解析、结果写进单据的 flow 快照，
 * 之后重算链路只读快照 —— 与业务数据快照同一套理由：
 * 历史单不能因为后来的人事变动而被改写。
 */
export interface ApprovalRole {
  /**
   * 解析方式：部门负责人 / 组织管理员 / **本环轮询到的组的负责人**。
   *
   * `loop_leader` 只在**「组间轮询」卡片内部**有意义：建单期展开时，卡片内部子流程会
   * 按组复制 N 份，每一份里的 `loop_leader` 都被填成**那一环的组名**（`role.dept = 组名`），
   * 再交给同一个角色解析器找真人（见 utils/approvalRotation 的 stampRing）。
   *
   * 所以它**不是**运行期概念：展开之后流程里不会再出现它。万一出现了（卡片没展开就进引擎），
   * 角色解析会明确报"没指定部门"，而不是悄悄变成一个没人办的环节。
   */
  kind: 'dept_leader' | 'tenant_admin' | 'loop_leader'
  /** 固定值（与 deptFrom 二选一；两个都填时 dept 优先）：写**团队**名或**部门**名都认 */
  dept?: string
  /** 取自**数据行字段**（中文列名，如「团队」）——
   *  「推送至相关部门负责人」就是这种：具体是哪个团队/部门由这一行数据决定 */
  deptFrom?: string
}

/**
 * 「按组轮询」：这一环不是一个人办，而是**一组人依次各办一环**。
 *
 * 场景：依据数据筛出若干个组，按销售数量从高到低依次流转给各组负责人，
 * 直到所有满足条件的组都办完 —— **环节数是数据决定的，模板里画不出来**。
 *
 * 怎么进流程（关键）：**建单时展开**，不是运行期循环。
 *   `expandRotations(flow, groups)` 把配了本配置的环节替换成 N 个普通审批环节
 *   （第 i 环的成员 = 第 i 个组的负责人），写进本单的 flow 快照。
 *   之后 `rebuildChain` 一行都不用改：驳回重审、催办、时间线、通知全部照旧可用。
 *   反过来，运行期再决定"下一个是谁"会让同一份流水重算出不同链路（历史单漂移、
 *   模板被污染），而且模板里也画不出环 —— graphToFlowFrom 明确拒绝"节点被重复经过"。
 *
 * 因此取数也必须发生在**建单那一刻**（那时数据被冻结成 context）：
 * 展开结果与业务数据一起快照进单据，之后再改数据不影响在途单。
 */
export interface RotationSpec {
  /** 组名取自数据行的哪一列（如「组别」） */
  groupFrom: string
  /** 统计范围：按哪一列圈定"相关的行"，默认「SKU」—— 同一个 SKU 的多行里各组的销量。
   *  ⚠️ 配了 `rowFilter` 时**不看它**（范围由行条件自己定，通常是"同团队"） */
  scopeFrom?: string
  /**
   * **行级条件**（可选，PB filter 语法，写数据行自己的列名）：先按它筛行，再按 `groupFrom` 分组。
   *
   * 「这个组里**存在**这样的行」由此自然成立 —— 一行都没命中的组根本不会出现在结果里，
   * 所以业务上说的"某组是否存在在售/非呆滞的货"不用另有语法。
   *
   * `{:字段名}` 从**当前审批单**取值（中文列名，与条件字段同一套），例如：
   *
   *     主MODEL = {:主MODEL} && 是否属于待评估库存 = "无需评估" && 销售状态 ~ "在售"
   *
   * 读作"与当前单同主MODEL、无需评估、且在售"。绑定由 `pb.filter` 完成并自动转义
   * （见 utils/rotationQuery.ts），**不要把字段值手工拼进字符串**。
   */
  rowFilter?: string
  /**
   * 只看与当前单**同团队**的组别（团队→组别 的映射见 utils/organazation.ts 的 `parent`/`group`）。
   *
   * 为什么专门一个开关、而不是写成行条件：`bi_rows` 里**没有「团队」这一列**，
   * 归属关系只维护在组织架构文件里，写不进 PB filter。
   * 取值用**当前单的 `groupFrom` 那一列**（如「组别」），查不到会判建单失败。
   */
  sameTeam?: boolean
  /** 排序依据列，默认「SKU近一年月平均销量」；同一个组命中多行时先按 aggregate 汇总 */
  orderFrom?: string
  /** 排序方向，默认 desc（销量高的组先办） */
  order?: 'asc' | 'desc'
  /** 同一个组命中多行时的汇总方式，默认 sum */
  aggregate?: 'sum' | 'max'
  /**
   * 只保留满足条件的组（可选）。
   * 求值上下文 = 该组**汇总后**的字段（`orderFrom` 那一列是汇总值，另有别名「销量」）
   * + 该组第一行的业务上下文 —— 所以「销量 > 0」「组别 包含 华东」都能写。
   */
  where?: ConditionExpr
  /** 最多展开几环（安全阀），默认 20。超了判建单失败（不静默截断，否则会漏掉几个组） */
  limit?: number
  /** 一个组都没命中时：'skip' 跳过这一环（默认）/ 'fail' 让建单失败 */
  whenEmpty?: 'skip' | 'fail'
}

/** 角色种类的可读名（用查表而不是嵌套三元：种类以后还会加） */
const ROLE_KIND_LABEL: Record<ApprovalRole['kind'], string> = {
  tenant_admin: '组织管理员',
  loop_leader: '本环的组负责人',
  // 取的是 organazation 表里的负责人：团队 → `manager`、部门 → `parentManager`
  // （界面上统一叫「团队负责人」，见 utils/approvalRoles 的说明）
  dept_leader: '团队负责人',
}

/** 角色的可读描述（模板里没解析时，卡片上显示它；建单失败时的报错也用它） */
export function roleLabel (role: ApprovalRole): string {
  const kind = ROLE_KIND_LABEL[role.kind] ?? '团队负责人'
  const dept = role.dept ? `（${role.dept}）` : (role.deptFrom ? `（取数据行「${role.deptFrom}」）` : '')
  return `${kind}${dept}`
}

export type ApprovalChain = ApprovalChainItem[][]

/**
 * 环节的**负责人**：优先 manager（办理信息记在它上面），没有 manager 时退回第一项。
 *
 * 为什么放在这里（types/approval）而不是各处自己写：它是「时间线上合并同一个人相邻环节」
 * 与「回退跳过同一个人」（见 collectRejectTargets）共用的口径，而这两种判定分别在
 * utils/approvalRuntime 与 types/approval 里 —— 基础模块放在这里，两边都引得到，
 * 也避免 types/approval 反向依赖 utils（会成环）。utils/approvalRuntime 原样转出去，调用点不用改。
 */
export function mainOf (step?: ApprovalChainItem[]) {
  return step?.find(i => i.type === 'manager') ?? step?.[0]
}

/**
 * 两个审批人是不是同一个人：**邮箱优先**（快照里最稳的标识），缺邮箱时退回姓名。
 * 口径说明见 mainOf。
 */
export function sameApprover (a?: ApprovalChainItem, b?: ApprovalChainItem) {
  if (!a || !b) {
    return false
  }
  const ae = String(a.email ?? '').trim().toLowerCase()
  const be = String(b.email ?? '').trim().toLowerCase()
  return ae && be ? ae === be : (!!a.name && a.name === b.name)
}

/**
 * 把运行期追加的成员（抄送 / 转办）合并进重算出来的 chain。
 *
 * 为什么必须单独存（`approval_chain.chain.extraMembers`，按 stepId 索引）：
 *   chain 是 `rebuildChain(flow, decisions, context)` 的**重算产物**，
 *   直接往 chain 里塞人，下一次重算就没了；而写进 flow 又会改到模板、影响后续所有单。
 *
 * 顺带处理**转办的展示口径**：转办进来的人是 `type: 'manager'`（他接替办理），
 * 若只做追加，同一环节会出现两位"审批人"，看起来像会签 —— 实际只有接替者在办。
 * 所以这里把被接替的那位标上 `transferred_to`（**仅展示用，不落库**），
 * 前端据此渲染成「已转办 → X」。
 */
export function mergeExtraMembers (
  chain: ApprovalChain,
  stepIds: string[],
  extraMembers?: Record<string, ApprovalChainItem[]>,
): ApprovalChain {
  if (!extraMembers) {
    return chain
  }
  for (const [i, step] of chain.entries()) {
    const adds = extraMembers[stepIds[i]]
    if (!adds?.length) {
      continue
    }
    for (const m of adds) {
      step.push({ ...m })
    }

    // 同一环节可能转过多次：取**最后**一位接替者（与 handleSelect 里"最后一位 manager 才是现经办人"一致）
    const transfers = adds.filter(m => m.delegated_from)
    const transfer = transfers.at(-1)
    if (!transfer) {
      continue
    }
    for (const m of step) {
      // 已办过的成员不标（那是历史轨迹）；仅展示字段，不影响任何求值
      if (m.type === 'manager' && !m.delegated_from && !m.result) {
        m.transferred_to = transfer.name
      }
    }
  }
  return chain
}

/** 单个环节的办理结论（运行时流水，按实际办理顺序追加）。
 *  同一 stepId 可出现多次 —— 驳回回退后重审会再产生一条，旧结论完整保留用于追溯。 */
export interface NodeDecision {
  /** 对应 flow / 分支 steps 里的步骤 id */
  stepId: string
  /** 审批结论标识：pass / reject / ... 取值见 APPROVAL_RESULTS */
  result: string
  /** 结论文案（如「通过」「驳回」） */
  result_label?: string
  /** 各选项的补充值：数量、金额、二级原因等，参与条件求值 */
  extra?: Record<string, unknown>
  /** 备注 / 审批意见 */
  opinion?: string
  /** 该环节上传的附件 */
  files?: ApprovalAttachment[]
  /** 办理时间（ISO 字符串） */
  handled_at?: string
}

// ===== 分支 =====
// 需求：同一个流程内可以有几条不同的走向，每条走向就是一个「分支」。
// 分支负责命名走向，并承载命中条件，走哪条由条件求值（或审批结果）决定。
// 流程被抽象成「顺序节点」，节点是以下两种之一：
//   1) approval —— 普通审批环节（等价于原来的 chain[i]）
//   2) branch   —— 分支组：内含若干命名分支，按「业务字段命中条件」或「上一环节审批结果」分流
// 画布上 approval 节点可有多条出线，出现第二条出线后这些出线即「审批结果分支」：
//   无条件出线为主线（审批通过 / 其余结论未命中时走这里，排 chain 时即主链路），
//   其余出线各绑定一个审批结论（data.condition 形如 { field: 'result', op: 'eq', value: 'reject' }）。
// 该结构保存时被拍平为「审批环节 + 结果分支组(branch)」两个顺序 flow 节点。
// condition 节点对应「业务字段条件分支组」；两者共用 branch flow 结构。
// 分支内允许再出现分支：分支步骤里 type='branch' 的步骤即嵌套分支组（可任意层级递归），
// 运行时按「局部汇聚」理解——嵌套分支组汇聚后回到父分支继续，不必先汇聚再拆。
// 旧数据（纯线性 chain）不需要迁移，用 chainToFlow() 升级即可。

/** 分支内的一个步骤：
 *  - 默认形态（type 缺省 / 'approval'）：一个或多个并行的审批人（即会签），保留旧数据的线性子步骤兼容；
 *  - type='branch'：一个嵌套分支组（分支内再按审批结果 / 业务条件分流），分支组步骤通过 branches 递归承载，
 *    支持任意层级「分支内再分分支」，无需先汇聚；
 *  - type='notify'：飞书提醒步骤（只通知、不办理，见 ApprovalFlowNotifyNode）；
 *  - type='probe'：数据查询步骤（分支里的查询节点，走向在建单期由查询结果冻定，见 utils/approvalProbe）。
 */
export interface ApprovalFlowStep {
  id: string
  /** 步骤名（可选），如「初审」「复核」；notify 步骤里它是提醒名称 */
  name?: string
  /**
   * 步骤形态：缺省 'approval'（兼容旧数据）；'branch' = 嵌套分支组；'notify' = 飞书提醒；
   * 'probe' = 数据查询；**'loop' = 组间轮询卡片**（按组各走一遍内部子流程，见 ApprovalFlowLoopNode）。
   *
   * 为什么卡片既要是"节点"又要是"步骤"：它在画布上是**一个节点**，但可以摆在两个位置 ——
   * 主流程上（= 顶层节点）或某条分支的链上（= 分支里的步骤）。
   * 后者就是需求里的「先按条件分流、只有某条分支里才轮询各组」。
   * 运行时两者走**同一套**建单期展开（见 utils/approvalRotation），只是产物形态不同：
   * 顶层展开成节点、分支里展开成步骤。
   */
  type?: 'approval' | 'branch' | 'notify' | 'probe' | 'loop' | 'ref'
  /** 该步骤的审批人（多人即会签）；type='branch' 的分支组步骤可留空；
   *  type='notify' 时它是**提醒对象**（同样支持 role 动态负责人） */
  members?: ApprovalChainItem[]
  /** type='notify' 的补充文案（可选） */
  content?: string
  /** type='probe' 的查询配置（建单期求值，与顶层数据查询节点同一套） */
  probe?: ProbeSpec
  /**
   * type='loop'（组间轮询卡片）的轮询配置：按哪些组、什么顺序。
   * 与顶层卡片、成员级轮询共用同一个 RotationSpec（建单期取数见 utils/rotationData）。
   */
  rotation?: RotationSpec
  /**
   * type='loop' 的**卡片级**走向：所有组都轮完、**一直没有跳出轮询** 时去哪。
   *
   * 不配 = 自然继续卡片后面那个环节（老行为，默认）；配了 = 走完最后一组后跳到该环节。
   * 与环上的「提前结束轮询」（`branch.exitTo`）是两回事：
   *   · 环上的 = **某一组接了**就跳出，剩下几组不再轮；
   *   · 这个   = **轮到最后一个组也没人接**。
   * 没有它这两种情况会落到同一个地方，"全部轮完"这类兜底走向就表达不出来。
   *
   * 目标必须是本图里的审批 / 提醒环节 —— 与卡片内部跳转**同一份白名单**
   * （见 utils/approvalFlow 的 outerExitIds；两处口径必须一致，否则会出现
   * "内部能跳、卡片级跳不过去"这种说不清的现象）。
   */
  afterLoop?: { stepId: string }
  /**
   * type='ref'（引用模板）指向的**源模板 id**（`app_chain` 记录的 id）。
   *
   * 与 `loop` 卡片一样是"**一段被搬过来的子流程**"，但内容**不**存在本模板里 ——
   * 只存一个引用，建单期才去读源模板、把它的流程整段搬进来（见 utils/templateRef）。
   * 这样源模板改了，之后新建的单自动用新版；已建的单因为快照自包含，不受影响。
   */
  refTemplateId?: string
  /**
   * 分支列表：type='branch'（嵌套分支组）/ type='probe'（存在-不存在两条）用；
   * `type='ref'` 时是"引用的那一段走完、按最后结论分流"的出线（见 ApprovalFlowRefNode.branches）。
   */
  branches?: ApprovalBranch[]
  /**
   * type='loop' 时是**卡片内部的子流程**（每个组各走一遍）；
   * 另外还兼容旧结构的线性子步骤（无新生产方；flowToChain 仍会递归拍平）。
   */
  steps?: ApprovalFlowStep[]
  /**
   * 审批步骤（type 缺省 / 'approval'）的**环节级办理选项树** ——
   * 与 ApprovalFlowApprovalNode.optionGroups 同一件事，只是这个环节挂在分支里（画布上审批节点画在分支内）。
   */
  optionGroups?: ApprovalOptionGroup[]
}

/**
 * 一个流程步骤的审批人 —— **两种写法都要认**。
 *
 *   · `members`：分支内步骤（ApprovalFlowStep）的常规字段（转换器写的就是它）；
 *   · `nodes`  ：顶层审批节点（ApprovalFlowApprovalNode）的字段。
 *
 * 为什么步骤也得认 `nodes`：**引用模板**搬进来的段落是"照抄源模板的形态"（见 utils/templateRef），
 * 源模板的**顶层**审批节点落到本流程的分支里就变成了"步骤"，却仍然带着 `nodes`，
 * 而 `members` 是个**空数组** —— 只读 `members` 的结果是这一环**一个人都没有**：
 * 引擎拿到空成员，时间线（ApprovalNode）就渲染不出任何人（实测：单据流转到「弃置模板」
 * 那一段时整环空白，见 collect 的调用点）。
 *
 * 与 `collectRejectTargets` 里的 `nodes ?? members` 保持同一口径，别在各处另写一套。
 */
export function stepMembersOf (
  step: Pick<ApprovalFlowStep, 'members'> & { nodes?: ApprovalChainItem[] },
): ApprovalChainItem[] {
  return step.nodes ?? step.members ?? []
}

/** 分支命中条件：字段 + 操作符 + 值；branch.condition 为空表示兜底（默认）分支 */
export interface BranchCondition {
  /** 参与判断的表单字段 key，如 amount / department */
  field: string
  /** 操作符 */
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'
  /**
   * 比较值（数字或字符串，求值时自动尝试数值比较）。
   *
   * `op === 'contains'` 时还允许是**一组值**，语义是「命中任一即满足」：
   *   多值列（销售状态「停售,在售」）经常要一次匹配好几个取值，
   *   写成数组就不必为同一个字段加好几条条件 —— 而多条条件还得同时选「任一满足」，
   *   那个组合方式是**整条分支**共用的，会连带影响它与其它条件的组合，很容易配错。
   *
   * 其它操作符遇到数组只会 `String()` 成一个逗号串参与比较（等于没填对），
   * 所以编辑器在**切换操作符时会主动把数组收回单值**（见 createStream 的 onOpChange）。
   */
  value: string | number | Array<string | number>
}

/**
 * 条件组：把若干条件（或更小的组）按 logic 组合起来。
 *
 * 为什么需要它：一组条件原先只能有一个 `logic`，于是「灯具>5000 **或** 非灯具>2000」
 * 这种**分档阈值**表达不了（只能拆成两层条件节点绕开）；也没有括号与取反。
 * 有了组就能直接写 `(是否灯具=是 and 金额>5000) or (是否灯具=否 and 金额>2000)`。
 *
 * 递归结构（组里可以再放组），求值见 `evalConditionExpr`。
 */
export interface ConditionGroup {
  /** 组内组合方式：and = 全部满足（默认），or = 任一满足 */
  logic: 'and' | 'or'
  /** 组内成员：条件，或更小的组 */
  items: ConditionExpr[]
}

/** 条件表达式：单个条件，或一个条件组（可任意嵌套） */
export type ConditionExpr = BranchCondition | ConditionGroup

/** 是不是条件组（组有 items，单个条件有 field） */
export function isConditionGroup (expr: ConditionExpr): expr is ConditionGroup {
  return Array.isArray((expr as ConditionGroup)?.items)
}

/**
 * 「选择接收团队」结论码。
 *
 * 语义：这一环的办理人**当场指定由哪个团队接下这批货**，命中即**终结流程**
 * （接收方是**结果**，不是下一环的审批人，见 CLOSE_FLOW_RESULTS）。
 * 所以模板里那个接收环节**可以留空**（`allowEmptyMembers`，编辑器已放开）——
 * 「谁接」由业务在办理时按实际情况决定，写死在模板里反而做不到。
 *
 * 候选来自**团队表**（utils/organazation 的 groupManage：`group` = 团队、`manager` = 团队负责人），
 * 按部门分组展示；不是整棵飞书通讯录，见 components/TeamPicker.vue 的说明。
 * 码值 `pick_members` 是历史叫法（原「选择接收组别」），不能改 —— 历史模板存的是它。
 */
export const PICK_MEMBERS_RESULT = 'pick_members'

/**
 * 「选择接收部门」结论码。
 *
 * 与「选择接收团队」是**同一族**的结论（当场指定接收方、命中即终结流程），差别只在**粒度**：
 *   · pick_members —— 选到**团队**（表里的 `group`），接收方记「团队名 + 团队负责人」；
 *   · pick_team    —— 选到**部门**（表里的 `parent`），接收方记「部门名 + 部门负责人」（`parentManager`）。
 *
 * 候选来自**团队表**，见 components/TeamPicker.vue 的 `mode="team"`（`mode` 值是历史命名）。
 */
export const PICK_TEAM_RESULT = 'pick_team'

/**
 * 「接收（填数量）」结论码：数量**由人填**，上限是「剩余接收数量」，且**可以等于**上限。
 *
 * 与另外两条接收类结论的分工：
 *   · `receive`（全部接收）—— 数量由系统锁成剩余，人不填；
 *   · `part_receive`（部分接收）—— 必须是"部分"，数量**严格小于**剩余；
 *   · `receive_qty`（接收）—— 能接多少填多少，**不大于**剩余，等于剩余即接完。
 *
 * 与它们一样计入「已接收数量」（见 RECEIVE_RESULTS），所以条件里的
 * 「剩余接收数量 > 0」照常按它扣减。
 */
export const RECEIVE_QTY_RESULT = 'receive_qty'

/** 审批结论选项：value 与运行时办理结论（result 码）保持一致，供「审批结果分支」配置与校验 */
export const APPROVAL_RESULTS: ReadonlyArray<{ value: string, label: string }> = [
  { value: 'pass', label: '通过' },
  { value: 'reject', label: '驳回' },
  /*
   * 「全部接收」：数量**不由人填** —— 系统取「剩余接收数量」（= 总库存数量 − 前面各环节已接收，
   * 取不到才退回总库存数量）并锁成只读，见 components/ApprovalNode.vue 的 receiveAll /
   * receiveCapText 与 utils/approvalTypes 的 BUILTIN.receive（prefillFromLimit + readonlyWhenFull）。
   * 要少收一部分就用下面那个「部分接收」。
   *
   * 文案改动说明：这里原来写「接收」，与办理端真正落库的 result_label「全部接收」不一致，
   * 结果同一件事在编辑器下拉里叫「接收」、在时间线上叫「全部接收」（踩过）。
   * 码值 `receive` **不能**改 —— 模板条件、历史单据里存的全是它。
   */
  { value: 'receive', label: '全部接收' },
  /*
   * 「不接收」：**组间轮询卡片内部**的分结论 —— 每轮到一个组，该组负责人要么「全部接收」
   * （那条线通常绑「跳出循环」：不再往后轮）、要么「不接收」（走主线继续轮下一组）。
   * 以前用户只能在卡片里写 `confirmed = 接收/不接收` 这种条件，而 confirmed 只有
   * 「报废清仓」才写入 —— 条件永远不命中，轮询分支等于失灵（踩过）。
   * 全局码表里有了它，编辑器「审批结论」下拉、办理下拉、引擎选路三处自动同口径。
   */
  { value: 'not_receive', label: '不接收' },
  { value: 'part_receive', label: '部分接收' },
  /*
   * 「接收」：数量由人填，上限是「剩余接收数量」，且**可以等于**上限
   * （等于剩余 = 这一环正好接完，不必再选「全部接收」）。
   * 详见 RECEIVE_QTY_RESULT 的说明。
   */
  { value: RECEIVE_QTY_RESULT, label: '接收' },
  { value: 'recycle', label: '回收' },
  /*
   * 「供应商回收」：与「回收」同一类处置结论（办理时同样填**回收数量 + 回收金额**，
   * 见 components/ApprovalNode.vue 的 needRecycle / supplier_recycle 分支），
   * 但业务上要能与"自己回收"分开统计，所以**单独一个码**，不要复用 recycle。
   *
   * ⚠️ 因此它也**不算接收**（不在 RECEIVE_RESULTS）—— 写法与 recycle 一致，
   *    `extra.qty` 是回收数量，混进「已接收数量」会把其余组还能接多少算错。
   */
  { value: 'supplier_recycle', label: '供应商回收' },
  { value: 'scrap', label: '报废清仓' },
  { value: 'rework', label: '建议返工' },
  { value: 'discard', label: '建议弃置' },
  { value: 'lack_demand', label: '市场需求不足' },
  { value: 'other_reason', label: '其他原因' },
  { value: 'pending', label: '待定' },
  // 「选择接收团队」：办理人当场指定由哪个团队接下这批货（命中即终结流程，
  // 接收方是**结果**、不是下一环的审批人 —— 见 PICK_MEMBERS_RESULT 的说明）。
  // 配套的是「允许没有审批人的环节」—— 模板里把接收环节留空，由上一环指定。
  // 白板上的「指定接收团队」就是这个环节。
  // （码值 `pick_members` 是历史叫法，原「选择接收组别」；老模板里的旧文案见 LEGACY_RESULT_TEXTS。）
  { value: PICK_MEMBERS_RESULT, label: '选择接收团队' },
  // 「选择接收部门」：粒度上移到部门（`parent`）—— 接收方是「部门 + 部门负责人」，
  // 命中即终结流程（见 PICK_TEAM_RESULT 与 CLOSE_FLOW_RESULTS）。
  // 编辑器里的「审批结论」下拉直接读这张表，所以这一条加进来，模板里立刻可选。
  { value: PICK_TEAM_RESULT, label: '选择接收部门' },
  // —— 原因分类：来自「库存管理流程规范」白板的「筛选一级原因/二级原因」环节——
  // 那一环的出线在图上没写标签，分类写在**目标节点标题**上，所以这些类是审批人的结论选项。
  // 纯新增，不影响已有模板（结论选项是按 flow 里绑的条件算出来的）。
  { value: 'cat_operation', label: '运营类' },
  { value: 'cat_infringe', label: '产品侵权类' },
  { value: 'cat_stock', label: '库存管理类' },
  { value: 'cat_env', label: '外部环境类' },
  { value: 'cat_quality', label: '质量问题类' },
  { value: 'cat_dev', label: '开发类' },
  { value: 'cat_supply', label: '供应链类' },
]

/**
 * 老模板里的**旧默认文案** → 现在码表里的文案（键是 `结论码|旧文案`）。
 *
 * 线上还有 12 处分支叫「接收」（白板出线名转成模板后就固定成这个字符串了），
 * 而码表、以及办理端落库的 result_label 都已经叫「全部接收」。不统一的话同一条结论
 * 在办理下拉里叫「接收」、办完在时间线上叫「全部接收」—— 同一件事两个名字。
 *
 * 为什么只在**文案完全等于旧默认值**时替换：模板作者自己起的名字（「同意接收」「团队接收」）
 * 必须原样保留，那是业务语义，不该被码表覆盖。
 * 为什么不刷库：模板随时会从白板重新生成（见 scripts/gen-approval-template.ts），
 * 刷一遍第二天又被生成回「接收」；在显示层归一一次就够，老单也不受影响。
 */
const LEGACY_RESULT_TEXTS: Record<string, string> = {
  'receive|接收': '全部接收',
  // 「组别」这个叫法已整体改为「团队」，选部门的码又接过了「选择接收团队」这个名字，
  // 两条都按**结论码**区分（键带码，不怕文案撞车）。
  'pick_members|选择接收组别': '选择接收团队',
  'pick_team|选择接收团队': '选择接收部门',
}

/** 分支 / 选项的展示文案：旧默认文案跟着码表走，自定义文案原样返回 */
function resultTextOf (result: string, text: string): string {
  return LEGACY_RESULT_TEXTS[`${result}|${text}`] ?? text
}

/** 审批单状态（approval_chain.status） */
export const APPROVAL_STATUS = {
  /** 进行中：仍有环节待办 */
  PENDING: 0,
  /** 通过：流程走完且未落入驳回类走向 */
  APPROVED: 1,
  /** 驳回：流程因驳回类走向而终止 */
  REJECTED: 2,
} as const

/** 视为「驳回」的结论值，用于终态判定：
 *  终止分支绑定了这些结论，或最后一个办理环节的结论属于这些值。
 *  业务上若要把「建议弃置」「报废清仓」也算驳回终态，往这里加即可。 */
export const REJECT_RESULTS: ReadonlyArray<string> = ['reject']

/**
 * 「待定」结论码（APPROVAL_RESULTS 里的 `pending`）。
 *
 * 它会**结束流程**，但既不是通过也不是驳回 —— 单据的展示状态据此单独分出「待定」一档
 * （见 utils/approvalFilters 的 approvalStageOf）；模板里「待定（一个月）」那种走法就是这个。
 */
export const PENDING_RESULT = 'pending'

/**
 * 命中即**终结流程**的结论：这一步办完流程就结束，后面的环节不再展开、也就没人有权限办。
 *
 * 目前是「选择接收团队」与「选择接收部门」两条：接收方是**结果**（哪个团队 / 哪个部门接下这批货），
 * 不是下一环的审批人。所以模板里配这两条结论的分支，后面接什么都不会生效（建议直接连到结束节点）。
 *
 * 与 REJECT_RESULTS 的唯一区别在终态判定：这里的终结算**通过**（流程正常走完），
 * REJECT_RESULTS 算驳回。见 outcomeOf()。
 */
export const CLOSE_FLOW_RESULTS: ReadonlyArray<string> = [PICK_MEMBERS_RESULT, PICK_TEAM_RESULT]

/**
 * 「接收」类结论码：只有这两种结论下，办理流水里的 `extra.qty` 才表示**这一轮接收了多少件**。
 *
 * 为什么单列一份：`recycle`（回收）也写 `extra.qty`，但那是回收数量、业务含义不同 ——
 * 混进「已接收数量」会让"其余组还能接多少"算错。
 */
export const RECEIVE_RESULTS: ReadonlyArray<string> = ['receive', 'part_receive', RECEIVE_QTY_RESULT]

/** 「总库存数量」这一业务列：接收数量的上限来源，也是「剩余」的基数 */
export const STOCK_QTY_FIELD = '总库存数量'

/** 派生字段（运行期才有值）：按办理流水累计的**已接收数量** —— 分支条件里可直接写它 */
export const RECEIVED_QTY_FIELD = '已接收数量'

/**
 * 派生字段（运行期才有值）：**剩余接收数量** = 总库存数量 − 已接收数量（不小于 0）。
 *
 * 用途：一批货先被某个组「部分接收」，剩下的要流转给其他组/团队接着收 ——
 * 模板里就用它分流，例如「剩余接收数量 > 0」时走组间轮询 / 下一个接收环节。
 */
export const REMAINING_QTY_FIELD = '剩余接收数量'

/**
 * 「选择接收团队 / 选择接收部门」的接收方：**团队（或部门）+ 负责人**（+ 历史单里可能存过的部门 / 邮箱）。
 *
 * `manager` 是表里维护的负责人（团队级取 `manager`、部门级取 `parentManager`），
 * 办理时随选中一起记进 `extra.members` —— 时间线上要一眼看出"货交给谁、找谁"。
 */
export interface ReceiverTeam extends ApprovalChainItem {
  /** 该团队负责人 / 该部门负责人（团队表维护；表里没填时没有这个字段） */
  manager?: string
  /**
   * 接收方是**哪一层**：`group` = 选择接收团队（manager 是团队负责人）；
   * `team` = 选择接收部门（manager 是部门负责人）。
   *
   * 历史单没有这个字段 —— 由 receiverOf 依据结论码补上；界面据此决定「团队 / 部门」文案。
   * ⚠️ 这两个字符串是模板快照里的值，不能改（`team` 现在选的是部门）。
   */
  pick?: 'group' | 'team'
}

/**
 * 取「选择接收团队 / 选择接收部门」的办理结果（接收方），用于在时间线上**单独渲染一个节点**。
 *
 * 为什么单独取：命中 CLOSE_FLOW_RESULTS 的结论会终止流程，接收方**不是**任何一个
 * chain 环节的审批人（它不在 chain 里），所以只能从办理流水里取出来单独展示。
 * 同一单可能被驳回重审过，取**最后一条**这类结论；两条结论都认（粒度不同，见 PICK_TEAM_RESULT）。
 */
export function receiverOf (order: ApprovalOrder | null | undefined): ReceiverTeam | undefined {
  const decisions = order?.chain?.decisions ?? []
  for (let i = decisions.length - 1; i >= 0; i--) {
    const d = decisions[i]
    if (d.result !== PICK_MEMBERS_RESULT && d.result !== PICK_TEAM_RESULT) {
      continue
    }
    const raw = d.extra?.members
    const one = Array.isArray(raw) ? raw[0] : raw
    if (one && typeof one === 'object') {
      const item = one as ReceiverTeam
      // 粒度以**结论码**为准（历史单里没有 pick 字段）：pick_team 才是团队级
      return { ...item, pick: item.pick ?? (d.result === PICK_TEAM_RESULT ? 'team' : 'group') }
    }
  }
  return undefined
}

/** 分支：一条命名的走向，可以挂直属审批人 + 顺序步骤（步骤里可再嵌分支组，即分支内的分支） */
export interface ApprovalBranch {
  id: string
  /** 分支名，如「财务审批」「技术审批」 */
  name: string
  /** 命中条件（可选）；为空 = 默认分支（审批结果分支里即「主线」）。
         field 为保留字段 result 时表示按上一环节审批结论分流，value 取值见 APPROVAL_RESULTS。
         单条件时代留下的字段，等价于 conditions[0]；新数据以 conditions 为准 */
  condition?: BranchCondition | null
  /** 多条件组合方式：and = 全部满足（默认），or = 任一满足 */
  logic?: 'and' | 'or'
  /** 该分支的全部命中条件（可按 and/or 组合，允许嵌条件组）。
     *  审批结果分支要求**顶层**有一个结论条件（field='result'），它是硬前提；
     *  放进组里的 result 条件不做硬前提，按该组 logic 参与运算。 */
  conditions?: ConditionExpr[]
  /** 顶级分支直属审批人（可选，顺序排在 steps 之前） */
  members?: ApprovalChainItem[]
  /**
   * 该分支的**选项文本**（结果分支专用，可选，见 ApprovalNodeOption）：
   * 办理下拉里按这些文本逐条渲染；**选哪个都提交本分支绑定的那个审批结论**。
   * 空 / 未配 = 下拉里退回用分支名当一个选项（旧口径）。
   */
  options?: string[]
  /**
   * **办理选项条件**（结果分支专用，可选）：满足这些条件才把本分支的选项摆给办理人。
   *
   * 与 `conditions` 的分工（两者正交，别混进同一个数组）：
   *   · `conditions` = **引擎选路**：办理人提交后按它决定走哪条线（`matchBranch`）；
   *   · `offerWhen`  = **只影响渲染**：办理那一刻这条线的选项摆不摆出来。过滤在办理端做
   *     （见 filterOfferedOptions），**完全不参与选路**。
   *
   * 典型场景：同一个环节，不同来路给不同选项 —— 例如「团队负责人审批」的「同意接收」，
   * 只在"上一环节结论 = receive"（前面某组真的接了）时才该出现；前面各组全都不接收时，
   * 这一环不该给「同意接收」。条件是**办理期**求值的，可用字段见 utils/conditionFields
   * （含 `result` = 上一环节结论、业务字段、累计接收数量）。
   */
  offerWhen?: ConditionExpr[]
  /**
   * 该分支的**选项树**（结果分支专用，可选，见 ApprovalOptionGroup）：
   * 配了它就以它为准 —— 办理时按「类别 → 一级 → 二级」分类展示，
   * 且每个一级选项的 `link` 决定**实际走哪条线**（与类别归类解耦）。
   * 与 `options` 同时存在时**以选项树为准**。
   *
   * ⚠️ 这是**老口径**（树挂在连线上）。现在配置是**环节级**的（`ApprovalNodeData.optionGroups`），
   * 编译时写到 `ApprovalFlowApprovalNode.optionGroups` / `ApprovalFlowStep.optionGroups`；
   * 两者同时存在时**以环节级为准**（见 collectStepOptionItems 的 optionsOfApproval）。
   * 保留本字段只为兼容已保存的流程。
   */
  optionGroups?: ApprovalOptionGroup[]
  /** 顺序步骤：分支自己的审批环节链；允许出现 type='branch' 的嵌套分支组步骤（递归），
         也允许普通审批步骤带旧式线性 steps（兼容旧数据） */
  steps: ApprovalFlowStep[]
  /** 驳回/打回回到指定步骤：分支不再向后推进，而是把整条审批流回退到目标步骤（按步骤 id 引用）。
     *  steps 可为空（也可附带返回前的处理步骤，如通知）。该分支不会进入主干主链/主干汇聚。 */
  loopBackTo?: { stepId: string }
  /**
   * 跳出循环：命中本分支时不再顺序推进，而是**跳到目标环节、从它本身开始办**。
   *
   * 与 loopBackTo 的区别只在一处：loopBackTo 从目标的**下一环**续走（目标是"重新办理"），
   * exitTo 从目标**本身**开始（目标还没办过，要办它），中间的环节全部跳过。
   *
   * 典型用途：「组内循环」里某个结论命中即**提前退出轮询**，直接进后续环节 ——
   * 而画布是树结构（同一节点被重复经过就报错），"分支汇回主干"画不出来，
   * 所以用这个字段表达"跳过去"，而不是在画布上连一条合并线。
   *
   * ⚠️ 目标必须是循环**之后**的环节，否则语义退化成 loopBackTo（回退重办）。
   * 同样不进入主干主链 / 主干汇聚（与 loopBackTo 一致）。
   */
  exitTo?: { stepId: string }
  /** 是否为「出口」：该分支的连线直达结束节点，命中即整条流程终止。
     *  由 graphToFlowFrom 在转换时写入 —— 它算过分支终点，不必等运行时回查画布。
     *  为什么需要：分支汇到后续节点时 steps 同样为空，光看 steps 分不清「终止」和「继续」。
     *  旧数据没有该字段时，运行时退化为查单据快照的出口表（`branchTerminal`，
     *  见 branchTerminalMapOf）；更老的单（快照里连出口表都没有）才现算画布。 */
  isEnd?: boolean
}

/**
 * 办理下拉里的一个**选项** —— 由该环节的「审批结果分支配置」推导（见 collectStepOptionItems）。
 *
 * 三级配置口径（从新到旧）：
 *   · **环节级选项树**（`node.data.optionGroups`，见 ApprovalOptionGroup）→
 *     整个环节只有一项，本类型的 `nodeLevel = true`：办理时**不再显示"选择处理方式"**，
 *     直接把树展开成「类别 → 一级 → 二级」，每个一级自带的「实际链路」决定走哪条线；
 *   · 线级**选项树**（`edge.data.optionGroups`，老口径，仍兼容）→
 *     办理时按「类别 → 一级 → 二级」分类展示，**每个一级选项自带「实际链路」** ——
 *     提交时用的是这个链路码，所以**显示归类与实际走哪条线是解耦的**；
 *   · 什么都不配 → 下拉里就是分支名（`edge.data.options` 的选项文本同理，都是老口径）。
 *
 * `result` 是运行时匹配连线用的结论码；`text` 只给人看（提交时随 result_label 落到单据上）。
 */
export interface ApprovalNodeOption {
  /** 显示文字 = 线上配的选项文本（没配则取分支名）；环节级选项树时用不上（没有"处理方式"这一层） */
  text: string
  /** 提交时用的结论码（决定走哪条线）：配了选项树取一级的 link，否则取本分支绑定的结论码 */
  result: string
  /** 该选项的**分类选项树**（配了才在办理时展开成「类别 → 一级 → 二级」） */
  groups?: ApprovalOptionGroup[]
  /**
   * 办理选项条件（来自配它的那条分支，见 `ApprovalBranch.offerWhen`）：
   * 办理端按当前上下文过滤 —— 不满足就不把这个选项摆出来。
   * 收集时**只搬运不过滤**：收集是纯函数、没有运行期上下文，而且它的输出还被
   * `collectStepResultOptions` 当"这一环能选哪些结论"用，过滤会让两处口径分叉。
   */
  offerWhen?: ConditionExpr[]
  /**
   * 这一项来自**环节级选项树**（整个环节共用一棵树，见 ApprovalNodeData.optionGroups）。
   *
   * 办理时与线级树有两处不同（因为"结论"已由树里的一级决定，不再有"处理方式"这一层）：
   *   1. 不显示「选择处理方式」控件，直接呈现选项树；
   *   2. 表单按**所选一级的「实际链路」**展开（如选中链路是「回收」才要填数量/金额）。
   */
  nodeLevel?: boolean
  /**
   * 本环节有「驳回 → 回退上一环」这个出口（保存期 `ensureRejectLoopBack` 给每个
   * **有上一环**的环节都注入了一条绑 `reject` 的分支）。
   *
   * 为什么单独给这个标记：环节级树下"选什么"全部来自模板的那棵树，而那条驳回分支
   * **不在树里**（它是流程自带的兜底出口）—— 老口径下它作为一条普通分支出现在下拉里，
   * 换成环节级树后就没了路，所以办理端要据此在选项**末尾补一个「驳回」**。
   * 首环节没有上一环 → 没有这条分支 → 不补（不然点了驳回无处可退）。
   */
  canReject?: boolean
}

/** 办理选项树里的一个**一级选项** */
export interface ApprovalOptionLeaf {
  /** 显示文案 */
  text: string
  /**
   * **实际链路**：本节点**哪条出线**（= 那条线绑定的审批结论码）。
   * 它才是提交时真正用的结果码 —— 与上面的类别归类**无关**
   * （例如：类别「开发类」下的「产品质量问题」可以指向"产品质量"那条线，
   *  而其余原因都指向另一条线）。
   */
  link: string
  /** 二级选项（只细分展示，**实际链路跟随本一级**） */
  children?: string[]
}

/** 办理选项树里的一个**类别**：标题就是办理时的分组标题（如「外部环境」） */
export interface ApprovalOptionGroup {
  title: string
  items: ApprovalOptionLeaf[]
}

/**
 * 把线上配的**选项树**规范化：
 * 类别标题 / 一级文案 trim 后非空才保留；`link` 非空才保留（没有链路就无法决定走向）；
 * 二级文案走 normalizeOptionTexts 的去空去重。返回空数组 = 这条线没配选项树。
 */
export function normalizeOptionGroups (raw: unknown): ApprovalOptionGroup[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: ApprovalOptionGroup[] = []
  for (const g of raw as Array<Partial<ApprovalOptionGroup>>) {
    const title = String(g?.title ?? '').trim()
    const items: ApprovalOptionLeaf[] = []
    for (const it of Array.isArray(g?.items) ? g.items : []) {
      const text = String((it as Partial<ApprovalOptionLeaf>)?.text ?? '').trim()
      const link = String((it as Partial<ApprovalOptionLeaf>)?.link ?? '').trim()
      if (!text || !link) {
        continue
      }
      const children = normalizeOptionTexts((it as Partial<ApprovalOptionLeaf>)?.children)
      items.push({ text, link, ...(children.length > 0 ? { children } : {}) })
    }
    if (items.length > 0) {
      out.push({ title, items })
    }
  }
  return out
}

/**
 * 把线上配的「选项文本」规范化：数组或分隔字符串都收，去空白项、去重（保序）。
 * 返回空数组 = 这条线没配选项（下拉里退回用分支名）。
 *
 * 分隔符支持：`,` `，` `、` 与换行 —— 所以**选项文本里不要再写这些符号**（写进去会被切开）。
 */
export function normalizeOptionTexts (raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.map(x => String(x ?? ''))
    : (typeof raw === 'string' ? raw.split(/[,，、\n]/) : [])
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const t = item.trim()
    if (!t || seen.has(t)) {
      continue
    }
    seen.add(t)
    out.push(t)
  }
  return out
}

/** 把选项文本数组合成一行可编辑文本（编辑器输入框回显用，与上面的分隔符口径一致） */
export function optionTextsToText (list?: string[]): string {
  return (list ?? []).join('，')
}

/** 流程节点：普通审批环节 */
export interface ApprovalFlowApprovalNode {
  id: string
  type: 'approval'
  /** 该环节的审批人，多人时为会签 */
  nodes: ApprovalChainItem[]
  /**
   * 本环节**共用的办理选项树**（画布上配在审批节点上，见 ApprovalNodeData.optionGroups）。
   * 配了它：办理时整个环节就呈现这一棵树（不再先选"处理方式"），每个一级的「实际链路」决定走哪条线。
   * 线级的 `ApprovalBranch.optionGroups` 是老口径，两者同时存在时**以本字段为准**。
   */
  optionGroups?: ApprovalOptionGroup[]
}

/** 流程节点：分支组 */
export interface ApprovalFlowBranchNode {
  id: string
  type: 'branch'
  /** 分支列表 */
  branches: ApprovalBranch[]
}

/**
 * 流程节点：飞书提醒（只通知、不办理）。
 *
 * 语义（三条，缺一不可）：
 *  1. **在审批环节中体现**：它会作为一环出现在审批时间线上，看得见「走到了这里、通知了谁」；
 *  2. **不参与办理**：不产生待办 —— 流程到达即自动穿过，不写 decisions、
 *     不需要审批人填写结论，因此也**不会**成为 currentStep 卡住整条流程；
 *  3. **到达即发**：流程刚推进到它的那一刻发一条飞书消息（发送见 composables/useNodeSubmit）。
 *
 * 提醒对象复用审批环节的成员结构（`ApprovalChainItem`，含 `role` 动态负责人）：
 * 「固定的人」与「按数据行字段取部门负责人」两种都能表达，不必再造一套配置交互。
 *
 * ⚠️ 出线必须**恰好一条**：它没有结论、也没有条件可分流，多条出线无从选择。
 */
export interface ApprovalFlowNotifyNode {
  id: string
  type: 'notify'
  /** 提醒名称，如「通知财务」；也是时间线上显示的那一环 */
  name: string
  /** 提醒对象（固定成员 / 动态负责人） */
  members: ApprovalChainItem[]
  /** 可选补充文案，拼在自动生成的内容后面 */
  content?: string
}

/**
 * 「数据查询」节点的配置：**建单时**去 PocketBase 查"有没有满足条件的记录"。
 *
 * 为什么不能运行期查（三条理由，与 utils/approvalRotation 的说明同源）：
 *  1. `rebuildChain` 是**纯同步**函数，被审批页 / 首页抽屉 / 提交环节反复调用 —— 塞 IO 等于每次渲染打库；
 *  2. 同一份 decisions 在不同时间必须算出同一条链，否则历史单会"漂移"（待办人自己变、时间线错位）；
 *  3. 查询结果不可重现（数据一周一刷），事后查不出"当时是按什么定的路"。
 *
 * 所以：**建单那一刻查一次，把走哪条分支冻进单据**（见 utils/approvalProbe）。
 */
export interface ProbeSpec {
  /** PocketBase 集合名（保存期按白名单校验，见 utils/approvalProbe 的 PROBE_COLLECTIONS） */
  collection: string
  /**
   * PB filter（可留空 = 只要该集合里有记录就命中）。
   * `{:字段名}` 取**当前审批单**的值，与轮转行条件同一套写法，例如：
   *   `sku = {:SKU} && status = 0`
   */
  filter?: string
}

/** 「数据查询」节点两条出边的名字：画布上连线的名称必须与之一致（保存期校验） */
export const PROBE_EXISTS_BRANCH = '存在'
export const PROBE_EMPTY_BRANCH = '不存在'

/**
 * 流程节点：数据查询（存在性判断）。
 *
 * 建单时查一次，命中 ≥1 条走「存在」分支、否则走「不存在」分支；
 * 展开时**只保留命中的那条分支**（见 utils/approvalProbe 的 expandProbes），
 * 所以 `rebuildChain` / 时间线 / 催办 / 驳回重审全都不需要改。
 */
export interface ApprovalFlowProbeNode {
  id: string
  type: 'probe'
  /** 环节名（时间线上显示，如「查是否已有在办单」） */
  name?: string
  spec: ProbeSpec
  /** 两条分支：`PROBE_EXISTS_BRANCH` / `PROBE_EMPTY_BRANCH` */
  branches: ApprovalBranch[]
}

/**
 * 流程节点：「组间轮询」卡片 —— **一段"每个组各走一遍"的子流程**。
 *
 * 与「成员级轮询」（`ApprovalChainItem.rotation`）的分工：
 *   · 成员级轮询：只把**一个环节**的审批人换成各组负责人，那一环**没有子流程**；
 *   · 卡片：卡片内部可以放**审批节点 / 条件分支 / 提醒**，按组各走一遍 ——
 *     于是"每个组各自的流程"（如 A 组走财务、B 组走仓库）才表达得出来。
 *     ⚠️ 成员级轮询做不到这一点：它后面那条下游分支，运行时在**所有环办完之后**只判一次
 *     （实测确认），拿不到"这一环是哪个组"。
 *
 * 怎么进流程：仍然是**建单期展开**（见 utils/approvalRotation 的 stampRing）——
 * 对每个组复制一份卡片内部子流程，id 加 `#环号`、`loop_leader` 填成该组组名。
 * 展开产物是**普通节点 / 普通步骤**，所以 `rebuildChain` / 时间线 / 催办 / 驳回重审全都不用改。
 *
 * 卡片内部环节的默认审批人是**本环的组负责人**（`role.kind = 'loop_leader'`），可改成固定人或其它角色。
 */
export interface ApprovalFlowLoopNode {
  id: string
  type: 'loop'
  /** 卡片名（时间线与报错里显示，如「各组自审」） */
  name?: string
  /** 轮询配置：按哪些组、按什么排序（与成员级轮询共用同一个 RotationSpec） */
  rotation: RotationSpec
  /** 卡片内部的子流程：每个组各走一遍（审批 / 分支 / 提醒；数据查询在建单期更早展开） */
  steps: ApprovalFlowStep[]
  /**
   * 卡片级走向：所有组都轮完、**一直没有跳出轮询** 时去哪（不配 = 继续卡片后面那个环节）。
   * 详见 ApprovalFlowStep.afterLoop 的说明 —— 两种形态共用同一个字段语义。
   */
  afterLoop?: { stepId: string }
}

/**
 * 流程节点：**引用模板** —— 把另一个模板的流程整段搬到这里。
 *
 * 与「组间轮询」卡片同属"建单期展开成普通步骤"，但搬的是**外部模板**：
 *   · 模板里只存 `refTemplateId`（不复制内容）⇒ 源模板改了，之后新建的单自动用新版；
 *   · **建单期**读源模板的 flow、给所有 id 加前缀后拼进本流程（见 utils/templateRef），
 *     之后 probe / loop 展开、角色解析都照常作用在这段内容上；
 *   · 因为单据快照自包含（`approval_chain.chain.flow`），**已建的单不受源模板改动影响**。
 *
 * 为什么不让它留在流程里到运行期再解析：`rebuildChain` 是纯同步函数、被反复调用，
 * 且历史单必须"同一份 decisions 永远算出同一条链"（理由与 ProbeSpec / RotationSpec 同源）。
 */
export interface ApprovalFlowRefNode {
  id: string
  type: 'ref'
  /** 引用卡片的名字（时间线 / 报错里显示，取源模板名） */
  name?: string
  /** 源模板 id（`app_chain` 记录 id） */
  refTemplateId: string
  /**
   * 「按结论分流」的出线（画布上接了 **≥2 条出线** 时才写它）。
   *
   * 语义：接哪条线，由**这一段最后办出来的那个结论**决定 —— 引擎每办完一环就把结论写进
   * 下游的 `result`（见 formOf），引用段落里最后被办理的那个结论就是它。
   * 每条线的 `conditions` 写 `result = 结论码`（编辑器里就是「上一环节的审批结论」那一套），
   * 允许留**一条无条件主线**兜底（与审批结果分支同一口径：一条主干 + 若干结论线）。
   *
   * 不写这个字段 = 老语义：**这一段走完，继续卡片后面那个环节**（单出线，"穿过去"）。
   *
   * ⚠️ 所以**单出线时不要给那条线配结论条件**：那样写本意是"只在这个结论才往下走"，
   *    可这条线之外没有"否则"可走 —— `graphToFlowFrom` 会当场报错，不静默忽略。
   *
   * `branches[].steps` 装的是**本模板自己的下游环节**（不是源模板的），
   * 所以建单期展开时这部分**不做 id 前缀** —— 与搬进来的那一段正好相反（见 utils/templateRef）。
   */
  branches?: ApprovalBranch[]
}

export type ApprovalFlowNode = (ApprovalFlowApprovalNode | ApprovalFlowBranchNode | ApprovalFlowNotifyNode | ApprovalFlowProbeNode | ApprovalFlowLoopNode | ApprovalFlowRefNode) & {
  /**
   * 这一环是**一条「脱线支路」的起点**（由 utils/approvalFlow 的 graphToFlowFrom 在
   * 「结束」节点处按支路分段时写入）。
   *
   * ## 为什么需要它
   *
   * 「提前跳出 / 跳出循环 / 轮完走向」的落点通常画在画布旁边，是**独立的一条支路**
   * （最常见的接法就是"跳出轮询 → 发个飞书提醒 → 结束"）。可 flow 是一个**扁平数组**，
   * `graphToFlowFrom` 为了运行期按 id 找得到落点，会把这些支路**首尾相接地铺在 flow 末尾**
   * —— 两条支路之间没有任何标记。
   *
   * 于是运行时顺序推进时，"提醒14" 走完会自然滑进 "提醒15"、"提醒3"（那是**别的**
   * 跳出线各自的支路），把它们也执行一遍：一次跳出，连发三条提醒（实测单号 1792496009092 /
   * 1792547162214，模板里三条跳出线各接了一个提醒环，链路把三条全走了）。
   *
   * 有了这个标记：顺序推进到"另一条支路的起点"就停（见 rebuildChain 的 walkFlow）；
   * 而**跳转**落到它是正常的（`exitTo` 就是"从支路自己的开头开始走"），不受影响。
   */
  branchStart?: boolean
}

/** 完整审批流：顺序节点，支持分支 */
export type ApprovalFlow = ApprovalFlowNode[]

/** 画布上「数据查询」节点的 data（graphToFlowFrom 读它转成 ApprovalFlowProbeNode） */
export interface ProbeNodeData {
  /** 环节名（时间线上显示） */
  title: string
  probe: ProbeSpec
}

/**
 * 画布上「组间轮询」卡片节点的 data。
 *
 * `graph` 是卡片内部那张**小画布的快照**（含开始 / 结束节点，与模板的 graph 同一形状）——
 * 保存时由 utils/loopCardGraph 转成 `ApprovalFlowLoopNode.steps`。
 * 为什么存图而不是存 steps：编辑时要能原样还原（节点坐标、连线），steps 丢掉了这些；
 * 而且内部图复用同一个 `graphToFlowFrom` 转换与校验，不必再写一套。
 */
export interface LoopNodeData {
  /** 卡片名（时间线 / 报错里显示） */
  title: string
  /** 轮询配置：按哪些组、什么顺序（与成员级轮询同一个 RotationSpec） */
  rotation: RotationSpec
  /** 卡片内部的画布快照 */
  graph: {
    nodes: any[]
    edges: any[]
    viewport?: { x: number, y: number, zoom: number }
  }
  /**
   * 卡片级走向（画布上存**目标节点的 id**，与内部连线的 `edge.data.exitTo` 同一写法）：
   * 所有组都轮完、一直没跳出轮询时去哪个环节。
   * 空 = 继续卡片后面那个环节。转成 flow 时会被包成 `afterLoop: { stepId }`，见 ApprovalFlowLoopNode。
   *
   * ## 与"出线"的关系（见 FlowGraphEdge.data.loopExit）
   * 想让「轮完」和「提前跳出」各走各的路线时，画布上给卡片接出线：
   *   · 没标（或标 `'done'`）的那条 = 「轮完」→ 它就是卡片的后继（= 这里 `afterLoop` 想表达的那条路），**只能一条**；
   *   · 标了 `loopExit: 'early'` 的 = 「提前跳出」，可以**多条**、各自连到不同环节；
   *     环内「提前结束轮询」那条线自己选跳到哪一条（只有恰好一条时才可以留空走缺省）。
   * 接了出线时这一项**必须留空**（两处都配会报"轮完走向配了两处"）；
   * 只有一条出线时它照旧是"改这条去路"的入口（老行为，没配 = 走那条线）。
   */
  afterLoop?: string
}

/**
 * 画布上「引用模板」卡片节点的 data（graphToFlowFrom 读它转成 ApprovalFlowRefNode）。
 *
 * 与 `LoopNodeData` 的差别：卡片内部**不存画布**，只存一个指向源模板的引用 ——
 * 内容只有一份（在源模板里），这正是"复用而不是复制"的关键。
 */
export interface RefNodeData {
  /** 卡片名（可改，默认取源模板名） */
  title: string
  /** 源模板 id（`app_chain` 记录 id）；未选时为空串，保存期报错 */
  refTemplateId: string
  /**
   * 源模板名（**冗余存一份，仅供显示**）：源模板被删/改名后卡片上还能看出原本引的是谁；
   * 真正解析流程时只认 `refTemplateId`（见 utils/templateRef）。
   */
  refTemplateName?: string
}

// ===== Vue Flow 画布节点 data =====

/** 审批节点（approval）/ 提醒节点（notify）的画布 data：环节名 + 成员（审批人/抄送人/提醒对象） */
export interface ApprovalNodeData {
  /** 环节名，如「初审」「财务复核」「通知财务」 */
  title: string
  /** 成员列表，type 区分审批人（manager）/ 抄送人（cc）；notify 节点里是提醒对象 */
  members: ApprovalChainItem[]
  /** 仅 notify 节点用：提醒的补充文案 */
  content?: string
  /**
   * 仅 approval 节点用：本环节**共用的办理选项树**（类别 → 一级 → 二级，见 ApprovalOptionGroup）。
   *
   * 为什么挂在**节点**上而不是连线上：树里每个一级选项自带「实际链路」，
   * 能指到本节点任意一条出线 —— 一棵树本来就覆盖整个环节，所以它是"一个环节一份"，
   * 由该环节的各条结果分支共用（配置入口见 createStream / LoopCardCanvas 的「配置选项」）。
   */
  optionGroups?: ApprovalOptionGroup[]
}

/** 生成节点 / 分支的本地 id */
export function uid (): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 按分支名查找分支：运行时由提交人指定分支名时用 */
export function findBranch (node: ApprovalFlowBranchNode, name: string): ApprovalBranch | null {
  return node.branches.find(b => b.name === name) ?? null
}

// ===== 条件求值（运行时自动选路） =====

/**
 * 求值上下文里的「**当前环节对应的组**」字段名（分支条件里可选）。
 *
 * 为什么需要它：按组轮询展开出来的每一环，判条件时上下文里只有
 * 「建单快照 + 该环结论 + 该环办理人填的值」（见 rebuildChain 的 formOf），
 * 于是「A 组走这条、其它组走那条」这类条件写不出来 —— 快照里的「组别」是**单据自己的**
 * 组别，不是正轮到的那一环的组。
 *
 * 取值来源：展开后的成员带 `role.dept = 组名`（见 utils/approvalRotation 的 splitMembers），
 * 求值时读它 —— 与轮询的筛选/排序同一个来源，不会出现"两边算的组不是同一个"。
 *
 * ⚠️ 只对**分支条件**有意义（求值走 rebuildChain）。「按组轮询」自己的筛选条件是拿
 *    BI 行数据求值的（见 utils/rotationData），那里没有这个字段，写了不会命中。
 *
 * ⚠️ 它只能做「**整体分流**」，做不了「每个组各自分流」：轮询节点后面那个分支节点，
 *    运行时是在**所有环都办完之后**才被求值**一次**的（walkFlow 顺序推进；展开只是把一个
 *    环节换成 N 个连续环节，分支节点并没有跟着复制），所以那时上下文里是**最后一环**的组
 *    与结论（实测：三环 A/B/C 全通过，条件「当前组别 = A组」不命中，走的是兜底分支）。
 *    要按组逐个分流，得在展开时把分支也按环复制（本次未做）。
 */
export const CURRENT_GROUP_FIELD = 'current_group'

/** 分支的全部命中条件：优先用多条件 conditions，兼容旧的单条件 condition */
export function branchConditions (b: ApprovalBranch): ConditionExpr[] {
  if (b.conditions && b.conditions.length > 0) {
    return b.conditions
  }
  return b.condition ? [b.condition] : []
}

/**
 * 求值一个条件表达式（条件或条件组）。
 *
 * 空组按「恒真」处理：组还没配条件时不该把分支拦掉 ——
 * 与"整条分支没有任何条件 = 兜底分支"保持一致的直觉。
 */
export function evalConditionExpr (expr: ConditionExpr, form: Record<string, unknown>): boolean {
  /*
   * 脏数据兜底：组里的 items 混进 null / undefined 时（历史模板、手改过的 JSON），
   * 往下走会在 `form[expr.field]` 上抛 TypeError —— 整条分支的求值直接崩掉，
   * 与本文件「取不到值就不命中」的口径相反。这里按不命中处理。
   */
  if (!expr) {
    return false
  }
  if (isConditionGroup(expr)) {
    if (!expr.items?.length) {
      return true
    }
    return expr.logic === 'or'
      ? expr.items.some(i => evalConditionExpr(i, form))
      : expr.items.every(i => evalConditionExpr(i, form))
  }
  return evalCondition(expr, form[expr.field], form)
}

/** 该条件是不是「按上一环节审批结论分流」的结果条件 */
export function isResultCondition (expr: ConditionExpr): boolean {
  return !isConditionGroup(expr) && expr.field === 'result'
}

/**
 * 取分支**顶层**结果条件的取值（没有则 undefined）。
 *
 * 「顶层」这两个字是关键：审批结果分支里结论条件是**硬前提**（见 matchBranch），
 * 放在组里的 result 条件则按普通条件参与该组运算 —— 两处口径必须一致，
 * 所以判定终态、收集可选结论都用这一个函数。
 */
export function firstResultValueOf (b: ApprovalBranch): string | undefined {
  const hit = branchConditions(b).find(isResultCondition) as BranchCondition | undefined
  /*
   * 数组只会出现在「包含」里，而它不是一个结论码 —— 必须挡掉：
   * 放过去的话 `String(['recycle','discard'])` = "recycle,discard" 会被当成结论码，
   * 终态判定（outcomeOf）和可选结论就都拿到一个根本不存在的码。
   */
  const v = hit && !Array.isArray(hit.value) ? hit.value : ''
  return String(v ?? '').trim() || undefined
}

/** 该分支是否为默认（兜底）分支：没有任何命中条件 */
export function isDefaultBranch (b: ApprovalBranch): boolean {
  return branchConditions(b).length === 0
}

/**
 * 把条件的比较值读成「值列表」（只有 `contains` 用得上）。
 *
 * 不是数组就**就地升级**成数组再返回：历史模板里配好的 contains 都是单值，
 * 不能假设读到的就是数组；值为空时给一个空元素，否则界面上没地方填第一个值。
 *
 * ⚠️ 返回的是 `value` **本身**（不是拷贝）：调用方（编辑器）常常直接写回某个下标
 * （`condValues(c)[i] = 输入值`），返回拷贝的话写入会静默丢失 —— 输入框看着能打字，
 * 但存进 flow 的永远是空。
 */
export function conditionValues (c: BranchCondition): Array<string | number> {
  if (!Array.isArray(c.value)) {
    const v = c.value
    c.value = v === undefined || v === null || String(v).trim() === '' ? [''] : [v]
  }
  return c.value
}

/**
 * 把多值收回单值（切换操作符到别的比较方式时用），保留**第一个非空值**。
 *
 * 不收的后果：数组会被 `String()` 成 "a,b" 参与比较 —— 条件永远不命中，而且看不出来
 * （界面上那两个框里的内容都还在）。已填过的第一个值留着，比直接丢掉更符合预期。
 */
export function collapseConditionValue (c: BranchCondition): void {
  if (Array.isArray(c.value)) {
    c.value = c.value.find(v => String(v ?? '').trim() !== '') ?? ''
  }
}

/**
 * 条件**右侧**「引用另一个字段」的前缀：`@字段名`。
 *
 * 用途：把原本写死的比较值换成**另一个字段的值**，例如
 * 「金额 > 上一环节填的金额」「总库存金额 > 参考MSKU」。
 * 取数范围就是求值上下文（`FlowContext` / 办理时的 form）里有的东西：
 * BI 行字段、派生指标（毛利率 / 海外仓库存金额）、办理时填的 amount / qty 等。
 *
 * 三条硬约定（改这里必须同时满足，否则会破坏既有分流）：
 *   1) **常量照旧**：不以 `@` 开头的值仍是字面量 —— 历史模板行为逐字节不变；
 *   2) **审批结论码不参与引用**：`field === 'result'` 的条件永远按字面量解释。
 *      结论码（pass / reject …）会被 firstResultValueOf 当标识读走去判定终态与可选结论，
 *      一旦被当成字段引用，分流与终态就全乱了；
 *   3) 引用取不到值（字段不存在 / 该字段为空）时按**不命中**处理 ——
 *      与「未知不当成成立」的既有口径一致（见 deriveFlowFields 里 null 的说明）。
 *
 * ⚠️ 代价：真要拿一个**以 `@` 开头**的字符串当常量比较，目前无法表达（会被当成引用）。
 *    现有业务值（平台名 / 部门名 / 是-否 / 金额）都不以 @ 开头，暂不为它加转义语法。
 */
export const FIELD_REF_PREFIX = '@'

/**
 * 该条件的比较值是否为「引用另一个字段」。
 * 是则返回**被引用的字段名**，不是引用则返回 null。
 *
 * `field === 'result'`（审批结论条件）永不解析引用 —— 见 FIELD_REF_PREFIX 的第 2 条约定。
 */
export function conditionRefField (c: BranchCondition): string | null {
  if (c.field === 'result') {
    return null
  }
  const v = typeof c.value === 'string' ? c.value.trim() : ''
  if (!v.startsWith(FIELD_REF_PREFIX)) {
    return null
  }
  const name = v.slice(FIELD_REF_PREFIX.length).trim()
  return name || null
}

/**
 * 「包含」的求值：值可以是一个常量、一组常量，或 `@字段名` 引用。
 *
 * 多值的语义是**命中任一**（`some`），不是全部，两个理由：
 *  1. 多值列（销售状态「停售,在售」）的业务读法就是「包含这几个取值之一」；
 *  2. 「同时包含 A 和 B」用一条 contains 表达不了（子串有先后顺序），
 *     本来就该写成两条条件 + 「全部满足」；把 some 改成 every 只会让"多勾一个值"
 *     变得越来越难命中，与用户加值的直觉相反。
 */
function containsHit (rawStr: string, c: BranchCondition, form: Record<string, unknown>): boolean {
  const list = Array.isArray(c.value) ? c.value : [c.value]
  return list.some(v => {
    // 单个值也可以写成「@字段名」：复用与单值同一套引用规则（含"result 条件不参与引用"那条）
    const refField = conditionRefField({ field: c.field, op: 'contains', value: v })
    const expect = refField ? form[refField] : v
    // 空值不算命中：一个还没填的空框不该让分支恰好命中
    if (expect === undefined || expect === null || expect === '') {
      return false
    }
    return rawStr.includes(String(expect))
  })
}

/**
 * @param form 求值上下文。右侧写成 `@字段名` 时从这里取值；
 *             不传则引用一律取不到 → 按不命中处理（调用方都应显式传入）。
 */
function evalCondition (c: BranchCondition, raw: unknown, form: Record<string, unknown> = {}): boolean {
  if (raw === undefined || raw === null || raw === '') {
    return false
  }
  /*
   * 千分位串要在**比较时**还原成数字："6,000" 直接 Number() 是 NaN，
   * 于是 gt/gte/lt/lte 一律判 false —— 而两个来源都可能是这种写法：
   *   ① 表格里的行数据（formatDatas 把数字格式化成 "1,234"）；
   *   ② 办理时审批人手填的金额。
   * 业务上下文那条路径已经在 toFlowContext 里归一化过，这里再兜一道，
   * 保证"条件比较的值"与"数据从哪来"无关。
   */
  // 右侧可能是「@字段名」：取上下文里该字段的值来比较，取不到就判不命中。
  // 非引用时 expect === c.value，下面的比较逻辑与改动前完全一致。
  let expect: unknown = c.value
  const refField = conditionRefField(c)
  if (refField) {
    expect = form[refField]
    if (expect === undefined || expect === null || expect === '') {
      return false
    }
  } else if (expect === undefined || expect === null || expect === '') {
    /*
     * 常量侧同样不能为空：`Number('') === 0`，于是「金额 > ''」会变成「> 0」、
     * 「金额 = ''」会命中金额 0 —— 一个没填完的条件反而更容易命中。
     * 左边取不到值（上面那道）与引用取不到都按不命中处理，这里补齐同一口径。
     * ⚠️ 数组（contains 的多值）不在此列：它走 containsHit，自己按「命中任一」判空。
     */
    return false
  }
  const a = Number(typeof raw === 'string' ? raw.replace(/,/g, '').trim() : raw)
  const b = Number(typeof expect === 'string' ? expect.replace(/,/g, '').trim() : expect)
  const numeric = !Number.isNaN(a) && !Number.isNaN(b)
  switch (c.op) {
    case 'eq': { return numeric ? a === b : String(raw) === String(expect)
    }
    case 'ne': { return numeric ? a !== b : String(raw) !== String(expect)
    }
    case 'gt': { return numeric && a > b
    }
    case 'gte': { return numeric && a >= b
    }
    case 'lt': { return numeric && a < b
    }
    case 'lte': { return numeric && a <= b
    }
    // 「包含」支持一组值（命中任一即满足）；单值走同一条路径，行为与改动前一致
    case 'contains': { return containsHit(String(raw), c, form)
    }
    // 脏数据里的非法 op（如旧模板手写的 '='）：明确判不命中，
    // 而不是让函数末尾隐式返回 undefined（签名声明的是 boolean）
    default: { return false
    }
  }
}

/**
 * 按表单数据（含 result 等运行时字段）选择分支：
 * 返回第一个条件命中的分支；都不命中时返回无条件的默认分支；连默认分支都没有则 null。
 * 审批结果分流时，form 需带上上一环节的 result（如 { result: 'reject' }）；
 * 多条件分支按 logic 组合：and = 全部满足，or = 任一满足；
 * 但首条为审批结果条件（field=result）时它是硬性前提，logic 只作用于其后的附加条件。
 */
export function matchBranch (branches: ApprovalBranch[], form: Record<string, unknown>): ApprovalBranch | null {
  let fallback: ApprovalBranch | null = null
  for (const b of branches) {
    const list = branchConditions(b)
    if (list.length === 0) {
      fallback ??= b
      continue
    }
    // 顶层的「审批结论」条件是**硬性前提**：必须命中，且不参与 or 组合，
    // 否则「金额>5000」这类附加条件会在结论不是该结果时也把分支命中。
    // （放进**组里**的 result 条件不受这个优待，按该组自己的 logic 参与运算，
    //   口径与 firstResultValueOf 的说明一致。）
    const results = list.filter(isResultCondition) as BranchCondition[]
    if (results.some(c => !evalCondition(c, form[c.field], form))) {
      continue
    }
    const rest = list.filter(i => !isResultCondition(i))
    const hit
      = rest.length === 0
        ? results.length > 0
        : ((b.logic ?? 'and') === 'or'
            ? rest.some(i => evalConditionExpr(i, form))
            : rest.every(i => evalConditionExpr(i, form)))
    if (hit) {
      return b
    }
  }
  return fallback
}

/* ==================== 回退（驳回）目标：跳过"同一个人" ==================== */

/** 驳回的结论码（保存期 `ensureRejectLoopBack` 注入的「回退上一级」分支绑的就是它） */
const REJECT_RESULT = 'reject'

/** 见 collectRejectTargets */
export interface RejectBackInfo {
  /** stepId → 回退**真正该退到**的环节（已跳过同一个人）；undefined = 没得退 */
  byStep: Record<string, string | undefined>
  /** 分支组 id → 这个组归属于哪个环节（回退的主语）；rebuildChain 在分支组处用它查目标 */
  stepOfGroup: Record<string, string>
}

/**
 * 每个环节「回退」真正该退到哪一环 —— **跳过同一个人**。
 *
 * 口径（业务方 2026-10 确认，实测反馈过"在自己这两步之间来回退"）：
 * 回退退到**前一个节点**。而同一个人的相邻环节在时间线上本来就是**同一条节点**
 * （见 utils/approvalRuntime 的 groupApproverSteps，判定用的就是 mainOf/sameApprover）——
 * 所以"前一个节点" = 上一个**别人**办的环节：同一审批人的上一环要一路往前跳过。
 * 一路都是同一个人（或本环节就是首环节）→ **没得退**，办理端据此不显示「回退」
 * （与"首环节不注入回退分支"同一口径：点了也只会退回自己）。
 *
 * 起点不另算"上一环"，而是读保存期注入的那条分支（`loopBackTo`）—— 注入逻辑在
 * utils/approvalFlow（分支组内 / 轮询卡片内的"上一环"各有口径），这里再实现一份必然漂。
 *
 * 两个返回值各有用处：
 *   · `byStep`     —— 选项收集（没得退就不出现「回退」）与 rebuildChain（真正往哪退）；
 *   · `stepOfGroup` —— rebuildChain 在**分支组**处反查"这是哪个环节的分支"，
 *     回退时才有主语可比。
 */
export function collectRejectTargets (flow: ApprovalFlow): RejectBackInfo {
  const byStep: Record<string, string | undefined> = {}
  const stepOfGroup: Record<string, string> = {}
  /** 有审批人的环节（审批节点 / 审批步骤）。飞书提醒没有成员，不在表里 —— 回退时要越过去 */
  const membersOf = new Map<string, ApprovalChainItem[]>()
  /** stepId → 紧跟它的那个分支组的 branches（注入的回退分支就在里面） */
  const groupAfterOf = new Map<string, ApprovalBranch[]>()

  /**
   * 扫一层（顶层节点 / 分支组内的步骤 / 轮询卡片内的步骤）：
   * 记下"谁有分支组跟在后面"，并递归进各组 / 卡片内部。
   *
   * ⚠️ 成员字段**两种形状**：顶层审批节点是 `nodes`（见 ApprovalFlowApprovalNode），
   * 分支内的步骤是 `members`（见 ApprovalFlowStep）—— 与 rebuildChain 收集 membersById 时同一口径。
   */
  type LayerItem = {
    id: string
    type?: string
    nodes?: ApprovalChainItem[]
    members?: ApprovalChainItem[]
    branches?: ApprovalBranch[]
    steps?: ApprovalFlowStep[]
  }
  const scan = (items?: LayerItem[]) => {
    for (let i = 0; i < (items?.length ?? 0); i++) {
      const cur = items![i]
      const next = items![i + 1]
      if (cur.type === 'branch') {
        for (const b of cur.branches ?? []) {
          scan(b.steps as LayerItem[] | undefined)
        }
        continue
      }
      if (cur.type === 'loop') {
        scan(cur.steps as LayerItem[] | undefined)
        continue
      }
      /*
       * 审批环节：顶层节点 type='approval'，而**分支内的步骤可以缺省 type**
       * （见 ApprovalFlowStep 的说明）—— 缺省同样算审批步骤，否则回退会把它当成
       * "没有审批人的环节"越过去。
       * notify / probe 不给成员：前者没有审批人（回退时本来就该越过），后者在建单期已展开。
       */
      if (cur.type === 'approval' || cur.type === undefined) {
        membersOf.set(cur.id, cur.nodes ?? cur.members ?? [])
      }
      if (next?.type === 'branch' && next.branches?.length) {
        groupAfterOf.set(cur.id, next.branches)
        stepOfGroup[next.id] = cur.id
      }
    }
  }
  scan(flow as LayerItem[])

  /** 该分支组里那条「回退」分支指向谁（注入的分支就是唯一的 loopBackTo 来源） */
  const injectedTarget = (branches?: ApprovalBranch[]): string | undefined =>
    branches?.find(b => !!b.loopBackTo && firstResultValueOf(b) === REJECT_RESULT)?.loopBackTo?.stepId

  for (const [id, mine] of membersOf) {
    const seen = new Set<string>()
    let target = injectedTarget(groupAfterOf.get(id))
    let hit: string | undefined
    while (target && !seen.has(target)) {
      seen.add(target)
      const members = membersOf.get(target)
      // 不是审批环节（飞书提醒这类没有审批人的）→ 越过它继续往前找
      if (members && !sameApprover(mainOf(mine), mainOf(members))) {
        hit = target
        break
      }
      target = injectedTarget(groupAfterOf.get(target))
    }
    byStep[id] = hit
  }
  return { byStep, stepOfGroup }
}

/**
 * 收集每个审批环节「可选的审批结论」：取自它后面那个分支组里各分支绑定的 result 条件。
 *
 * 这样办理表单就能按模板配置渲染（某环节能选什么结论，由画布上它连了哪些结果分支决定），
 * 而不是按环节在链中的下标硬编码表单类型。
 *
 * - 有条件分支（field=result）→ 取条件值，如 reject / pending / recycle；
 * - 无条件分支（主线）→ 视为 pass，它是通过 / 其余结论未命中时的兜底走向；
 * - 嵌套分支组同样处理：分支 steps 里的 branch 步骤，归属于它前面那个审批步骤。
 *
 * @returns stepId → 结论标识数组（去重），如 { '财务初审': ['reject', 'pass'] }
 */
export function collectStepResultOptions (flow: ApprovalFlow): Record<string, string[]> {
  const items = collectStepOptionItems(flow)
  const map: Record<string, string[]> = {}
  for (const [stepId, list] of Object.entries(items)) {
    map[stepId] = list.map(i => i.result)
  }
  return map
}

/**
 * 按当前上下文过滤「该摆给办理人的选项」—— 只认 `offerWhen`（见 ApprovalBranch.offerWhen）。
 *
 * 为什么在**渲染层**过滤而不是收集层（collectStepOptionItems）：收集是纯函数、没有运行期上下文，
 * 而且它的输出还被 `collectStepResultOptions` 当"这一环能选哪些结论"用 —— 在收集层过滤会让
 * 两处口径分叉（一个少选项、一个没少），而且 `allowed-results` 缩水会连带影响别的判断。
 *
 * ⚠️ 只影响**渲染**，不参与选路：选路由提交后的 `matchBranch` 按 `conditions` 决定。
 * ⚠️ **全被过滤光时退回原列表**：宁可多摆一个选项，也不能让人无路可走
 *    （那会卡在"没有可选项、也提交不了"）。
 * ⚠️ 多条 `offerWhen` 之间是 **and**（都满足才显示）。
 *
 * @param ctx 求值上下文：业务快照 + `result`（上一环节结论），见 utils/approvalFlow 的 optionContextOf
 */
export function filterOfferedOptions (
  options: ApprovalNodeOption[],
  ctx: Record<string, unknown>,
): ApprovalNodeOption[] {
  if (options.length === 0) {
    return options
  }
  const kept = options.filter(o => (o.offerWhen ?? []).every(c => evalConditionExpr(c, ctx)))
  return kept.length > 0 ? kept : options
}

/**
 * 每个审批环节的**选项数组** —— 办理下拉框直接拿它渲染，前端不再自己造词。
 *
 * `result` = 提交上去的结论码（决定后面走哪条线）；`text` = **模板里给那条线起的名字**。
 *
 * 为什么要有它（与上面 collectStepResultOptions 的分工）：
 *   · 旧的做法只回传"有哪些结论码"，前端再拿 `APPROVAL_RESULTS` 去翻译文案 ——
 *     于是下拉里显示的是**目录里写死的词**（"产品质量类"），而不是你在画布上给这条线
 *     起的名字（"产品质量"）。模板怎么配，前端都不该有第二套词。
 *   · 这里把**名字一起带回来**：谁配的线谁起名，前端只负责渲染。
 *
 * 无条件主线同样算一个选项（`result` 固定为 pass —— 它是"其余结论都没命中"的兜底走向），
 * 文案同样取那条线自己的名字（如「其他原因」）。
 */
export function collectStepOptionItems (
  flow: ApprovalFlow,
): Record<string, ApprovalNodeOption[]> {
  const map: Record<string, ApprovalNodeOption[]> = {}
  /** 主线（无条件分支）对应的结论码 */
  const MAIN_RESULT = 'pass'
  /**
   * 回退目标（已跳过"同一个人"）：**没得退的环节不显示「回退」** ——
   * 那种「回退」只会退回自己（见 collectRejectTargets）。
   */
  const rejectInfo = collectRejectTargets(flow)

  /**
   * 从分支组提取选项：**每条出线就是一个走动方向**。
   * 绑了结论的取结论码；无条件的算主线（pass）。
   *
   * 下拉里显示什么由这条线决定：
   *   · 配了 `options`（选项文本数组，见 ApprovalNodeOption）→ 每个文本一个选项，
   *     它们的 result **统一是这条线的结论码** → 选哪个都走这条线；
   *   · 没配 → 退回用分支名当一个选项；分支名也空（老模板）则退回结论码，交给前端按目录显示。
   */
  function optionsOf (branches: ApprovalBranch[]): ApprovalNodeOption[] {
    /*
     * 环节里配了**选项树**时：这一环就是"树驱动"的 —— 把树的一级（按类别分组）直接当选项，
     * 每个一级的「实际链路」自己决定走哪条线，**不再套一层"处理方式"**。
     *
     * 为什么必须这样（实测反馈）：树的一级本来就能指到多条线（如「运营 / 市场需求分析不足」
     * 指向"其他原因"那条线、「产品侵权 / 版权」指向"产品侵权"那条线），此时上面再摆一个
     * 「产品侵权 / 产品质量 / 其他原因」的下拉，等于**同一件事问两遍**，用户看到的却是
     * "多了一栏"，而且那层下拉里的选项还不是模板里配的分项。
     *
     * 没被树覆盖的结果分支**照样保留**（否则那条线成了死路）：见 leftoverGroups。
     */
    const trees = branches
      .map(b => normalizeOptionGroups(b.optionGroups))
      .filter(g => g.length > 0)
    if (trees.length > 0) {
      return nodeLevelOptionsOf([...mergeGroups(trees), ...leftoverGroups(trees, branches)], branches)
    }

    const list: ApprovalNodeOption[] = []
    for (const b of branches) {
      // 顶层结果条件 = 该分支对应的审批结论；只靠条件组命中的分支不贡献选项
      const v = firstResultValueOf(b)
      const name = String(b.name ?? '').trim()
      const isMain = !v && branchConditions(b).length === 0
      if (!v && !isMain) {
        continue
      }
      const result = v || MAIN_RESULT
      /*
       * 配了**选项树**就以它为准：办理时把整棵树挂在这个选项上（类别 → 一级 → 二级），
       * 而每个一级选项的 `link` 才是真正提交的链路码 —— 见 ApprovalNodeOption。
       */
      const groups = normalizeOptionGroups(b.optionGroups)
      // 这条线的「办理选项条件」：原样带到选项上，由办理端按上下文过滤（见 offerWhen 的说明）
      const offerWhen = b.offerWhen && b.offerWhen.length > 0 ? b.offerWhen : undefined
      if (groups.length > 0) {
        list.push({ result, text: resultTextOf(result, name || result), groups, ...(offerWhen ? { offerWhen } : {}) })
        continue
      }
      const texts = normalizeOptionTexts(b.options)
      if (texts.length > 0) {
        for (const t of texts) {
          list.push({ result, text: resultTextOf(result, t), ...(offerWhen ? { offerWhen } : {}) })
        }
      } else {
        list.push({ result, text: resultTextOf(result, name || result), ...(offerWhen ? { offerWhen } : {}) })
      }
    }
    // 去重按「文案 + 结论码」：不按结论码合并 —— 同一条线的多个选项本来就共用一个码，
    // 合并会把"多个选项"压成一个；不同线用了同一个文案时也只是各自保留（先到先得，不静默改码）。
    const seen = new Set<string>()
    return list.filter(i => (seen.has(`${i.text}|${i.result}`) ? false : (seen.add(`${i.text}|${i.result}`), true)))
  }

  /** 多棵树合并成一棵：同名的类别合并 items（按「文案 + 链路」去重），顺序按先出现的来 */
  function mergeGroups (trees: ApprovalOptionGroup[][]): ApprovalOptionGroup[] {
    const out: ApprovalOptionGroup[] = []
    for (const tree of trees) {
      for (const g of tree) {
        const hit = out.find(x => x.title === g.title)
        if (!hit) {
          out.push({ title: g.title, items: g.items.map(it => ({ ...it })) })
          continue
        }
        for (const it of g.items) {
          if (!hit.items.some(x => x.text === it.text && x.link === it.link)) {
            hit.items.push({ ...it })
          }
        }
      }
    }
    return out
  }

  /**
   * **树没覆盖到的结果分支**：保留成选项，挂在树后面（用分支名当分组标题）。
   *
   * 为什么不能不管：树是"树驱动"的唯一入口，树里没有某个结论码时，那条线就**没人能选到**了
   * （原来的「处理方式」下拉里它是有的）。例如某环有「产品侵权(带树) / 产品质量 / 其他原因」，
   * 而树的一级只指到 产品侵权 + 其他原因 两条线 —— 这里的「产品质量」就得补回来。
   *
   * 「驳回」出口不在这儿补：办理端会按 `canReject` 在末尾放一个统一的「驳回」（见 ApprovalNode）。
   */
  function leftoverGroups (trees: ApprovalOptionGroup[][], branches: ApprovalBranch[]): ApprovalOptionGroup[] {
    const covered = new Set(trees.flatMap(t => t.flatMap(g => g.items.map(i => i.link))))
    const out: ApprovalOptionGroup[] = []
    for (const b of branches) {
      const name = String(b.name ?? '').trim()
      const code = firstResultValueOf(b) || MAIN_RESULT
      if (code === REJECT_RESULT || covered.has(code)) {
        continue
      }
      // 配了选项文本就逐条给（"多个说法走同一条线"），没配就用分支名
      const texts = normalizeOptionTexts(b.options)
      const items = (texts.length > 0 ? texts : [name])
        .filter(Boolean)
        .map(t => ({ text: resultTextOf(code, t), link: code }))
      if (items.length > 0) {
        out.push({ title: resultTextOf(code, name || code), items })
      }
    }
    return out
  }

  /**
   * 环节级选项树 → **唯一一个**"选项"。
   *
   * 为什么只给一项：树里每个一级自带「实际链路」，本身就是一次完整的选择
   * （"走哪条线"已由它决定），所以办理时不必先选"处理方式" —— 见 ApprovalNodeOption.nodeLevel。
   * `result` / `text` 留空：这一层的文案与结论都不再有意义，谁也不会读它。
   *
   * `canReject`：本环节有没有「驳回 → 回退上一环」这个出口。**必须从 branches 上算**，
   * 不能只看树 —— 那条分支是保存期 `ensureRejectLoopBack` 自动注入的，模板的树里通常没有它；
   * 老口径下它作为一条普通分支出现在下拉里，换成环节级树后就会丢掉（办理人无路可驳回）。
   */
  function nodeLevelOptionsOf (groups: ApprovalOptionGroup[], branches: ApprovalBranch[]): ApprovalNodeOption[] {
    return [{
      result: '',
      text: '',
      groups,
      nodeLevel: true,
      ...(branches.some(b => firstResultValueOf(b) === REJECT_RESULT) ? { canReject: true } : {}),
    }]
  }

  /**
   * 一个审批环节（顶层节点或分支内的审批步骤）的选项数组。
   *
   * **环节级树优先**：配了它整个环节就呈现这一棵树，各条结果分支不再是"处理方式"；
   * 没配才按老口径逐条出线推导（`options` 文本 / 分支名）。
   */
  function optionsOfApproval (
    step: ApprovalFlowStep | ApprovalFlowApprovalNode,
    branches: ApprovalBranch[],
  ): ApprovalNodeOption[] {
    /*
     * **整组都是自动注入的**（模板没给这个环节配结果分支）→ 一组选项都不给，
     * 让办理端回落到结论目录（与"注入这回事存在之前"完全一致）。
     *
     * 为什么必须整组丢掉、而不是只丢兜底那条：`rejectBackBranches` 造的是
     * [回退, 无条件兜底] 两条 —— 兜底那条只是为了让 matchBranch 有路可走
     * （不然非驳回结论会被判"无分支命中 → 流程终止"），**不是模板配的"处理方式"**；
     * 而回退那条在这套老口径里本来也应走目录里的「驳回」（结论码同为 reject，
     * 命中同一条注入分支），单摆一个「回退上一级」反而和别处不一致。
     *
     * 辨认口径：**该组恰好两条、一条是注入的回退、另一条无条件** —— 只可能是注入产物。
     * 编辑器产出的结果分支组至少两条用户分支，之后 `appendRejectBack` 再补回退，所以 ≥3 条。
     */
    const injectedOnly = branches.length === 2
      && branches.some(b => !!b.loopBackTo && firstResultValueOf(b) === REJECT_RESULT)
      && branches.some(b => !b.loopBackTo && branchConditions(b).length === 0)
    if (injectedOnly) {
      return []
    }

    /*
     * **没得退的「回退」整条去掉**：本环节与上一环是同一个人、再往前也没有别人时，
     * 回退只会退回自己（同一个人相邻环节在时间线上本来就是同一条节点）→ 干脆不出现。
     * 判定见 collectRejectTargets。
     * ⚠️ 带 loopBackTo 的分支**都是**保存期注入的（编辑器画不出这种分支），按它过滤是安全的。
     * 连 `canReject` 也一起受影响（它就是从 branches 上算的）——没得退就不补那个「驳回」。
     */
    const usable = rejectInfo.byStep[step.id] === undefined
      ? branches.filter(b => !(b.loopBackTo && firstResultValueOf(b) === REJECT_RESULT))
      : branches

    const shared = normalizeOptionGroups(step.optionGroups)
    // 树没覆盖到的结果分支同样补回来，保证每条画出来的线都有人能选到（见 leftoverGroups）
    return shared.length > 0
      ? nodeLevelOptionsOf([...shared, ...leftoverGroups([shared], usable)], usable)
      : optionsOf(usable)
  }

  /**
   * 引用卡片的**分流组**：它的 branches 是"本模板的下游走向"（这一段走完，按最后那个结论接哪条线），
   * 不是引用段内某一环能选的结论。算到段尾那一环头上，办理端就会摆出
   * 「按结论继续 / 其它结论」这类与本环节无关的下游分支名 —— 弃置段里最容易撞见。
   *
   * 两种写法都算：
   *  · `<卡片id>:exits`  —— 现在的编译器在建单展开时生成（见 utils/templateRef 的 expandList）；
   *  · `<卡片id>:bound`  —— **旧编译器**留下的同名角色（`bound:hit` 按结论继续 / `bound:other` 其它结论）。
   *    线上「美1组模板」里还有 13 处，只认 `:exits` 的话这些段的尾环节选项会被它整个盖住，
   *    办理人看到的就是「按结论继续 / 其它结论」，而段内真正的「选择接收团队 / 通过」一个都不剩。
   *
   * 两者都**不能**参与尾环节的选项推导，但段尾自己的结果分支（`:result`）照常生效。
   */
  function isRefExitGroup (id: unknown) {
    const s = String(id ?? '')
    return s.endsWith(':exits') || s.endsWith(':bound')
  }

  /** 分支内的步骤序列：branch 步骤归属于它前面那个审批步骤 */
  function collectSteps (steps: ApprovalFlowStep[] | undefined) {
    let prev: ApprovalFlowStep | undefined
    for (const s of steps ?? []) {
      if (s.type === 'branch' && s.branches?.length) {
        if (isRefExitGroup(s.id)) {
          /*
           * 引用段的分流组：不是上一环的结论分支。
           * 但段尾那一环自己的**选项树**仍要生效 —— 它的出线就是这张卡片的出线，
           * 没有自己的结果分支组，不给的话办理端只能落回「通过 / 驳回」。
           */
          if (prev) {
            const shared = normalizeOptionGroups(prev.optionGroups)
            if (shared.length > 0) {
              map[prev.id] = nodeLevelOptionsOf(shared, [])
            }
          }
          prev = undefined
        } else if (prev) {
          map[prev.id] = optionsOfApproval(prev, s.branches)
        }
        for (const b of s.branches) {
          collectSteps(b.steps)
        }
        continue
      }
      prev = s
    }
  }

  let prevTop: ApprovalFlowApprovalNode | undefined
  for (const node of flow) {
    if (node.type === 'approval') {
      prevTop = node
      continue
    }
    if (node.type === 'branch') {
      if (isRefExitGroup(node.id)) {
        // 同上：引用卡片的出线分流，不能当成段尾环节的「可选结论」；
        // 但段尾环节自己的选项树要保留（见 collectSteps 里的同款说明）
        if (prevTop) {
          const shared = normalizeOptionGroups(prevTop.optionGroups)
          if (shared.length > 0) {
            map[prevTop.id] = nodeLevelOptionsOf(shared, [])
          }
        }
        prevTop = undefined
      } else if (prevTop) {
        map[prevTop.id] = optionsOfApproval(prevTop, node.branches)
      }
      for (const b of node.branches) {
        collectSteps(b.steps)
      }
      continue
    }
    /*
     * 其余节点（飞书提醒 / 数据查询 / 循环卡片 / 引用模板）都**不是"能摆选项的环节"** ——
     * 清掉 `prevTop`，别让紧跟它们的那个分支组被算到前面那个审批环节头上。
     *
     * 踩过（实测）：模板「审批 → 提醒 → 提醒」在保存时被 `ensureRejectLoopBack` 给两个
     * 提醒也各注入了一个回退分支组（id 形如 `<提醒id>:reject-back`，里面是
     * [回退上一级, 主线]）。旧写法遇到提醒不更新 `prevTop`，于是这两组被当成
     * "第一个审批环节的结果分支"一遍遍覆盖它 —— 审批页上第一个环节的选项最后只剩一个
     * 叫「主线」的（模板真正配的「通过 / 待定」被盖没了）。
     * 提醒没有"办理结论"这一说，它后面那组选项本来就不该出现在任何环节里。
     */
    prevTop = undefined
  }
  return map
}

/** 一个「飞书提醒」环节的配置（见 collectNotifySteps） */
export interface NotifyStepInfo {
  /** 提醒名称（一般就是环节名） */
  name: string
  /** 节点上配的补充文案 */
  content?: string
  /** 提醒对象（固定成员 / 已解析的 department leader） */
  members: ApprovalChainItem[]
}

/**
 * 收集流程里所有「飞书提醒」节点 / 步骤：stepId → 提醒配置。
 *
 * 两个用途：
 *   1) rebuildChain 把它们作为一环写进 chain（时间线上要看得见），但**不产生待办**；
 *   2) 提交环节时据此发飞书消息（见 composables/useNodeSubmit）——
 *      发送必须发生在"流程刚推进到它"的那一刻，**不能**放在 rebuildChain 里：
 *      那是纯函数、且每次读取都重算（审批页/首页/我的都会调），在里面发消息会重复轰炸。
 */
export function collectNotifySteps (flow: ApprovalFlow): Record<string, NotifyStepInfo> {
  const out: Record<string, NotifyStepInfo> = {}

  const walkSteps = (steps?: ApprovalFlowStep[]) => {
    for (const s of steps ?? []) {
      if (s.type === 'branch') {
        for (const b of s.branches ?? []) {
          walkSteps(b.steps)
        }
        continue
      }
      if (s.type === 'notify') {
        out[s.id] = {
          name: s.name ?? '',
          ...(s.content ? { content: s.content } : {}),
          members: s.members ?? [],
        }
      }
    }
  }

  for (const node of flow) {
    if (node.type === 'notify') {
      out[node.id] = {
        name: node.name,
        ...(node.content ? { content: node.content } : {}),
        members: node.members ?? [],
      }
      continue
    }
    if (node.type === 'branch') {
      for (const b of node.branches) {
        walkSteps(b.steps)
      }
    }
  }
  return out
}

/** 一个「审批」环节的配置（见 collectApprovalSteps） */
export interface ApprovalStepInfo {
  /** 环节名（模板上给这个节点起的名字；没配就是空串） */
  name: string
  /** 该环节的办理人（成员已在建单期由 resolveFlowRoles 解析成真人） */
  members: ApprovalChainItem[]
}

/**
 * 收集流程里所有**审批环节**：stepId → 环节名 + 办理人。
 *
 * 与 collectNotifySteps 是同一套遍历（都是"按 id 找环节"），用途见 utils/notifySteps：
 * 流程推进到某个审批环节时，要按 id 找到"这一环该谁办"，发到达通知。
 *
 * 认的形状与 rebuildChain 一致：顶层节点 + 分支里的步骤 + 轮询卡片内部步骤都要递归到，
 * 成员取 `stepMembersOf`（nodes / members 都认，见它的说明）。
 */
export function collectApprovalSteps (flow: ApprovalFlow): Record<string, ApprovalStepInfo> {
  const out: Record<string, ApprovalStepInfo> = {}

  const walkSteps = (steps?: ApprovalFlowStep[]) => {
    for (const s of steps ?? []) {
      if (s.type === 'branch') {
        for (const b of s.branches ?? []) {
          walkSteps(b.steps)
        }
        continue
      }
      if (s.type === 'loop') {
        // 「组间轮询」卡片：建单期已按组展开成普通步骤，这里再兜一层（老数据可能还留着卡片）
        walkSteps(s.steps)
        continue
      }
      if (s.type === 'notify') {
        continue
      }
      out[s.id] = { name: s.name ?? '', members: stepMembersOf(s) }
    }
  }

  for (const node of flow) {
    if (node.type === 'branch' || node.type === 'probe' || node.type === 'ref') {
      for (const b of node.branches ?? []) {
        walkSteps(b.steps)
      }
      continue
    }
    if (node.type === 'loop') {
      walkSteps(node.steps)
      continue
    }
    if (node.type === 'notify') {
      continue
    }
    /*
     * 顶层审批节点**没有环节名**（`ApprovalFlowApprovalNode` 上没有 `name` 字段）——
     * 名字只存在画布的 `data.title`，转 flow 时刻意没带：轮询卡片展开出来的 N 个节点
     * 会共用一个标题，时间线上反而分不清是第几环（见 utils/approvalRotation 的说明）。
     * 所以这里给空串；到达通知对空名字有降级文案（见 utils/arrivalNotice.buildArrivalText）。
     */
    out[node.id] = { name: '', members: stepMembersOf(node) }
  }
  return out
}

/**
 * 分支 id → 是否为「出口」（该分支的连线直达结束节点）。
 *
 * 为什么需要它：flow 里分支的 steps 只在「该分支独占一段审批环节」时才非空；
 * 当分支直接汇聚到后续节点、或直接连到结束节点时 steps 都是空的。
 * 仅凭 flow 无法区分这两种情况（都会表现为 steps.length === 0），
 * 必须回到画布快照看这条分支线的 target 是不是结束节点。
 */
export type BranchTerminalMap = Record<string, boolean>

/**
 * 参与条件求值的**业务上下文**：关联数据行的字段快照（中文 key → 值）。
 *
 * 为什么要**快照**而不是每次去读关联行：
 * `rebuildChain` 是纯函数，且**每次读取都会重算**（审批页 / 抽屉 / 提交前都要重算）。
 * 若条件直接读实时业务数据，而 `bi_rows` 每次同步都会重写（行 id 都可能变），
 * 那么同一批 decisions 在不同时间会**算出不同的链路** —— 历史单的已办轨迹、终态
 * 会跟着业务数据一起"回放性变化"，审批单就不再是可信凭证了。
 * 所以：**建单时把数据快照写进单里**（`approval_chain.chain.context`），此后只读快照。
 *
 * json 字段，加这个不需要迁移。
 */
export type FlowContext = Record<string, unknown>

/** 由画布快照构建出口表：分支线的 target 是 end 节点即为出口。
 *  没有 graph（旧数据）时返回空表，调用方退化为「不提前终止」。 */
export function buildBranchTerminalMap (graph?: FlowGraph | null): BranchTerminalMap {
  const map: BranchTerminalMap = {}
  if (!graph?.edges?.length) {
    return map
  }
  const endIds = new Set((graph.nodes ?? []).filter(n => n.type === 'end').map(n => n.id))
  for (const e of graph.edges) {
    map[e.id] = endIds.has(e.target)
  }
  return map
}

/**
 * 取**单据快照**里的分支出口表：优先用建单期存下的 `branchTerminal`，
 * 旧单（那会儿还没有这一项）才回退到画布快照现算一遍。
 *
 * 为什么要单独存一份、而不是让运行期一直看画布：
 * `graph` 是**编辑器**的东西（节点坐标、连线弯曲点、卡片内嵌的小画布、连线上的条件对象…）。
 * 实测一张真实单据里它占了整体积的 47%（比整条流程还大），
 * 而运行期只从它里面取一个布尔：「这条分支线是不是直达结束节点」。
 * 所以建单那一刻算好带走（见 pages/workStream 的 taskPayloadOf），模板之后怎么改都不影响这一单。
 *
 * 新旧走**同一个算法**（还是 buildBranchTerminalMap），不会出现"新单按 A、老单按 B"。
 */
export function branchTerminalMapOf (
  snapshot?: { branchTerminal?: BranchTerminalMap, graph?: FlowGraph | null } | null,
): BranchTerminalMap {
  return snapshot?.branchTerminal ?? buildBranchTerminalMap(snapshot?.graph)
}

/**
 * 把出口表压成**稀疏表**（只留 `true`）—— 写入快照时用，省掉 `xxx: false` 那一长串。
 *
 * 语义完全等价：读的地方只问"这一条是不是出口"，而 `rebuildChain` 的 isExit 判的是
 * `terminalMap[b.id] === true`（见本文件的 isExit）—— 没列出来就是"不是"。
 * 实测 199 条连线的表压完从 ~7 KB 变成 ~0.2 KB。
 */
export function compactBranchTerminal (map: BranchTerminalMap): BranchTerminalMap {
  const out: BranchTerminalMap = {}
  for (const [id, isEnd] of Object.entries(map)) {
    if (isEnd) {
      out[id] = true
    }
  }
  return out
}

/**
 * 流程**为什么停下**：由 rebuildChain 在每条"终止 / 卡住"的出口上写下来，
 * 供时间线在**流转的最后**展示（用户看到链路突然就没了，得知道依据是什么）。
 *
 * 与 `outcome`（判定通过 / 驳回，用于 status）分工不同：这个只解释"停下的原因"。
 */
export interface FlowEndInfo {
  /**
   * 停止类型：
   *   · closed   —— 命中终结类结论（CLOSE_FLOW_RESULTS，如「选择接收组别」）；
   *   · exit     —— 分支直达结束节点（连线画到「结束」）；
   *   · finished —— 所有环节都办完了；
   *   · stuck    —— 没分支命中 / 兜底主线缺失 / 疑似成环，**流程卡住**（异常，要人查模板）。
   */
  kind: 'closed' | 'exit' | 'finished' | 'stuck'
  /** 一句话依据（给办理人看） */
  reason: string
  /** 支撑依据的细节（命中的结论 / 分支），没有就不显示 */
  detail?: string
  /**
   * 支撑这条依据的**具体事实**：谁、办的什么结论、什么时候。
   *
   * 为什么单列一份：`reason` 说的是"为什么停"（哪条线 / 哪类结论），
   * 而人真正要核对的往往是"**凭什么**说它结束了" —— 光一句"流程结束"没有信息量。
   * 由 rebuildChain 在终止出口处自动从**链上最后一条已办**取（见 markEnd 的 factsOf），
   * 口径与表格的「审批结论」列同源（都是"最后一条已办"）。
   */
  facts?: FlowEndFacts
}

/** 「流程为什么结束」的具体事实（有哪项显示哪项） */
export interface FlowEndFacts {
  /** 最后一条已办的结论文案（如「通过」「选择接收团队」） */
  resultLabel?: string
  /** 最后一条已办是谁办的 */
  byName?: string
  /** 什么时候办的（ISO 字符串） */
  at?: string
}

/**
 * 把「数量类」入参认成数字：空 / 认不出返回 undefined。
 *
 * 为什么不直接 `Number(v)`：`Number('')` 是 **0**、`Number('—')` 是 NaN ——
 * 直接转会把"没有这个值"当成"数量 0"，接收数量的上限与剩余就会悄悄算错（真出现过的坑类型）。
 */
function qtyNum (v: unknown): number | undefined {
  if (v === undefined || v === null) {
    return undefined
  }
  const raw = String(v).trim()
  if (raw === '') {
    return undefined
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 按办理流水累计「已接收 / 剩余接收数量」。
 *
 * 只统计**接收类结论**（`RECEIVE_RESULTS`）的 `extra.qty`，并顺手处理掉两个坑：
 *   · **同一环节办过多次**（驳回回退后重审）以**最后一次**为准 —— 重办一次不该把数量算两遍；
 *   · 总库存数量取**建单快照**（单据 `context` 里的那一列）。快照里没有它（老单 / 没关联产品）
 *     就算不出剩余，`remaining` 返回 undefined，调用方退回「按总库存数量」的老口径（不把人卡住）。
 *
 * ⚠️ 这份口径被三处复用：rebuildChain 注入条件上下文（分支条件按"还剩多少"分流）、
 * 办理端显示与校验上限（页面下发）、办完写进结论 extra 的那笔账（见 receiptLedgerAfter）。
 * 所以实现只此一处，别处都调它 —— 各写一份必然漂。
 */
export function receivedQuantities (
  decisions: NodeDecision[] = [],
  ctx?: Record<string, unknown> | null,
): { received: number, total?: number, remaining?: number } {
  // stepId → 该环节**最后一次**接收的数量（回退重审时覆盖，不叠加）
  const byStep = new Map<string, number>()
  for (const d of decisions) {
    if (!RECEIVE_RESULTS.includes(d.result)) {
      continue
    }
    const n = qtyNum(d.extra?.qty)
    if (n !== undefined) {
      byStep.set(d.stepId, n)
    }
  }
  let received = 0
  for (const n of byStep.values()) {
    received += n
  }

  const total = qtyNum(ctx?.[STOCK_QTY_FIELD])
  if (total === undefined) {
    return { received }
  }
  return { received, total, remaining: Math.max(0, total - received) }
}

/**
 * 本环节办完之后这笔接收账（办理端写进结论的 extra，供时间线展示与日后统计）：
 *
 *   received  = 总库存数量 − 本环节**之前**的剩余 + 本环节接收量
 *   remaining = 本环节之前的剩余 − 本环节接收量（不小于 0）
 *
 * 与 receivedQuantities 用的是同一套「总库存数量 / 剩余」（都由页面按建单快照下发），
 * 所以记录里写下的数，与下一步条件「剩余接收数量 > 0」算出来的数**必然一致**。
 * 三个入参有一个认不出（老单 / 没关联产品）就返回 null —— 宁可什么都不写，
 * 也不要在记录里留半截假数字（那种数最难发现）。
 */
export function receiptLedgerAfter (
  totalQty: unknown,
  remainingBefore: unknown,
  thisQty: unknown,
): { received: number, remaining: number } | null {
  const total = qtyNum(totalQty)
  const before = qtyNum(remainingBefore)
  const q = qtyNum(thisQty)
  if (total === undefined || before === undefined || q === undefined) {
    return null
  }
  return {
    received: Math.max(0, total - before) + q,
    remaining: Math.max(0, before - q),
  }
}

/**
 * 由「模板 flow + 办理流水 decisions」重建运行时 chain。
 *
 * 纯函数：同样的 (flow, decisions) 必得同样的 chain。因此驳回回退、分支选路、重审
 * 全部自然生效，不需要在旧链上做增删改的补丁操作 —— chain 是 flow 的投影，不是事实源。
 *
 * 关键约定：
 * - 环节的结论按「该环节第几次办理」从 decisions 取（round 轮次），
 *   回退重审会展开成新的 chain 环节，旧结论仍留在 decisions 里可追溯；
 * - 第一个「没有对应结论」的环节即当前待办，currentStep 指向它，其后的走向不再展开；
 * - 分支 steps 为空（连线直达结束节点）视为流程出口，整体终止并置 done。
 */
export function rebuildChain (
  flow: ApprovalFlow,
  decisions: NodeDecision[] = [],
  terminalMap: BranchTerminalMap = {},
  context: FlowContext = {},
): {
  chain: ApprovalChain
  stepIds: string[]
  currentStep: number
  done: boolean
  /** 终态：pending 进行中 / approved 通过 / rejected 驳回 */
  outcome: 'pending' | 'approved' | 'rejected'
  /** 流程为什么停下（见 FlowEndInfo）；正常进行中的单是 undefined */
  end?: FlowEndInfo
} {
  const chain: ApprovalChain = []
  // chain 下标 → 步骤 id，办理时据此把结论记到正确的 stepId 上
  const stepIds: string[] = []

  // stepId → 该环节历次办理结论（按办理时间顺序）
  const byStep = new Map<string, NodeDecision[]>()
  for (const d of decisions) {
    const list = byStep.get(d.stepId)
    if (list) {
      list.push(d)
    } else {
      byStep.set(d.stepId, [d])
    }
  }
  // stepId → 已展开次数，用于取「第几轮」结论（重审 = 第二轮）
  const round = new Map<string, number>()

  /**
   * 已被这条链路**消费掉**的接收类结论（按推进顺序）。
   *
   * 已接收 / 剩余由它算出（见 withReceivedQuantities）—— 不能直接拿全部 decisions 去算：
   * 那会把"还没走到"的环节填过的数量也算进来，剩余数量在时间线上就成了**未来值**。
   * 同一环节回退重审会 push 两次，receivedQuantities 按 stepId 取最后一次，正好覆盖。
   */
  const consumedReceiveDecisions: NodeDecision[] = []

  // stepId → 成员（顶层节点 + 所有嵌套分支内步骤），回退重审时要据此重建环节
  const membersById = new Map<string, ApprovalChainItem[]>()
  // 顶层审批节点 → 在 flow 中的下标，回退后从它的下一个节点继续推进
  const flowIndexById = new Map<string, number>()
  // stepId → 它所在的 steps 序列及位置，回退到分支内步骤时从它后面继续展开
  const containerById = new Map<string, { steps: ApprovalFlowStep[], index: number }>()

  for (const [i, n] of flow.entries()) {
    if (n.type === 'approval') {
      membersById.set(n.id, n.nodes)
      flowIndexById.set(n.id, i)
      continue
    }
    /*
     * 「飞书提醒」也是「跳出循环」的合法落点：它是"到达即穿过"（会真发一条通知），
     * 跳过去再从它往下走是有意义的 —— 所以它也必须能按 id 定位到在 flow 里的下标。
     * 只收审批节点的话，exitTo 会走到最后那句「跳出循环目标环节不存在」直接抛错（踩过）。
     * 它没有成员，因此不进 membersById（pushNotify 不需要成员）。
     */
    if (n.type === 'notify') {
      flowIndexById.set(n.id, i)
    }
  }
  /** 递归收集嵌套分支内的步骤：成员 + 所在容器 */
  function collect (steps: ApprovalFlowStep[] | undefined) {
    for (let i = 0; i < (steps?.length ?? 0); i++) {
      const s = steps![i]
      if (s.type === 'branch') {
        for (const b of s.branches ?? []) {
          collect(b.steps)
        }
      } else {
        /*
         * 成员取 `stepMembersOf`（nodes / members 都认）。
         * ⚠️ 只读 `s.members` 会让「引用模板」搬进来的那一类步骤变成**空环节** ——
         *    它们在源模板里是顶层审批节点，带的是 `nodes`（且 `members` 为空数组），
         *    时间线上于是没有人可显示（见 stepMembersOf 的说明）。
         */
        membersById.set(s.id, stepMembersOf(s))
        // 旧式线性子步骤 / 轮询卡片内部步骤：与 flowToChain 一样递归下去
        if (s.steps) {
          collect(s.steps)
        }
      }
      containerById.set(s.id, { steps: steps!, index: i })
    }
  }
  for (const node of flow) {
    if (node.type === 'branch') {
      for (const b of node.branches) {
        collect(b.steps)
      }
    }
  }

  /** stepId → 飞书提醒配置。这类环节**不产生待办**，到达即穿过（见 pushNotify） */
  const notifyById = collectNotifySteps(flow)

  /**
   * 回退目标（**已跳过同一个人**）与「分支组 → 它归属的环节」：见 collectRejectTargets。
   *
   * 回退不再是字面上的"上一环"，而是"上一个**别人**办的环节" —— 同一个人的相邻环节在
   * 时间线上本来就是同一条节点，退回到自己那一步等于原地打转（实测反馈过：
   * 一个弹窗里 A→B 来回退自己）。所以顶层与分支内都从这张表查目标。
   */
  const rejectInfo = collectRejectTargets(flow)

  /**
   * 命中「回退」分支时真正退到哪一环。
   *
   * 分支组自己不带主语，所以先反查"这是哪个环节的分支"，再取它的回退目标；
   * 查不到（老数据 / 异常）就按分支自己写的目标退 —— 宁可退回上一环，也不把单据卡住
   * （那种"没得退"的情形办理端已经不显示「回退」，正常不会走到这里）。
   */
  function loopBackTarget (groupId: string, b: ApprovalBranch): string {
    const owner = rejectInfo.stepOfGroup[groupId]
    return (owner ? rejectInfo.byStep[owner] : undefined) ?? b.loopBackTo!.stepId
  }

  /**
   * 把一个「飞书提醒」环节写进 chain。
   *
   * 关键：**不消费 decisions、也不设 currentStep** —— 流程不会为它停下等人办理，
   * 它只是时间线上的一环（即需求里的"在审批环节中体现，但不参与办理"）。
   * 真正的飞书发送发生在提交那一刻（见 composables/useNodeSubmit）：
   * 本函数是纯函数且每次读取都会重算，在里面发消息必然重复轰炸。
   */
  function pushNotify (stepId: string) {
    const info = notifyById[stepId]
    chain.push([{
      type: 'notify',
      name: info?.name ?? '',
      notify: {
        ...(info?.content ? { content: info.content } : {}),
        ...(info?.members.length
          ? { to: info.members.map(m => m.name || m.email || '').filter(Boolean) }
          : {}),
      },
    }])
    stepIds.push(stepId)
  }

  let currentStep = -1
  let done = false
  let guard = 0
  /** 导致流程终止的分支，用于判定终态是「通过」还是「驳回」 */
  let terminalBranch: ApprovalBranch | null = null
  /** 最后一个已办理环节的结论：终止分支未绑定结论时用它兜底判定 */
  let lastResult: string | undefined
  /** 流程为什么停下：见 FlowEndInfo（只在"终止 / 卡住"的出口赋值，进行中的单没有） */
  let endInfo: FlowEndInfo | undefined

  /**
   * 记录"流程为什么停了"：各条终止 / 卡住的出口都调它，别各处自己拼文案。
   *
   * 除了文案，还会自动带上**具体事实**（最后一条已办的结论 / 办理人 / 时间）——
   * 展示层要回答的是"凭什么说它结束了"，光一句"流程结束"没有信息量（见 FlowEndNote）。
   */
  function markEnd (kind: FlowEndInfo['kind'], reason: string, detail?: string) {
    endInfo = {
      kind,
      reason,
      ...(detail ? { detail } : {}),
      ...factsOf(),
    }
  }

  /**
   * 终止出口的具体事实：取**链上最后一条已办**（谁办的、什么结论、什么时候）。
   *
   * 为什么不在这里判定本轮的结论：各出口的判定依据不一样（命中终结类结论 / 走到结束线 /
   * 全部办完），但"最后一次办理"这一事实对四种出口都成立、也都最有解释力 ——
   * 与表格「审批结论」列取的是同一条（见 utils/approvalRuntime 的 lastHandledOf）。
   */
  function factsOf (): { facts?: FlowEndFacts } {
    for (let i = chain.length - 1; i >= 0; i--) {
      const items: ApprovalChainItem[] = chain[i] ?? []
      const m = items.find(x => x?.type === 'manager' && (x.handled_at || x.result))
        ?? items.find(x => x.handled_at || x.result)
      if (m) {
        return {
          facts: {
            ...(m.result_label || m.result ? { resultLabel: m.result_label || m.result } : {}),
            ...(m.name ? { byName: m.name } : {}),
            ...(m.handled_at ? { at: m.handled_at } : {}),
          },
        }
      }
    }
    return {}
  }

  /** 结论码 → 目录文案（如 receive → 接收）；依据文案里用得到 */
  function resultLabelOf (result?: string) {
    return result ? (APPROVAL_RESULTS.find(r => r.value === result)?.label ?? result) : ''
  }

  /** 分支展示名：优先分支名，其次它绑定的结论，最后兜底"兜底主线" */
  function branchNameOf (b: ApprovalBranch) {
    const name = String(b.name ?? '').trim()
    const v = firstResultValueOf(b)
    if (name) {
      // 旧默认文案跟着码表走（如 receive 的「接收」→「全部接收」），自定义名原样保留
      return resultTextOf(v ?? '', name)
    }
    return v ? resultLabelOf(v) : '兜底主线'
  }

  /** 该分支是否为流程出口（连线直达结束节点）。
     *  优先取转换时写入的 isEnd；旧数据没有该字段才回查画布快照。
     *  两者都没有时按「非出口」处理，交给后续节点自然走完，避免误判成终止。 */
  function isExit (b: ApprovalBranch): boolean {
    if (typeof b.isEnd === 'boolean') {
      return b.isEnd
    }
    return terminalMap[b.id] === true
  }

  /** 取该环节「第 n 次办理」的结论，n = 已展开次数 */
  function takeDecision (stepId: string): NodeDecision | undefined {
    const r = round.get(stepId) ?? 0
    round.set(stepId, r + 1)
    return (byStep.get(stepId) ?? [])[r]
  }

  /**
   * 该环节对应的**组**（条件是「当前组别 = XX」时的取值来源，见 CURRENT_GROUP_FIELD）。
   *
   * 取 `role.dept` 优先：轮询展开时写进去的就是**组名**（approvalRotation 的 splitMembers）。
   * `department` 只作兜底 —— 它是解析后的组织架构部门名，该组没设负责人时会往上级找，
   * 那时它变成上级部门名，就不再是条件里写的那个组了。
   *
   * 只认**带 role 的成员**：固定审批人也有 `department`（他自己的部门），
   * 但那不是"这一环对应的组"，混进来会让条件莫名命中。
   */
  function groupOf (stepId: string): string {
    for (const m of membersById.get(stepId) ?? []) {
      if (!m.role) {
        continue
      }
      const byRole = m.role.dept?.trim()
      if (byRole) {
        return byRole
      }
      const byDept = m.department?.trim()
      if (byDept) {
        return byDept
      }
    }
    return ''
  }

  /**
    * 结论 → 选路表单：result 是保留字段，extra 里的业务字段一并参与条件求值。
    *
    * 业务上下文（关联数据行的快照）垫在最底层 —— 分支条件里写的业务字段
    * （如「总库存金额 > 5000」）就是从这里取的；审批结论与办理人填的 extra 覆盖它，
    * 因为那是本次办理的即时事实，比建档时的快照更权威。
    *
    * `stepId` 用来补上「当前环节对应的组」：按组轮询下每一环轮到的组不同，
    * 不带上它就没法按组分流（见 CURRENT_GROUP_FIELD）。它排在 extra **之前** ——
    * 办理人填的值才是本次的即时事实，保持最高优先级。
    */
  /**
   * 把「已接收 / 剩余接收数量」补进条件求值上下文 —— 模板就是靠它分流的：
   * 一批货被某个组部分接收后，「剩余接收数量 > 0」就走其他组/团队接手的那条线。
   *
   * 排在 extra **之后**：这是引擎按流水算出来的事实，不允许被办理人填的同名字段顶掉。
   * 总库存数量取不到时**不放**剩余字段 —— 条件「剩余接收数量 > 0」会因此不命中
   * （未知不当成成立，与 deriveFlowFields 里 null 的口径一致），模板里请把它配在兜底主线一侧。
   */
  function withReceivedQuantities (form: Record<string, unknown>): Record<string, unknown> {
    const { received, remaining } = receivedQuantities(consumedReceiveDecisions, context)
    return {
      ...form,
      [RECEIVED_QTY_FIELD]: received,
      ...(remaining === undefined ? {} : { [REMAINING_QTY_FIELD]: remaining }),
    }
  }

  function formOf (d: NodeDecision, stepId: string): Record<string, unknown> {
    const group = groupOf(stepId)
    return withReceivedQuantities({
      ...context,
      result: d.result,
      ...(group ? { [CURRENT_GROUP_FIELD]: group } : {}),
      ...d.extra,
    })
  }

  /**
   * 该结论是否**终结流程**（见 CLOSE_FLOW_RESULTS）。
   * 命中就不再往后展开：后面的环节不进 chain、也就没人有权限办 ——
   * 「选择接收组别」就是这种：接收方是结果，不是下一环的审批人。
   */
  function closesFlow (d: NodeDecision | undefined): boolean {
    return !!d && CLOSE_FLOW_RESULTS.includes(d.result)
  }

  /** 生成一个 chain 环节并回填其结论；返回结论（undefined = 该环节待办） */
  function pushStep (stepId: string): NodeDecision | undefined {
    const d = takeDecision(stepId)
    const step = (membersById.get(stepId) ?? []).map(m => ({ ...m }))
    if (d) {
      lastResult = d.result
      // 接收类结论：记进"已走到的接收流水"，后续环节的 已接收/剩余 由它算
      if (RECEIVE_RESULTS.includes(d.result)) {
        consumedReceiveDecisions.push(d)
      }
      // 结论记在审批人上，ApprovalNode 读 manager 的这些字段来展示
      const target = step.find(i => i.type === 'manager') ?? step[0]
      if (target) {
        target.result = d.result
        target.result_label = d.result_label
        target.extra = d.extra
        target.opinion = d.opinion
        target.handled_at = d.handled_at
        if (d.files?.length) {
          target.files = d.files
        }
      }
    }
    chain.push(step)
    stepIds.push(stepId)
    return d
  }

  /** 回退到目标环节重新办理，并按重审结论续走后续路径 */
  function loopBackTo (stepId: string): boolean {
    const d = pushStep(stepId)
    if (!d) {
      // 还没有重审结论 → 它就停在这一步等着重审
      currentStep = chain.length - 1
      return false
    }
    // 重审时选了终结类结论 → 同样到此结束
    if (closesFlow(d)) {
      done = true
      terminalBranch = null
      markEnd('closed', `重审时选了终结类结论「${resultLabelOf(d.result)}」，流程到此结束`)
      return false
    }
    const form = formOf(d, stepId)
    const idx = flowIndexById.get(stepId)
    if (idx !== undefined) {
      return walkFlow(idx + 1, form)
    }
    const c = containerById.get(stepId)
    if (c) {
      return walkSteps(c.steps.slice(c.index + 1), form)
    }
    return true
  }

  /**
   * 跳出循环：跳到目标环节，并**从它本身开始**继续走（目标环节要办）。
   *
   * 与 loopBackTo 是同一套"跳过去"的机制，只差 idx 与 idx + 1：
   *   · loopBackTo → walkFlow(idx + 1)  ：目标已办过，从它**后面**续走（回退重办）
   *   · exitTo     → walkFlow(idx)      ：目标还没办，从它**本身**开始（跳过中间环节）
   * 这也是这个原语能做到"引擎几乎零改动"的原因 —— 不需要新概念，只是换个起点。
   */
  function exitTo (stepId: string, form: Record<string, unknown>): boolean {
    const idx = flowIndexById.get(stepId)
    if (idx !== undefined) {
      return walkFlow(idx, form)
    }
    const c = containerById.get(stepId)
    if (c) {
      return walkSteps(c.steps.slice(c.index), form)
    }
    /*
     * 目标不存在（模板被改过 / 数据不完整）：**不静默穿过**。
     * 静默的表现是"这一环莫名其妙被跳过、单据直接往下走"，那种失败最难查 ——
     * 与 probe 步骤的处理口径一致（见上面 walkSteps / walkFlow 里的抛错）。
     */
    throw new Error(`流程里的「跳出循环」目标环节不存在：${stepId}（模板可能被改过，请重新保存模板）`)
  }

  /** 展开分支内的步骤序列；返回 false 表示已停在待办或流程终止 */
  function walkSteps (steps: ApprovalFlowStep[], form: Record<string, unknown>): boolean {
    for (const s of steps) {
      if (guard++ > 500) {
        markEnd('stuck', '流转中止：流程疑似成环（回退 + 同一结论反复命中），被安全阀拦下', '请检查模板里的回退分支是否又把流程送回了同一个环节')
        return false
      } // 防御：回退 + 同样的结论会形成死循环
      /*
       * 「数据查询」步骤必须在建单期展开掉（见 utils/approvalProbe 的 expandProbes）。
       * 走到这里说明单据数据不完整 —— 直接抛错，理由同顶层节点：
       * 静默跳过会变成"单据一建出来就是已完成"，那种失败最难查。
       */
      if (s.type === 'probe') {
        throw new Error('流程里的「数据查询」步骤没有在建单时展开，单据数据不完整（见 utils/approvalProbe）')
      }
      /*
       * 组间轮询卡片（分支链里的步骤形态）同理：必须在**建单期**按组展开成 N 段步骤
       * （见 utils/approvalRotation）。静默跳过的表现是"某条分支上的一整段轮询凭空消失"，
       * 单子却继续往下走 —— 最难查，所以直接抛错。
       */
      if (s.type === 'loop') {
        throw new Error('流程里的「组间轮询」卡片没有在建单时展开，单据数据不完整（见 utils/approvalRotation）')
      }
      /*
       * 「引用模板」同理：源模板的内容是**建单期**搬进来的（见 utils/templateRef）。
       * 走到这里说明单据数据不完整 —— 静默跳过的表现是"引用进来的一整段流程凭空消失、
       * 单子却继续往下走"，与 loop 一样是最难查的那种失败，所以直接抛错。
       */
      if (s.type === 'ref') {
        throw new Error('流程里的「引用模板」步骤没有在建单时展开，单据数据不完整（见 utils/templateRef）')
      }
      if (s.type === 'branch' && s.branches?.length) {
        const b = matchBranch(s.branches, form)
        if (!b) {
          markEnd('stuck', '流转中止：这个结论没有命中任何一条分支，也没配兜底主线', '单据停在当前环节 —— 请检查模板里该结论绑到了哪条线上')
          return false
        }
        // 跳出循环优先于回退：两者都是"跳转"，但 exitTo 表示向前跳出本段循环
        if (b.exitTo) {
          return exitTo(b.exitTo.stepId, form)
        }
        if (b.loopBackTo) {
          return loopBackTo(loopBackTarget(s.id, b))
        }
        // steps 为空只说明该分支没独占环节，不等于终止 —— 是否终止看出口表
        if (b.steps.length > 0 && !walkSteps(b.steps, form)) {
          return false
        }
        if (isExit(b)) {
          done = true // 连线直达结束节点
          terminalBranch = b
          markEnd('exit', `按「${branchNameOf(b)}」这条线走到结束节点，流程结束`, `分支结论：${resultLabelOf(firstResultValueOf(b)) || '无（兜底分支）'}`)
          return false
        }
        continue
      }
      // 飞书提醒步骤：不等待办理，直接穿过（不消费决策、不设 currentStep）
      if (s.type === 'notify') {
        pushNotify(s.id)
        continue
      }
      const d = pushStep(s.id)
      if (!d) {
        currentStep = chain.length - 1
        return false
      }
      // 终结类结论：分支内的步骤同样到此为止
      if (closesFlow(d)) {
        done = true
        terminalBranch = null
        markEnd('closed', `本环节的结论「${resultLabelOf(d.result)}」是终结类结论，流程到此结束`)
        return false
      }
      form = formOf(d, s.id)
    }
    return true
  }

  /** 从 flow 的第 start 个节点开始推进 */
  function walkFlow (start: number, form: Record<string, unknown>): boolean {
    let i = start
    while (i < flow.length) {
      if (guard++ > 500) {
        markEnd('stuck', '流转中止：流程疑似成环（回退 + 同一结论反复命中），被安全阀拦下', '请检查模板里的回退分支是否又把流程送回了同一个环节')
        return false
      }
      const node = flow[i]
      /*
       * 顺序推进到了**另一条脱线支路的起点** → 说明上一条支路已经走到画布上的「结束」了。
       *
       * 必须停：flow 里几条支路是**首尾相接**铺在末尾的（见 ApprovalFlowNode.branchStart），
       * 继续往下就是别人的跳出线 —— 表现是"某组提前跳出轮询"，却把另外几条跳出线
       * 各自接的提醒环 / 审批环节也执行了一遍（实测单号 1792496009092：一个提醒连发三条）。
       *
       * `i === start` 不算：那是**跳转**落到了这条支路的开头（exitTo / loopBackTo），
       * 正是要从这里往下走。
       */
      if (i > start && node.branchStart) {
        done = true
        markEnd(
          'finished',
          '按「提前跳出」的支路走到结束节点，流程结束',
          '这一段在画布上是接到「结束」的；后面几条支路属于别的跳出线，不参与本次流转',
        )
        return true
      }
      /*
       * 「数据查询」节点必须在**建单期**展开掉（见 utils/approvalProbe 的 expandProbes）。
       * 走到这里说明单据数据不完整 —— 直接抛错。
       *
       * 为什么不能"忽略它继续走"：忽略的表现是 chain 为空、done=true，
       * 也就是**单据一建出来就是已完成** —— 这种静默失败最难查，不如当场报出来。
       */
      if (node.type === 'probe') {
        throw new Error('流程里的「数据查询」节点没有在建单时展开，单据数据不完整（见 utils/approvalProbe）')
      }
      /*
       * 「组间轮询」卡片同理：必须在**建单期**按组展开（见 utils/approvalRotation）。
       * 走到这里说明单据数据不完整 —— 直接抛错，因为"静默跳过"的表现是
       * 卡片内部那一整段子流程凭空消失（没人有权限办、单子却继续往下走），最难查。
       */
      if (node.type === 'loop') {
        throw new Error('流程里的「组间轮询」卡片没有在建单时展开，单据数据不完整（见 utils/approvalRotation）')
      }
      // 「引用模板」同上：内容必须在建单期搬进来，残留即数据不完整（见 utils/templateRef）
      if (node.type === 'ref') {
        throw new Error('流程里的「引用模板」节点没有在建单时展开，单据数据不完整（见 utils/templateRef）')
      }

      // 飞书提醒：只记一环、不停留；后续走向不受它影响
      // （出线唯一性由 graphToFlowFrom 保证 —— 它没有结论也没有条件，多条出线无从选择）
      if (node.type === 'notify') {
        pushNotify(node.id)
        i++
        continue
      }
      if (node.type === 'approval') {
        const d = pushStep(node.id)
        if (!d) {
          currentStep = chain.length - 1
          return false
        }
        // 终结类结论（如「选择接收组别」）：这一步办完流程即结束，后面接的环节不会生效
        if (closesFlow(d)) {
          done = true
          terminalBranch = null
          markEnd('closed', `本环节的结论「${resultLabelOf(d.result)}」是终结类结论，流程到此结束`)
          return false
        }
        form = formOf(d, node.id)
        i++
        continue
      }
      if (node.type === 'branch') {
        const b = matchBranch(node.branches, form)
        if (!b) {
          /*
           * 一条分支都没命中，且这个分支组**没有兜底主线**（模板允许不配主线：
           * 每条出线各自绑结论 / 条件，见 utils/approvalFlow 的 collectBranchesRaw）。
           *
           * 以前这里是 `done = true`：单子会被静默判成「已通过」—— 而真实原因是
           * "某个结论没绑到任何一条线"，属于配置问题，判成通过会让错误无声地流下去。
           * 现在改为**停在当前环节**：不推进、也不结束，一眼就能看出异常。
           * （与分支步骤里的口径一致，见 walkSteps 的 `if (!b) return false`。）
           */
          console.warn('[rebuildChain] 没有分支命中且无兜底主线，单据停在当前环节而非判为通过')
          markEnd('stuck', '流转中止：这个结论没有命中任何一条分支，也没配兜底主线', '单据停在当前环节 —— 请检查模板里该结论绑到了哪条线上')
          currentStep = chain.length - 1
          return false
        }
        // 跳出循环优先于回退：两者都是"跳转"，但 exitTo 表示向前跳出本段循环
        if (b.exitTo) {
          return exitTo(b.exitTo.stepId, form)
        }
        if (b.loopBackTo) {
          return loopBackTo(loopBackTarget(node.id, b))
        }
        // steps 为空可能是「直接汇聚到下一个节点」，只有出口表认定为终止才停
        if (b.steps.length > 0 && !walkSteps(b.steps, form)) {
          return false
        }
        if (isExit(b)) {
          done = true
          terminalBranch = b
          markEnd('exit', `按「${branchNameOf(b)}」这条线走到结束节点，流程结束`, `分支结论：${resultLabelOf(firstResultValueOf(b)) || '无（兜底分支）'}`)
          return false
        }
        i++
        continue
      }
      i++
    }
    done = true
    markEnd('finished', '所有环节都已办完，流程结束', lastResult ? `最后一个环节的结论：${resultLabelOf(lastResult)}` : undefined)
    return true
  }

  /**
     * 终态判定：优先看「终止分支」绑定的审批结论（模板作者意图最明确），
     * 终止分支没绑结论时（如兜底的默认分支）再看最后一个环节的结论。
     */
  function outcomeOf (): 'pending' | 'approved' | 'rejected' {
    if (!done) {
      return 'pending'
    }
    const v = terminalBranch ? firstResultValueOf(terminalBranch) : undefined
    if (v) {
      return REJECT_RESULTS.includes(v) ? 'rejected' : 'approved'
    }
    return lastResult && REJECT_RESULTS.includes(lastResult) ? 'rejected' : 'approved'
  }

  // 起始表单也要带上业务上下文：第一个环节之前若有条件节点，它同样要能按业务数据分流
  // （已接收/剩余同样补上：还没人办过时 = 0 / 总库存数量）
  walkFlow(0, withReceivedQuantities({ ...context }))
  // end：流程为什么停下（见 FlowEndInfo）；正常在办的（停在待办环节等人办）没有依据可讲
  return { chain, stepIds, currentStep, done, outcome: outcomeOf(), end: endInfo }
}

// ===== Vue Flow 画布持久化快照 =====

/** 画布节点快照（剥离 vue-flow 运行时字段，仅存可还原的最小集） */
export interface FlowGraphNode {
  id: string
  type: string
  position: { x: number, y: number }
  data?: Record<string, unknown>
}

/** 画布连线快照；data.conditions 保存该分支的命中条件（可多条，logic 决定 and/or） */
export interface FlowGraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
  /** 连线形状：default=贝塞尔 smoothstep=圆角折线 step=直角折线 straight=直线（vue-flow 内置类型） */
  type?: string
  /** 连线形状参数：curvature（贝塞尔弯曲度 0~1）、borderRadius（折线圆角）等，透传给 vue-flow 连线组件 */
  pathOptions?: { curvature?: number, borderRadius?: number, offset?: number }
  data?: {
    /** 兼容旧数据的单条件，等价于 conditions[0] */
    condition?: BranchCondition | null
    /** 该分支的全部命中条件（可以是条件组嵌套） */
    conditions?: ConditionExpr[]
    /** 多条件组合方式，默认 and */
    logic?: 'and' | 'or'
    /**
     * **「组间轮询」卡片**的出线走向：`'early'` = 「提前跳出」（某一组接了、
     * 提前结束轮询，剩下几组不再轮），省略 / `'done'` = 「轮完」
     * （所有组都轮完、一直没人跳出轮询）。
     *
     * 数量约束：**「轮完」有且只有一条**（它决定卡片的后继），**「提前跳出」可以多条**，
     * 各自连到不同环节；环内「提前结束轮询」那条线选其中一条（数据存目标环节 id）。
     * 没有这项时"第几环走哪条"说不清，两条「轮完」会在保存期报错
     * （见 utils/approvalFlow 的 splitLoopOuts / readLoopOuts）。
     * ⚠️ 只用在**卡片自己的出线**上；环内连线表达"提前结束轮询"用的是另一套
     * 字段（`exitMode` + `exitTo`，见 utils/loopCardGraph），两者别混。
     */
    loopExit?: 'done' | 'early'
    /** 手动拖拽曲线（type=adjustable）的弯点；双击圆点可复位 */
    cp?: { x: number, y: number }
  }
}

/** 整图快照：节点 + 连线 + 视口，保存后可原样还原画布 */
export interface FlowGraph {
  nodes: FlowGraphNode[]
  edges: FlowGraphEdge[]
  viewport: { x: number, y: number, zoom: number }
}

/**
 * **建单期成员瘦身**：把 flow 里所有成员裁成"身份 + 展示"真正要用的那几个字段。
 *
 * 为什么要有这一步：成员对象来自通讯录选人（见 components/OrgTree.vue 的 OrgSelectedUser），
 * 上面带着头像 URL（一个就 ~165 B）与 is_leader / is_tenant_manager 这类**只有选人界面**才看的标记。
 * 而单据快照会把这**同一份**记录按环节复制很多遍（组间轮询还要按组各一份）——
 * 实测一张单里 97 个成员对象，去重后只有 15 个人，其余全是重复。
 *
 * 裁掉头像之后展示层怎么显示：按 `open_id`（退化用 `email`）现查
 * （见 stores/avatarDirectory）；老单自带 avatar 照旧直显。两种形状读取方都支持。
 *
 * 保留：`open_id`（查头像 / 发飞书通知都优先用它）、`name`、`email`、`type`、
 * `department`、`department_path`（时间线要显示部门）、`role`（动态审批人来源，备查）。
 * 办理信息（result / opinion / files…）本来就不在 flow 成员上 —— 那些由 rebuildChain 写进 chain。
 *
 * ⚠️ 只作用于**写进单据的那一份** flow：模板画布里的成员照旧带着头像等字段（编辑器要原样回显）。
 *
 * @param openIdOf 通讯录反查（见 utils/orgDirectory 的 memberOpenId）：老模板画布里的成员
 *                 **只有邮箱/姓名、没有 open_id**，建单时按它补上 —— 否则发通知只能退回邮箱，
 *                 没有邮箱的人就永远收不到（飞书发消息本来 open_id / email 都支持）。
 */
export function slimFlowMembers (
  flow: ApprovalFlow,
  openIdOf?: (member: ApprovalChainItem) => string,
): ApprovalFlow {
  const member = (m: ApprovalChainItem): ApprovalChainItem => {
    const out: ApprovalChainItem = {}
    const openId = m.open_id || openIdOf?.(m) || ''
    if (openId) {
      out.open_id = openId
    }
    if (m.name) {
      out.name = m.name
    }
    if (m.email) {
      out.email = m.email
    }
    if (m.type) {
      out.type = m.type
    }
    if (m.department) {
      out.department = m.department
    }
    if (m.department_path) {
      out.department_path = m.department_path
    }
    if (m.role) {
      out.role = m.role
    }
    return out
  }
  /*
   * 节点 / 分支 / 步骤三种形状都有 members、nodes、branches、steps 这几样，
   * 所以用一个递归器统一处理（写三份必然漏掉某一种嵌套）—— 与 utils/templateRef
   * 处理引用树是同一个做法。
   */
  const node = (n: any): any => {
    const out: any = { ...n }
    if (n.members) {
      out.members = n.members.map(member)
    }
    if (n.nodes) {
      out.nodes = n.nodes.map(member)
    }
    if (n.branches) {
      out.branches = n.branches.map(node)
    }
    if (n.steps) {
      out.steps = n.steps.map(node)
    }
    return out
  }
  return flow.map(node)
}

/** 把带分支的流程拍平成线性 chain：分支节点优先取无条件默认分支（审批结果分支即主线），否则取第一个。
 *  支持任意层级嵌套：遇到 type='branch' 的嵌套分支组步骤时取它的默认分支继续递归。 */
export function flowToChain (flow: ApprovalFlow): ApprovalChain {
  const chain: ApprovalChain = []
  function pushMembers (members: ApprovalChainItem[] | undefined) {
    if (members && members.length > 0) {
      chain.push(members)
    }
  }
  function walkBranch (branch: ApprovalBranch) {
    pushMembers(branch.members)
    for (const step of branch.steps) {
      walkStep(step)
    }
  }
  function walkStep (step: ApprovalFlowStep) {
    if (step.type === 'branch' && step.branches?.length) {
      // 嵌套分支组：默认走无条件主线（通过/兜底）；都带条件时才退到第一个分支兼容旧模板
      const first = step.branches.find(isDefaultBranch) ?? step.branches[0]
      if (first) {
        walkBranch(first)
      }
      return
    }
    /*
     * ⚠️ 飞书提醒步骤必须**跳过**，不能 pushMembers。
     *
     * 它的 members 是"提醒对象"，不是审批人。推进线性链的话，
     * 服务端超时催办（server/reminders.ts 的 pendingStepOf 按 type==='manager' 找待办）
     * 会把这些**没有审批职责**的人当成待办人去催 —— 一个不该出现的骚扰。
     * 时间线上要显示它是 rebuildChain 的事（那里写的是 type:'notify' 的占位项）。
     */
    if (step.type === 'notify') {
      return
    }
    /*
     * 「引用模板」步骤：模板里只存引用，内容在建单期才从源模板搬进来（见 utils/templateRef）。
     * 这个函数是**同步**的、保存期就会跑，读不到源模板 —— 所以跳过（见下面顶层同款说明）。
     */
    if (step.type === 'ref') {
      return
    }
    // 同 rebuildChain 的 collect：步骤上的人员可能是 nodes（引用模板搬进来的段落），见 stepMembersOf
    pushMembers(stepMembersOf(step))
    for (const sub of step.steps ?? []) {
      walkStep(sub)
    }
  }
  for (const node of flow) {
    if (node.type === 'approval') {
      if (node.nodes.length > 0) {
        chain.push(node.nodes)
      }
      continue
    }
    // 提醒节点不进线性链，理由同上
    if (node.type === 'notify') {
      continue
    }
    /*
     * 「组间轮询」卡片：保存预览用的线性链走它内部的子流程。
     *
     * 运行时它会被 expandRotations 按组**复制 N 份**（每环各走一遍内部子流程）；
     * 保存时还不知道会有几个组（要建单那一刻才查数据），所以这里只是"看得出卡片里有什么"
     * 的近似 —— 与 flowToChain 处理嵌套分支同一个态度。
     */
    if (node.type === 'loop') {
      for (const step of node.steps) {
        walkStep(step)
      }
      continue
    }
    /*
     * 「引用模板」节点：跳过。
     *
     * 模板里只有引用，没有内容（内容在源模板里、**建单期**才搬进来）——
     * 所以模板记录里这份拍平的 `chain` 不含引用段落。这是"近似"，
     * 与 loop 卡片"按组复制前的近似"同一个态度。
     *
     * ⚠️ 但**订单**的 chain 不从这里来近似：建单期先展开引用再拍平
     * （见 pages/workStream 的 createTaskForRow），那是完整的。
     */
    if (node.type === 'ref') {
      continue
    }
    const first = node.branches.find(isDefaultBranch) ?? node.branches[0]
    if (!first) {
      continue
    }
    walkBranch(first)
  }
  return chain
}

/** 旧的线性 chain 升级为 flow：每个环节变成一个 approval 节点 */
export function chainToFlow (chain: ApprovalChain): ApprovalFlow {
  return chain
    .filter(step => step.length > 0)
    .map(step => ({ id: uid(), type: 'approval' as const, nodes: step }))
}

/**
 * approval_chain 审批订单记录。
 * 字段与 PocketBase collection 保持一致
 * （见 pocketbase/pb_migrations/1788230497_created_approval_chain.js）
 * 除 id 外，collection 中其余字段均为非必填，故声明为可选。
 */
export interface ApprovalOrder {
  id: string
  /** 审批单号 */
  order_no?: string
  /** 审批状态 */
  status?: number
  /** 查询时带了 `expand: 'relation'` 才会有：被展开的 bi_rows 记录（PB 原始记录，
     *  含 snake_case 列与 data 快照）。交给 toProductView 即可转成界面用的中文 key 对象。
     *  没关联数据、或调用方未登录（bi_rows.viewRule 要求已登录）时为空。 */
  expand?: { relation?: Record<string, unknown> | null }
  /** 关联的 `bi_rows` 记录 id（指向 bi_rows 的 relation 字段）。
     *  单值：该字段 maxSelect = 0，按 PB 约定等价于 single，值就是字符串。
     *  见 pocketbase/pb_migrations/1789548325_updated_approval_chain.js */
  relation?: string
  /**
   * 建单人（`users` 记录 id）。
   *
   * 只有**加这个字段之后**建的单才有（见 pb_migrations/1789800000_updated_approval_chain_creator.js）；
   * 历史单为空 —— 读取侧按「不是我的」处理（fail-closed），不会把它错算给别人。
   * 「我的审批单」页的「我发起的」用它区分，见 utils/approvalRuntime 的 orderCreatedBy。
   */
  creator?: string
  /** 关联行的业务键兜底（= `bi_rows.sync_key`，SKU|店铺|仓位|组别|是否属于呆滞库存）。
     *  bi_rows 每次同步都会重写，行被 prune 后重新出现会换新 id，relation 就指空了；
     *  这一列由业务字段拼成、不受重写影响，用来把单重新对回数据。
     *  见 pocketbase/pb_migrations/1789660200_updated_approval_chain.js */
  sync_key?: string
  /** 审批链快照（json 字段）。
   *  chain 为运行时链路（由 flow + decisions 重算得出，含已办轨迹与当前待办），
   *  flow 为带分支的完整流程（模板，只读），branchTerminal 为分支出口表，
   *  decisions 为办理流水（按办理顺序追加，同一环节可有多条 = 驳回重审）。 */
  chain?: {
    chain: ApprovalChain
    flow?: ApprovalFlow
    /**
     * **画布快照：只有老单才有**，新单不再写它（见下面 branchTerminal）。
     *
     * 为什么新单不写：它是**编辑器**的数据（节点坐标、连线弯曲点、卡片内嵌的小画布、
     * 连线上的条件对象…），实测在一张真实单据里占整份快照的 47%（120 KB / 252 KB），
     * 而单据这一侧从来不画图 —— 运行期只从它里面取"这条分支线是不是直达结束节点"。
     * 字段保留是为了老单照旧能读、也不必迁移历史数据（读取口见 branchTerminalMapOf）。
     */
    graph?: FlowGraph
    /**
     * **分支出口表**（连线 / 分支的 id → 是不是直达「结束」节点），建单期从模板的画布算好存下。
     *
     * 谁在用：`rebuildChain` 判"命中这个分支是不是整单终止"（见 ApprovalBranch.isEnd 与
     * 本文件的 isExit）。只存 `true` 项（稀疏），没列出来 = 非出口 —— 语义与整表等价，
     * 但小得多（见 compactBranchTerminal）。
     */
    branchTerminal?: BranchTerminalMap
    decisions?: NodeDecision[]
    /** 运行时追加的成员（抄送/转办）：stepId → 成员列表。
         *  不能只写进 chain —— chain 是 flow+decisions 的重算结果，下次重算会丢失；
         *  也不能写进 flow —— 那是模板，改了会影响后续所有审批单。 */
    extraMembers?: Record<string, ApprovalChainItem[]>
    /** 建单时冻结的**业务数据快照**：分支条件里的业务字段从这里取（见 FlowContext）。
         *  必须冻结：bi_rows 每次同步都会重写，读实时数据会让历史单的链路回放性变化。 */
    context?: FlowContext
    /**
     * 建单期冻结的**审批类型**（`结论码 → 选中这个结论后要填什么`，见 utils/approvalTypes）。
     *
     * 与 flow / branchTerminal 同一个时机、同一个承诺：**模板之后怎么改都不影响已建的单**。
     * 办理页只读这一份（经 typesFromSnapshot / typeTemplateFromSnapshot），
     * 老单没有这一项时回落到内置默认（= 改造前的硬编码行为）。
     * 只存"非空壳"的行（写法见 slimTypeTemplates）。
     */
    types?: Record<string, ApprovalTypeTemplate>
  }
  created?: string
  updated?: string
}

export interface ApprovalModal {
  /** chain 为拍平后的线性链路（兼容旧渲染），flow 为带分支的完整流程，graph 为画布快照 */
  chain: { chain: ApprovalChain, flow?: ApprovalFlow, graph?: FlowGraph }
  name: string
  status: number
  created: string
  id: string
  updated: string
}

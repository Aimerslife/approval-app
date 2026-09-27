import type {
  Flow2Decision,
  Flow2LogEntry,
  Flow2Node,
  Flow2QueryRecord,
  Flow2Run,
  Flow2Step,
  Flow2StepMember,
  Flow2Template,
} from '@/types/flow2'
import { toFlowContext } from '@/utils/approvalFlow'
import { BI_ROW_FIELD_BY_KEY } from '@/utils/biRowFields'
import { sameTeamGroups } from '@/utils/groupApprovers'
import { translateFilterFields } from '@/utils/rotationQuery'

/*
 * ============================================================================
 * 流程编排 v2 · 运行期引擎（实验）
 * ============================================================================
 *
 * ## 它解决什么
 *
 * v1 里"流程长什么样"在建单那一刻就被**算死了**（`expandRotations` 把轮询展成 N 个死环，
 * 之后 `rebuildChain` 只能按快照重放）。于是这些事情**表达不出来**：
 *
 *   · 环内选到某个结论就提前结束、跳过剩余所有环；
 *   · 按"该组自己的数据"决定这一组要不要审、由谁审；
 *   · 每走一步都要去看一次别处的数据。
 *
 * v2 把"决定下一步"从模板搬到了**函数**里：节点即函数，函数可以查库、可以循环、
 * 可以看已办流水。流程在推进的那一刻被**构建出来**，而不是提前画好。
 *
 * ## ⚠️ 三条硬约束（这是 v1 那些设计换来的，v2 必须自己扛住）
 *
 * 1. **构建只发生在"推进"的瞬间**（建单 / 办完一环），结果与决策日志一起落库。
 *    展示、待办、催办、时间线全部**只读落库的那份结果**，绝不重新执行函数 ——
 *    否则审批页每渲染一次就可能查出不同数据、算出不同走向，历史单会漂移。
 *
 * 2. **函数必须是可终止的**。`next` 指回自己就是循环，所以引擎有三道闸：
 *    单次推进的节点执行次数上限、单次推进产出的环节数上限、每个节点的执行超时。
 *    任一超限都判这一轮失败（`errors` 非空），**不静默继续**。
 *
 * 3. **审计靠日志，不靠代码**。函数代码会改，日志不会：每次执行都记下
 *    输入（ctx/decisions 的指纹不记全量）、查询（集合/filter/参数/条数/耗时）、
 *    `log()` 输出、返回值。没有这些，"当时为什么把单发给这个人"就答不出来。
 *
 * ## 与 v1 的取舍（对照表，写在页面上给使用者看）
 *
 * | | v1（静态模板 + 建单期展开） | v2（函数节点 + 运行期构建） |
 * |---|---|---|
 * | 建单期开销 | 大（要把链路全算出来） | 小（只跑第一个函数） |
 * | 运行期开销 | 无（纯重放） | 每推进一环都要执行函数、可能要查库 |
 * | 表达力 | 受"画得出来"限制 | 任意 JS |
 * | 可校验性 | 保存期能静态校验 | 只能校验语法，行为要跑才知道 |
 * | 可重放/可审计 | 天然（模板+流水+快照） | 靠**落库的构建结果 + 决策日志** |
 * | 数据一致性 | 建单期冻死 | 每步都是当时的最新数据（这正是你要的，也是它最大的风险） |
 *
 * ## 沙箱的实话
 *
 * 这里的函数用 `new Function` 在**浏览器里**执行，它拿得到页面里的一切，没有真正的隔离。
 * 因此本模块只适合内部可信环境（实验/对比）。生产化只有两条路：
 *   · 把执行搬到服务端，由服务端在受控环境里跑并落库；
 *   · 或改成**受控算子集**（可序列化、可静态校验、可重放的小语言），放弃"任意 JS"。
 */

/** 单次推进里，函数最多被执行多少次（`next` 指回自己 = 循环，用它兜底） */
export const MAX_NODE_RUNS = 200
/** 单次推进最多产出多少环（与 v1 的 ROTATION_DEFAULTS.limit 同量级） */
export const MAX_STEPS_PER_RUN = 20
/** 每个节点的执行超时（只对 await 有效：同步死循环拦不住，见文件头说明） */
export const NODE_TIMEOUT_MS = 8000
/** 单次查询最多取回多少行（防止函数把整表拉进内存） */
export const QUERY_LIMIT_MAX = 2000
/** `q.list` 的默认行数 */
export const QUERY_LIMIT_DEFAULT = 200

/** 注入给函数的查询实现（真实是 PocketBase，测试可换成假的） */
export type Flow2QueryFn = (
  collection: string,
  filter: string,
  params: Record<string, string | number>,
  opts: { sort?: string, limit?: number },
) => Promise<Record<string, unknown>[]>

/** 运行环境：函数的输入 */
export interface Flow2Env {
  /** 业务上下文（审批单快照）。**只读**：函数改它没有意义，也不会被落库 */
  ctx: Record<string, unknown>
  /** 已办流水（按发生顺序） */
  decisions: Flow2Decision[]
  /** 可写状态：随单据落库，函数靠它记住"办到第几个了" */
  state: Record<string, unknown>
  /** 查询实现（必填，见 makePbQuery / 测试里的假实现） */
  query: Flow2QueryFn
  /** 同团队组别（团队归属在组织架构里，不是数据列，所以只能注入进来） */
  org?: { sameTeamGroups: (group: string) => string[] }
  /** 时钟（测试可注入固定值） */
  now?: () => number
}

/** 函数返回里的一个环节（未加 id 之前） */
interface RawStep {
  name: string
  members: Flow2StepMember[]
}

/* ==================== 一、模板校验与编译 ==================== */

/** 节点代码的编译结果 */
export interface CompiledNode {
  node: Flow2Node
  fn?: (...args: unknown[]) => Promise<unknown>
  /** 编译失败的原因（语法错） */
  error?: string
}

/**
 * 编译一个节点的代码。
 *
 * 语法错在**编译期**就能发现（`new Function` 会抛 SyntaxError），所以保存模板与执行前
 * 都会先编译一遍 —— 这是 v2 里唯一能"提前"发现的错，其余（查库失败、算错走向）
 * 只有跑起来才知道，这也是它相对 v1 的固有劣势。
 */
export function compileNode (node: Flow2Node): CompiledNode {
  const body = `"use strict";\nreturn (async () => {\n${node.code ?? ''}\n})()`
  try {
    const fn = new Function('ctx', 'decisions', 'state', 'q', 'org', 'log', body) as CompiledNode['fn']
    return { node, fn }
  } catch (error) {
    return { node, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}

/** 模板结构校验（保存前调用）。返回的每一条都是给人看的短句 */
export function validateFlow2Template (template: Flow2Template): string[] {
  const issues: string[] = []
  const nodes = template?.nodes ?? []
  if (nodes.length === 0) {
    issues.push('模板里一个节点都没有')
    return issues
  }
  const seen = new Set<string>()
  for (const n of nodes) {
    const id = String(n.id ?? '').trim()
    if (!id) {
      issues.push(`有节点没填 id（节点名「${n.name ?? ''}」）`)
      continue
    }
    if (seen.has(id)) {
      issues.push(`节点 id「${id}」重复了（id 是节点之间跳转的地址，必须唯一）`)
    }
    seen.add(id)
  }
  if (!String(template.entry ?? '').trim()) {
    issues.push('没有指定起始节点')
  } else if (!seen.has(String(template.entry).trim())) {
    issues.push(`起始节点「${template.entry}」不在节点列表里`)
  }
  for (const n of nodes) {
    const compiled = compileNode(n)
    if (compiled.error) {
      issues.push(`节点「${n.name || n.id}」代码有语法错误：${compiled.error}`)
    }
  }
  return issues
}

/* ==================== 二、查询 API ==================== */

/** `{:名字}` 的绑定值只允许文本与数字（undefined 会让 pb.filter 直接抛，null 会变成字符串 'null'） */
function checkQueryParams (params: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) {
      throw new Error(`查询参数「${k}」没有值（空值会让条件永远不命中）`)
    }
    if (typeof v !== 'string' && typeof v !== 'number') {
      const shape = Array.isArray(v) ? '数组' : typeof v
      throw new Error(`查询参数「${k}」不是文本也不是数字（${shape}）`)
    }
    out[k] = v
  }
  return out
}

/** 排序串里的中文列名也要翻译（`sort=-SKU近一年月平均销量` → `-sku_sales_avg_12m`） */
function translateSort (sort: string | undefined): string | undefined {
  const raw = String(sort ?? '').trim()
  if (!raw) {
    return undefined
  }
  return raw
    .split(',')
    .map(part => {
      const name = part.trim()
      const desc = name.startsWith('-')
      const key = desc ? name.slice(1) : name
      const field = BI_ROW_FIELD_BY_KEY[key]?.field ?? key
      return desc ? `-${field}` : field
    })
    .join(',')
}

/**
 * 真实的查询实现：直连 PocketBase。
 *
 * 两个便利（与项目其余部分同一套口径，用户不需要知道 PB 的列名是 ASCII）：
 *   · filter / sort 里写**中文列名**，这里自动翻译；
 *   · `bi_rows` 取回来的行转成中文列名的普通对象（含派生指标），函数里直接 `row['组别']`。
 */
export function makePbQuery (): Flow2QueryFn {
  return async (collection, filter, params, opts) => {
    /*
     * 惰性加载 pb 实例（而不是模块顶部 import）：
     * `src/pocketbase.ts` 用 `import.meta.env`，在 node/tsx 下加载会直接抛。
     * 放在这里，整个引擎就能被 tsx 直接断言（本项目对纯逻辑一律这么验）。
     */
    const { default: pb } = await import('@/pocketbase.ts')
    const bound = pb.filter(translateFilterFields(filter), checkQueryParams(params))
    const sort = translateSort(opts?.sort)
    const limit = Math.min(Number(opts?.limit ?? QUERY_LIMIT_DEFAULT) || QUERY_LIMIT_DEFAULT, QUERY_LIMIT_MAX)
    const list = await pb.collection(collection).getList(1, limit, {
      filter: bound,
      ...(sort ? { sort } : {}),
    })
    return list.items.map(item => (collection === 'bi_rows'
      ? toFlowContext(item as Record<string, unknown>)
      : { ...(item as Record<string, unknown>) }))
  }
}

/** 把查询包一层日志（无论真假实现都记，审计靠它） */
function loggedQuery (real: Flow2QueryFn, sink: Flow2QueryRecord[], now: () => number): Flow2QueryFn {
  return async (collection, filter, params, opts) => {
    const t0 = now()
    const record: Flow2QueryRecord = {
      collection,
      filter,
      ...(Object.keys(params ?? {}).length > 0 ? { params: { ...params } } : {}),
      ms: 0,
    }
    sink.push(record)
    try {
      const rows = await real(collection, filter, params, opts)
      record.total = rows.length
      record.ms = Math.round(now() - t0)
      return rows
    } catch (error) {
      record.ms = Math.round(now() - t0)
      record.error = error instanceof Error ? error.message : String(error)
      // 带上 cause：底层错（PB 拒绝、网络断）要能顺着调用栈看出来
      throw new Error(`查询「${collection}」失败：${record.error}`, { cause: error })
    }
  }
}

/** 给函数用的 `q`：list / first / exists 三个方法 */
function makeQueryApi (query: Flow2QueryFn) {
  return {
    list: (collection: string, filter: string, params?: Record<string, string | number>, opts?: { sort?: string, limit?: number }) =>
      query(String(collection), String(filter ?? ''), params ?? {}, opts ?? {}),
    first: async (collection: string, filter: string, params?: Record<string, string | number>, opts?: { sort?: string }) => {
      const rows = await query(String(collection), String(filter ?? ''), params ?? {}, { ...opts, limit: 1 })
      return rows[0] ?? null
    },
    /**
     * 存在性判断：只取 1 行，**不必把行拉回来**。
     *
     * 为什么不给 `count`：查询实现只回行（`Flow2QueryFn`），拿不到真实总数；
     * 与其给一个受 `QUERY_LIMIT_MAX` 影响的"假计数"，不如只提供确定可靠的 exists。
     * 真要条数就先 list 回来数（同样受上限约束，超了会报错提醒收窄条件）。
     */
    exists: async (collection: string, filter: string, params?: Record<string, string | number>) => {
      const rows = await query(String(collection), String(filter ?? ''), params ?? {}, { limit: 1 })
      return rows.length > 0
    },
  }
}

/* ==================== 三、执行 ==================== */

/** 把函数返回的东西归一化；形状不对就报错（宁可失败，不要静默走错路） */
function normalizeOut (raw: unknown, nodeName: string): { steps: RawStep[], next: string, done: boolean } {
  if (raw === undefined || raw === null) {
    throw new Error(`节点「${nodeName}」没有 return；必须返回 { steps?, next } 或 { done: true }`)
  }
  if (typeof raw !== 'object') {
    throw new TypeError(`节点「${nodeName}」返回了 ${typeof raw}；必须返回 { steps?, next } 或 { done: true }`)
  }
  const obj = raw as { steps?: unknown, next?: unknown, done?: unknown }
  const done = obj.done === true
  const steps: RawStep[] = []
  if (obj.steps !== undefined && obj.steps !== null) {
    if (!Array.isArray(obj.steps)) {
      throw new TypeError(`节点「${nodeName}」的 steps 不是数组`)
    }
    for (const [i, s] of obj.steps.entries()) {
      if (!s || typeof s !== 'object') {
        throw new Error(`节点「${nodeName}」的第 ${i + 1} 个环节不是对象`)
      }
      const one = s as { name?: unknown, members?: unknown }
      const name = String(one.name ?? '').trim()
      if (!name) {
        throw new Error(`节点「${nodeName}」的第 ${i + 1} 个环节没填 name（环节名会进时间线，必须给）`)
      }
      const members: Flow2StepMember[] = []
      if (one.members !== undefined) {
        if (!Array.isArray(one.members)) {
          throw new TypeError(`节点「${nodeName}」的环节「${name}」的 members 不是数组`)
        }
        for (const m of one.members) {
          if (!m || typeof m !== 'object') {
            throw new Error(`节点「${nodeName}」的环节「${name}」里有成员不是对象`)
          }
          const mm = m as Flow2StepMember
          members.push({
            ...(mm.name ? { name: String(mm.name) } : {}),
            ...(mm.email ? { email: String(mm.email) } : {}),
            ...(mm.role ? { role: { kind: 'dept_leader' as const, ...(mm.role.dept ? { dept: String(mm.role.dept) } : {}) } } : {}),
          })
        }
      }
      if (members.length === 0) {
        throw new Error(`节点「${nodeName}」的环节「${name}」没有办理人（members 为空，这一环会没人能办）`)
      }
      steps.push({ name, members })
    }
  }
  const next = done ? 'end' : String(obj.next ?? '').trim()
  if (!next) {
    throw new Error(`节点「${nodeName}」没给 next（下一步去哪）：写 'end' 表示流程结束，或写下一个节点的 id`)
  }
  return { steps, next, done }
}

/** 超时包装。注意：**同步死循环拦不住**（JS 单线程），它只保证 await 不会无限等 */
function withTimeout<T> (p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      v => {
        clearTimeout(timer)
        resolve(v)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * 从 `from`（默认模板入口）开始执行，直到**产出至少一个环节**（停下等办理）、
 * 或者流程结束、或者出错。
 *
 * 返回值里的 `cursor` 就是"这些环节都办完之后从哪个节点继续"，调用方要把它和
 * `state` / `steps` 一起落库 —— 这是 v2 里"流程"的全部载体。
 */
export async function runFlow2 (
  template: Flow2Template,
  env: Flow2Env,
  from?: string,
): Promise<Flow2Run> {
  const now = env.now ?? (() => Date.now())
  const byId = new Map<string, Flow2Node>()
  for (const n of template?.nodes ?? []) {
    byId.set(String(n.id), n)
  }

  const queryRecords: Flow2QueryRecord[] = []
  const query = loggedQuery(env.query, queryRecords, now)
  const q = makeQueryApi(query)
  const org = env.org ?? { sameTeamGroups }

  const steps: Flow2Step[] = []
  const logs: Flow2LogEntry[] = []
  const errors: string[] = []
  const state = env.state ?? {}
  let seq = 0
  let nodeRuns = 0
  let cursor = String(from ?? template?.entry ?? '').trim()

  if (!cursor) {
    errors.push('模板没有起始节点（entry 为空）')
    return { steps, cursor: '', state, done: false, logs, errors }
  }

  while (cursor && cursor !== 'end') {
    if (nodeRuns >= MAX_NODE_RUNS) {
      errors.push(`单次推进里函数执行超过 ${MAX_NODE_RUNS} 次：多半是 next 指回了自己而缺少终止条件`)
      break
    }
    nodeRuns++

    const node = byId.get(cursor)
    if (!node) {
      errors.push(`找不到节点「${cursor}」（模板里只有：${[...byId.keys()].join('、')}）`)
      break
    }

    const entry: Flow2LogEntry = {
      seq: seq++,
      nodeId: node.id,
      nodeName: node.name || node.id,
      at: new Date(now()).toISOString(),
      ms: 0,
      logs: [],
      queries: queryRecords.splice(0),
    }
    logs.push(entry)

    const compiled = compileNode(node)
    if (compiled.error || !compiled.fn) {
      entry.error = `代码有语法错误：${compiled.error ?? '未知'}`
      errors.push(`节点「${entry.nodeName}」${entry.error}`)
      break
    }

    const t0 = now()
    let out: { steps: RawStep[], next: string, done: boolean }
    try {
      const raw = await withTimeout(
        compiled.fn(env.ctx, env.decisions, state, q, org, (msg: unknown) => entry.logs.push(String(msg))),
        NODE_TIMEOUT_MS,
        `节点「${entry.nodeName}」执行超过 ${NODE_TIMEOUT_MS}ms 还没结束`,
      )
      out = normalizeOut(raw, entry.nodeName)
    } catch (error) {
      // 查询记录也要收进这一条日志（失败的那次查询同样重要）
      entry.queries.push(...queryRecords.splice(0))
      entry.ms = Math.round(now() - t0)
      entry.error = error instanceof Error ? error.message : String(error)
      errors.push(`节点「${entry.nodeName}」执行失败：${entry.error}`)
      break
    }
    // 函数内部的查询记录归到这一条日志上
    entry.queries.push(...queryRecords.splice(0))
    entry.ms = Math.round(now() - t0)
    entry.out = { steps: out.steps.length, next: out.next, done: out.done }

    for (const s of out.steps) {
      if (steps.length >= MAX_STEPS_PER_RUN) {
        errors.push(
          `单次推进产出的环节超过 ${MAX_STEPS_PER_RUN} 个（不静默截断，否则会漏掉几个环节；请收窄条件或拆节点）`,
        )
        break
      }
      steps.push({ id: `${node.id}#${steps.length + 1}`, nodeId: node.id, name: s.name, members: s.members })
    }
    if (errors.length > 0) {
      break
    }

    cursor = out.next
    if (out.steps.length > 0) {
      // 产出环节 = 有人要办 = 这一段构建到此为止，等办理完再从这个节点继续
      break
    }
  }

  return {
    steps,
    cursor,
    state,
    // 走到 'end' 才算正常结束；出错中止时 cursor 停在原地，调用方读 errors 判失败
    done: cursor === 'end',
    logs,
    errors,
  }
}

/* ==================== 四、试算（页面用） ==================== */

/** 试算结果：一条被完整构建出来的流程 + 全过程日志 */
export interface Flow2Simulation {
  /** 构建出来的全部环节（按顺序） */
  steps: Flow2Step[]
  /** 每一环被"模拟办理"时用的结论（与 steps 一一对应） */
  results: string[]
  logs: Flow2LogEntry[]
  errors: string[]
  /** 执行了几轮（= 函数被推进了几次） */
  rounds: number
  done: boolean
  /** 结束时的 state（给使用者看"函数记住了什么"） */
  state: Record<string, unknown>
}

/**
 * 试算：反复"推进 + 模拟办理"，直到流程结束或出错。
 *
 * 模拟办理的结论按 `results` 依次取（不够就默认 `pass`）—— 这正是用来演示
 * "某一环选到终止项就提前结束"的方式。
 */
export async function simulateFlow2 (opts: {
  template: Flow2Template
  ctx: Record<string, unknown>
  query: Flow2QueryFn
  /** 依次给每一环用的结论 */
  results?: string[]
  org?: Flow2Env['org']
  now?: () => number
  maxRounds?: number
}): Promise<Flow2Simulation> {
  const { template, ctx, query } = opts
  const out: Flow2Simulation = { steps: [], results: [], logs: [], errors: [], rounds: 0, done: false, state: {} }
  const state: Record<string, unknown> = {}
  const decisions: Flow2Decision[] = []
  const maxRounds = opts.maxRounds ?? 50

  let from: string | undefined
  for (let round = 0; round < maxRounds; round++) {
    out.rounds = round + 1
    const run = await runFlow2(template, {
      ctx, decisions, state, query,
      ...(opts.org ? { org: opts.org } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    }, from)
    out.logs.push(...run.logs)
    if (run.errors.length > 0) {
      out.errors.push(...run.errors)
      break
    }
    if (run.steps.length === 0) {
      out.done = run.done || run.cursor === 'end'
      break
    }
    // 这一轮产出的环节：逐个"模拟办理"，把结论记进流水（下一轮的函数能读到它）
    for (const s of run.steps) {
      const result = opts.results?.[out.results.length] ?? 'pass'
      out.steps.push(s)
      out.results.push(result)
      decisions.push({ stepId: s.id, nodeId: s.nodeId, name: s.name, result, at: new Date().toISOString() })
    }
    from = run.cursor
    if (run.cursor === 'end') {
      out.done = true
      break
    }
  }
  out.state = { ...state }
  if (!out.done && out.errors.length === 0 && out.rounds >= maxRounds) {
    out.errors.push(`试算超过 ${maxRounds} 轮还没结束（函数里可能缺终止条件）`)
  }
  return out
}

/* ==================== 五、内置示例模板 ==================== */

/**
 * 示例模板：**正是 v1 表达不了的那个场景**（同团队里存在同主MODEL 的在售非呆滞货
 * → 这些组依次进入轮询 → 环内选到终止项就提前结束）。
 *
 * 两个节点：
 *   scan 收集候选组（运行期查库，随便写逻辑）
 *   next 逐个组构建环节；`next` 指回自己 = 循环，读完上一环的结论决定是否终止
 */
export function defaultFlow2Template (): Flow2Template {
  return {
    entry: 'scan',
    nodes: [
      {
        id: 'scan',
        name: '收集候选组（运行期查库）',
        note: '等价的 v1 配置是「按组轮询 + 同团队 + 行条件」，但 v1 在建单期就展开成死结构',
        code: `
const rows = await q.list(
  'bi_rows',
  '部门 = {:部门} && 主MODEL = {:主MODEL} && 是否属于呆滞库存 = "否" && 销售状态 ~ "在售"',
  { 部门: ctx['部门'], 主MODEL: ctx['主MODEL'] },
)
log('命中 ' + rows.length + ' 行')

// 团队归属维护在组织架构里（不是数据列），所以只能问 org
const team = org.sameTeamGroups(String(ctx['组别'] ?? ''))
const sum = new Map()
for (const r of rows) {
  const g = String(r['组别'] ?? '').trim()
  if (!g) continue
  if (team.length && !team.includes(g)) continue
  sum.set(g, (sum.get(g) ?? 0) + Number(r['SKU近一年月平均销量'] ?? 0))
}
state.queue = [...sum.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([name, sales]) => ({ name, sales }))
state.stopResults = state.stopResults ?? ['recycle', 'scrap']
log('候选组：' + (state.queue.map(x => x.name + '(' + x.sales + ')').join('、') || '（无）'))

return { next: 'next' }
`.trim(),
      },
      {
        id: 'next',
        name: '逐个组构建环节（可提前结束）',
        note: 'next 指回自己 = 运行期循环；提前终止就是一次普通判断',
        code: `
// 1) 上一环选到终止项 → 结束轮询，进后面（这里就是"提前终止"）
const last = decisions[decisions.length - 1]
const stopResults = state.stopResults ?? []
if (last && stopResults.includes(last.result)) {
  log('上一环选了「' + last.result + '」，结束轮询')
  return { next: 'end' }
}

// 2) 取下一个组；state 随单据落库，所以"办到第几个"是可追溯的
const queue = state.queue ?? []
const g = queue.shift()
if (!g) {
  log('没有待办的组了，流程结束')
  return { next: 'end' }
}

// 3) 构建这一环（办理人按该组负责人解析，与 v1 同口径）
return {
  steps: [{
    name: '组审批 · ' + g.name + '（销量 ' + g.sales + '）',
    members: [{ role: { kind: 'dept_leader', dept: g.name } }],
  }],
  next: 'next',
}
`.trim(),
      },
    ],
  }
}

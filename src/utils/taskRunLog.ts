/**
 * 「开启任务」批量建单的**执行日志**（浏览器内存里的环形缓冲）—— workStream.vue 的
 * 「最近任务执行状态」弹窗读它。
 *
 * ## 为什么要有它
 *
 * 批量建单的结果现在只汇总成一条 snackbar（见 workStream.vue 的 reportTaskResults）：
 * 「成功 3、跳过 20（A：已有进行中的单 XX；B：…）等 12 条」—— 括号里最多举三个例子。
 * 而"剩下那些为什么没建出来"（已有进行中的单 / 这一行没有团队 / 模板找不到 /
 * 流程展开失败 / 拿不到记录 id）当场没看仔细就永远查不到了，只剩一连串再点一遍的成本。
 * 这个页面恰好是排查"为什么没建出单"的第一现场，所以把每轮结果留下来。
 *
 * ## 为什么不落库
 *
 *   · 这是**页面操作**的日志（谁点的、点了哪几行、逐条什么原因），和后端跑批不是一类东西；
 *   · 落库要新建集合、定保留期、处理并发写，为了"看最近几轮"不划算 ——
 *     与 server/reminderLog.ts 的取舍一致（那份记的是服务端跑批）。
 *
 * ⚠️ 代价说清楚：**刷新页面即清空**，只记本次会话的最近 MAX_RUNS 轮。
 *    普通的路由切换不丢（模块作用域），所以从 workStream 走开再回来还在。
 *
 * ## 为什么明细要截断
 *
 * 一页最多 200 行，正常批量不会触发截断；真超了就只留前 MAX_ITEMS 条，
 * 但**计数（成功 / 跳过 / 失败）始终是完整的** —— 截断只影响明细展示。
 */

/** 一行结果的处理类型 —— 与 workStream.vue 里 TaskResult 的 kind 同义 */
export type TaskRunItemKind = 'created' | 'skipped' | 'failed'

/** 一条明细（成功 / 跳过 / 失败） */
export interface TaskRunItem {
  kind: TaskRunItemKind
  /** 展示用的行标识（SKU） */
  label: string
  /** 成功时是单号；跳过 / 失败时是原因 */
  detail?: string
}

/** 一轮批量建单的记录 */
export interface TaskRunEntry {
  /** 这一轮**开始**的时刻（ISO） */
  at: string
  /** 耗时（毫秒）—— 一条单要打好几次库，看它判断这批的规模是否正常 */
  ms: number
  /** 勾选的行数 */
  picked: number
  /** 勾选里因为"已有单（在流程中 / 已结束）"被剔掉的条数 */
  locked: number
  created: number
  skipped: number
  failed: number
  /** 明细总条数（可能大于 items.length —— 被截断了，见文件头） */
  total: number
  /** 这一轮**根本没跑起来**的原因（没勾选 / 选中的都已有单）—— 有值就说明一条都没建 */
  aborted?: string
  /** 这一轮**跑到一半挂了**（区别于 failed：那是单行失败）—— 有它就说明这轮不完整 */
  fatal?: string
  /** 逐条明细（截断保存） */
  items: TaskRunItem[]
}

/** 最多留多少轮：弹窗只看最近几轮，20 足够回溯一下午的批量操作 */
const MAX_RUNS = 20
/** 单轮最多留多少条明细 */
const MAX_ITEMS = 200

/** 最新的排最前，弹窗直接按顺序渲染 */
const runs: TaskRunEntry[] = []

/**
 * 记一轮。**没跑起来 / 跑到一半挂了也要记**（传 aborted / fatal）——
 * 这两种正是事后最需要回看的情况：什么都不记的话，日志里看起来就像"压根没点过"。
 */
export function recordTaskRun (input: {
  at: string
  ms: number
  picked: number
  locked?: number
  results?: Array<{ kind: TaskRunItemKind, label: string, detail?: string }>
  aborted?: string
  fatal?: string
}): void {
  const results = input.results ?? []
  runs.unshift({
    at: input.at,
    ms: input.ms,
    picked: input.picked,
    locked: input.locked ?? 0,
    created: results.filter(r => r.kind === 'created').length,
    skipped: results.filter(r => r.kind === 'skipped').length,
    failed: results.filter(r => r.kind === 'failed').length,
    total: results.length,
    ...(input.aborted ? { aborted: input.aborted } : {}),
    ...(input.fatal ? { fatal: input.fatal } : {}),
    items: results.slice(0, MAX_ITEMS).map(r => ({ kind: r.kind, label: r.label, detail: r.detail })),
  })
  if (runs.length > MAX_RUNS) {
    runs.length = MAX_RUNS
  }
}

/** 给弹窗读的快照（带上留存上限，弹窗据此说明"只记最近多少轮 / 每轮最多多少条"） */
export function readTaskRuns (): { limits: { runs: number, items: number }, items: TaskRunEntry[] } {
  return { limits: { runs: MAX_RUNS, items: MAX_ITEMS }, items: runs }
}

/** 清空记录（弹窗上的「清空」用） */
export function clearTaskRuns (): void {
  runs.length = 0
}

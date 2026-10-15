import type { ReminderReport } from './reminders'
import { config } from './config'

/**
 * 超时提醒跑批的**执行日志**（进程内环形缓冲）—— 「提醒设置」页的「执行日志」板块读它。
 *
 * ## 为什么要有它
 *
 * 跑批（`server/index.ts` 的 runReminderBatch）算完之后只把结果打了 console：
 * 定时任务到底跑没跑、发了多少、被哪条规则挡掉，只能登服务器看日志。页面里看不到。
 *
 * ## 为什么刻意**不落库**
 *
 *   · 跑批那条路本来就不碰库（`server/reminders.ts` 是纯逻辑 + 注入的发送函数）；
 *   · 要落库就得新建集合、定保留期、再用管理员凭据写 —— 为了"看最近几轮"引这些不划算，
 *     和 reminders.ts 里 `lastSentAt` 的取舍是同一个理由。
 *
 * ⚠️ 代价说清楚：**重启服务即清空**，只记本次启动以来的最近 MAX_ENTRIES 轮。
 *    要跨重启查历史，那是"落库 + 清理策略"另一件事。页面会把"服务启动于"显示出来，
 *    免得有人看到空列表以为跑批一次都没跑。
 *
 * ## 为什么明细要截断
 *
 * 一轮最多 200 单，全留下会把内存和接口响应都撑大；页面也只展示前若干条。
 * 截断只影响**展示**，计数（scanned/due/sent…）都是完整的。
 */

/** 最多留多少轮：页面只看最近十几轮，50 足够回溯一整天 */
const MAX_ENTRIES = 50
/** 单轮最多留多少条应提醒明细 */
const MAX_TASKS = 20
/** 单轮最多留多少条错误 */
const MAX_ERRORS = 10

/**
 * 这一轮是谁触发的：
 *   · timer  —— 进程内定时（REMINDER_INTERVAL_MIN>0 时才开）
 *   · http   —— 外部 cron 打 POST /api/reminders/run
 *   · manual —— 页面上的「立即试算」（打 ?src=manual）
 */
export type ReminderTrigger = 'timer' | 'http' | 'manual'

/** 日志里的应提醒明细（只留页面要展示的字段） */
export interface ReminderRunTask {
  orderNo: string
  /** 第几环（从 1 开始，给人看的） */
  stepIndex: number
  /** 已等待的工作日小时数 */
  hours: number
  /** '48h' 日常催办 / '5d' 升级（标签沿用报告口径，见 reminders.ts 的说明） */
  level: string
  /** 这一环还没办的人 */
  waiting: Array<{ name?: string, email?: string }>
}

/** 一轮跑批的记录 */
export interface ReminderRunEntry {
  /** 这一轮**开始**的时刻（ISO） */
  at: string
  trigger: ReminderTrigger
  /** true = 只算不发（dry-run） */
  dryRun: boolean
  /** 耗时（毫秒）—— 扫一遍 200 单要多久，看它 */
  ms: number
  scanned: number
  due: number
  sent: number
  /** 距上次提醒还没隔够推送间隔、这一轮跳过的条数 */
  skippedInterval: number
  /** 没有可发收件人（缺邮箱 / 被白名单排除 / 未配指定人员）的条数 */
  noEmail: number
  escalated: number
  /** 本轮生效的推送间隔（小时）—— "配了间隔却没发"时一眼能看出间隔是多少 */
  intervalHours: number
  /** 被推送规则**整轮**挡掉的原因（有值 = 这轮连库都没查） */
  gate?: string
  /** 单条失败 / 告警（如"某单没有可发收件人"） */
  errors: string[]
  /** 跑批**本身**抛异常（区别于 errors：那是单条发送失败）—— 有它就说明这轮是失败的 */
  fatal?: string
  /** 这一轮该提醒哪些单（截断保存，页面展开看明细） */
  tasks: ReminderRunTask[]
}

/** 本次服务启动时刻：页面用它说明"日志从什么时候开始记" */
export const serverStartedAt = new Date().toISOString()

/** 最新的排最前，页面直接按顺序渲染 */
const entries: ReminderRunEntry[] = []

/**
 * 记一轮。**失败也要记**（传 fatal）—— 什么都不记的话，页面看起来就像"压根没跑"，
 * 而实际是跑挂了，那是最容易误判的一种情况。
 *
 * 注释里特意把 report 设为可选：抛异常时没有 report，只剩 fatal 与耗时。
 */
export function recordReminderRun (input: {
  at: string
  trigger: ReminderTrigger
  dryRun: boolean
  ms: number
  report?: ReminderReport
  fatal?: string
}): void {
  const report = input.report
  entries.unshift({
    at: input.at,
    trigger: input.trigger,
    dryRun: input.dryRun,
    ms: input.ms,
    scanned: report?.scanned ?? 0,
    due: report?.due ?? 0,
    sent: report?.sent ?? 0,
    skippedInterval: report?.skippedInterval ?? 0,
    noEmail: report?.noEmail ?? 0,
    escalated: report?.escalated ?? 0,
    intervalHours: report?.intervalHours ?? config.reminder.intervalMin,
    ...(report?.gate ? { gate: report.gate } : {}),
    errors: (report?.errors ?? []).slice(0, MAX_ERRORS),
    ...(input.fatal ? { fatal: input.fatal } : {}),
    tasks: (report?.tasks ?? []).slice(0, MAX_TASKS).map(t => ({
      orderNo: t.orderNo,
      stepIndex: t.stepIndex,
      hours: t.hours,
      level: t.level,
      waiting: (t.waiting ?? []).map(m => ({ name: m.name, email: m.email })),
    })),
  })
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES
  }
}

/**
 * 给接口读的快照。
 *
 * 带上 `timer`（进程内定时开没开、多久一次、真发还是试算）与 `limits`：
 *   · 前者比"日志为空"更能说明问题 —— 定时压根没开时，界面该提示"靠外部 cron"，
 *     而不是让人以为跑批坏了；
 *   · 后者让页面能写"最近 50 轮 / 每轮最多留 20 条明细"，别让人以为明细是真被漏了。
 */
export function readReminderRuns () {
  return {
    since: serverStartedAt,
    timer: {
      enabled: config.reminder.intervalMin > 0,
      intervalMin: config.reminder.intervalMin,
      /** true = 进程内定时会真发消息（REMINDER_SEND=1） */
      send: config.reminder.send,
    },
    limits: { entries: MAX_ENTRIES, tasks: MAX_TASKS },
    items: entries,
  }
}

/** 只给测试用：清空记录 */
export function clearReminderRuns (): void {
  entries.length = 0
}

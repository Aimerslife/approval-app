/**
 * 审批超时提醒。
 *
 * 白板依据（「库存管理流程规范」）：
 *   ⏰ 所有环节：工作日48h 每天飞书提醒
 *   ⏰ 5 个工作日未处理推送（给管理员）
 *
 * 三个口径（自己定的，都有理由）：
 *  1. **工作日 = 周一~周五，周末不计时**。周五 18:00 建的单，周末两天不累计 ——
 *     否则周一早上打开就是"已超时"，提醒失去意义。
 *     ⚠️ 法定节假日没有排除（要接节假日日历才准，目前只排周末）。
 *  2. **计时起点 = 该环节上一条办理时间**，没有办理记录时用建单时间。
 *     用 updated 之类的不行：任何字段被改都会把计时清零，等于永不超时。
 *  3. **同一单同一级别每天最多提醒一次**（进程内记录）。到 5 个工作日时另外推给管理员。
 *
 * 这里只放**纯逻辑 + 可注入的跑批**，飞书发送由 server/index.ts 注入 ——
 * 这样测试可以完全离线跑，也不会因为在测试里手滑就真给别人发消息。
 */

/** 提醒阈值（工作日小时）：48 小时开始每天催；5 个工作日（按工作日计 120 小时）升级 */
export const DAILY_HOURS = 48
export const ESCALATE_HOURS = 5 * 24

/**
 * 工作日小时数：逐天累计"落在周一~周五里的时长"，周末整天不计。
 * 不按"自然日 8 小时"折算 —— 业务说的是「工作日48h」，跨夜等待也要算进去。
 */
export function workingHoursBetween (from: Date, to: Date): number {
  if (!(to.getTime() > from.getTime())) {
    return 0
  }
  let ms = 0
  let cur = from.getTime()
  let guard = 0
  while (cur < to.getTime() && guard++ < 5000) {
    const d = new Date(cur)
    const dayEnd = new Date(cur)
    dayEnd.setHours(24, 0, 0, 0)
    const segEnd = Math.min(dayEnd.getTime(), to.getTime())
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {
      ms += segEnd - cur
    }
    cur = segEnd
  }
  return ms / 3_600_000
}

/** 只用到的那几个字段（服务端不引前端类型：server 是独立进程，见 dev:server 脚本） */
export interface ChainMember {
  name?: string
  email?: string
  type?: string
  result?: string
  /** 转办：被接替的人会被打上这个（仅展示字段，见 mergeExtraMembers） */
  transferred_to?: string
  delegated_from?: string
}

export interface ReminderOrder {
  id: string
  order_no?: string
  status?: number
  created?: string
  chain?: {
    chain?: ChainMember[][]
    decisions?: Array<{ stepId?: string, handled_at?: string }>
    context?: Record<string, unknown>
  }
}

export interface PendingStep {
  /** 第几环（chain.chain 的下标，从 1 开始给人看） */
  index: number
  /** 这一环还没办的人（已转办出去的人不算） */
  waiting: ChainMember[]
  /** 这一环开始等待的时刻 */
  since: Date
}

/**
 * 定位「当前待办环节」：运行链路里第一个还有审批人没办的环节。
 *
 * 为什么读 `chain.chain` 而不是重算：那是单据保存时按 flow+decisions 重算好并落库的，
 * 服务端拿不到（也不该拿）前端的求值逻辑；照它读等于跟前端同一口径。
 */
export function pendingStepOf (order: ReminderOrder): PendingStep | null {
  if (order.status !== 0) {
    return null
  } // 只催进行中的单
  const steps = order.chain?.chain ?? []
  for (const [i, step] of steps.entries()) {
    const waiting = (step ?? []).filter(m =>
      m.type === 'manager' && !m.result && !m.transferred_to,
    )
    if (waiting.length === 0) {
      continue
    }
    return { index: i + 1, waiting, since: stepStartAt(order) }
  }
  return null
}

/**
 * 这一环从什么时候开始等：
 * 取**所有办理记录里最晚的**时间；一条办理记录都没有就是建单时间。
 * 用 max 而不是"最后一条"：同一单可能被驳回重审，decisions 是追加的，顺序不一定可靠。
 */
function stepStartAt (order: ReminderOrder): Date {
  const times = (order.chain?.decisions ?? [])
    .map(d => (d.handled_at ? Date.parse(d.handled_at) : Number.NaN))
    .filter(t => Number.isFinite(t))
  const created = order.created ? Date.parse(order.created) : Number.NaN
  const t = times.length > 0 ? Math.max(...times) : created
  return new Date(Number.isFinite(t) ? t : Date.now())
}

export interface ReminderTask {
  orderId: string
  orderNo: string
  stepIndex: number
  waiting: ChainMember[]
  /** 已等待的工作日小时数 */
  hours: number
  since: string
  level: '48h' | '5d'
}

/** 该不该发、发哪一级（纯判断，便于测边界） */
export function reminderLevelOf (hours: number): '48h' | '5d' | null {
  if (hours >= ESCALATE_HOURS) {
    return '5d'
  }
  if (hours >= DAILY_HOURS) {
    return '48h'
  }
  return null
}

/** 把一串单子算成"该发哪些提醒"（不发消息，纯计算） */
export function planReminders (orders: ReminderOrder[], now = new Date()): ReminderTask[] {
  const out: ReminderTask[] = []
  for (const order of orders) {
    const pending = pendingStepOf(order)
    if (!pending) {
      continue
    }
    const hours = workingHoursBetween(pending.since, now)
    const level = reminderLevelOf(hours)
    if (!level) {
      continue
    }
    out.push({
      orderId: order.id,
      orderNo: order.order_no || order.id,
      stepIndex: pending.index,
      waiting: pending.waiting,
      hours: Math.round(hours * 10) / 10,
      since: pending.since.toISOString(),
      level,
    })
  }
  return out
}

/* ==================== 跑批 ==================== */

export interface SendText {
  (receiveId: string, receiveIdType: 'email' | 'open_id', text: string): Promise<void>
}

export interface ReminderDeps {
  /** PB 地址，如 http://127.0.0.1:8091 */
  pbUrl: string
  sendText: SendText
  /** 升级（5 个工作日）推送对象，一般是组织管理员 */
  admins?: () => Promise<Array<{ name?: string, email?: string }>>
  log?: (msg: string) => void
}

/** 单日去重键：同一单同一级别，一天只发一次（进程内） */
const sentToday = new Map<string, string>() // `${orderId}:${level}` → 'YYYY-MM-DD'
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

/** 只给测试/运维用：清掉去重记录（比如手工重跑） */
export function resetReminderLog () {
  sentToday.clear()
}

export interface ReminderReport {
  scanned: number
  due: number
  sent: number
  skippedToday: number
  noEmail: number
  escalated: number
  errors: string[]
  tasks: ReminderTask[]
}

/**
 * 跑一遍提醒。默认 **dry-run**（只算不发）—— 真发消息必须显式传 dryRun: false，
 * 免得本地起服务就把真提醒发给同事了。
 */
export async function runReminders (
  deps: ReminderDeps,
  opts: { now?: Date, dryRun?: boolean } = {},
): Promise<ReminderReport> {
  const now = opts.now ?? new Date()
  const dryRun = opts.dryRun !== false
  const log = deps.log ?? (() => {})
  const report: ReminderReport = {
    scanned: 0, due: 0, sent: 0, skippedToday: 0, noEmail: 0, escalated: 0, errors: [], tasks: [],
  }

  const url = `${deps.pbUrl}/api/collections/approval_chain/records?perPage=200&sort=created`
    + `&filter=${encodeURIComponent('status=0')}`
  const res = await fetch(url)
  if (!res.ok) {
    report.errors.push(`读取进行中的单据失败：HTTP ${res.status}`)
    return report
  }
  const data = await res.json().catch(() => null) as { items?: ReminderOrder[] } | null
  const orders = data?.items ?? []
  report.scanned = orders.length

  report.tasks = planReminders(orders, now)
  report.due = report.tasks.length
  if (report.tasks.length === 0) {
    return report
  }

  const admins = report.tasks.some(t => t.level === '5d') && deps.admins
    ? await deps.admins().catch(() => [])
    : []

  for (const task of report.tasks) {
    const key = `${task.orderId}:${task.level}`
    if (sentToday.get(key) === dayKey(now)) {
      report.skippedToday++
      continue
    }
    // dry-run 不占用"今天已发"名额，也不记数 —— 它只是算一遍给你看
    if (dryRun) {
      continue
    }

    const getters = task.waiting.filter(m => m.email)
    report.noEmail += task.waiting.length - getters.length
    if (getters.length === 0) {
      report.errors.push(`${task.orderNo} 第${task.stepIndex}环没有人邮箱，发不出去`)
      continue
    }

    const head = task.level === '5d'
      ? `【审批超时·升级】${task.orderNo}`
      : `【审批超时提醒】${task.orderNo}`
    const who = getters.map(m => m.name || m.email).join('、')
    const body = task.level === '5d'
      ? `第 ${task.stepIndex} 环已等待 ${task.hours} 个工作日小时（超过 5 个工作日），待 ${who} 处理，请协助跟进。`
      : `第 ${task.stepIndex} 环已等待 ${task.hours} 个工作日小时，待 ${who} 处理，请尽快办理。`
    try {
      for (const m of getters) {
        await deps.sendText(m.email!, 'email', `${head}\n${body}`)
      }
      if (task.level === '5d') {
        for (const a of admins) {
          if (a.email) {
            await deps.sendText(a.email, 'email', `${head}\n${body}`)
          }
        }
        report.escalated++
      }
      sentToday.set(key, dayKey(now))
      report.sent++
      log(`[提醒] ${task.orderNo} 第${task.stepIndex}环 ${task.hours}h → ${who}（${task.level}）`)
    } catch (error) {
      report.errors.push(`${task.orderNo} 发送失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return report
}

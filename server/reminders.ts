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
 *  3. **同一单同一级别按「推送间隔」重复提醒**（进程内记上次发送时刻，见 lastSentAt）：
 *     超时之后每隔 `intervalHours` 小时再催一次，直到这一环办掉或升级。
 *     默认 24 小时 = 改造前的"每天一条"；页面把间隔改成 4，就是超时后每 4 小时催一次。
 *     到 5 个工作日时另外推给管理员。
 *
 * 阈值、频率、推送间隔、收件人与白名单现在由「提醒设置」页面（src/pages/alarmSetting.vue）配置，
 * 落库在 `push_rules`；**口径本身只有一份**（utils/pushRules，前端与服务端共用）：
 *   · deps.rules 不传 / 表还是空的 → 用默认规则 = 改造前的行为（工作日 48h 起、每天催当前审批人）；
 *   · 关了总开关 / 还没到推送时刻 / 今天不是推送日 → 这一轮什么都不发（report.gate 说明原因）；
 *   · 距上次提醒还没隔够 intervalHours → 这一单这一级别这一轮跳过（report.skippedInterval）。
 *
 * 这里只放**纯逻辑 + 可注入的跑批**，飞书发送由 server/index.ts 注入 ——
 * 这样测试可以完全离线跑，也不会因为在测试里手滑就真给别人发消息。
 */

// 推送规则（页面配的那份）里的纯函数：到点判断、收件人解析、白名单过滤。
// 跨端共用同一份口径（服务端是独立进程，引不了前端那些带副作用的模块，见 utils/pushRules 的文件头）。
import {
  DEFAULT_PUSH_RULES,
  excludeWhitelist,
  intervalElapsed,
  isWhitelisted,
  resolveReceivers,
  shouldPushNow,
  type PushRules,
} from '../src/utils/pushRules'
/*
 * 「工作日小时」的实现搬去了 src/utils/workingHours —— 前端表格的「进度」列
 * （utils/approvalProgress）也要用它，两边必须算得一样，否则会出现
 * "表格显示超时、提醒却还没发"这种对不上的情况。
 * 这里 import 之后再导出：本模块对外仍然提供 workingHoursBetween，历史调用方不用改。
 */
import { workingHoursBetween } from '../src/utils/workingHours'
export { workingHoursBetween }

/**
 * 提醒阈值（工作日小时）：48 小时开始每天催；5 个工作日（按工作日计 120 小时）升级。
 * 48 现在只是**默认值** —— 页面里改成别的，planReminders 就按那个算。
 *
 * ⚠️ 与前端「进度」列的对应关系：48（可按页面配置变）= 表格里的「超时」，
 * 5 个工作日 = 表格里的「滞留」（见 src/utils/approvalProgress 的 STAGNANT_HOURS）。
 */
export const DAILY_HOURS = 48
export const ESCALATE_HOURS = 5 * 24

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

/**
 * 该不该发、发哪一级（纯判断，便于测边界）。
 *
 * ⚠️ `'48h'` 只是**日常催办**这一级的内部标签（去重键、报告里都用它），
 * 阈值本身现在由页面配（overdueHours，默认还是 48）—— 标签名不跟着改，
 * 免得去重键与报告字段一改，历史行为对不上、查日志的人还得记住两套叫法。
 */
export function reminderLevelOf (hours: number, overdueHours = DAILY_HOURS): '48h' | '5d' | null {
  if (hours >= ESCALATE_HOURS) {
    return '5d'
  }
  if (hours >= overdueHours) {
    return '48h'
  }
  return null
}

/** 把一串单子算成"该发哪些提醒"（不发消息，纯计算）。overdueHours 由页面配置下发 */
export function planReminders (
  orders: ReminderOrder[],
  now = new Date(),
  overdueHours = DAILY_HOURS,
): ReminderTask[] {
  const out: ReminderTask[] = []
  for (const order of orders) {
    const pending = pendingStepOf(order)
    if (!pending) {
      continue
    }
    const hours = workingHoursBetween(pending.since, now)
    const level = reminderLevelOf(hours, overdueHours)
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
  /**
   * 「提醒设置」页面里的推送规则。不传 = 默认规则（改造前的行为）。
   * 由调用方负责去 PB 把规则读出来（本模块保持纯逻辑，不碰库、不碰网络里除 sendText 外的东西）。
   */
  rules?: PushRules
  log?: (msg: string) => void
}

/**
 * 间隔去重：`${orderId}:${level}` → **上次给这一单这一级别发提醒的时刻**（毫秒时间戳，进程内）。
 *
 * 为什么记"时刻"而不是"今天发过没有"：间隔是页面可配的（utils/pushRules 的 intervalHours），
 * 按天去重根本表达不了"每 4 小时催一次"。这里只负责**记**，该不该发交给纯函数 intervalElapsed
 * —— 判定与记录分开，"隔多久算该发"就只有一处口径。
 *
 * ⚠️ 进程内记录：重启服务会忘掉（重启后可能提前发一条）。与改造前同一个取舍 ——
 *    要做到严格跨重启，得把"上次提醒时刻"落库（每单一行），那是另一件事，先不引进来。
 */
const lastSentAt = new Map<string, number>()

/** 只给测试/运维用：清掉去重记录（比如手工重跑） */
export function resetReminderLog () {
  lastSentAt.clear()
}

export interface ReminderReport {
  scanned: number
  due: number
  sent: number
  /** 距上次提醒还没隔够推送间隔、这一轮跳过的条数（**不是**"当天已发过"） */
  skippedInterval: number
  noEmail: number
  escalated: number
  errors: string[]
  tasks: ReminderTask[]
  /** 本轮生效的推送间隔（小时）—— 日志里带上它，"配了间隔却没发"时一眼能看出间隔是多少 */
  intervalHours: number
  /**
   * 这一轮**根本没往下算**的原因（总开关关了 / 没到推送时刻 / 今天不是推送日）。
   * 有值时上面所有计数都是 0 —— 接口与日志直接展示这句话，省得看的人以为"没有超时单"。
   */
  gate?: string
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
  const rules = deps.rules ?? DEFAULT_PUSH_RULES
  const report: ReminderReport = {
    scanned: 0, due: 0, sent: 0, skippedInterval: 0, noEmail: 0, escalated: 0, errors: [], tasks: [],
    intervalHours: rules.intervalHours,
  }

  /*
   * 到点判断放在**最前面**（连查库都不做）：总开关关了 / 今天不是推送日 / 还没到推送时刻，
   * 这一轮就不该有任何"看起来跑了"的动作。原因写进 report.gate，接口与日志直接展示 ——
   * 否则看日志的人分不清"没有超时单"和"规则挡掉了"。
   * ⚠️ dry-run 也拦：它本来就是给运维"看这轮会发什么"的，规则挡掉时更要说清楚。
   */
  const gate = shouldPushNow(rules, now)
  if (!gate.ok) {
    report.gate = gate.reason
    log(`[提醒] 本轮跳过：${gate.reason}`)
    return report
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

  report.tasks = planReminders(orders, now, rules.overdueHours)
  report.due = report.tasks.length
  if (report.tasks.length === 0) {
    return report
  }

  // 升级对象（组织管理员）同样要过白名单：被拉黑的人不该因为"是管理员"就收到
  const admins = report.tasks.some(t => t.level === '5d') && deps.admins
    ? excludeWhitelist(await deps.admins().catch(() => []), rules.whitelist)
    : []

  for (const task of report.tasks) {
    const key = `${task.orderId}:${task.level}`
    /*
     * 间隔去重：同一天内距上次提醒还没隔够 intervalHours 就跳过（默认 24h = 每天一条）；
     * 跨自然日重新起算，所以每天的第一条仍由「不早于 sendTime」决定（见 intervalElapsed 的说明）。
     * 用**这一单这一级别**的键：升级成 '5d' 之后是新键，会立刻发一次升级提醒 —— 那是有意为之，
     * 「超时太久」这件事本身就该压过"刚催过"。
     */
    if (!intervalElapsed(lastSentAt.get(key), now, rules.intervalHours)) {
      report.skippedInterval++
      continue
    }
    // dry-run 不占"上次发送时刻"的名额，也不记数 —— 它只是算一遍给你看
    if (dryRun) {
      continue
    }

    /*
     * 收件人 = 当前审批人 + 固定收件人（按页面配的口径取），白名单在 resolveReceivers 里已经剔掉。
     * 所以"没人可发"有三种原因，报错文案要把三种都说出来，不然运维只能猜：
     * 审批人没邮箱 / 被白名单排除了 / 口径选了"仅指定人员"但名单是空的。
     */
    const people = resolveReceivers(task.waiting, rules)
    const getters = people.filter(m => m.email)
    report.noEmail += people.length - getters.length
    if (getters.length === 0) {
      report.errors.push(
        `${task.orderNo} 第${task.stepIndex}环没有可发的收件人（缺邮箱 / 被白名单排除 / 未配置指定人员）`,
      )
      continue
    }

    // 有人在白名单里就记一条：白名单是"静默不发"，不记的话没人知道它起了作用
    const blocked = task.waiting.filter(m => isWhitelisted(m, rules.whitelist))
    if (blocked.length > 0) {
      log(`[提醒] ${task.orderNo} 第${task.stepIndex}环：${blocked.map(m => m.name || m.email).join('、')} 在白名单里，跳过`)
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
      // 记下"刚发过"：下一次是否再发由 intervalElapsed 按间隔判定（见上面的跳过分支）
      lastSentAt.set(key, now.getTime())
      report.sent++
      log(`[提醒] ${task.orderNo} 第${task.stepIndex}环 ${task.hours}h → ${who}（${task.level}）`)
    } catch (error) {
      report.errors.push(`${task.orderNo} 发送失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return report
}

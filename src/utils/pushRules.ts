/**
 * 飞书推送规则（在「提醒设置」页面里维护，落库到 PocketBase 的 `push_rules`）。
 *
 * 管五件事：
 *   1. **是否定时推送** + **频率**（每天 / 仅工作日）+ **每天不早于几点推**；
 *   2. **超时阈值**：待办超过多少个「工作日小时」才开始催（业务原口径 48h）；
 *   3. **推送间隔**：超时之后每隔多少小时**再催一次** —— 这就是"超时后按推送时间、每隔一段时间
 *      重复推送"的开关（见 intervalHours；默认 24 小时 = 改造前"每天一条"的行为）；
 *   4. **推送人员**：默认发给当前审批人，也可以固定发某几个人；
 *   5. **白名单**：名单内的人**一条都不发**（定时提醒与到达提醒都排除）。
 *
 * 为什么这个文件里全是**纯函数**、一个依赖都不 import：
 * 前端页面、服务端超时跑批（server/reminders.ts）、到达提醒（utils/notifySteps）三处都要用
 * 同一套口径 —— 口径写两遍迟早漂，而服务端是独立进程、引不了前端那些带副作用的模块
 * （其它跨端共用的纯函数模块也是这个做法，见 utils/biRowFields、utils/notifyText）。
 */

/** 一个推送对象（人）。字段与通讯录选人的结果对齐（见 components/OrgTree.vue 的 OrgSelectedUser） */
export interface PushPerson {
  name: string
  email?: string
  avatar?: string
  department?: string
  department_path?: string
}

/** 推送频率：每天都推 / 只在工作日推（周末不推） */
export type PushFrequency = 'daily' | 'workdays'

/**
 * 推送人员口径：
 *   · approver —— 只发**当前审批人**（默认，也就是"该谁办就催谁"）；
 *   · custom   —— 只发下面指定的那几个人（给主管/助理盯单用）；
 *   · both     —— 两边都发。
 */
export type ReceiverMode = 'approver' | 'custom' | 'both'

export interface PushRules {
  /** 定时推送总开关：关掉后跑批不发任何超时提醒（到达提醒不受它管） */
  enabled: boolean
  frequency: PushFrequency
  /** 每天**不早于**这个时刻推送，'HH:mm'（本机时区） */
  sendTime: string
  /** 待办超过多少个**工作日小时**开始推送（业务原口径 48） */
  overdueHours: number
  /**
   * **推送间隔**（小时）：同一单同一级别两次提醒之间至少隔多少小时。
   *
   * 超时之后要不要"一直催"，就看它：只要距上次提醒已经隔够这么多小时（**跨自然日则重新起算**，
   * 见 intervalElapsed），又满足「频率 + 不早于推送时间」那两条（见 shouldPushNow），跑批就再推一次。
   *   · 24（默认）= 超时后每天一条 —— 与改造前完全一致；
   *    · 4        = 超时后每 4 小时催一次（工作日、不早于 sendTime）。
   */
  intervalHours: number
  receiverMode: ReceiverMode
  /** receiverMode 为 custom / both 时生效的固定收件人 */
  receivers: PushPerson[]
  /** 白名单：这些人不推送 */
  whitelist: PushPerson[]
}

/** 时刻格式：'09:00' / '18:30'（24 小时制，两位补零） */
export const PUSH_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 默认规则 —— 与改造前的行为**完全一致**（工作日 48h 起每天催、催当前审批人、无白名单），
 * 这样「没配过」「表还没建」「读失败」三种情况下的表现都跟以前一样，不会因为上线这个页面
 * 让提醒突然变多或变少。
 */
export const DEFAULT_PUSH_RULES: PushRules = {
  enabled: true,
  frequency: 'workdays',
  sendTime: '09:00',
  overdueHours: 48,
  // 24 小时 = 每天一条：与改造前"超时后每天催一次"的行为完全一致
  intervalHours: 24,
  receiverMode: 'approver',
  receivers: [],
  whitelist: [],
}

/** 频率的可选值与说明（页面直接用，别再在页面里抄一份文案） */
export const PUSH_FREQUENCY_OPTIONS: ReadonlyArray<{ value: PushFrequency, title: string, hint: string }> = [
  { value: 'workdays', title: '仅工作日', hint: '周六、周日不推送' },
  { value: 'daily', title: '每天', hint: '含周末照常推送' },
]

/** 推送人员的可选项与说明 */
export const RECEIVER_MODE_OPTIONS: ReadonlyArray<{ value: ReceiverMode, title: string, hint: string }> = [
  { value: 'approver', title: '当前审批人', hint: '催到该办的人头上（默认）' },
  { value: 'custom', title: '仅指定人员', hint: '只发给下面勾的人，不再打扰审批人' },
  { value: 'both', title: '审批人 + 指定人员', hint: '两边都发，指定人员一起盯' },
]

/**
 * 推送间隔的常用档位（「提醒设置」页的下拉直接用）。
 *
 * 没有"不重复"这一档：间隔本身就是**重复推送**的开关，把值填大（比如 168 = 一周）
 * 就等于"基本不再重复"，比多一个布尔开关少一处会互相矛盾的状态。
 */
export const PUSH_INTERVAL_OPTIONS: ReadonlyArray<{ value: number, title: string, hint: string }> = [
  { value: 1, title: '每 1 小时', hint: '超时后每小时催一次（仍只在工作日、且不早于推送时间）' },
  { value: 2, title: '每 2 小时', hint: '超时后每 2 小时催一次' },
  { value: 4, title: '每 4 小时', hint: '超时后每 4 小时催一次' },
  { value: 6, title: '每 6 小时', hint: '超时后每 6 小时催一次' },
  { value: 8, title: '每 8 小时', hint: '超时后每 8 小时催一次' },
  { value: 12, title: '每 12 小时', hint: '超时后每天催两次' },
  { value: 24, title: '每 24 小时', hint: '超时后每天一条（默认，与改造前一致）' },
]

/** 间隔的取值边界：至少 1 小时、最多 168 小时（一周）—— 跑批比这更密的间隔没有意义 */
export const PUSH_INTERVAL_MIN = 1
export const PUSH_INTERVAL_MAX = 168

/** 'HH:mm' → 当天的分钟数；认不出来时退回 0 点（宁可早推，也不要因为配错就不推） */
export function pushTimeMinutes (sendTime: string): number {
  const hit = PUSH_TIME_RE.exec(String(sendTime ?? '').trim())
  if (!hit) {
    return 0
  }
  const [h, m] = String(sendTime).split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * 该不该再给「这一单 + 这一级别」发一条（纯函数：跑批与服务端报告都用它，边界好测）。
 *
 * 两条口径：
 *   1. **同一自然日**内，两次之间至少隔 `intervalHours` 小时；
 *   2. **换了自然日**就重新起算 —— 当天能不能发由"不早于 sendTime"那道闸门管（见 shouldPushNow）。
 *
 * 第 2 条是必须的（实测踩到）：只按"距上次 ≥ 24 小时"算的话，第一天在 10:00 发出，
 * 第二天 09:00 只有 23 小时 → 被跳过 → 实际推到 10:00，第三天再往后漂一点
 * —— 表现就是"说好每天 9 点催，越催越晚"。按自然日重算之后，每天的第一条都在 sendTime 之后准时发。
 *
 * 这是"间隔推送"的**唯一**判定处：跑批只负责记"上次发在什么时候"，怎么算由这里说了算。
 *
 * @param lastSentAt  上次发提醒的时刻（毫秒时间戳）；没发过 = undefined
 * @param intervalHours 规则里的间隔（小时）
 * @returns true = 该发（没发过 / 换天了 / 今天已经隔够）
 */
export function intervalElapsed (
  lastSentAt: number | undefined,
  now: Date,
  intervalHours: number,
): boolean {
  if (lastSentAt === undefined || !Number.isFinite(lastSentAt)) {
    return true
  }
  const last = new Date(lastSentAt)
  // ① 换了自然日 → 重新起算（时间窗由 shouldPushNow 把关，这里不重复判 sendTime）
  if (
    last.getFullYear() !== now.getFullYear()
    || last.getMonth() !== now.getMonth()
    || last.getDate() !== now.getDate()
  ) {
    return true
  }
  // ② 同一天内比时间差；间隔非法（0 / 负数 / NaN）时按默认值算：宁可"每天一条"，也不要退化成"每次跑批都发"
  const hours = Number.isFinite(Number(intervalHours)) && Number(intervalHours) >= 1
    ? Number(intervalHours)
    : DEFAULT_PUSH_RULES.intervalHours
  return now.getTime() - lastSentAt >= hours * 3_600_000
}

/**
 * 一句话描述"超时后会怎么推"（设置页的提示文案；口径只有这一处，页面别自己拼字符串）。
 * 形如：超时 48 个工作日小时起，每 4 小时催一次（仅工作日，不早于 09:00）
 *
 * 单位统一说「工作日小时」—— 与阈值输入框的后缀、以及「进度」列的悬浮说明同一套说法，
 * 免得同一个判据在三个地方分别是"48 小时""48 个工作日小时""48h"。
 */
export function pushCadenceText (rules: PushRules): string {
  const r = normalizePushRules(rules)
  const freq = r.frequency === 'workdays' ? '仅工作日' : '每天'
  return `超时 ${r.overdueHours} 个工作日小时起，每 ${r.intervalHours} 小时催一次（${freq}，不早于 ${r.sendTime}）`
}

/** 一个人的身份键：**邮箱优先**、缺邮箱退回姓名（与 types/approval 的 sameApprover 同一口径） */
export function personKeyOf (p: { name?: string, email?: string }): string {
  const email = String(p?.email ?? '').trim().toLowerCase()
  if (email) {
    return `email:${email}`
  }
  return `name:${String(p?.name ?? '').trim()}`
}

/**
 * 把一条原始人员数据（库里的 json / 通讯录选出来的人）收敛成 PushPerson。
 * 认不出的人（没有名字也没有邮箱）返回 null —— 留着它只会让白名单里多一条
 * 永远匹配不上的空记录。
 */
export function normalizePerson (raw: unknown): PushPerson | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const o = raw as Record<string, unknown>
  const str = (v: unknown) => String(v ?? '').trim()
  const name = str(o.name)
  const email = str(o.email)
  if (!name && !email) {
    return null
  }
  const out: PushPerson = { name: name || email }
  if (email) {
    out.email = email
  }
  for (const key of ['avatar', 'department', 'department_path'] as const) {
    const v = str(o[key])
    if (v) {
      out[key] = v
    }
  }
  return out
}

/** 清洗一份人员名单：丢掉认不出的人、按身份键去重、保持原顺序 */
export function cleanPeople (list: unknown): PushPerson[] {
  const out: PushPerson[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(list) ? list : []) {
    const person = normalizePerson(raw)
    if (!person) {
      continue
    }
    const key = personKeyOf(person)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(person)
  }
  return out
}

function normalizeFrequency (raw: unknown): PushFrequency {
  return raw === 'daily' ? 'daily' : 'workdays'
}

function normalizeReceiverMode (raw: unknown): ReceiverMode {
  return raw === 'custom' || raw === 'both' ? raw : 'approver'
}

/**
 * 把库里的记录（或任何来路不明的 json）收敛成一份合法规则。
 *
 * 逐个字段兜底而不是整体判空：库里的记录可能是人手改的、也可能是老版本写的
 * （少了新字段），那时只有缺的那一项回默认值，其余照旧生效。
 */
export function normalizePushRules (raw: unknown): PushRules {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const hours = Number(o.overdueHours)
  const interval = Number(o.intervalHours)
  const sendTime = String(o.sendTime ?? '').trim()
  return {
    enabled: o.enabled === undefined ? DEFAULT_PUSH_RULES.enabled : !!o.enabled,
    frequency: normalizeFrequency(o.frequency),
    sendTime: PUSH_TIME_RE.test(sendTime) ? sendTime : DEFAULT_PUSH_RULES.sendTime,
    // 非正数/非数字一律回默认：0 会让"所有待办一建出来就该催"
    overdueHours: Number.isFinite(hours) && hours > 0 ? Math.round(hours) : DEFAULT_PUSH_RULES.overdueHours,
    /*
     * 间隔同样要挡住非法值，但方向相反：这里**小于 1 一律回默认**。
     * 0 会让 intervalElapsed 永远为真 —— 表现就是"跑批每 tick 都发一条"，比不推更糟。
     * 上限只做软收敛（夹到一周），超了算用户填错，不该因此静默改成默认值。
     */
    intervalHours: Number.isFinite(interval) && interval >= PUSH_INTERVAL_MIN
      ? Math.min(PUSH_INTERVAL_MAX, Math.round(interval))
      : DEFAULT_PUSH_RULES.intervalHours,
    receiverMode: normalizeReceiverMode(o.receiverMode),
    receivers: cleanPeople(o.receivers),
    whitelist: cleanPeople(o.whitelist),
  }
}

/** 这个人是否在白名单里（判定口径见 personKeyOf） */
export function isWhitelisted (
  person: { name?: string, email?: string },
  whitelist: readonly PushPerson[],
): boolean {
  const key = personKeyOf(person)
  return whitelist.some(w => personKeyOf(w) === key)
}

/**
 * 从一份收件人里剔掉白名单里的人。
 *
 * 白名单是**排除**语义，所以无论收件人是从哪来的（当前审批人 / 固定收件人 / 提醒环节的提醒对象），
 * 发之前都要过这一道 —— 三处各写一遍过滤等于三处都可能漏。
 */
export function excludeWhitelist<T extends { name?: string, email?: string }> (
  people: readonly T[],
  whitelist: readonly PushPerson[],
): T[] {
  if (whitelist.length === 0) {
    return [...people]
  }
  return people.filter(p => !isWhitelisted(p, whitelist))
}

/**
 * 到点了吗 —— 定时跑批该不该真的往下发（纯函数，便于把边界想清楚）。
 *
 * 三条规则（缺一条都可能变成"配了没反应"或"配了乱发"）：
 *   1. 总开关关掉 → 不发；
 *   2. 频率是"仅工作日"且今天是周六/周日 → 不发；
 *   3. 还没到 `sendTime` → 不发。
 *
 * ⚠️ 这里**只管到点**（"推送窗口"），不管"这一单最近是不是刚发过" —— 那是跑批按**推送间隔**
 *    记的去重（见 server/reminders.ts 的 lastSentAt 与这里的 intervalElapsed）。
 *    所以外部 cron 从推送时刻起**每 10 分钟打一次也算安全**：到点之后每次跑批都会通过这里，
 *    但同一单同一级别同一天内间隔没到就不会再发；第二天从 sendTime 起重新开始。
 *
 * @returns ok = 可以发；reason = 不发的原因（页面/日志直接展示这句话）
 */
export function shouldPushNow (rules: PushRules, now: Date): { ok: boolean, reason: string } {
  if (!rules.enabled) {
    return { ok: false, reason: '定时推送已在「提醒设置」里关闭' }
  }
  const dow = now.getDay()
  if (rules.frequency === 'workdays' && (dow === 0 || dow === 6)) {
    return { ok: false, reason: '今天是周末，规则是"仅工作日推送"' }
  }
  const minutes = now.getHours() * 60 + now.getMinutes()
  if (minutes < pushTimeMinutes(rules.sendTime)) {
    return { ok: false, reason: `还没到推送时间（每天不早于 ${rules.sendTime}）` }
  }
  return { ok: true, reason: '' }
}

/**
 * 这一轮的实际收件人（定时提醒用）：当前审批人 + 固定收件人，按口径取，再剔掉白名单。
 *
 * @param approvers 当前待办环节还没办的人（服务端从 chain 里读出来的）
 * @param rules     页面里配的规则
 */
export function resolveReceivers<T extends { name?: string, email?: string }> (
  approvers: readonly T[],
  rules: PushRules,
): Array<{ name?: string, email?: string }> {
  const useApprovers = rules.receiverMode === 'approver' || rules.receiverMode === 'both'
  const useCustom = rules.receiverMode === 'custom' || rules.receiverMode === 'both'
  const people: Array<{ name?: string, email?: string }> = [
    ...(useApprovers ? approvers : []),
    ...(useCustom ? rules.receivers : []),
  ]
  return excludeWhitelist(people, rules.whitelist)
}

/*
 * ===== 与 `push_rules` 表的字段映射 =====
 * 库里用的是 snake_case（与其它集合一致），规则对象是 camelCase。这层翻译**只写在这里**：
 * 前端走 PB SDK 读、服务端走 REST 读，两边拿到的记录形状是一样的，
 * 各自再翻译一遍就一定会漂（改了字段只改一处，另一处静默读不到 → 规则"配了没反应"）。
 */

/** 库里的记录 → 规则（null / 空对象 → 默认规则） */
export function pushRulesFromRecord (rec: Record<string, unknown> | null | undefined): PushRules {
  if (!rec) {
    return DEFAULT_PUSH_RULES
  }
  return normalizePushRules({
    enabled: rec.enabled,
    frequency: rec.frequency,
    sendTime: rec.send_time,
    overdueHours: rec.overdue_hours,
    intervalHours: rec.interval_hours,
    receiverMode: rec.receiver_mode,
    receivers: rec.receivers,
    whitelist: rec.whitelist,
  })
}

/** 规则 → 写库的字段（与 pushRulesFromRecord 成对） */
export function pushRulesToRecord (rules: PushRules) {
  const clean = normalizePushRules(rules)
  return {
    enabled: clean.enabled,
    frequency: clean.frequency,
    send_time: clean.sendTime,
    overdue_hours: clean.overdueHours,
    interval_hours: clean.intervalHours,
    receiver_mode: clean.receiverMode,
    receivers: clean.receivers,
    whitelist: clean.whitelist,
  }
}

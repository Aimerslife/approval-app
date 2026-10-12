/**
 * 飞书推送规则（在「提醒设置」页面里维护，落库到 PocketBase 的 `push_rules`）。
 *
 * 管四件事：
 *   1. **是否定时推送** + **频率**（每天 / 仅工作日）+ **每天不早于几点推**；
 *   2. **超时阈值**：待办超过多少个「工作日小时」才开始催（业务原口径 48h）；
 *   3. **推送人员**：默认发给当前审批人，也可以固定发某几个人；
 *   4. **白名单**：名单内的人**一条都不发**（定时提醒与到达提醒都排除）。
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

/** 'HH:mm' → 当天的分钟数；认不出来时退回 0 点（宁可早推，也不要因为配错就不推） */
export function pushTimeMinutes (sendTime: string): number {
  const hit = PUSH_TIME_RE.exec(String(sendTime ?? '').trim())
  if (!hit) {
    return 0
  }
  const [h, m] = String(sendTime).split(':')
  return Number(h) * 60 + Number(m)
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
  const sendTime = String(o.sendTime ?? '').trim()
  return {
    enabled: o.enabled === undefined ? DEFAULT_PUSH_RULES.enabled : !!o.enabled,
    frequency: normalizeFrequency(o.frequency),
    sendTime: PUSH_TIME_RE.test(sendTime) ? sendTime : DEFAULT_PUSH_RULES.sendTime,
    // 非正数/非数字一律回默认：0 会让"所有待办一建出来就该催"
    overdueHours: Number.isFinite(hours) && hours > 0 ? Math.round(hours) : DEFAULT_PUSH_RULES.overdueHours,
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
 * ⚠️ 这里**只管到点**，不管"这一单今天是不是已经发过"（那是跑批自己的按日去重，
 *    见 server/reminders.ts 的 sentToday）—— 所以外部 cron 从推送时刻起
 *    **每 10 分钟打一次也算安全**：到点之后每次跑批都会通过这里，但同一单同一级别当天只发一条。
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
    receiver_mode: clean.receiverMode,
    receivers: clean.receivers,
    whitelist: clean.whitelist,
  }
}

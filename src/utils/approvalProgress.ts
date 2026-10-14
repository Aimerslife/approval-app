import { DEFAULT_PUSH_RULES } from '@/utils/pushRules'

/**
 * 审批单**在本环节**的进展状况：正常 / 超时 / 滞留（「我的审批」当前表的「进度」列）。
 *
 * 判据只有一个：**这一环已经等了几个工作日小时**（见 utils/workingHours）——
 * 不看谁在办、也不看总的审批时长，因为要回答的是"单据在我手上压着多久了"。
 *
 * ## 两档阈值都取自业务白板（不是自己定的）
 * 白板「库存管理流程规范」写的是：`所有环节：每一个环节超时（工作日48h）每天飞书推送提醒；
 * 5个工作日内未处理，推送提醒至部门负责人`。于是：
 *
 * | 取值 | 文案 | 什么时候 | 对应的业务动作 |
 * |---|---|---|---|
 * | `normal`   | 正常 | 未超过超时阈值（默认 48 工作日小时） | 不催 |
 * | `overdue`  | 超时 | ≥ 超时阈值，但还没到 5 个工作日 | 每天飞书提醒当前审批人 |
 * | `stagnant` | 滞留 | ≥ 5 个工作日（`STAGNANT_HOURS` = 120 工作日小时） | 升级提醒至部门负责人 |
 *
 * ⚠️ 阈值**不是写死的两套数字**：超时那一档取「提醒设置」里的 `overdueHours`（默认 48），
 * 页面把它改成 24，这里的"超时"就跟着提前 —— 表格与飞书提醒必须同一个口径，
 * 否则会出现"表格显示超时、提醒却还没发"这种没法解释的情况（滞留那档是白板写死的 5 个工作日）。
 */
export type ApprovalProgress = 'normal' | 'overdue' | 'stagnant'

/**
 * 滞留阈值（工作日小时）：5 个工作日。
 *
 * 与 server/reminders 的 `ESCALATE_HOURS` 是**同一件事**（那边用它决定"升级推给管理员"），
 * 两边都是白板那句"5个工作日内未处理"。这里刻意不 import 服务端模块（服务端引 src，不能反向引）。
 */
export const STAGNANT_HOURS = 5 * 24

/** 三种状况的文案与配色：绿 → 琥珀 → 红，严重程度递增，与「状态」列那套 chip 用法一致 */
export const APPROVAL_PROGRESS_META: Record<ApprovalProgress, { text: string, color: string }> = {
  normal: { text: '正常', color: 'success' },
  overdue: { text: '超时', color: 'warning' },
  stagnant: { text: '滞留', color: 'error' },
}

/** 展示顺序（列筛选 / 图例用得上）：正常 → 超时 → 滞留 */
export const APPROVAL_PROGRESS_LIST: readonly ApprovalProgress[] = ['normal', 'overdue', 'stagnant']

/**
 * 已等待的工作日小时数 → 进展状况。
 *
 * @param hours        这一环已等待的**工作日小时**（见 utils/workingHours 的 workingHoursBetween）
 * @param overdueHours 超时阈值，来自「提醒设置」的推送规则（默认 48）
 */
export function approvalProgressOf (
  hours: number,
  overdueHours: number = DEFAULT_PUSH_RULES.overdueHours,
): ApprovalProgress {
  // 算不出来（旧单没有办理时间、脏数据）一律按"正常"：宁可少报，也不要把没问题的单标红
  const h = Number.isFinite(hours) && hours > 0 ? hours : 0
  const limit = Number.isFinite(overdueHours) && overdueHours > 0
    ? overdueHours
    : DEFAULT_PUSH_RULES.overdueHours
  if (h >= STAGNANT_HOURS) {
    return 'stagnant'
  }
  return h >= limit ? 'overdue' : 'normal'
}

/**
 * 单元格的悬浮说明：把"等了多久、对着哪个阈值"写清楚。
 *
 * 为什么要有它：只给一个「超时」两个字，看到的人第一反应是"凭什么说超时" ——
 * 这句话把判据摆出来（本环节等了 X 工作日小时 / 阈值是多少 / 会不会发提醒）。
 */
export function approvalProgressDetail (
  progress: ApprovalProgress,
  hours: number,
  overdueHours: number = DEFAULT_PUSH_RULES.overdueHours,
): string {
  const h = Math.round((Number.isFinite(hours) ? hours : 0) * 10) / 10
  const waited = `本环节已等待 ${h} 个工作日小时`
  if (progress === 'stagnant') {
    return `${waited}，已超过 5 个工作日（${STAGNANT_HOURS} 个工作日小时），会升级提醒部门负责人`
  }
  if (progress === 'overdue') {
    return `${waited}，已超过超时阈值 ${overdueHours} 个工作日小时，每天飞书提醒当前审批人`
  }
  return `${waited}，未超过超时阈值 ${overdueHours} 个工作日小时`
}

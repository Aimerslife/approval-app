/**
 * 「工作日小时」计时（纯函数：前端表格与服务端超时跑批**共用同一份**）。
 *
 * ## 口径（白板「库存管理流程规范」）
 * 超时一律按**工作日**算：逐天累计"落在周一~周五里的时长"，周末整天不计。
 * 周五 18:00 建的单，周末两天不累计 —— 否则周一早上打开就是"已超时"，提醒就失去意义了。
 * 不按"自然日 8 小时"折算：业务说的是「工作日 48h」，跨夜等待也要算进去。
 *   ⚠️ 法定节假日没有排除（要接节假日日历才准，目前只排周末）。
 *
 * ## 为什么单独一个文件
 * 服务端跑批（server/reminders.ts）与前端表格（utils/approvalProgress → mine.vue 的「进度」列）
 * 必须算得**一样** —— 否则会出现"表格显示超时、提醒却还没发"这种对不上的情况。
 * 服务端是独立进程，只能引 src 下的**纯函数**模块（同 utils/pushRules、utils/biRowFields 的做法）。
 */

/**
 * from → to 之间的**工作日小时数**（周末不计）。
 *
 * 按天切片累加：每片取"当天 0 点前的那一段"，工作日才计入 —— 这样跨夜、跨周末都自然正确。
 * `guard` 是防御：万一入参是脏数据（to 比 from 早、或时间戳异常），最多循环 5000 次就退出，
 * 不会把跑批卡死。
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

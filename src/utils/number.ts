/**
 * number.ts
 *
 * 数字的展示格式化。**刻意不依赖任何应用模块**（不 import pocketbase / collection），
 * 这样它既能被业务代码用，也能被 node / tsx 直接加载做单测 ——
 * 放在 utils.ts 里会连带拉进 pocketbase.ts，在浏览器外跑不起来。
 *
 * 业务侧仍可从 '@/utils/utils' 取（那里做了再导出）。
 */

/**
 * 数字展示格式化：千分位 + **最多**两位小数。
 *
 * 为什么需要：
 * 1) BI 的数值普遍带浮点噪声（实测 5243.3561500000005、-2.6014999999999997、9919.592899999996），
 *    不处理的话同一列里数字长度参差、末位全是垃圾位；
 * 2) 金额从 0.01 到 24 万不等，没有千分位很难扫读。
 *
 * 为什么用 maximumFractionDigits 而不是固定两位：
 * 数量类字段是整数，固定两位会显示成 "8.00"，反而更难读。
 */
const NUMBER_FORMATTER = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

/** 单个数值的展示文本；非有限数原样返回，避免出现 "NaN" */
export function formatNumber (value: number): string {
  return Number.isFinite(value) ? NUMBER_FORMATTER.format(value) : String(value)
}

const FORMATTED_CACHE = new WeakMap<Record<string, unknown>, Record<string, unknown>>()

export function formatDatas (row: Record<string, unknown>): Record<string, unknown> {
  const cached = FORMATTED_CACHE.get(row)
  if (cached) {
    return cached
  }
  const next: Record<string, unknown> = { ...row }
  for (const key of Object.keys(next)) {
    const v = next[key]
    if (typeof v === 'number') {
      next[key] = formatNumber(v)
    }
  }
  FORMATTED_CACHE.set(row, next)
  return next
}

/**
 * 按「总量 / 总额」折算其中**一部分数量**的价值：总金额 ÷ 总数量 × 数量。
 *
 * 用途：办理弹窗里在「剩余接收数量」旁展示这批货值多少钱 —— 件数说明不了轻重，
 * 业务上是按金额判断接不接（口径由业务给定：总库存金额 ÷ 总库存数量 × 剩余数量）。
 *
 * 返回**展示文本**（千分位 + 最多两位小数，与 formatNumber 同口径）；
 * 任何一个数取不到（空串 / null / 非数字 / 总量 ≤ 0 导致单价算不出来）都返回空串 ——
 * 这种地方宁可空着，也不能显示"价值 0 元"这种假金额让人据此做决定。
 *
 * ⚠️ 空串与 0 必须分开判：`Number('')` 也是 0，只看 Number 会把"没下发"当成"数量是 0"。
 */
export function shareValueText (totalAmount: unknown, totalQty: unknown, qty: unknown): string {
  if (!isFilledNumber(totalAmount) || !isFilledNumber(totalQty) || !isFilledNumber(qty)) {
    return ''
  }
  const amount = Number(totalAmount)
  const total = Number(totalQty)
  const n = Number(qty)
  if (!Number.isFinite(amount) || !Number.isFinite(total) || total <= 0 || !Number.isFinite(n)) {
    return ''
  }
  return formatNumber((amount / total) * n)
}

/** 这个值算不算"填了"：空串 / null / undefined 都不算（0 算，它是有效值） */
function isFilledNumber (value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

/**
 * 把「可能已被 formatDatas 格式化过」的值解析回数字，供排序使用。
 * 先去掉千分位再转；解析不出来时返回 0（保持顺序稳定，不抛错）。
 */
export function parseFormattedNumber (value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

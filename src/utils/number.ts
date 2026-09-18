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

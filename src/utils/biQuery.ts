/**
 * biQuery.ts
 *
 * 「页面筛选条件 → PocketBase 查询」的**纯逻辑**：列名翻译、字面量转义、filter 拼装。
 *
 * 为什么单独一个文件：api.ts 会 `new PocketBase(...)` 并读 `document.cookie`，
 * 在 node 里加载不起来 —— 逻辑放在那儿就没法单测。这里只依赖字段映射表（纯数据），
 * 所以能被 tsx 直接加载验证转义 / 拼装是否正确。
 *
 * I/O（getList / getFullList）留在 api.ts。
 */
import { BI_ROW_FIELD_BY_KEY } from './biRowFields'

/**
 * 中文列 key → PB 的 ASCII 列名。
 * bi_rows 的列名是 ASCII（PB 不接受中文列名），而页面用的是中文 key，
 * 筛选 / 排序都要翻译一次，否则 PB 会报「字段不存在」。
 */
export function biColumnOf (chineseKey: string): string | undefined {
  return BI_ROW_FIELD_BY_KEY[chineseKey]?.field
}

/**
 * PB filter 表达式里的字符串字面量转义。
 *
 * ⚠️ 不转义的话，筛选值里只要有一个双引号就能破坏整个过滤器语法
 * （PB 的 filter 用反斜杠转义）。数据是用户从 Excel 传上来的，什么字符都可能出现。
 */
export function pbQuote (value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, String.raw`\"`) + '"'
}

/** 页面筛选条件 → PB 查询参数。列名一律传 ASCII 列名（见 biColumnOf）。 */
export interface BiRowQuery {
  componentId: string
  page?: number
  perPage?: number
  /** PB 的 sort 串：'qty_total' 升序 / '-qty_total' 降序 */
  sort?: string
  /** 精确相等 */
  equals?: Record<string, string>
  /** 包含（多值列用，如销售状态「停售,在售」） */
  contains?: Record<string, string>
  /** 多列任一包含（搜索框） */
  search?: { columns: string[], value: string }
  /** 闭区间。日期列存的是 'YYYY-MM-DD' 文本，字典序即时间序 */
  range?: { column: string, from?: string, to?: string }
}

/**
 * 把 query 拼成 PB 的 filter 表达式。
 *
 * 各段之间是 **AND**（&&）；搜索框内部的多列是 **OR**（||）。
 * 组件条件是最后一道兜底：绝不能漏 —— 否则会把别的 component 的数据一起查出来。
 */
export function buildBiFilter (q: BiRowQuery): string {
  const parts: string[] = [`component_id = ${pbQuote(q.componentId)}`]

  for (const [col, v] of Object.entries(q.equals ?? {})) {
    if (v !== '') {
      parts.push(`${col} = ${pbQuote(v)}`)
    }
  }
  for (const [col, v] of Object.entries(q.contains ?? {})) {
    if (v !== '') {
      parts.push(`${col} ~ ${pbQuote(v)}`)
    }
  }

  const keyword = q.search?.value.trim() ?? ''
  if (keyword && q.search?.columns.length) {
    const v = pbQuote(keyword)
    parts.push('(' + q.search.columns.map(c => `${c} ~ ${v}`).join(' || ') + ')')
  }

  if (q.range) {
    if (q.range.from) {
      parts.push(`${q.range.column} >= ${pbQuote(q.range.from)}`)
    }
    if (q.range.to) {
      parts.push(`${q.range.column} <= ${pbQuote(q.range.to)}`)
    }
  }

  return parts.join(' && ')
}

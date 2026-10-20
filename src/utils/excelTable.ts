/**
 * excelTable.ts
 *
 * 把上传的 Excel 解析成「页面表格能直接用」的行。
 *
 * 为什么单独一个文件、而不是写在 setDatas.vue 里：
 *   解析 + 表头匹配是纯函数逻辑，放这里才能被 node / tsx 直接加载做单测
 *   （SFC 里的代码跑不起来）。所以本文件**刻意不依赖任何应用模块** ——
 *   只依赖 xlsx 和 productFields，不 import pocketbase、不碰 import.meta.env。
 *
 * 列名对齐的所有规则都在 productFields.ts（matchFieldKey / resolveFieldValue），
 * 和 BI 拉取走的是同一份，不会两处各写一套。
 */
import * as XLSX from 'xlsx'
import { cleanFieldName, matchFieldKey, PRODUCT_FIELDS, resolveFieldValue } from './productFields'

/** 表头最多往前找几行 —— 有些导出文件顶部有标题行 / 筛选说明行 */
const HEADER_SCAN_ROWS = 10

/**
 * 至少命中这么多列才认为某行是表头。
 * 取 2 而不是 1：像「部门」「平台」这类列名在**数据行**里也可能出现（第一列常常就是部门名），
 * 只命中 1 列就下结论，很容易把数据行当成表头，导致整表错位。
 */
const MIN_HEADER_HITS = 2

export interface ParsedExcelSheet {
  /** 可直接喂给表格的行：id 已补齐、日期已转字符串、数字保持 number、空值统一成空串 */
  rows: Record<string, unknown>[]
  /** 识别到的列：Excel 列下标 → 页面列 key */
  columns: Array<{ index: number, key: string }>
  /** 表头所在行（0 基）。回落第一行时是 0 */
  headerIndex: number
  /** 表头里命中已知字段的列数 */
  headerHits: number
  /** 认不出来的表头文本（列名对不上，这些列的数据不会进表格） */
  unmatched: string[]
  /** 同一个列 key 出现多次时，被忽略掉的表头文本 */
  duplicated: string[]
  /**
   * 整行都取不到值（值全落在未匹配列上）而被跳过的行数。
   * 注意：**真正的空白行不会走到这里** —— XLSX 的 blankrows: false 已经先把它们丢掉了，
   * 所以这个数一般是 0，不要拿它判断「有没有空行」。
   */
  skippedEmptyRows: number
}

/** 该行命中了多少个已知字段 */
function countHeaderHits (row: unknown[]): number {
  let n = 0
  for (const cell of row) {
    if (matchFieldKey(cell)) {
      n++
    }
  }
  return n
}

/**
 * 找表头行。
 *
 * 为什么不能直接用第一行：很多导出的 Excel 顶部有标题行（比如「亚马逊库存数据-2026W37」），
 * 拿它当表头会让**所有列**都对不上，整份数据一行也进不了表格。
 *
 * 做法：在前 HEADER_SCAN_ROWS 行里挑命中已知字段最多的一行。
 * 命中数不足 MIN_HEADER_HITS 时**回落第 1 行**（即 sheet_to_json 的默认行为）——
 * 保持和以前一致，不因为「没认出表头」就把整份数据判死，那种情况交给
 * describeExcelProblems 提示用户，而不是静默丢数据。
 */
export function findHeaderRow (grid: unknown[][]): { index: number, hits: number } {
  const limit = Math.min(grid.length, HEADER_SCAN_ROWS)
  let best = 0
  let bestHits = -1
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? []
    const hits = countHeaderHits(row)
    if (hits > bestHits) {
      bestHits = hits
      best = i
    }
    // 整行都认得出来，不用再往下看了
    if (hits > 0 && hits === row.length) {
      break
    }
  }
  return bestHits >= MIN_HEADER_HITS
    ? { index: best, hits: bestHits }
    : { index: 0, hits: Math.max(bestHits, 0) }
}

/**
 * 离午夜多近就算「某一天」而不是一个时刻（秒）。
 *
 * 43 s 是实测的读数漂移（见下），取 60 s 留点余量；顺带把 23:59:59.x 那种
 * 亚秒漂移一起覆盖掉，所以原来单独写的 86399 那道判断合并进来了。
 */
const MIDNIGHT_TOLERANCE_SECONDS = 60

/**
 * 日期单元格 → 字符串。
 *
 * 只带日期的用 YYYY-MM-DD —— `最早开售日期-SKU` 的区间筛选就是按这个格式做
 * 字典序比较的（见 setDatas.vue 的 matchesFilters），带上时间会让比较失效。
 * 真的带时分秒的才保留时间，避免把信息悄悄丢掉。
 *
 * ⚠️ 这里必须处理 SheetJS 的日期漂移，否则**每个日期列都会静默错一天**：
 * Excel 用序列号存日期，SheetJS 反解回 Date 时会**早几十秒**，于是「某天的 0 点」
 * 变成前一天 23:59:xx。两个实测样本：
 *   - 写入 new Date(2026, 8, 16) 读回来是 2026-09-15 23:59:59（亚秒级）；
 *   - 上传的 test.xlsx：5858 个日期格全是**整数序列号**（Excel 显示 2021-04-23），
 *     cellDates 读回来一律是前一天 23:59:17，**每次都早 43 秒** —— 5858 行全错一天。
 * 所以判据不能是「等不等于整点」，只能是「离午夜够不够近」（MIDNIGHT_TOLERANCE_SECONDS），
 * 然后把这种格子归到**最近的那一天 0 点**。
 *
 * 代价：真写了一个 23:59:30 的时刻会被算成次日。本应用的日期列都是「某一天」，
 * 这个取舍比整体错一天划算；真需要精确时刻的话得回到序列号层面取数。
 */
export function formatDateCell (input: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  // 先四舍五入到整秒：亚秒级的 .999 会被进位到次日 0 点，绝大部分漂移到这里就修好了
  const d = new Date(Math.round(input.getTime() / 1000) * 1000)
  const seconds = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
  // 刚过午夜 → 就是这一天，且只有日期（秒数为 0 的整点也走这里）
  if (seconds < MIDNIGHT_TOLERANCE_SECONDS) {
    return dateOf(d)
  }
  // 快到午夜 → 本意是**次日** 0 点，把漂移补回去（按日历日 +1，避开时区/DST 的坑）
  if (seconds > 86_400 - MIDNIGHT_TOLERANCE_SECONDS) {
    return dateOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
  }
  // 其余：真带时分秒，照实保留
  return `${dateOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 单元格归一化。三件事：
 * 1) **Date → 字符串**：XLSX.read 开了 cellDates 之后日期是 Date 对象，
 *    直接进表格会显示成 "Wed Sep 16 2026 00:00:00 GMT+0800 (中国标准时间)"；
 * 2) **字符串 trim**：Excel 里带首尾空格的值会让下拉筛选、等值判断全部落空，
 *    而肉眼根本看不出多了一个空格；
 * 3) **数字保持 number**：数值列判定（collectNumericKeys）和千分位格式化
 *    （formatDatas）都依赖它是 number，转成字符串会同时废掉排序和格式化。
 */
export function normalizeCell (value: unknown): unknown {
  if (value instanceof Date) {
    return formatDateCell(value)
  }
  if (typeof value === 'string') {
    return value.trim()
  }
  return value ?? ''
}

/**
 * 解析上传文件（ArrayBuffer）的第一个工作表。
 *
 * @throws 文件里没有工作表时抛错（调用方负责提示）
 */
export function parseExcelSheet (buffer: ArrayBuffer): ParsedExcelSheet {
  // 显式 type: 'array' —— 直接把 ArrayBuffer 丢给 SheetJS 时类型嗅探并不可靠
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('文件里没有工作表')
  }
  const sheet = workbook.Sheets[sheetName]

  // header: 1     → 读成二维数组，表头行自己找（见 findHeaderRow）
  // defval: null  → 空单元格也占位，否则行内下标会错位、右边的值会串到左边的列上
  // blankrows: false → 全空行不返回
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  })

  const { index: headerIndex, hits } = findHeaderRow(grid)
  const headerRow = grid[headerIndex] ?? []

  const columns: Array<{ index: number, key: string }> = []
  const usedKeys = new Set<string>()
  const unmatched: string[] = []
  const duplicated: string[] = []

  for (const [index, cell] of headerRow.entries()) {
    const text = cleanFieldName(cell)
    if (!text) {
      continue
    }
    const key = matchFieldKey(cell)
    if (!key) {
      unmatched.push(text)
      continue
    }
    // 同一个 key 出现两次时只认第一列：否则后者会覆盖前者，静默丢数据
    if (usedKeys.has(key)) {
      duplicated.push(text)
      continue
    }
    usedKeys.add(key)
    columns.push({ index, key })
  }

  const rows: Record<string, unknown>[] = []
  let skippedEmptyRows = 0

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const line = grid[i] ?? []
    // id 从 1 开始连续编号：v-data-table 用 id 做行 key，和 BI 路径（normalizeBiRows）保持一致
    const item: Record<string, unknown> = { id: rows.length + 1 }
    let filled = false
    for (const col of columns) {
      const headerText = headerRow[col.index]
      const value = normalizeCell(resolveFieldValue(headerText, line[col.index], col.key))
      item[col.key] = value
      // 注意用 !== '' 而不是真值判断：数字 0 是有效值，不能当空
      if (value !== '') {
        filled = true
      }
    }
    if (filled) {
      rows.push(item)
    } else {
      skippedEmptyRows++
    }
  }

  return { rows, columns, headerIndex, headerHits: hits, unmatched, duplicated, skippedEmptyRows }
}

/**
 * 把解析结果里「需要用户知道」的问题拼成一句话；没问题返回空串。
 *
 * 这些以前全是**静默失败**：列名对不上就整列空白、一行数据都没解析出来也没有任何提示，
 * 用户只能盯着空表格猜。现在明确说出来。
 */
export function describeExcelProblems (res: ParsedExcelSheet): string {
  const problems: string[] = []
  if (res.columns.length === 0) {
    problems.push(`表头没有任何一列匹配到字段（识别到 ${res.headerHits} 个已知列名）`)
  } else if (res.rows.length === 0) {
    problems.push('表头下没有数据行')
  }
  if (res.unmatched.length > 0) {
    const shown = res.unmatched.slice(0, 5).join('、')
    problems.push(`${res.unmatched.length} 列未匹配：${shown}${res.unmatched.length > 5 ? ' 等' : ''}`)
  }
  if (res.duplicated.length > 0) {
    problems.push(`重复列已忽略：${res.duplicated.slice(0, 3).join('、')}`)
  }
  return problems.join('；')
}

/** 已识别的列涉及多少个页面字段（导出给调用方判断用，避免直接依赖 PRODUCT_FIELDS） */
export const KNOWN_FIELD_COUNT = PRODUCT_FIELDS.length

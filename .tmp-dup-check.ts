/**
 * 临时排查脚本：用**前端的同一套纯函数**复算 src/data/test.xlsx 的唯一键，
 * 并对比「不归一化 / 不 trim」的口径，定位重复行的来源。
 */
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { normalizeCell, parseExcelSheet } from './src/utils/excelTable'
import { makeSyncKey, SYNC_KEY_FIELDS } from './src/utils/biRowFields'
import { matchFieldKey, resolveFieldValue } from './src/utils/productFields'

type Row = Record<string, unknown>

const buf = readFileSync('src/data/test.xlsx')
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer

const parsed = parseExcelSheet(ab)
console.log('=== 解析结果 ===')
console.log('数据行:', parsed.rows.length, '| 表头行(0基):', parsed.headerIndex, '| 命中列:', parsed.headerHits)
console.log('未匹配列:', parsed.unmatched.join('、') || '(无)')
console.log('重复列(被忽略):', parsed.duplicated.join('、') || '(无)')

const wb = XLSX.read(new Uint8Array(ab), { type: 'array', cellDates: true })
const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, {
  header: 1,
  defval: null,
  blankrows: false,
})
const headerRow = grid[parsed.headerIndex] ?? []

const colOf = new Map<string, number>()
for (const [i, cell] of headerRow.entries()) {
  const key = matchFieldKey(cell)
  if (key && !colOf.has(key)) colOf.set(key, i)
}
console.log('参与键的 5 列:', SYNC_KEY_FIELDS.map(f => `${f}=第${(colOf.get(f) ?? -1) + 1}列`).join('  '))

// 「匹配店铺」：表头就叫这个名字，但别名表里没有它 → matchFieldKey 认不出来 → 整列被丢弃。
// 单独把它抓出来，验证「这一列参与键之后重复是否消失」。
let shopIdx = -1
for (const [i, cell] of headerRow.entries()) {
  if (String(cell ?? '').trim() === '匹配店铺') shopIdx = i
}
console.log('「匹配店铺」列下标:', shopIdx, shopIdx >= 0 ? '← 存在，但未被识别（整列被丢弃）' : '(表里没有这一列)')

/** A：前端现状（归一化 + 单元格 trim） */
const normalizedRows: Row[] = []
/** B/C 用：只有原始值 */
const rawRows: Row[] = []

for (let i = parsed.headerIndex + 1; i < grid.length; i++) {
  const line = grid[i] ?? []
  const n: Row = { __line: i + 1 }
  const r: Row = { __line: i + 1 }
  let filled = false
  for (const f of SYNC_KEY_FIELDS) {
    const idx = colOf.get(f)
    const raw = idx === undefined ? null : line[idx]
    r[f] = raw
    if (f === '店铺') r.__shop = shopIdx >= 0 ? line[shopIdx] : undefined
    const v = normalizeCell(resolveFieldValue(idx === undefined ? '' : headerRow[idx], raw, f))
    n[f] = v
    if (v !== '') filled = true
  }
  // 与 parseExcelSheet 一致：整行都空的会被跳过
  if (filled) {
    normalizedRows.push(n)
    rawRows.push(r)
  }
}

function stats (label: string, rows: Row[], keyOf: (r: Row) => string) {
  const map = new Map<string, Row[]>()
  let empty = 0
  for (const row of rows) {
    const k = keyOf(row)
    if (!k) {
      empty++
      continue
    }
    const list = map.get(k) ?? []
    list.push(row)
    map.set(k, list)
  }
  const groups = [...map.entries()].filter(([, list]) => list.length > 1)
  const dupRows = groups.reduce((s, [, list]) => s + list.length, 0)
  console.log(`\n[${label}]`)
  console.log(`  参与统计 ${rows.length} 行 | 唯一键 ${map.size} 个 | 重复组 ${groups.length} 个 | 重复行 ${dupRows} 行 | 空键(无SKU) ${empty} 行`)
  return { groups, dupRows }
}

const keyNoTrim = (r: Row) => SYNC_KEY_FIELDS.map(f => String(r[f] ?? '')).join('|')
const keyTrim = (r: Row) => SYNC_KEY_FIELDS.map(f => String(r[f] ?? '').trim()).join('|')

const A = stats('A 前端口径：归一化 + trim', normalizedRows, r => makeSyncKey(r))
const B = stats('B 原始值 + 键段 trim', rawRows, keyTrim)
const C = stats('C 原始值 + 键段不 trim（Python 常见口径）', rawRows, keyNoTrim)

console.log('\n=== A 中重复、但两行原始值并不相同（归一化/trim 造成的合并）前 6 组 ===')
let shown = 0
for (const [key, list] of A.groups) {
  if (shown >= 6) {
    break
  }
  if (new Set(list.map(keyTrim)).size === 1) {
    continue
  }
  shown++
  console.log(`\n  归一化键: ${JSON.stringify(key)}`)
  for (const row of list.slice(0, 4)) {
    console.log(`    Excel 第 ${row.__line} 行: ` + SYNC_KEY_FIELDS.map(f => `${f}=${JSON.stringify(row[f])}`).join(' | '))
  }
}

let sameGroups = 0
let sameRows = 0
for (const [, list] of A.groups) {
  if (new Set(list.map(keyTrim)).size === 1) {
    sameGroups++
    sameRows += list.length
  }
}
console.log(`\n=== A 里连原始值都相同（数据本身重复）的：${sameGroups} 组 / ${sameRows} 行 ===`)
const D = stats(
  'D 用 Excel 实际列（把「匹配店铺」当作「店铺」参与键）',
  rawRows,
  r => [r.SKU, r.__shop, r.仓位, r.团队, r.是否属于待评估库存].map(v => String(v ?? '').trim()).join('|'),
)

console.log(`\n汇总重复行数：A=${A.dupRows}  B=${B.dupRows}  C=${C.dupRows}  D=${D.dupRows}`)

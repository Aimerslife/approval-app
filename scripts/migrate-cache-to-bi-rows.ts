import fs from 'node:fs'
/**
 * migrate-cache-to-bi-rows.ts
 *
 * 把旧的「整份数据塞进一个 json 字段」缓存（`bi_data_cache`）迁到新表 `bi_rows`（一行一条记录）。
 *
 * 迁移 = 拆 JSON + 归一化 + 算唯一键 + 入库，四步**全部复用生产代码**：
 *   - 归一化   → src/utils/productFields.ts 的 `BI_VALUE_MAP`（呆滞统一成 0 = 呆滞 / 1 = 未呆滞）
 *   - 唯一键   → src/utils/biRowFields.ts 的 `SYNC_KEY_FIELDS` / `makeSyncKey`
 *   - 行→记录  → server/biSync.ts 的 `buildRecord`（中文列名 → PB 的 ASCII 列，含类型转换）
 *   - 去重     → server/biSync.ts 的 `dedupeBySyncKey`
 * 这样迁进去的数据和以后 `POST /api/bi/upload` 上传的数据是**同一个口径**，不会出现两套判等规则。
 *
 * ⚠️ 为什么直接写 PB 的 SQLite，而不是走 POST /api/bi/upload：
 *    那条正规路径需要管理员凭据（.env.local 的 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD）。
 *    本次是一次性迁移、目标表还是空的，所以直接落库：
 *      · 写入前自动做一份 **SQLite 一致性备份**（用 backup API，不是简单复制文件 ——
 *        PB 开着 WAL，直接 copy 可能拿到写了一半的库）；
 *      · 全部 INSERT 放在**单个事务**里，任何一条失败（含唯一索引冲突）整体回滚，不会留半份数据；
 *      · 目标 component 已有数据时直接拒绝执行（防止把同一批数据变成两份）。
 *    日常上传仍请走页面按钮 / POST /api/bi/upload。
 *
 * 用法：
 *   npx tsx scripts/migrate-cache-to-bi-rows.ts                       # 预演（默认，不写库）
 *   npx tsx scripts/migrate-cache-to-bi-rows.ts --write               # 真正写入（自动备份）
 *   npx tsx scripts/migrate-cache-to-bi-rows.ts --excel 数据.xlsx --write
 *       从 Excel 导入（默认是从旧的 bi_data_cache 迁）。Excel 的表头会对齐到字段名，
 *       对不上的列会列出来。
 *   --component <id>   指定写进哪个 component（默认沿用缓存里的 / BI_COMPONENT_ID）
 *   --replace          先删掉该 component 已有的行再写（默认遇到非空就拒绝）
 */
import Database from 'better-sqlite3'
import { buildRecord, dedupeBySyncKey } from '../server/biSync'
import { BI_ROW_FIELDS, SYNC_KEY_FIELDS } from '../src/utils/biRowFields'
import { describeExcelProblems, parseExcelSheet } from '../src/utils/excelTable'
import { BI_VALUE_MAP, resolveFieldValue } from '../src/utils/productFields'

const DB_PATH = process.env.PB_DB || 'pocketbase/pb_data/data.db'
const WRITE = process.argv.includes('--write')

/** 取 `--key value` 形式的参数值 */
function argValue (name: string): string {
  const i = process.argv.indexOf(name)
  return i === -1 ? '' : (process.argv[i + 1] ?? '')
}

/** 改从 Excel 文件导入（默认读旧的 bi_data_cache） */
const EXCEL_ARG = argValue('--excel')
/** 指定写进哪个 component（默认沿用缓存里的 / BI_COMPONENT_ID） */
const COMPONENT_ARG = argValue('--component')
/** 覆盖模式：先删掉该 component 已有的行再写（默认遇到非空直接拒绝） */
const REPLACE = process.argv.includes('--replace')

/** PB 的日期列格式：'2026-09-16 08:00:00.000Z' */
const PB_DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/

if (!fs.existsSync(DB_PATH)) {
  console.error(`找不到数据库：${DB_PATH}（可用 PB_DB 环境变量指定）`)
  process.exit(1)
}

const db = new Database(DB_PATH, { readonly: !WRITE, fileMustExist: true })

/* ---------- 1. 取数：--excel 读文件，否则读旧缓存 ---------- */
const DEFAULT_COMPONENT = '0c356d17-3c48-4c3b-b133-e6406a88c5fe'
let rawRows: Record<string, unknown>[] = []
let componentId = ''
let fetchedAt = ''
let sourceLabel = ''

if (EXCEL_ARG) {
  if (!fs.existsSync(EXCEL_ARG)) {
    console.error(`找不到 Excel：${EXCEL_ARG}`)
    process.exit(1)
  }
  // ⚠️ 不能用 readFileSync(...).buffer：node 的 Buffer 是**池化**的，
  //    .buffer 里可能含相邻数据，必须按 byteOffset/byteLength 切出干净的一段。
  const buf = fs.readFileSync(EXCEL_ARG)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const parsed = parseExcelSheet(ab)
  rawRows = parsed.rows
  componentId = COMPONENT_ARG || process.env.BI_COMPONENT_ID || DEFAULT_COMPONENT
  fetchedAt = new Date().toISOString()
  sourceLabel = `Excel ${EXCEL_ARG}`
  console.log(`来源: ${sourceLabel}`)
  console.log(`  解析出 ${rawRows.length} 行（表头在第 ${parsed.headerIndex + 1} 行，识别出 ${parsed.columns.length} 列）`)
  // 解析器自己的表头提示照样要显示 —— 否则「列名看着对、整列却是空」无从解释
  const problems = describeExcelProblems(parsed)
  if (problems) {
    console.log(`  ⚠️ ${problems}`)
  }
} else {
  const cache = db
    .prepare('SELECT id, component_id, row_count, fetched_at, rows FROM bi_data_cache ORDER BY fetched_at DESC LIMIT 1')
    .get() as { id: string, component_id: string, row_count: number, fetched_at: string, rows: unknown } | undefined

  if (!cache) {
    console.error('bi_data_cache 里没有记录。想从 Excel 导入请用 --excel <文件路径>。')
    process.exit(1)
  }
  rawRows = (typeof cache.rows === 'string' ? JSON.parse(cache.rows) : (cache.rows ?? [])) as Record<string, unknown>[]
  componentId = COMPONENT_ARG || cache.component_id || process.env.BI_COMPONENT_ID || DEFAULT_COMPONENT
  fetchedAt = cache.fetched_at || new Date().toISOString()
  sourceLabel = `bi_data_cache(${cache.id})`
  console.log(`来源: ${sourceLabel}  fetched_at=${cache.fetched_at}  row_count=${cache.row_count}`)
  console.log(`  JSON 解析出 ${rawRows.length} 行${rawRows.length === cache.row_count ? '（与 row_count 一致）' : ` ⚠️ 与 row_count(${cache.row_count}) 不一致`}`)
}

/* ---------- 2. 重新归一化 ----------
 * 缓存是旧代码写的，呆滞列当时可能是「是/否」；而它现在**参与唯一键**，
 * 不统一成 0/1 的话同一行会因为叫法不同被算成两条记录。
 */
let fixed = 0
for (const row of rawRows) {
  for (const field of Object.keys(BI_VALUE_MAP)) {
    if (!(field in row)) {
      continue
    }
    const before = row[field]
    const after = resolveFieldValue(field, before, field)
    if (after !== before) {
      row[field] = after
      fixed++
    }
  }
}
function distribution (field: string) {
  const m = new Map<string, number>()
  for (const r of rawRows) {
    const k = String(r[field] ?? '(空)')
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
console.log(`归一化：改写了 ${fixed} 个单元格`)
console.log('  「是否属于呆滞库存」值分布: ' + JSON.stringify(distribution('是否属于呆滞库存')))

/* ---------- 3. 算唯一键 + 去重 ---------- */
console.log('')
console.log(`唯一键 = ${SYNC_KEY_FIELDS.join(' | ')}`)
const dedupe = dedupeBySyncKey(rawRows)
console.log(
  `  fetched=${rawRows.length}  unique=${dedupe.unique}  missingKey=${dedupe.missingKey}（无 SKU 被跳过）`
  + `  duplicates=${dedupe.duplicates}（完全重复 ${dedupe.exactRepeatRows} / 同键冲突 ${dedupe.conflictRows}）`,
)
if (dedupe.conflicts.size > 0) {
  const topDiff = [...dedupe.conflictDiffColumns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`  ⚠️ ${dedupe.conflicts.size} 个键出现「同键不同内容」，按先到者保留`
    + `（后到的被丢弃，共 ${dedupe.conflictRows} 行）。差异列: ${JSON.stringify(topDiff)}`)
  console.log(`  冲突键样例: ${JSON.stringify([...dedupe.conflicts.keys()].slice(0, 3))}`)
} else {
  console.log('  ✅ 没有冲突：这个键的粒度足以区分所有行')
}

/* ---------- 4. 组装记录 ---------- */
const records = [...dedupe.byKey.entries()].map(([key, row]) => buildRecord(componentId, key, row, fetchedAt))

const unmapped = [...new Set(rawRows.flatMap(r => Object.keys(r)))]
  .filter(k => k !== 'id' && !BI_ROW_FIELDS.some(f => f.key === k))
if (unmapped.length > 0) {
  console.log(`  ⚠️ ${unmapped.length} 个列没有对应库字段（数据仍在 data 快照里，只是不能按它筛选）: ${unmapped.join(', ')}`)
}

console.log('')
console.log(`组装完成：${records.length} 条记录 → bi_rows（component_id=${componentId}）`)
console.log(`  data 快照大小样例: ${JSON.stringify(records[0]?.data ?? {}).length} 字节/行`)

if (!WRITE) {
  console.log('')
  console.log('当前是【预演】模式，没有写库。确认无误后加 --write 再跑一次。')
  db.close()
  process.exit(0)
}

/* ---------- 5. 安全检查 + 备份 ---------- */
const existing = db
  .prepare('SELECT COUNT(*) AS n FROM bi_rows WHERE component_id = ?')
  .get(componentId) as { n: number }
if (existing.n > 0 && !REPLACE) {
  console.error(`⛔ bi_rows 里 component=${componentId} 已有 ${existing.n} 行，拒绝继续。`)
  console.error('   键口径可能已经变过，硬写会把同一批数据变成两份（旧行留成 orphan）。')
  console.error(`   确认要整批替换就加 --replace（会先删掉这 ${existing.n} 行，与写入在同一个事务里，`)
  console.error('   并且写入前自动备份）；或改用 POST /api/bi/upload?prune=1 走正规路径。')
  db.close()
  process.exit(1)
}
if (existing.n > 0) {
  console.log(`⚠️ --replace：先删除 component=${componentId} 的 ${existing.n} 行，再写入 ${records.length} 行`)
  console.log('   删除与写入在同一个事务里（失败一起回滚）；写入前的备份已包含这些旧行。')
}

// 时间格式核对：PB 的 autodate 是 'YYYY-MM-DD HH:MM:SS.mmmZ'
const sample = db.prepare('SELECT created FROM app_chain LIMIT 1').get() as { created?: string } | undefined
const stamp = () => new Date().toISOString().replace('T', ' ')
const sampleOk = !sample?.created || PB_DATE_RE.test(sample.created)
console.log('')
console.log(`时间格式核对：现有 app_chain.created=${sample?.created ?? '(无样例)'} / 本脚本写入 ${stamp()} → ${sampleOk ? '一致' : '⚠️ 不一致'}`)

const backupPath = `${DB_PATH}.bak-${Date.now()}`
await db.backup(backupPath)
console.log(`已备份：${backupPath}（${(fs.statSync(backupPath).size / 1024 / 1024).toFixed(1)} MB）`)

/* ---------- 6. 单事务写入 ---------- */
const COLS = ['id', 'component_id', 'sync_key', ...BI_ROW_FIELDS.map(f => f.field), 'data', 'fetched_at', 'created', 'updated']
const insert = db.prepare(
  `INSERT INTO bi_rows (${COLS.map(c => `\`${c}\``).join(', ')}) VALUES (${COLS.map(c => '@' + c).join(', ')})`,
)

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
/** PB 的 id 是 15 位 [a-z0-9] */
const newId = () => Array.from({ length: 15 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

const now = stamp()
let inserted = 0
try {
  db.transaction(() => {
    if (REPLACE && existing.n > 0) {
      db.prepare('DELETE FROM bi_rows WHERE component_id = ?').run(componentId)
    }
    for (const rec of records) {
      insert.run({
        ...rec,
        // json 字段在 SQLite 里是 TEXT，必须序列化；其余值 buildRecord 已经保证不是 undefined
        data: JSON.stringify(rec.data ?? {}),
        id: newId(),
        created: now,
        updated: now,
      })
      inserted++
    }
  })()
} catch (error) {
  console.error(`⛔ 写入失败，已整体回滚（库里没留下任何东西）：${error instanceof Error ? error.message : error}`)
  db.close()
  process.exit(1)
}
console.log(`✅ 已写入 ${inserted} 行`)

/* ---------- 7. 回读校验 ---------- */
const back = db.prepare('SELECT COUNT(*) AS n FROM bi_rows WHERE component_id = ?').get(componentId) as { n: number }
console.log(`回读：component=${componentId} 现在共 ${back.n} 行`)
console.log('  is_dead 分布: ' + JSON.stringify(db.prepare('SELECT is_dead, COUNT(*) AS n FROM bi_rows WHERE component_id = ? GROUP BY is_dead').all(componentId)))
console.log('  group_name 非空行数: ' + JSON.stringify(db.prepare('SELECT COUNT(*) AS n FROM bi_rows WHERE component_id = ? AND group_name != \'\'').get(componentId)))
const samples = db.prepare('SELECT sync_key, sku, group_name, is_dead, qty_total FROM bi_rows WHERE component_id = ? LIMIT 3').all(componentId)
console.log('  样例: ' + JSON.stringify(samples))
db.close()

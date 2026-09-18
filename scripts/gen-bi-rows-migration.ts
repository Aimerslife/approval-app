/**
 * gen-bi-rows-migration.ts
 *
 * 由 src/utils/biRowFields.ts（中文字段 → PB 列名的映射表）生成 bi_rows 的 PB 迁移。
 *
 * 用法：npx tsx scripts/gen-bi-rows-migration.ts
 *
 * 为什么用生成而不是手写迁移：65 个字段 × 每个约 12 行 JSON，
 * 手写既长又必然出错（漏列、字段 id 重复、类型写反都只有 PB 启动时才报）。
 * 改字段的顺序应该是：改 src/utils/biRowFields.ts → 重跑本脚本。
 *
 * 生成的迁移是**幂等**的：先删掉已存在的 bi_rows 再重建。
 * 之所以敢这么做：这张表目前**不可能有数据** ——
 * BI 组件 id 已失效（实测报 "Component not found"），同步从未成功过。
 * 等同步跑通之后，就不能再用删除重建的方式改结构了，要改成增量加字段。
 */
import fs from 'node:fs'
import path from 'node:path'
import { BI_ROW_FIELDS, BI_ROW_META_FIELDS } from '../src/utils/biRowFields'

const OUT = path.join('pocketbase', 'pb_migrations', '1789660100_updated_bi_rows.js')
const COLLECTION_ID = 'pbc_1789660001'
const COLLECTION_NAME = 'bi_rows'

/** PB 的字段 id 必须是 [a-z0-9]+，且集合内唯一 */
function fieldId(index: number, type: string): string {
  const prefix = type === 'number' ? 'num' : 'txt'
  return `${prefix}178966${String(index).padStart(4, '0')}`
}

function textField(id: string, name: string, help: string): string {
  return `      {
        "autogeneratePattern": "",
        "help": ${JSON.stringify(help)},
        "hidden": false,
        "id": ${JSON.stringify(id)},
        "max": 0,
        "min": 0,
        "name": ${JSON.stringify(name)},
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      }`
}

function numberField(id: string, name: string, help: string): string {
  return `      {
        "help": ${JSON.stringify(help)},
        "hidden": false,
        "id": ${JSON.stringify(id)},
        "max": null,
        "min": null,
        "name": ${JSON.stringify(name)},
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      }`
}

const fields: string[] = []

// 1) id 主键
fields.push(`      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      }`)

// 2) 同步用的元字段。
// ⚠️ id 前缀刻意用 `meta` 而不是 `txt`：业务列的 id 是 txt178966<4位序号>，
//    序号从 0000 起 —— 如果元字段也用 txt1789660001，就会和序号 1 的业务列撞 id，
//    PB 会以「字段 id 重复」拒绝整个迁移。这里靠前缀分开，末尾还有重复自检兜底。
fields.push(
  textField(
    'meta1789660001',
    'component_id',
    'BI 组件 id。同一个 BI 组件的数据都带同一个值，便于换组件时整批替换。',
  ),
)
fields.push(
  textField(
    'meta1789660002',
    'sync_key',
    // ⚠️ help 上限 300 字节（中文 3 字节/字），长说明写在文件头注释里
    '幂等键 = SKU。同步按 (component_id, sync_key) upsert，同一 SKU 只留一条。',
  ),
)

// 3) 65 个业务列，按映射表顺序
BI_ROW_FIELDS.forEach((f, i) => {
  const help = `${f.title}（BI 中文字段名：${f.key}）`
  fields.push(
    f.type === 'number'
      ? numberField(fieldId(i, 'number'), f.field, help)
      : textField(fieldId(i, 'text'), f.field, help),
  )
})

// 4) 整行快照 + 拉取时间
fields.push(`      {
        "help": "整行原始数据（65 个字段原样保留）。BI 新增了尚未入库的列时，可以从这里取，不用立刻改表。",
        "hidden": false,
        "id": "meta1789669001",
        "maxSize": 100000,
        "name": "data",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      }`)
fields.push(
  textField('meta1789669002', 'fetched_at', '这一行是从 BI 拉到的时间（ISO 字符串），整批同步时写入同一个值。'),
)

// 5) 时间戳
fields.push(`      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }`)
fields.push(`      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }`)

const INDEXES = [
  'CREATE UNIQUE INDEX `idx_bi_rows_sync_key` ON `bi_rows` (`component_id`, `sync_key`)',
  'CREATE INDEX `idx_bi_rows_dims` ON `bi_rows` (`platform`, `department`, `group_name`)',
  'CREATE INDEX `idx_bi_rows_sku` ON `bi_rows` (`sku`)',
]

const migration = `/// <reference path="../pb_data/types.d.ts" />
/**
 * bi_rows：BI 数据行表（一行一条记录）。
 *
 * ⚠️ 本文件由 scripts/gen-bi-rows-migration.ts 生成，**不要手改**。
 *    要增删字段，改 src/utils/biRowFields.ts 再重跑：
 *      npx tsx scripts/gen-bi-rows-migration.ts
 *
 * 为什么一行一记录，而不是原来那样把整份数据塞进一个 json 字段：
 *   1) 原方案每次进数据页都要把 10.5MB 全量传回浏览器，哪怕只看 20 行；
 *   2) 服务端筛选/排序/分页全做不到（BI 接口又不支持 sorts，实测四种形态都被静默忽略）；
 *   3) 无法与审批规则关联 —— relation 字段指不进 json 内部。
 *
 * 字段分三部分：
 *   - sync_key / component_id：同步用的元字段，UNIQUE 索引是幂等 upsert 的前提；
 *   - ${BI_ROW_FIELDS.length} 个业务列：由 src/utils/biRowFields.ts 生成。
 *     PB 字段名不能用中文，所以每个中文列都映射了一个 ASCII 列名；
 *   - data：整行快照，BI 新增列时可以兜底，不用立刻改表。
 *
 * 关于 upsert：本迁移会先删掉已存在的 bi_rows 再重建。
 * 这张表目前不可能有数据 —— BI 组件 id 已失效（实测 "Component not found"），
 * 同步从未成功过。同步跑通之后要改成增量加字段，不能再这么重建。
 */
migrate((app) => {
  // 幂等：已经存在就先删掉（见文件头对"为什么敢删"的说明）
  try {
    const existing = app.findCollectionByNameOrId(${JSON.stringify(COLLECTION_ID)});
    if (existing) app.delete(existing);
  } catch (e) {
    // 不存在会抛错，忽略即可
  }

  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
${fields.join(',\n')}
    ],
    "id": ${JSON.stringify(COLLECTION_ID)},
    "indexes": [
${INDEXES.map(s => '      ' + JSON.stringify(s)).join(',\n')}
    ],
    "listRule": "@request.auth.id != ''",
    "name": ${JSON.stringify(COLLECTION_NAME)},
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": "@request.auth.id != ''"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId(${JSON.stringify(COLLECTION_ID)});
  return app.delete(collection);
})
`

// ==================== 自检 ====================
// 字段 id 重复是生成器最容易犯的错（生成的 id 撞上固定 id），
// 而 PB 只会在启动时报错、信息也不直观。这里先自查再落盘。
const allIds = [...migration.matchAll(/"id":\s*"([^"]+)"/g)].map(m => m[1])
const dupIds = [...new Set(allIds.filter((id, i) => allIds.indexOf(id) !== i))]
if (dupIds.length) {
  throw new Error(`[gen] 字段 id 重复: ${dupIds.join(', ')} —— 检查 fieldId() 与固定 id 的前缀`)
}
if (new Set(allIds).size !== allIds.length) {
  throw new Error('[gen] 字段 id 存在重复')
}

// PB 字段的 help 上限是 300 **字节**（一个中文占 3 字节，即约 100 字）。
// 超了会在 migrate 时报 "help: the length must be between 1 and 300"，
// 报错只给字段序号、不给字段名，排查很绕 —— 所以这里按字节先量一遍。
const longHelp = [...migration.matchAll(/"help":\s*"((?:[^"\\]|\\.)*)"/g)]
  .map(m => m[1].replace(/\\n/g, '\n'))
  .map(h => ({ h, bytes: Buffer.byteLength(h, 'utf8') }))
  .filter(x => x.bytes > 300)
if (longHelp.length) {
  throw new Error(
    `[gen] 有 ${longHelp.length} 个 help 超过 300 字节（PB 上限，中文按 3 字节算）: ` +
      longHelp.map(x => `「${x.h.slice(0, 16)}…」${x.bytes} 字节`).join('; '),
  )
}
// 索引里引用的列必须真的被声明过（写错列名 PB 也会在启动时报错）
const declaredNames = [...migration.matchAll(/"name":\s*"([^"]+)"/g)].map(m => m[1])
for (const sql of INDEXES) {
  const cols = (sql.match(/\(\s*([^)]+)\)\s*$/) ?? [, ''])[1]
    .split(',')
    .map(s => s.replace(/[`\s]/g, ''))
    .filter(Boolean)
  const missing = cols.filter(c => !declaredNames.includes(c))
  if (missing.length) {
    throw new Error(`[gen] 索引引用了不存在的列: ${missing.join(', ')}`)
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, migration, 'utf8')

const textCount = BI_ROW_FIELDS.filter(f => f.type === 'text').length
const numberCount = BI_ROW_FIELDS.filter(f => f.type === 'number').length
console.log(`✅ 已生成 ${OUT}`)
console.log(`   业务列 ${BI_ROW_FIELDS.length} 个（text ${textCount} / number ${numberCount}）`)
console.log(`   元字段 ${BI_ROW_META_FIELDS.length} 个 + id/created/updated`)
console.log(`   索引 ${INDEXES.length} 条`)
// fields 里已经含 id / created / updated，不要再 +3（之前这里多加了，日志数字比实际大 3）
console.log(`   文件共 ${fields.length} 个字段（含 id 与 created/updated）`)

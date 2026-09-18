/**
 * biRowFields.ts
 *
 * BI 行数据「中文字段名 → PocketBase 列名」的**唯一映射表**。
 *
 * 为什么需要它：PB 的字段名只允许字母、数字、下划线，**不能用中文**
 * （65 个列名全是中文，直接用会被 PB 拒绝）。所以每个中文列都要有一个 ASCII 列名。
 *
 * 这份表是「映射 → 建表结构 → 同步写入」三处的共同来源：
 *   - scripts/gen-bi-rows-migration.ts 用它生成 bi_rows 的迁移
 *   - server/biSync.ts 用它决定把哪个 BI 列写进哪个 PB 列
 *   改列名只改这里，然后重新生成迁移。
 *
 * 类型只分两类：`number` 与 `text`。
 * 日期（最早开售日期-SKU / 拓业部最早时间-SPU）**刻意存 text** ——
 * BI 给的就是 'YYYY-MM-DD' 字符串，字典序即时间序，可以直接比大小；
 * 转成 PB 的 date 反而要额外处理空值，还会把时区问题引进来。
 *
 * 分类依据：BI 实测该组件共 65 列，类型分布是 `string×20 / date×2 / number×43`。
 * 本表把 2 个日期并进 text，于是应为 **text（含 2 个日期串）22 个 + number 43 个 = 65**。
 * 文件末尾有断言校验这个分布 —— 对不上就说明表写错了。
 */

/** [中文字段名(BI/前端用的 key), PB 列名, 类型, 界面标题(供对照 productFields.ts)] */
import { PRODUCT_FIELDS } from './productFields'

type Row = [key: string, field: string, type: 'text' | 'number', title: string]

const RAW: Row[] = [
  // ===== 文本类（含 2 个日期串）=====
  ['图片链接', 'image_url', 'text', '产品图片'],
  ['SKU', 'sku', 'text', 'SKU'],
  ['SPU', 'spu', 'text', 'SPU'],
  ['主MODEL', 'main_model', 'text', '主MODEL'],
  ['产品名称', 'product_name', 'text', '产品名称'],
  ['季节性产品标签', 'seasonal_tag', 'text', '季节性产品标签'],
  ['最早开售日期-SKU', 'first_sale_date', 'text', '最早开售日期-SKU'],
  ['拓业部最早时间-SPU', 'expand_first_sale_date', 'text', '拓业部最早时间-SPU'],
  ['供应商', 'supplier', 'text', '自产/外购'],
  ['组长', 'leader', 'text', '组长'],
  ['组别', 'group_name', 'text', '组别'],
  ['部门', 'department', 'text', '部门'],
  ['仓位', 'warehouse', 'text', '仓位'],
  ['店铺', 'shop', 'text', '店铺'],
  ['平台', 'platform', 'text', '平台'],
  ['亚马逊呆滞条件', 'dead_rule_amazon', 'text', '亚马逊呆滞条件'],
  ['拓业部呆滞条件', 'dead_rule_expand', 'text', '拓业部呆滞条件'],
  ['是否属于呆滞库存', 'is_dead', 'text', '呆滞情况'],
  ['销售状态', 'sale_status', 'text', '销售状态'],
  ['一级品类', 'category1', 'text', '一级品类'],
  ['二级品类', 'category2', 'text', '二级品类'],
  ['是否属于灯具', 'is_lamp', 'text', '产品类型'],

  // ===== 库存数量 =====
  ['采购中', 'qty_purchasing', 'number', '采购中'],
  ['FBA在仓', 'qty_fba_stock', 'number', 'FBA在仓'],
  ['FBA在途', 'qty_fba_transit', 'number', 'FBA在途'],
  ['本地仓', 'qty_local', 'number', '本地仓'],
  ['海外仓在仓', 'qty_overseas_stock', 'number', '海外仓在仓'],
  ['海外仓在途', 'qty_overseas_transit', 'number', '海外仓在途'],
  ['总库存数量', 'qty_total', 'number', '总库存数量'],
  ['总库存金额', 'amount_total', 'number', '总库存金额'],
  ['未入仓', 'qty_not_in_warehouse', 'number', '未入仓'],

  // ===== 库龄数量 =====
  ['3个月内[0-90]', 'qty_age_0_90', 'number', '3个月内[数量]'],
  ['3-6个月内[91-180]', 'qty_age_91_180', 'number', '3-6个月内[数量]'],
  ['6-9个月内[181-270]', 'qty_age_181_270', 'number', '6-9个月内[数量]'],
  ['9-12个月内[271-365]', 'qty_age_271_365', 'number', '9-12个月内[数量]'],
  ['1年以上[365+]', 'qty_age_365_plus', 'number', '1年以上[数量]'],

  // ===== 库龄金额 =====
  ['3个月内[0-90]（金额）', 'amount_age_0_90', 'number', '3个月内（金额）'],
  ['3-6个月内[91-180](金额)', 'amount_age_91_180', 'number', '3-6个月内(金额)'],
  ['6-9个月内[181-270](金额)', 'amount_age_181_270', 'number', '6-9个月内(金额)'],
  ['9-12个月内[271-365](金额）', 'amount_age_271_365', 'number', '9-12个月内(金额）'],
  ['一年以上[365+](金额)', 'amount_age_365_plus', 'number', '一年以上(金额)'],

  // ===== SKU 回款 / 毛利润 =====
  ['SKU1月前回款', 'sku_refund_m1', 'number', 'SKU1月前回款'],
  ['SKU2月前回款', 'sku_refund_m2', 'number', 'SKU2月前回款'],
  ['SKU3月前回款', 'sku_refund_m3', 'number', 'SKU3月前回款'],
  ['SKU上年回款', 'sku_refund_ly', 'number', 'SKU上年回款'],
  ['SKU1月前毛利润', 'sku_profit_m1', 'number', 'SKU1月前毛利润'],
  ['SKU2月前毛利润', 'sku_profit_m2', 'number', 'SKU2月前毛利润'],
  ['SKU3月前毛利润', 'sku_profit_m3', 'number', 'SKU3月前毛利润'],

  // ===== 父 ASIN 回款 / 毛利润 =====
  ['父ASIN1月前回款', 'asin_refund_m1', 'number', '父ASIN1月前回款'],
  ['父ASIN2月前回款', 'asin_refund_m2', 'number', '父ASIN2月前回款'],
  ['父ASIN3月前回款', 'asin_refund_m3', 'number', '父ASIN3月前回款'],
  ['父ASIN上一年回款', 'asin_refund_ly', 'number', '父ASIN上一年回款'],
  ['父ASIN1月前毛利润', 'asin_profit_m1', 'number', '父ASIN1月前毛利润'],
  ['父ASIN2月前毛利润', 'asin_profit_m2', 'number', '父ASIN2月前毛利润'],
  ['父ASIN3月前毛利润', 'asin_profit_m3', 'number', '父ASIN3月前毛利润'],

  // ===== SPU 回款 / 毛利润 =====
  ['SPU1月前回款', 'spu_refund_m1', 'number', 'SPU1月前回款'],
  ['SPU2月前回款', 'spu_refund_m2', 'number', 'SPU2月前回款'],
  ['SPU3月前回款', 'spu_refund_m3', 'number', 'SPU3月前回款'],
  ['SPU4月前回款', 'spu_refund_m4', 'number', 'SPU4月前回款'],
  ['SPU1月前毛利润', 'spu_profit_m1', 'number', 'SPU1月前毛利润'],
  ['SPU2月前毛利润', 'spu_profit_m2', 'number', 'SPU2月前毛利润'],
  ['SPU3月前毛利润', 'spu_profit_m3', 'number', 'SPU3月前毛利润'],
  ['SPU4月前毛利润', 'spu_profit_m4', 'number', 'SPU4月前毛利润'],

  // ===== 销量 =====
  ['SKU近一年月平均销量', 'sku_sales_avg_12m', 'number', 'SKU近一年月平均销量'],
  ['SPU近一年月平均销量', 'spu_sales_avg_12m', 'number', 'SPU近一年月平均销量'],
]

export interface BiRowField {
  /** 中文字段名（页面上 `row['xxx']` 用的就是它） */
  key: string
  /** PocketBase 的 ASCII 列名 */
  field: string
  /** PB 列类型。日期也走 text（见文件头说明） */
  type: 'text' | 'number'
  /** 界面标题，仅用于与 productFields.ts 对照 */
  title: string
}

export const BI_ROW_FIELDS: BiRowField[] = RAW.map(([key, field, type, title]) => ({
  key,
  field,
  type,
  title,
}))

/** 中文字段名 → 映射项 */
export const BI_ROW_FIELD_BY_KEY: Record<string, BiRowField> = Object.fromEntries(
  BI_ROW_FIELDS.map(f => [f.key, f]),
)

/** PB 列名 → 中文字段名（同步时反向查找用） */
export const BI_ROW_KEY_BY_FIELD: Record<string, string> = Object.fromEntries(
  BI_ROW_FIELDS.map(f => [f.field, f.key]),
)

/** bi_rows 里**除 65 个业务列之外**的列（同步脚本自己维护，不要手改） */
export const BI_ROW_META_FIELDS = [
  'component_id',
  'sync_key',
  'data',
  'fetched_at',
  'created',
  'updated',
] as const

// ==================== sync_key（幂等键 / 去重键）====================

/**
 * sync_key 的组成部分（按顺序用 `|` 拼接）。
 *
 * **现用口径：SKU + 店铺 + 仓位 + 组别 + 是否属于呆滞库存。**
 *
 * ⚠️ 最后那段是「值」而不是「标识」：呆滞列必须**先归一化**再拼键
 *   （0 = 呆滞 / 1 = 未呆滞，映射见 productFields.ts 的 BI_VALUE_MAP）。
 *   归一化由 resolveFieldValue 在做键之前完成（BI 走 normalizeBiRows、
 *   Excel 走 parseExcelSheet），所以两种来源拼出来的键是一致的。
 *   如果哪天绕过这两条路直接调 makeSyncKey，记得值已经是 '0' / '1'。
 *
 * 历史（同一份 8017 行 BI 数据，每次只改一个维度，用来判断粒度够不够）：
 *   只用 SKU      → 158 个冲突，去重后 1761 行
 *   + 仓位        →  24 个冲突，去重后 1854 行
 *   + 店铺        →   5 个冲突，去重后 1899 行
 *   + 部门        →   0 个冲突（当时用它收尾）
 *   后来「部门」换成「组别」，现在再并入「是否属于呆滞库存」。
 *   判断标准始终是那两个数字，一起看：
 *     `conflicts` 还多      → 粒度不够，不同的行被当成同一行互相覆盖；
 *     `unique` 掉得厉害     → 粒度太细，本来是同一行的被拆成了多条。
 *   跑法：POST /api/bi/upload?dryRun=1（或 /api/bi/sync?dryRun=1），它只算差异不写库。
 *
 * ⚠️ 改这几个字段 = **改全库的判等口径**。库里已有的 bi_rows 是按旧键存的，
 *   新键跟它们对不上 → 同一批数据会被当成新行再插一遍，旧行留着变成 orphan
 *   （表里于是出现两份数据）。所以改键之后，要么先清空该 component 的行，
 *   要么用 `?prune=1` 跑一次**完整批次**（prune 删的正是「库里存在但本批没有」的行）。
 *
 * ⚠️ 为什么不能用 normalizeBiRows 生成的 `id`，也不能用「整行 hash」：
 *   `id` 是「累积行号 + 页内下标」，而 BI 的分页不稳定
 *   （实测 8017 行里 6256 行是重复返回的），同一逻辑行每次落在不同位置 → id 每次都变；
 *   整行 hash 更糟 —— 库存数字每天都在动，键一变就变成「插入新行 + 旧行变 orphan」。
 *   业务键必须由**跨次拉取稳定**的字段组成，且不含度量。
 *
 * 服务端同步（server/biSync.ts）与 Excel 上传（server/index.ts 的 /api/bi/upload）
 * 都用这一个定义，保证「上传的行」和「BI 同步的行」在库里是同一批。
 */
export const SYNC_KEY_FIELDS = ['SKU', '店铺', '仓位', '组别', '是否属于呆滞库存'] as const

/** 计算 sync_key。第一段 SKU 必须有值，否则返回 ''（调用方应跳过该行） */
export function makeSyncKey (row: Record<string, unknown>): string {
  const parts = SYNC_KEY_FIELDS.map(f => String(row[f] ?? '').trim())
  if (!parts[0]) {
    return ''
  }
  return parts.join('|')
}

// ==================== 自检 ====================
// 这几条断言是「防手滑」用的：65 个中文列名里挑错一个（比如把某列的类型写反、
// 或者复制粘贴时漏了一行），后面生成的表结构和同步逻辑会一起错，而且不会报错。
// 类型分布必须与 BI 实测的 `string×20 / date×2 / number×43` 吻合。
const EXPECTED_TOTAL = 65
const EXPECTED_TEXT = 22 // 20 个字符串 + 2 个日期串
const EXPECTED_NUMBER = 43

const textCount = BI_ROW_FIELDS.filter(f => f.type === 'text').length
const numberCount = BI_ROW_FIELDS.filter(f => f.type === 'number').length

if (BI_ROW_FIELDS.length !== EXPECTED_TOTAL) {
  throw new Error(
    `[biRowFields] 字段数应为 ${EXPECTED_TOTAL}，实际 ${BI_ROW_FIELDS.length} —— 与 productFields.ts 对齐一下`,
  )
}
if (textCount !== EXPECTED_TEXT || numberCount !== EXPECTED_NUMBER) {
  throw new Error(
    `[biRowFields] 类型分布应为 text ${EXPECTED_TEXT} / number ${EXPECTED_NUMBER}，`
    + `实际 text ${textCount} / number ${numberCount} —— 有列的类型写错了`,
  )
}
if (new Set(BI_ROW_FIELDS.map(f => f.key)).size !== EXPECTED_TOTAL) {
  throw new Error('[biRowFields] 中文字段名有重复')
}
if (new Set(BI_ROW_FIELDS.map(f => f.field)).size !== EXPECTED_TOTAL) {
  throw new Error('[biRowFields] PB 列名有重复')
}
if (!BI_ROW_FIELDS.every(f => /^[a-z][a-z0-9_]*$/.test(f.field))) {
  throw new Error(
    '[biRowFields] 有列名不符合 PB 的命名规则（小写字母开头，只含小写字母数字下划线）: '
    + BI_ROW_FIELDS.filter(f => !/^[a-z][a-z0-9_]*$/.test(f.field)).map(f => f.field).join(', '),
  )
}
if (BI_ROW_FIELDS.some(f => BI_ROW_META_FIELDS.includes(f.field as never))) {
  throw new Error('[biRowFields] 有列名和同步用的元字段重名')
}

// 与 productFields.ts 对齐：两边的中文 key 必须**完全一致**（数量、名称、顺序）。
// 这是最关键的一条 —— 漏一列不会报任何错，只会让那一列永远是空的；
// 多一列则永远写不进值。顺序也校验，方便两份清单对照着看。
const declaredKeys = PRODUCT_FIELDS.map(f => f.key)
if (declaredKeys.length !== BI_ROW_FIELDS.length) {
  throw new Error(
    `[biRowFields] 与 productFields.ts 字段数不一致：`
    + `productFields ${declaredKeys.length} 个，本映射 ${BI_ROW_FIELDS.length} 个`,
  )
}
const badIndex = declaredKeys.findIndex((k, i) => k !== BI_ROW_FIELDS[i]?.key)
if (badIndex !== -1) {
  throw new Error(
    `[biRowFields] 与 productFields.ts 第 ${badIndex + 1} 个字段对不上：`
    + `productFields 是「${declaredKeys[badIndex]}」，本映射是「${BI_ROW_FIELDS[badIndex]?.key}」`,
  )
}
const titleMismatch = BI_ROW_FIELDS.filter(
  f => PRODUCT_FIELDS.find(x => x.key === f.key)?.title !== f.title,
)
if (titleMismatch.length > 0) {
  // 标题只是文档信息，不一致不拦，提示一下即可
  console.warn(
    '[biRowFields] 界面标题与 productFields.ts 不一致（不影响建表）: '
    + titleMismatch.map(f => `${f.key}（本表「${f.title}」）`).join(', '),
  )
}

// ==================== PB 记录 → 界面用的产品对象 ====================
// 界面上（ProductInfoCard / 审批页）读的字段是**中文 key**（product['图片链接'] …），
// 而 PB 的 bi_rows 存的是 snake_case 列 + data（整行快照，中文 key）。
// 下面两个函数负责把 PB 记录还原成界面认识的形状。

/** bi_rows 记录里的元字段（不是业务列，不要出现在产品对象里） */
const PB_META = ['id', 'component_id', 'sync_key', 'data', 'fetched_at', 'created', 'updated', 'collectionId', 'collectionName']

/**
 * 把 PB 的 bi_rows 记录（snake_case 列）还原成中文 key 的对象。
 * 只映射映射表里声明过的列 —— 元字段（id / sync_key / fetched_at …）会被丢掉。
 */
export function pbRowToProduct (row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of BI_ROW_FIELDS) {
    out[f.key] = row[f.field] ?? ''
  }
  return out
}

/**
 * 统一入口：不管数据来自哪里，都返回「中文 key 的产品对象」。
 *
 * 三种情况（按优先级）：
 *   1) 带了 `data` 对象 → 是 PB 记录且取了整行快照，直接用 data（最完整）；
 *   2) 有 snake_case 业务列、且**一个中文 key 都没有** → 是 PB 记录但只取了列，走 pbRowToProduct；
 *   3) 其他（BI 直连的行 / mock）→ 原样返回。
 *
 * 判据 2 之所以要求「中文 key 一个都没有」，是为了避免误判：
 * 一旦对象里已经出现中文 key，说明它本来就是界面形状，再映射一次反而会把它清空。
 */
export function toProductView (row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!row || typeof row !== 'object') {
    return {}
  }

  const hasData = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
  const view = hasData
    ? (row.data as Record<string, unknown>)
    : BI_ROW_FIELDS.some(f => f.key in row)
      ? row
      : BI_ROW_FIELDS.some(f => f.field in row)
        ? pbRowToProduct(row)
        : row

  // 派生指标最后注入：它们是**算出来的**，BI 里没有这两列（见 deriveFlowFields 的说明）。
  // 放在这里而不是让各页面自己算 —— 审批详情、产品卡片、流程条件求值都走这个入口，
  // 只有一处实现才能保证「界面上看到的毛利率」和「条件里比较的毛利率」是同一个数。
  return { ...view, ...deriveFlowFields(view) }
}

/* ==================== 派生指标 ==================== */

/**
 * 派生指标的 key：界面上 row['毛利率(SKU3月前)'] 就是用这个取的。
 *
 * ⚠️ 沿革（避免后来人踩）：曾经这两个指标都靠"算"——
 *    毛利率 = 毛利/回款；海外仓库存金额 = 海外仓在仓 × 单价（单价还写死过 60 占位）。
 *    业务方 2026-09 明确口径：白板条件里的「海外仓库存金额」「呆滞金额」
 *    **就是「总库存金额」这一列本身**，不折算、不乘数量。所以：
 *      - 不再有单价概念（`unitPriceOf` / `OVERSEAS_UNIT_PRICE` 已删除）；
 *      - `海外仓库存金额` 这个 key 保留，值与「总库存金额」一致 ——
 *        这样已经按旧 key 配好的条件仍然有效，不用逐个回改。
 *    另外它**不改名**：白板与已生成模板里写的都是「海外仓库存金额」。
 */
export const DERIVED_KEYS = {
  /** SKU3月前毛利润 / SKU3月前回款 × 100（百分数）——这个是算出来的 */
  grossMargin: '毛利率(SKU3月前)',
  /** 取值 = 「总库存金额」（业务方口径，见上） */
  overseasAmount: '海外仓库存金额',
} as const

/** 宽松取数：数字、'1,234' 这类千分位串都认；取不到返回 null（不是 0） */
function numOf (v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null
  }
  if (typeof v !== 'string') {
    return null
  }
  const s = v.replace(/,/g, '').trim()
  if (!s) {
    return null
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * 计算派生指标（毛利率；以及"海外仓库存金额"这个 key —— 它现在就是总库存金额）。
 *
 * 为什么**算**而不是往 bi_rows 加数据库列：
 *   1) 毛利率不是 BI 给的，是已有列的算术结果 —— 加列就必须让同步侧一起写，
 *      而同步目前因 BI 组件 id 失效跑不通 → 加出来的列永远是空的，反而不能用；
 *   2) 口径会变（这次「海外仓库存金额」就从"在仓×单价"改成了直接取总库存金额）
 *      → 当场生效，不必回填历史数据；
 *   3) 界面上看到的与条件里比较的必须是**同一个数**（展示与求值共用这一个入口）。
 * 若将来需要**按这两列做服务端筛选 / 排序**，再考虑落库成列（那时再写迁移）。
 *
 * 取不到值一律返回 null 而不是 0：`evalCondition` 把 null/undefined 视为「不命中」，
 * 于是「毛利率 > 0」在数据缺失时不会误判为成立 —— 未知不该被当成「大于 0」。
 */
export function deriveFlowFields (row: Record<string, unknown>): Record<string, unknown> {
  const profit = numOf(row['SKU3月前毛利润'])
  const refund = numOf(row['SKU3月前回款'])

  const margin = profit === null || refund === null
    ? null
    : refund === 0
    // 回款为 0：毛利也是 0 → 毛利率记 0；毛利非 0 → 分母没有意义，记 null（无法计算）
      ? (profit === 0 ? 0 : null)
      : Math.round((profit / refund) * 10_000) / 100

  // ⚠️ 口径变更（业务方 2026-09）：白板条件里的「海外仓库存金额」「呆滞金额」
  //    **就是总库存金额本身**，不需要再用单价折算 —— 所以这里直接取该列，
  //    不再乘「海外仓在仓」。留着这个 key 是为了让已经配好的条件继续可用。
  const amount = numOf(row['总库存金额'])

  return {
    [DERIVED_KEYS.grossMargin]: margin,
    [DERIVED_KEYS.overseasAmount]: amount === null ? null : amount,
  }
}

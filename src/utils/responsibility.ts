/**
 * 呆滞库存责任划分规则：**二级原因 → 各部门承担比率**。
 *
 * 数据源自《全渠道呆滞库存管理制度-责任归属与标准》那张表（运营类 / 库存管理类 /
 * 产品侵权类 / 开发类 / 供应链类 / 外部环境类 6 大类，10 个责任部门）。
 *
 * 两个来源，与「仓库清单」（utils/warehouse）完全同一套范式：
 *   1. **默认值**：本文件里人工维护的 DEFAULT_RESPONSIBILITY_ROWS —— PB 一条记录都没有时用它；
 *   2. **维护值**：在「角色设置 → 责任划分」里修改的那份（PocketBase `responsibility_rules` 表）。
 *
 * ⚠️ 合并口径是**二选一**（与仓库同款，不是逐行覆盖）：责任规则要能新增/删除，
 *    逐行合并表达不了"删掉某一条"；PB 里有记录就完全以它为准，「恢复默认」= 清空 PB 表。
 *
 * 比率语义（跟制度表对齐，**不要**强制每行合计 = 1）：
 *   · 多数行是"拆分比率"（如 运营/销售 0.6 + 开发 0.4）；
 *   · 少数行是"按归属部门各担 100%"（如 产品质量问题：开发/研发/合规/采购/工厂各 1）——
 *     问题最终定在哪个部门头上，那个部门承担 100%，多格同为 1 是业务上的正常形态。
 *
 * 本模块刻意保持**纯**（不碰 PocketBase）；读写那张表在 `utils/collection.ts`
 * （`loadResponsibilities` / `saveResponsibilities` / `resetResponsibilities`）。
 */

/** 责任部门清单（与制度表的 10 列一一对应，顺序即表格列顺序） */
export const RESPONSIBILITY_DEPTS = [
  '公司',
  '运营/销售',
  '开发',
  '研发',
  '合规管理',
  '设计部',
  'PMC',
  '采购部',
  '物流部',
  '工厂',
] as const

export type ResponsibilityDept = (typeof RESPONSIBILITY_DEPTS)[number]

/** 一条责任划分规则：ratios 只存**有比率**的部门（缺席 = 该部门不承担） */
export interface ResponsibilityRow {
  /** 二级原因（如「产品侵权-发明专利侵权」） */
  reason: string
  /** 原因类别（运营类 / 库存管理类 / …；新增规则时可选可填） */
  category: string
  /** 部门 → 承担比率（0~1；0 与缺席同义：不承担） */
  ratios: Partial<Record<ResponsibilityDept, number>>
}

/**
 * 默认清单（《全渠道呆滞库存管理制度-责任归属与标准》Sheet1 的 24 条规则；
 * 顺序与制度表一致）。改动这里即刻生效，无需迁移。
 *
 * 注意：制度表里「产品侵权-外观专利侵权（产品合规中心承接）」有**两行**（0.3/0.7 与
 * 0.6/0.4 两套比率，对应不同承接场景），所以身份键不能只用 reason 文本 ——
 * 本表靠整表替换落库（见 saveResponsibilities），不做逐行 diff，同名行天然共存。
 */
export const DEFAULT_RESPONSIBILITY_ROWS: ResponsibilityRow[] = [
  { reason: '市场需求分析不足/运营策略不当', category: '运营类', ratios: { '运营/销售': 0.6, '开发': 0.4 } },
  { reason: '运营-其他因素', category: '运营类', ratios: { '运营/销售': 1 } },
  { reason: '销量预测偏差', category: '库存管理类', ratios: { '运营/销售': 0.6, 'PMC': 0.4 } },
  { reason: '库存尾数弃置', category: '库存管理类', ratios: { '公司': 1 } },
  { reason: '库存保管不善', category: '库存管理类', ratios: { '工厂': 1 } },
  { reason: '产品侵权-外观专利侵权（产品员自查）', category: '产品侵权类', ratios: { '开发': 0.8, '合规管理': 0.2 } },
  { reason: '产品侵权-外观专利侵权（产品合规中心承接）', category: '产品侵权类', ratios: { '开发': 0.3, '合规管理': 0.7 } },
  { reason: '产品侵权-外观专利侵权（产品合规中心承接）', category: '产品侵权类', ratios: { '开发': 0.6, '合规管理': 0.4 } },
  { reason: '产品侵权-发明专利侵权', category: '产品侵权类', ratios: { '公司': 0.4, '开发': 0.2, '研发': 0.2, '合规管理': 0.2 } },
  { reason: '产品侵权-常规技术/常规外观竞对恶意专利抢注', category: '产品侵权类', ratios: { '公司': 0.7, '合规管理': 0.3 } },
  { reason: '产品侵权-专利公示时间晚于检索时间', category: '产品侵权类', ratios: { '公司': 0.6, '开发': 0.2, '合规管理': 0.2 } },
  { reason: '产品侵权-其他', category: '产品侵权类', ratios: { '开发': 0.3, '合规管理': 0.7 } },
  { reason: '产品侵权-版权', category: '产品侵权类', ratios: { '设计部': 1 } },
  { reason: '产品质量问题', category: '开发类', ratios: { '开发': 1, '研发': 1, '合规管理': 1, '采购部': 1, '工厂': 1 } },
  { reason: '包装及设计问题', category: '开发类', ratios: { '开发': 1, '合规管理': 1, '采购部': 1, '工厂': 1 } },
  { reason: '开发/研发-其他因素', category: '开发类', ratios: { '开发': 1, '研发': 1 } },
  { reason: '供应链-起订量限制', category: '供应链类', ratios: { '运营/销售': 0.55, '开发': 0.15, '采购部': 0.15, '工厂': 0.15 } },
  { reason: '供应链-采购因素', category: '供应链类', ratios: { '采购部': 1 } },
  { reason: '供应链-物流因素', category: '供应链类', ratios: { '物流部': 1 } },
  { reason: '政策与法规变化', category: '外部环境类', ratios: { '公司': 1 } },
  { reason: '自然灾害与突发事件导致产品不可售', category: '外部环境类', ratios: { '公司': 1 } },
  { reason: '平台限制、政策调整等', category: '外部环境类', ratios: { '公司': 1 } },
  { reason: '历史遗留库存', category: '外部环境类', ratios: { '公司': 1 } },
  { reason: '其他客观因素', category: '外部环境类', ratios: { '公司': 1 } },
]

/** 原因类别的候选：默认清单里出现过的（编辑弹窗的 combobox 直接可输新的） */
export function responsibilityCategories (
  rows: readonly ResponsibilityRow[] = DEFAULT_RESPONSIBILITY_ROWS,
): string[] {
  return [...new Set(rows.map(r => r.category).filter(Boolean))]
}

/** 比率落库形状：合法数字且 > 0 才保留（0 与缺席同义：不承担），并钳制到 0~1 */
function cleanRatio (v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  if (n <= 0) return undefined
  return Math.min(1, n)
}

/** 干净的一行：两侧空白去掉、只留合法比率 */
export function cleanResponsibilityRow (row: ResponsibilityRow): ResponsibilityRow {
  const ratios: Partial<Record<ResponsibilityDept, number>> = {}
  for (const dept of RESPONSIBILITY_DEPTS) {
    const v = cleanRatio(row.ratios?.[dept])
    if (v !== undefined) ratios[dept] = v
  }
  return { reason: String(row.reason ?? '').trim(), category: String(row.category ?? '').trim(), ratios }
}

/** 整行比率合计（表格编辑弹窗里给一行小字用；"按归属各担 100%"的行会 > 1，属正常） */
export function responsibilitySum (row: ResponsibilityRow): number {
  return RESPONSIBILITY_DEPTS.reduce((sum, dept) => sum + (row.ratios[dept] ?? 0), 0)
}

/** 比率 → 展示文案：0.6 → '60%'、0.15 → '15%'；没有比率返回 '—' */
export function formatRatio (v: unknown): string {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—'
  // 先四舍五入到 0.1% 再去尾零：避开 0.55*100 = 55.000…01 这类浮点尾巴
  return `${String(Math.round(n * 1000) / 10)}%`
}

/**
 * 清洗一份清单：去空白、丢掉没填原因的行。
 *
 * ⚠️ 与 `resolveResponsibilities` 的区别同仓库那对函数：这里**不看**默认值，
 *    "把清单存回去"用本函数 —— 传空数组的语义是**清空**，不能被默认值又填满。
 */
export function normalizeResponsibilities (rows: readonly ResponsibilityRow[]): ResponsibilityRow[] {
  const out: ResponsibilityRow[] = []
  for (const raw of rows ?? []) {
    const row = cleanResponsibilityRow(raw)
    if (!row.reason) continue
    out.push(row)
  }
  return out
}

/**
 * 取本次要用的清单：PB 里有记录就用 PB 的（清洗过），否则回落到默认值。
 *
 * @param overrides PB `responsibility_rules` 表里的记录；空数组/undefined = 没维护过
 */
export function resolveResponsibilities (overrides?: readonly ResponsibilityRow[] | null): ResponsibilityRow[] {
  const list = normalizeResponsibilities(overrides ?? [])
  return list.length > 0 ? list : DEFAULT_RESPONSIBILITY_ROWS.map(r => ({ ...r, ratios: { ...r.ratios } }))
}

/**
 * 校验一行能不能存；返回错误文案，null = 没问题。
 * 合计不校验：拆分比率（合计 1）与"按归属各担 100%"（合计 > 1）都是合法形态。
 */
export function findBadResponsibility (row: ResponsibilityRow): string | null {
  const clean = cleanResponsibilityRow(row)
  if (!clean.reason) {
    return '请填写「二级原因」'
  }
  if (Object.keys(clean.ratios).length === 0) {
    return '至少给一个部门填写承担比率'
  }
  return null
}

import type { ApprovalFlow, ConditionExpr, RotationSpec } from '@/types/approval'
import { matchBranch } from '@/types/approval'
import pb from '@/pocketbase.ts'
import { toFlowContext } from '@/utils/approvalFlow'
import { collectRotations, ROTATION_DEFAULTS, type RotationGroup } from '@/utils/approvalRotation'
import { BI_ROW_FIELD_BY_KEY } from '@/utils/biRowFields'

/**
 * 「按组轮询」的**取数**：查出"符合条件的组，按销售数量排好序"。
 *
 * ⚠️ 这里是整套机制里**唯一带业务口径**的地方（其余部分是纯逻辑，见 utils/approvalRotation.ts）。
 * 当前口径（按最可能的来源实现，口径不同只改这一个文件）：
 *
 *   1. **统计范围**：与该数据行 `scopeFrom`（默认「SKU」）相同的**所有 bi_rows 行**
 *      —— 同一个 SKU 在多个组/店铺各有一行，正好是"这条数据涉及哪几个组"；
 *   2. **按组聚合**：同一组命中多行时，把 `orderFrom`（默认「SKU近一年月平均销量」）
 *      按 `aggregate`（默认求和）汇总 —— 一个组的总销量；
 *   3. **筛选**：`where` 作用在**该组汇总后**的值上（上下文里同时有该组第一行的业务字段；
 *      排序列是汇总值，另有别名「销量」，所以「销量 > 0」这类写法能直接用）；
 *   4. **排序**：按汇总值 `order`（默认降序）—— 销量高的组先办。
 *
 * 取不到数不抛错、返回空集合：交给轮询配置里的 `whenEmpty` 决定是跳过这一环还是让建单失败
 * （口径与 approvalRoles"解析不出来就判建单失败"一致 —— 区别在于**这里给业务留了选择**，
 * 因为"这单数据一个组都没命中"很可能是正常的，硬失败会让这类数据永远建不出单）。
 */

/** 宽松取数：'1,234' / 1234 / 1234.5 都认；取不到返回 null（不是 0） */
function toNum (v: unknown): number | null {
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
 * `where` 的求值：包成一条只有该条件的分支交给 matchBranch ——
 * 复用运行时**同一套**条件求值（含条件组、`@字段` 引用、result 特殊口径），
 * 不在这里另写一份比较逻辑（两份迟早不一致）。
 */
function passesWhere (where: ConditionExpr | undefined, form: Record<string, unknown>): boolean {
  if (!where) {
    return true
  }
  return !!matchBranch([{ id: '__rotation_probe__', name: '轮询筛选', conditions: [where], steps: [] }], form)
}

/** 查出一个轮询环节要依次流转的组（已排好序） */
export async function resolveRotationGroups (
  spec: RotationSpec,
  ctx: Record<string, unknown>,
): Promise<RotationGroup[]> {
  const groupKey = (spec.groupFrom ?? '').trim() || '组别'
  const scopeKey = (spec.scopeFrom ?? '').trim() || ROTATION_DEFAULTS.scopeFrom
  const orderKey = (spec.orderFrom ?? '').trim() || ROTATION_DEFAULTS.orderFrom
  const aggregate = spec.aggregate ?? ROTATION_DEFAULTS.aggregate
  const desc = (spec.order ?? ROTATION_DEFAULTS.order) === 'desc'

  const scopeValue = ctx[scopeKey]
  if (scopeValue === undefined || scopeValue === null || String(scopeValue).trim() === '') {
    console.warn(`[rotation] 数据里没有「${scopeKey}」，圈不出统计范围，按"没有组"处理`)
    return []
  }
  const scopeField = BI_ROW_FIELD_BY_KEY[scopeKey]?.field
  if (!scopeField) {
    // 字段名写错属于**配置错误**，不是数据问题：报出来（会被当成建单失败），别静默当成"没有组"
    throw new Error(`按组轮询：不认识的字段「${scopeKey}」（统计范围），请检查模板配置`)
  }

  // 同一范围的行业务量很小（同一个 SKU 通常几行），一次取回即可
  const rows = await pb.collection('bi_rows').getFullList<Record<string, unknown>>({
    filter: pb.filter(`${scopeField} = {:v}`, { v: scopeValue }),
  })

  /** 组名 → 该组各行（已转成条件求值上下文） */
  const byGroup = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    const form = toFlowContext(row)
    const name = String(form[groupKey] ?? '').trim()
    if (!name) {
      continue
    }
    const list = byGroup.get(name)
    if (list) {
      list.push(form)
    } else {
      byGroup.set(name, [form])
    }
  }

  const out: RotationGroup[] = []
  for (const [name, forms] of byGroup) {
    const nums = forms.map(f => toNum(f[orderKey])).filter((n): n is number => n !== null)
    // 排序列一个数都没有 → 记 0（不参与"销量 > 0"这类筛选，排序时也排最后）
    const sales = nums.length === 0
      ? 0
      : (aggregate === 'max' ? Math.max(...nums) : nums.reduce((a, b) => a + b, 0))

    const form: Record<string, unknown> = {
      ...forms[0],
      // 组名覆盖掉行里的原值：这里的上下文代表"这个组"，而不是"组里的某一行的那个组"
      [groupKey]: name,
      [orderKey]: sales,
      // 别名：条件是写给人看的，「销量 > 0」比抄一长串列名清楚
      销量: sales,
    }
    if (!passesWhere(spec.where, form)) {
      continue
    }
    out.push({ name, sortValue: sales })
  }

  out.sort((a, b) => (desc
    ? (b.sortValue ?? 0) - (a.sortValue ?? 0)
    : (a.sortValue ?? 0) - (b.sortValue ?? 0)))
  return out
}

/**
 * 把流程里所有轮询配置各查一次（建单路径调用）。
 * key = 配了轮询的环节 id，与 `expandRotations` 的入参对应。
 */
export async function resolveAllRotationGroups (
  flow: ApprovalFlow,
  ctx: Record<string, unknown>,
): Promise<Record<string, RotationGroup[]>> {
  const out: Record<string, RotationGroup[]> = {}
  for (const { id, spec } of collectRotations(flow)) {
    out[id] = await resolveRotationGroups(spec, ctx)
  }
  return out
}

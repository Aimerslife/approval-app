import type { ApprovalFlow, ConditionExpr, RotationSpec } from '@/types/approval'
import { matchBranch } from '@/types/approval'
import pb from '@/pocketbase.ts'
import { toFlowContext } from '@/utils/approvalFlow'
import { collectRotations, ROTATION_DEFAULTS, rotationLabel, type RotationGroup } from '@/utils/approvalRotation'
import { BI_ROW_FIELD_BY_KEY } from '@/utils/biRowFields'
import { sameTeamGroups } from '@/utils/groupApprovers'
import { PB_REQUEST_KEY } from '@/utils/pbRequestKeys'
import { bindFilterParams, translateFilterFields } from '@/utils/rotationQuery'

/**
 * 「按组轮询」的**取数**：查出"符合条件的组，按销售数量排好序"。
 *
 * ⚠️ 这里是整套机制里**唯一带业务口径**的地方（其余部分是纯逻辑，见 utils/approvalRotation.ts）。
 * 求值顺序（口径不同只改这一个文件）：
 *
 *   1. **取哪些行**：配了 `rowFilter` 就用它（PB filter，占位符从**当前审批单**取值，
 *      见 utils/rotationQuery.ts）；没配则沿用旧口径 —— `scopeFrom`（默认「SKU」）那一列
 *      等于当前单的该字段。同一个 SKU 在多个组/店铺各有一行，正好是"这条数据涉及哪几个组"；
 *   2. **只看同团队**（可选）：`sameTeam` 时用 utils/organazation.ts 的「团队→组别」映射
 *      过滤掉别的团队的组（它不是数据列，所以只能在这一步做，写不进 filter）；
 *   3. **按组聚合**：同一组命中多行时，把 `orderFrom`（默认「SKU近一年月平均销量」）
 *      按 `aggregate`（默认求和）汇总 —— 一个组的总销量；
 *      「这个组**存在**这样的行」在这里自然成立：一行都没命中的组根本不会出现；
 *   4. **筛选**：`where` 作用在**该组汇总后**的值上（上下文里同时有该组第一行的业务字段；
 *      排序列是汇总值，另有别名「销量」与「命中行数」，所以「销量 > 0」「命中行数 > 1」都能写）；
 *   5. **排序**：按汇总值 `order`（默认降序）—— 销量高的组先办。
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

/** 组别名比较用的归一：数据里常有多余空格（口径同 groupApprovers / approvalRoles 的 squash） */
function squash (s: string): string {
  return s.replace(/\s+/g, '')
}

/**
 * 本次取数的「行条件」。返回 null 表示"圈不出范围，按没有组处理"（调用方返回空集合）。
 *
 * 两条路：配了 `rowFilter` 就用它（占位符从当前单绑定）；没配则沿用旧口径
 * —— `scopeFrom` 那一列等于当前单的该字段（**已保存的模板行为逐字节不变**）。
 */
function buildRowFilter (
  spec: RotationSpec,
  scopeKey: string,
  ctx: Record<string, unknown>,
  label: string,
): string | null {
  const raw = (spec.rowFilter ?? '').trim()
  if (raw) {
    try {
      /*
       * 两件事，顺序不能反：
       *   ① `translateFilterFields` 把**中文列名**换成 PB 的 ASCII 列名
       *      —— 不换的话服务端直接 400（实测：「主MODEL」不是 PB 的列，它是 data 里的键）；
       *   ② `bindFilterParams` 把 `{:占位符}` 绑成当前单的值（原始写法里的是中文名，
       *      占位符**不能**翻译，否则参数名对不上）。
       */
      return pb.filter(translateFilterFields(raw), bindFilterParams(raw, ctx))
    } catch (e) {
      // 绑定失败是**配置/数据问题**（列名写错、该列没值），不是"没有符合条件的组"：
      // 报出来判这一条建单失败，别静默当成空集合
      throw new Error(`${label}：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const scopeValue = ctx[scopeKey]
  if (scopeValue === undefined || scopeValue === null || String(scopeValue).trim() === '') {
    console.warn(`[rotation] 数据里没有「${scopeKey}」，圈不出统计范围，按"没有组"处理`)
    return null
  }
  const scopeField = BI_ROW_FIELD_BY_KEY[scopeKey]?.field
  if (!scopeField) {
    // 字段名写错属于**配置错误**，不是数据问题：报出来（会被当成建单失败），别静默当成"没有组"
    throw new Error(`按组轮询：不认识的字段「${scopeKey}」（统计范围），请检查模板配置`)
  }
  return pb.filter(`${scopeField} = {:v}`, { v: scopeValue })
}

/**
 * 「只看同团队」的组别白名单。返回 null = 没开这个开关。
 *
 * 团队→组别 的映射维护在 utils/organazation.ts，**不是数据列**，
 * 所以这一步只能在拿回行之后做，写不进 PB filter（见 RotationSpec.sameTeam）。
 */
function buildTeamWhitelist (
  spec: RotationSpec,
  groupKey: string,
  ctx: Record<string, unknown>,
  label: string,
): Set<string> | null {
  if (!spec.sameTeam) {
    return null
  }
  const selfGroup = String(ctx[groupKey] ?? '').trim()
  if (!selfGroup) {
    throw new Error(`${label}：配了「只看同团队的组别」，但当前数据里「${groupKey}」这一列没有值`)
  }
  const list = sameTeamGroups(selfGroup)
  if (list.length === 0) {
    // 维护漏项（organazation.ts 里没这个组别）——报错，别静默变成"没有组"
    throw new Error(`${label}：查不到组别「${selfGroup}」属于哪个团队（见 utils/organazation.ts 的 parent/group）`)
  }
  return new Set(list.map(squash))
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
  // 报错时带上环节名：一个模板可能有好几个轮询环节，不写名字不知道是哪个配错了
  const label = rotationLabel(spec)

  const filter = buildRowFilter(spec, scopeKey, ctx, label)
  if (filter === null) {
    return []
  }
  const allowGroups = buildTeamWhitelist(spec, groupKey, ctx, label)

  /*
   * 一次取回符合条件的行。行数完全由行条件决定：
   *  · 旧口径（同一个 SKU）通常只有几行；
   *  · 行条件写成「主MODEL + 同团队」时可能几十到几百行 —— 过滤已下推到服务端，
   *    不要拿回数据再筛（那等于把整表拉回来）。
   */
  const rows = await pb.collection('bi_rows').getFullList<Record<string, unknown>>({
    filter,
    requestKey: PB_REQUEST_KEY.biRowsRotation,
  })

  /** 组名 → 该组各行（已转成条件求值上下文） */
  const byGroup = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    const form = toFlowContext(row)
    const name = String(form[groupKey] ?? '').trim()
    if (!name) {
      continue
    }
    // 「只看同团队」：别的团队的组别在这一步排除
    if (allowGroups && !allowGroups.has(squash(name))) {
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
      /*
       * 该组**命中了几行**（行条件筛过之后）。有了它，「这个组是否存在这样的行」在组级
       * 条件里也能显式写出来（如「命中行数 >= 2」），排查时也能一眼看出是几行撑起这个组。
       */
      命中行数: forms.length,
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

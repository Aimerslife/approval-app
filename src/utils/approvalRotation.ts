import type {
  ApprovalBranch,
  ApprovalChainItem,
  ApprovalFlow,
  ApprovalFlowNode,
  ApprovalFlowStep,
  RotationSpec,
} from '../types/approval'
import { BI_ROW_FIELD_BY_KEY, BI_ROW_KEY_BY_FIELD, DERIVED_KEYS } from './biRowFields'
import { extractFilterParams, filterFieldNames } from './rotationQuery'

/**
 * 「按组轮询」的**建单期展开**（纯函数：不碰网络、不碰 PocketBase，能被 tsx 直接断言）。
 *
 * ## 为什么要展开，而不是运行期循环
 *
 * 需求是"依据条件筛出几个组，按销售数量依次流转，直到所有满足条件的组都办完" ——
 * 环节数由**数据**决定，模板里画不出来。两条路：
 *
 *  · **建单时展开**（本文件）：那一刻数据已经冻结成 context，能算出组列表和顺序，
 *    于是把这一环替换成 N 个**普通审批环节**写进本单的 flow 快照。
 *    之后 `rebuildChain(flow, decisions, context)` 一行都不用改 —— 驳回重审、催办（服务端按
 *    status=0 找当前环的人）、时间线、通知、我的待办全部照旧可用。
 *
 *  · 运行期循环：每次办完再去算"下一个是谁"。会破坏"flow 是静态快照"这条不变量：
 *    同一份 decisions 在不同时间重算出不同链路（历史单漂移），而且模板里也画不出环 ——
 *    `graphToFlowFrom` 明确拒绝"节点被重复经过"，保存时就报「流程中检测到环」。
 *
 * 附带好处：展开结果与业务数据一起被快照，**之后再改数据不影响在途单**（与现有口径一致）。
 *
 * ## 展开后每环的人怎么来
 *
 * 展开出来的成员是 `role: { kind: 'dept_leader', dept: 组名 }`，交给**现有**的角色解析
 * （`resolveFlowRoles`）填真人 —— 包含"该组没设负责人就往上级找"那套口径，
 * 所以这里不需要、也不应该自己去找人。
 */

/** 一个要轮询到的组（由取数侧查好并**排好序**，见 utils/rotationData.ts） */
export interface RotationGroup {
  /** 组名：既用来找该组负责人，也会写进环节名/成员部门，让人看得出轮到谁了 */
  name: string
  /** 排序依据的汇总值（如销量）；写进环节名，能看出"为什么它在前面" */
  sortValue?: number
}

export interface RotationExpansion {
  /** 展开后的流程（原对象不改） */
  flow: ApprovalFlow
  /** 每个轮询环节展开成了几环（0 = 一个组都没命中被跳过）；用于建单日志与排查 */
  expanded: Record<string, number>
  /** 展开不了的地方。**非空即应判该条建单失败**，不要静默继续 */
  issues: string[]
}

/** 缺省口径：一个 SKU 的多行里、各组按近一年月均销量从高到低依次流转 */
export const ROTATION_DEFAULTS = {
  scopeFrom: 'SKU',
  orderFrom: 'SKU近一年月平均销量',
  order: 'desc' as const,
  aggregate: 'sum' as const,
  limit: 20,
  whenEmpty: 'skip' as const,
}

/** 轮询配置的可读描述（报错与日志用） */
export function rotationLabel (spec: RotationSpec): string {
  const order = spec.orderFrom?.trim() || ROTATION_DEFAULTS.orderFrom
  return `按组轮询（组名取「${spec.groupFrom}」，按「${order}」排序）`
}

/**
 * 收集流程里**可展开**的轮询配置。
 *
 * 只认审批环节（顶层审批节点 / 分支里的步骤）—— 编辑器也只允许配在审批节点上。
 * 提醒环节、分支的直属成员（`branch.members`）配了不在这里收集：
 * 那两处展开语义不明确，宁可"配了不生效"也不要"悄悄按别的意思展开"。
 * （编辑器已把入口限制在审批节点上，正常配不出这两种情况。）
 */
export function collectRotations (flow: ApprovalFlow): Array<{ id: string, label: string, spec: RotationSpec }> {
  const out: Array<{ id: string, label: string, spec: RotationSpec }> = []
  const note = (id: string, members?: ApprovalChainItem[]) => {
    for (const m of members ?? []) {
      if (m.rotation) {
        out.push({ id, label: rotationLabel(m.rotation), spec: m.rotation })
      }
    }
  }
  const walkSteps = (steps?: ApprovalFlowStep[]) => {
    for (const s of steps ?? []) {
      if (s.type === 'branch') {
        for (const b of s.branches ?? []) {
          note(b.id, b.members)
          walkSteps(b.steps)
        }
        continue
      }
      note(s.id, s.members)
      walkSteps(s.steps)
    }
  }
  for (const node of flow) {
    if (node.type === 'approval') {
      note(node.id, node.nodes)
      continue
    }
    if (node.type === 'notify') {
      continue
    }
    for (const b of node.branches) {
      note(b.id, b.members)
      walkSteps(b.steps)
    }
  }
  return out
}

/** 流程里有没有轮询（没有就不必去查数） */
export function flowHasRotation (flow: ApprovalFlow): boolean {
  return collectRotations(flow).length > 0
}

/* ==================== 保存期校验 ==================== */

/**
 * 「行条件」里**不能**引用的字段。
 *
 * 这几个恰恰是条件编辑器里会给出的候选（上一环节结论 / 办理时填的值，见
 * createStream.vue 的 FIELD_OPTIONS），所以很容易被顺手写进行条件 ——
 * 但它们要到**办理时**才有值，而行条件在**建单那一刻**就要算，绑不出值来。
 * 那种写法建单时才会炸（报"这一列没有值"），在这里提前拦下更省事。
 */
const RUNTIME_ONLY_FIELDS = new Set([
  'result',
  'amount',
  'qty',
  'reason_belong',
  'second_reason',
  'remark',
])

/**
 * 组级上下文里的别名：只在**该组汇总之后**的 `where` 里有效，
 * 行条件跑在分组之前，引用不到（也不会命中）。
 */
const GROUP_ALIAS_FIELDS = new Set(['销量', '命中行数'])

/** 可以当作行条件占位符的字段：65 个数据列 + 两个派生指标 */
const BINDABLE_FIELDS = new Set<string>([
  ...Object.keys(BI_ROW_FIELD_BY_KEY),
  DERIVED_KEYS.grossMargin,
  DERIVED_KEYS.overseasAmount,
])

/**
 * 轮询配置的**保存期**校验。返回错误文案，null = 没问题。
 *
 * 只查"不看数据就能判定"的问题。数据相关的（组别在组织架构里查不到、该列这一行没值）
 * 只能等具体那条数据建单时才报 —— 见 utils/rotationData.ts 的 buildRowFilter/buildTeamWhitelist。
 *
 * 为什么要在这里拦：行条件里写错一个字段名，症状是"这一环没人办/这一条建单失败"，
 * 而配置的人往往在几天后才从别人的报错里知道。
 */
export function findBadRotation (spec: RotationSpec): string | null {
  const label = rotationLabel(spec)
  const raw = (spec.rowFilter ?? '').trim()
  if (!raw) {
    return null
  }
  for (const name of extractFilterParams(raw)) {
    if (GROUP_ALIAS_FIELDS.has(name)) {
      return `${label}：行条件里的「{:${name}}」用不了 —— 「${name}」是该组**汇总之后**才有的别名，行条件跑在分组之前`
    }
    if (RUNTIME_ONLY_FIELDS.has(name)) {
      return `${label}：行条件里的「{:${name}}」取不到值 —— 它是办理时/上一环节才有的字段，而行条件在建单那一刻就要算`
    }
    if (!BINDABLE_FIELDS.has(name)) {
      return `${label}：行条件里的「{:${name}}」不是已知的数据列，请从数据字段里选（写错列名会让条件永远不命中）`
    }
  }

  /*
   * 列名（filter 左边那些）也要查：
   * 写错的症状不是"不命中"，而是**服务端直接 400、这一条建单失败**（实测踩过）——
   * 所以不值得等建单时才发现。
   *
   * ⚠️ 派生指标在这里**不能用**：毛利率 / 海外仓库存金额是取出数据后在 TS 里算的，
   * 数据库里没有这两列，写进 filter 一样会被 400。它们只能用作 `{:占位符}`（值取自当前单）。
   */
  for (const name of filterFieldNames(raw)) {
    if (DERIVED_KEYS.grossMargin === name || DERIVED_KEYS.overseasAmount === name) {
      return `${label}：行条件里的列名「${name}」是派生指标（不落库），只能用成「{:${name}}」取值来比，不能当成数据表的列`
    }
    if (!BINDABLE_FIELDS.has(name) && !(name in BI_ROW_KEY_BY_FIELD)) {
      return `${label}：行条件里的列名「${name}」不是已知的数据列（写错会让服务端直接拒绝这条建单）`
    }
  }
  return null
}

/** 汇总值的展示：整数不带小数，小数最多两位（千分位） */
function formatSortValue (n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString('zh-CN')
    : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

/** 展开后的环节名：把"轮到哪个组、它的销量"写进去，否则时间线上几环长得一模一样 */
function nameWithGroup (name: string | undefined, group?: RotationGroup): string | undefined {
  if (!group) {
    return name
  }
  const tag = group.sortValue === undefined ? group.name : `${group.name} · ${formatSortValue(group.sortValue)}`
  return name ? `${name}（${tag}）` : tag
}

/**
 * 把流程里配了轮询的环节展开成 N 个普通审批环节。
 *
 * @param groups key = 配了轮询的环节 id（顶层审批节点 id / 分支步骤 id），
 *               值 = 该环节要依次流转的组（**已排好序**）。缺 key 视同空数组。
 */
export function expandRotations (
  flow: ApprovalFlow,
  groups: Record<string, RotationGroup[]>,
): RotationExpansion {
  const issues: string[] = []
  const expanded: Record<string, number> = {}
  /** 展开前的环节 id → 展开后的**第一环** id（驳回回退的目标要跟着改，见 mapBranches） */
  const firstOf: Record<string, string> = {}

  /**
   * 把一段成员列表按轮询切成 N 段。
   * 返回值三种：
   *  · `[members]`（长度 1 且内容不变）—— 没有轮询，原样；
   *  · `[]` —— 一个组都没命中且允许跳过：**整环丢弃**；
   *  · `null` —— 展开不了（已在 issues 里写明原因）：调用方原样保留，让建单失败。
   */
  function splitMembers (id: string, members: ApprovalChainItem[]): ApprovalChainItem[][] | null {
    const rotates = members.filter(m => m.rotation)
    if (rotates.length === 0) {
      return [members]
    }
    if (rotates.length > 1) {
      issues.push(`${rotationLabel(rotates[0].rotation!)}：一个环节只能配一个「按组轮询」，请拆到两个环节`)
      return null
    }
    const spec = rotates[0].rotation!
    const label = rotationLabel(spec)
    const rest = members.filter(m => !m.rotation)
    const list = groups[id] ?? []
    const limit = spec.limit ?? ROTATION_DEFAULTS.limit

    if (list.length === 0) {
      if ((spec.whenEmpty ?? ROTATION_DEFAULTS.whenEmpty) === 'fail') {
        issues.push(`${label}：没有符合条件的组（该环节设的是"没有匹配组就让建单失败"）`)
        return null
      }
      expanded[id] = 0
      return []
    }
    if (list.length > limit) {
      issues.push(
        `${label}：符合条件的组有 ${list.length} 个，超过上限 ${limit}`
        + '（不静默截断，否则会漏掉几个组；请收窄条件或调大上限）',
      )
      return null
    }

    expanded[id] = list.length
    return list.map(group => [
      // 同环节里的其它成员（固定的人 / 抄送）**每一环都保留**：它们本来就会签，
      // 展开只是把"轮询那一位"换成了该组负责人，不该把别人悄悄丢掉
      ...rest.map(m => ({ ...m })),
      {
        // 姓名/邮箱留空：由 resolveFlowRoles 按 role.dept 填真人（含"该组没设负责人就往上级找"）
        type: 'manager' as const,
        name: '',
        email: '',
        role: { kind: 'dept_leader' as const, dept: group.name },
      },
    ])
  }

  /** 展开一段"步骤链"，并把每个轮询步骤切成 N 个步骤 */
  function mapSteps (steps: ApprovalFlowStep[] | undefined): ApprovalFlowStep[] {
    const out: ApprovalFlowStep[] = []
    for (const s of steps ?? []) {
      if (s.type === 'branch') {
        out.push({ ...s, branches: mapBranches(s.branches ?? []) })
        continue
      }
      const parts = splitMembers(s.id, s.members ?? [])
      if (parts === null) {
        out.push(s)
        continue
      }
      if (parts.length === 0) {
        continue // 整环跳过（一个组都没命中）
      }
      if (parts.length === 1) {
        out.push(s) // 没配轮询：原样（保证既有模板零改动）
        continue
      }
      firstOf[s.id] = `${s.id}#1`
      const list = groups[s.id] ?? []
      parts.forEach((members, i) => {
        out.push({
          ...s,
          id: `${s.id}#${i + 1}`,
          name: nameWithGroup(s.name, list[i]),
          members,
        })
      })
    }
    return out
  }

  /** 展开分支列表：步骤展开 + **驳回回退目标重映射** */
  function mapBranches (branches: ApprovalBranch[]): ApprovalBranch[] {
    return (branches ?? []).map(b => {
      const target = b.loopBackTo?.stepId
      const retarget = target ? firstOf[target] : undefined
      return {
        ...b,
        // 回退目标指向被展开的环节时，改指它的**第一环**：整个轮询重走一遍。
        // 不重映射的话目标 id 不存在了，驳回会走向一个没有落点的分支（流程卡住且不报错）。
        ...(retarget ? { loopBackTo: { stepId: retarget } } : {}),
        steps: mapSteps(b.steps),
      }
    })
  }

  const nodes: ApprovalFlowNode[] = []
  for (const node of flow) {
    if (node.type === 'approval') {
      const parts = splitMembers(node.id, node.nodes ?? [])
      if (parts === null) {
        nodes.push(node)
        continue
      }
      if (parts.length === 0) {
        continue
      }
      if (parts.length === 1) {
        nodes.push(node)
        continue
      }
      firstOf[node.id] = `${node.id}#1`
      parts.forEach((members, i) => {
        /*
         * 顶层审批节点**没有环节名**（见 ApprovalFlowApprovalNode），所以"哪个组、多少销量"
         * 只能靠成员体现：展开出来的成员是「该组负责人 + role.dept = 组名」，
         * 解析成真人后 `department` 会填成组名，时间线上就是「张三 / 华东组」。
         */
        nodes.push({ id: `${node.id}#${i + 1}`, type: 'approval', nodes: members })
      })
      continue
    }
    if (node.type === 'notify') {
      nodes.push(node)
      continue
    }
    nodes.push({ ...node, branches: mapBranches(node.branches) })
  }

  return { flow: nodes, expanded, issues }
}

import type {
  ApprovalBranch,
  ApprovalChainItem,
  ApprovalFlow,
  ApprovalFlowLoopNode,
  ApprovalFlowNode,
  ApprovalFlowStep,
  RotationSpec,
} from '../types/approval'
import { RECEIVED_QTY_FIELD, REMAINING_QTY_FIELD } from '../types/approval'
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
  /**
   * 成员级的「按组轮询」——**只为旧数据保留**。
   *
   * 2026-09 起组间流转整体搬到画布上的「组间轮询」卡片（见 ApprovalFlowLoopNode），
   * 编辑器入口已移除，新模板不会再产生这个字段；但旧模板与在途单还有，
   * 所以这里照旧收集并展开（删掉会让它们静默地不再按组流转，最难发现）。
   * 详见 types/approval 里 `ApprovalChainItem.rotation` 的废弃说明。
   */
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
      /*
       * 组间轮询卡片（落在分支链里的步骤形态）：它自己就是一处轮询配置。
       * 卡片**内部**不允许再配成员级轮询（展开时会报错），所以不必往里收集。
       */
      if (s.type === 'loop') {
        if (s.rotation) {
          out.push({ id: s.id, label: rotationLabel(s.rotation), spec: s.rotation })
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
    /*
     * 「组间轮询」卡片：它自己的轮询配置，必须在这里露脸 ——
     * 建单期取数就是照这份清单去查"哪些组、怎么排序"的
     * （见 utils/rotationData 的 resolveAllRotationGroups，它按 id 回填 groups）。
     *
     * 卡片**内部**不允许再配成员级轮询（等于在一个环里再套一层轮询，语义没定义），
     * 所以这里不走进内部去收集；真配了会在展开时报错（见 expandRotations 的卡片分支）。
     */
    if (node.type === 'loop') {
      out.push({ id: node.id, label: rotationLabel(node.rotation), spec: node.rotation })
      continue
    }
    if (node.type === 'notify') {
      continue
    }
    /*
     * 「引用模板」：内容在**源模板**里，这里看不到 —— 直接跳过。
     *
     * 不会漏掉源模板里的轮询：建单期是"先展开引用、再收集轮询"（见 utils/expandFlowForOrder
     * 的执行顺序），轮到本函数时引用早被换成了真内容，那时收集到的就是它。
     */
    if (node.type === 'ref') {
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
  // 接收数量的派生字段：由办理流水累计出来（见 types/approval 的 receivedQuantities），
  // 建单那一刻还没有任何流水 → 绑不出值
  RECEIVED_QTY_FIELD,
  REMAINING_QTY_FIELD,
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
   * 注入了「轮完走向」的分支（见 loopEndBranches）：主循环跑完之后要统一重映射一次目标。
   *
   * 为什么要后处理：`firstOf` 是**单趟**填的，而这些分支的目标通常排在卡片**之后**
   * （轮完当然继续往后走），注入那一刻 `firstOf[目标]` 还是空的 —— 目标本身若是轮询卡片，
   * 它展开后会改名，届时 `exitTo` 就会指向一个不存在的环节（运行期直接抛「目标环节不存在」）。
   */
  const injectedExits: Array<{ exitTo: { stepId: string } }> = []

  /**
   * 该环节是否配了轮询。
   *
   * ⚠️ 调用方**不能**拿"切出来只有 1 段"当作"没配轮询"：只命中一个组时切出来也是 1 段，
   *    但那一段的成员是**换过的**「该组负责人（role.dept = 组名）」，与原成员不同。
   *    踩过：单组命中的环节被当成"没配轮询"原样留下，而原成员只有 `rotation`、没有 `role` ——
   *    角色解析器只解析带 role 的成员（见 utils/approvalRoles 的 membersOf），
   *    于是这一环**没人可办**（既不报错、也不进"待解析"告警），条件里的「当前组别」也取不到值。
   */
  function hasRotation (members?: ApprovalChainItem[]): boolean {
    return (members ?? []).some(m => m.rotation)
  }

  /**
   * 把一段成员列表按轮询切成 N 段。
   * 返回值三种：
   *  · `[members]`（长度 1 且内容不变）—— 没有轮询，原样（**用 hasRotation 才算得准**，见上）；
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

  /**
   * 卡片内部有没有配「成员级轮询」。
   *
   * 卡片内部再套一层轮询 = 一个环里还有 N 环，语义与展示都没定义（时间线上会出现
   * 「A组 · B组 …」这种读不懂的名字）→ 直接判建单失败并指出来，而不是悄悄按某个意思展开。
   */
  function hasInnerRotation (steps?: ApprovalFlowStep[]): boolean {
    for (const s of steps ?? []) {
      if ((s.members ?? []).some(m => m.rotation)) {
        return true
      }
      if (s.type === 'branch') {
        for (const b of s.branches ?? []) {
          if ((b.members ?? []).some(m => m.rotation) || hasInnerRotation(b.steps)) {
            return true
          }
        }
      }
      if (hasInnerRotation(s.steps)) {
        return true
      }
    }
    return false
  }

  /**
   * 卡片内部的**一步** → **顶层节点**。
   *
   * 为什么需要这层转换：卡片内部是 `ApprovalFlowStep[]`（步骤形态），而顶层 flow 只认
   * 节点形态（见 ApprovalFlowNode）。两者字段几乎一一对应，所以这里只"改名"不做语义加工。
   * 返回 null 表示这一步展开不了（数据查询步骤本该在 expandProbes 阶段就展开掉）。
   */
  function stepToNode (s: ApprovalFlowStep): ApprovalFlowNode | null {
    if (s.type === 'branch') {
      return { id: s.id, type: 'branch', branches: s.branches ?? [] }
    }
    if (s.type === 'notify') {
      return {
        id: s.id,
        type: 'notify',
        name: s.name ?? '',
        members: s.members ?? [],
        ...(s.content ? { content: s.content } : {}),
      }
    }
    if (s.type === 'probe') {
      return null
    }
    return {
      id: s.id,
      type: 'approval',
      nodes: s.members ?? [],
      // 环节级选项树（画布上配在审批节点上）：卡片内部环节也可能配了，展开成顶层节点时要带上
      ...(s.optionGroups?.length ? { optionGroups: s.optionGroups } : {}),
    }
  }

  /**
   * 把卡片内部的子流程复制给第 `ring` 环。四件事，一件都不能漏：
   *
   *  1. **id 全部加 `#ring`**：办理结论是按 stepId 记录的（`decisions[].stepId`），
   *     不加后缀的话 N 环共用同一个 id，第 2 环的结论会把第 1 环的顶掉；
   *  2. **`loop_leader` → 该环的组**：填成 `role.dept = 组名`，交给同一个角色解析器找真人
   *     （含"该组没设负责人就往上级找"那套口径，见 utils/approvalRoles）；
   *  3. **分支的跳转目标跟着改名**（见下面 rename 的三条口径）；
   *  4. 嵌套的分支 / 步骤 / 提醒成员一律递归处理。
   */
  function stampRing (
    steps: ApprovalFlowStep[],
    /** 卡片本体：顶层卡片是节点、分支链里是步骤 —— 这里只用它的 `id`（跳转目标要用） */
    card: ApprovalFlowLoopNode | ApprovalFlowStep,
    group: RotationGroup,
    ring: number,
  ): ApprovalFlowStep[] {
    const suffix = (id: string) => `${id}#${ring}`

    /** 卡片内部的全部 id（步骤 + 分支），用来判断"跳转目标在不在卡片里" */
    const innerIds = new Set<string>()
    const collectIds = (list?: ApprovalFlowStep[]) => {
      for (const s of list ?? []) {
        innerIds.add(s.id)
        for (const b of s.branches ?? []) {
          innerIds.add(b.id)
          collectIds(b.steps)
        }
        collectIds(s.steps)
      }
    }
    collectIds(steps)

    /**
     * 跳转目标改名，三种情况：
     *  · 卡片**内部**的步骤 → 同环那一份（加 `#ring`）；
     *  · **卡片自己** → 第一环的第一个环节（`firstOf[card.id]`，即"整张卡片重走"，
     *    与"驳回回退整段轮询"同一口径）；
     *  · 卡片**外部**的环节 → 原样（外层 id 没变）。这正是"某个组决定提前跳出轮询、
     *    直接去后面某个环节"的表达方式；卡片内部首个环节的「驳回 → 上一级」
     *    也属于这一类（它的上一级在卡片外面）。
     */
    const rename = (target: { stepId: string }): { stepId: string } => {
      const id = target.stepId
      if (id === card.id) {
        return { stepId: firstOf[card.id] ?? id }
      }
      return innerIds.has(id) ? { stepId: suffix(id) } : target
    }

    const membersWithGroup = (members?: ApprovalChainItem[]): ApprovalChainItem[] =>
      (members ?? []).map(m => (m.role?.kind === 'loop_leader'
        ? { ...m, role: { kind: 'dept_leader' as const, dept: group.name } }
        : { ...m }))

    function mapRingSteps (list: ApprovalFlowStep[]): ApprovalFlowStep[] {
      return list.map(s => ({
        ...s,
        id: suffix(s.id),
        ...(s.members ? { members: membersWithGroup(s.members) } : {}),
        ...(s.type === 'branch' ? { branches: mapRingBranches(s.branches ?? []) } : {}),
        ...(s.steps ? { steps: mapRingSteps(s.steps) } : {}),
      }))
    }

    function mapRingBranches (branches: ApprovalBranch[]): ApprovalBranch[] {
      return (branches ?? []).map(b => ({
        ...b,
        id: suffix(b.id),
        ...(b.members ? { members: membersWithGroup(b.members) } : {}),
        ...(b.loopBackTo ? { loopBackTo: rename(b.loopBackTo) } : {}),
        ...(b.exitTo ? { exitTo: rename(b.exitTo) } : {}),
        steps: mapRingSteps(b.steps ?? []),
      }))
    }

    return mapRingSteps(steps)
  }

  /* ==================== 卡片展开的三个共用助手 ====================
   * 顶层卡片（节点）与分支里的卡片（步骤）走的是**同一套**展开：校验、取组、按环改名。
   * 两份实现迟早会在某处不一致（那种不一致只在建单时才暴露），所以抽在这里共用。
   */

  /** 卡片的展开前校验：返回错误文案；null = 没问题。`label` 用来点明是哪张卡片 */
  function cardProblem (
    id: string,
    rotation: RotationSpec | undefined,
    steps: ApprovalFlowStep[] | undefined,
    label: string,
  ): string | null {
    if (!rotation) {
      return `${label}：还没有轮询配置，请点卡片填写「组字段」`
    }
    if (!steps?.length) {
      return `${label}：卡片内部没有任何环节，请先在卡片里加一个审批节点`
    }
    if (hasInnerRotation(steps)) {
      return `${label}：卡片内部的环节不允许再配「按组轮询」`
        + '（一个环里再套一层轮询没有确定的含义），请把它挪到卡片外'
    }
    return null
  }

  /**
   * 卡片要轮询到的组。
   * 返回 `null` = 展开不了（issues 里已写明）；返回 `[]` = 一个组都没命中但允许跳过（整卡跳过）。
   */
  function cardGroups (id: string, rotation: RotationSpec, label: string): RotationGroup[] | null {
    const list = groups[id] ?? []
    const limit = rotation.limit ?? ROTATION_DEFAULTS.limit
    if (list.length === 0) {
      if ((rotation.whenEmpty ?? ROTATION_DEFAULTS.whenEmpty) === 'fail') {
        issues.push(`${label}：没有符合条件的组（该卡片设的是"没有匹配组就让建单失败"）`)
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
    return list
  }

  /**
   * 环内有没有"没人办"的审批步骤：有就返回那一步（报错用），否则 null。
   *
   * 卡片内部是按组**复制**的，一个空环节会变成 N 个没人办的环 —— 单据会永远停在那儿。
   * 保存期拦不住这类问题（编辑器允许存"人后配"的草稿模板，见 utils/loopCardGraph），
   * 所以放在**建单期**当场报出来。
   */
  function unstaffedStep (steps: ApprovalFlowStep[]): ApprovalFlowStep | null {
    for (const s of steps ?? []) {
      if ((!s.type || s.type === 'approval') && (s.members ?? []).length === 0) {
        return s
      }
      if (s.type === 'branch' || s.type === 'probe') {
        for (const b of s.branches ?? []) {
          const hit = unstaffedStep(b.steps ?? [])
          if (hit) {
            return hit
          }
        }
      }
      if (s.type === 'loop') {
        const hit = unstaffedStep(s.steps ?? [])
        if (hit) {
          return hit
        }
      }
    }
    return null
  }

  /** 展开一段"步骤链"，并把每个轮询步骤切成 N 个步骤 */
  function mapSteps (steps: ApprovalFlowStep[] | undefined): ApprovalFlowStep[] {
    const out: ApprovalFlowStep[] = []
    for (const s of steps ?? []) {
      if (s.type === 'branch') {
        out.push({ ...s, branches: mapBranches(s.branches ?? []) })
        continue
      }
      /*
       * 「组间轮询」卡片（分支链里的步骤形态）：按组把**卡片内部子流程**复制 N 份，
       * 铺成 N 段**步骤**（步骤本身是顺序的，所以 N 环就是 N 段首尾相接）。
       *
       * 这就是「先按条件分流、只有某条分支里才轮询各组」—— 卡片画在条件/结果分支后面即可。
       */
      if (s.type === 'loop') {
        const label = rotationLabel(s.rotation ?? { groupFrom: '' })
        const problem = cardProblem(s.id, s.rotation, s.steps, label)
        if (problem) {
          issues.push(problem)
          out.push(s) // 原样保留：issues 非空即这条建单失败（不静默走别的意思）
          continue
        }
        const list = cardGroups(s.id, s.rotation!, label)
        if (list === null) {
          out.push(s)
          continue
        }
        if (list.length === 0) {
          continue // 整卡跳过（一个组都没命中）
        }
        // 卡片被"驳回回退 / 跳出循环"指向时，落到**第一环的第一个步骤**
        firstOf[s.id] = `${s.steps![0].id}#1`
        for (const [i, group] of list.entries()) {
          const ring = i + 1
          const ringSteps = stampRing(s.steps!, s, group, ring)
          const bad = unstaffedStep(ringSteps)
          if (bad) {
            issues.push(`${label}：卡片内部的「${bad.name || '未命名环节'}」没有审批人（第 ${ring} 环），这一环没人能办`)
          }
          out.push(...ringSteps)
        }
        // 「轮完走向」紧跟在**所有环之后**（见 loopEndBranchGroup 的说明）
        if (s.afterLoop?.stepId) {
          const g = loopEndBranchGroup(s.id, s.afterLoop.stepId)
          injectedExits.push(g)
          out.push({ id: g.id, type: 'branch', branches: g.branches })
        }
        continue
      }
      const members = s.members ?? []
      const parts = splitMembers(s.id, members)
      if (parts === null) {
        out.push(s)
        continue
      }
      if (!hasRotation(members)) {
        out.push(s) // 没配轮询：原样（保证既有模板零改动）
        continue
      }
      if (parts.length === 0) {
        continue // 整环跳过（一个组都没命中）
      }
      if (parts.length === 1) {
        // 只命中一个组：**只换成员**（该组负责人 + role.dept = 组名），id 与名字都不动 ——
        // id 不变，跳转目标（驳回回退 / 跳出循环）就仍指向它，不必重映射。
        out.push({ ...s, members: parts[0] })
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

  /** 展开分支列表：步骤展开 + **两种「跳转目标」的重映射**（驳回回退 / 跳出循环） */
  function mapBranches (branches: ApprovalBranch[]): ApprovalBranch[] {
    return (branches ?? []).map(b => {
      /*
       * 跳转目标指向被展开的环节时，改指它的**第一环**。
       *
       * 两种跳转都必须映射，漏一个都是运行期故障：
       *   · loopBackTo（驳回回退）：回到该环节重新办理 → 从第一环起、整段轮询重走一遍；
       *   · exitTo（跳出循环）：跳到该环节 → 同样落在第一环。语义上"跳到循环本身"
       *     本来就只有"重走"一种解释（类型注释也说目标该是循环**之后**的环节）。
       *
       * ⚠️ 漏映射的表现（踩过 exitTo 这个）：
       *   · loopBackTo：目标 id 不存在 → 驳回走向一个没有落点的分支，流程卡住且**不报错**；
       *   · exitTo：目标 id 不存在 → 运行期直接抛「跳出循环目标环节不存在」（见 types/approval.ts）。
       * 而模板在编辑器里看着完全正常 —— 保存期那句"目标必须是已存在的环节"校验的是**展开前**
       * 的 id，拦不住这种"展开后才对不上"的情况，所以只能在这里补。
       */
      const retargetOf = (stepId?: string) => (stepId ? firstOf[stepId] : undefined)
      const loopBack = retargetOf(b.loopBackTo?.stepId)
      const exit = retargetOf(b.exitTo?.stepId)
      return {
        ...b,
        ...(loopBack ? { loopBackTo: { stepId: loopBack } } : {}),
        ...(exit ? { exitTo: { stepId: exit } } : {}),
        steps: mapSteps(b.steps),
      }
    })
  }

  const nodes: ApprovalFlowNode[] = []
  for (const node of flow) {
    if (node.type === 'approval') {
      const members = node.nodes ?? []
      const parts = splitMembers(node.id, members)
      if (parts === null) {
        nodes.push(node)
        continue
      }
      if (!hasRotation(members)) {
        nodes.push(node)
        continue
      }
      if (parts.length === 0) {
        continue
      }
      if (parts.length === 1) {
        // 同 mapSteps：只命中一个组时只换成员，id 不变（跳转目标无需重映射）
        nodes.push({ ...node, nodes: parts[0] })
        continue
      }
      firstOf[node.id] = `${node.id}#1`
      parts.forEach((members, i) => {
        /*
         * 顶层审批节点**没有环节名**（见 ApprovalFlowApprovalNode），所以"哪个组、多少销量"
         * 只能靠成员体现：展开出来的成员是「该组负责人 + role.dept = 组名」，
         * 解析成真人后 `department` 会填成组名，时间线上就是「张三 / 华东组」。
         */
        nodes.push({
          id: `${node.id}#${i + 1}`,
          type: 'approval',
          nodes: members,
          // 环节级选项树跟着复制：树里存的是**结论码**（不是节点 id），换环号不受影响
          ...(node.optionGroups?.length ? { optionGroups: node.optionGroups } : {}),
        })
      })
      continue
    }
    /*
     * 「组间轮询」卡片：按组把**卡片内部子流程**复制 N 份，摊平成顶层节点。
     *
     * 与成员级轮询的三点不同，都是有意的：
     *   · 成员级把"一个环节"换成 N 个环节；卡片把"**一段子流程**"换成 N 段
     *     （内部可以有自己的分支，所以"每个组各自分流"才成立）；
     *   · 展开后**卡片这个 id 就没了**（内部环节直接成为顶层节点），所以 `firstOf[card.id]`
     *     指向**第一环的第一个环节** —— 外层分支的驳回回退 / 跳出循环指向卡片时，
     *     落点就是"整张卡片重走"；
     *   · 单组命中时**也加 `#1` 后缀**（不像成员级那样保持原 id）：卡片整体消失，
     *     内部环节的 id 变了，时间线与排查时才知道"这是卡片里的环节"。
     */
    if (node.type === 'loop') {
      const label = rotationLabel(node.rotation)
      const problem = cardProblem(node.id, node.rotation, node.steps, label)
      if (problem) {
        issues.push(problem)
        continue
      }
      const list = cardGroups(node.id, node.rotation, label)
      if (list === null) {
        continue
      }
      if (list.length === 0) {
        continue // 整卡跳过（一个组都没命中）
      }
      // 先登记"卡片 → 第一环的第一个环节"：stampRing 里"跳回卡片自己"要用到它
      firstOf[node.id] = `${node.steps[0].id}#1`

      for (const [i, group] of list.entries()) {
        const ring = i + 1
        const ringSteps = stampRing(node.steps, node, group, ring)
        // 环内有没有人办：与分支里的卡片共用同一个检查（见 unstaffedStep 的说明）
        const bad = unstaffedStep(ringSteps)
        if (bad) {
          issues.push(`${label}：卡片内部的「${bad.name || '未命名环节'}」没有审批人（第 ${ring} 环），这一环没人能办`)
        }
        for (const s of ringSteps) {
          const n = stepToNode(s)
          if (!n) {
            issues.push(
              `${label}：卡片内部的「数据查询」步骤没有在建单时展开（第 ${ring} 环），单据数据不完整`,
            )
            continue
          }
          nodes.push(n)
        }
      }
      // 「轮完走向」紧跟在**所有环之后**（见 loopEndBranchGroup 的说明）
      if (node.afterLoop?.stepId) {
        const g = loopEndBranchGroup(node.id, node.afterLoop.stepId)
        injectedExits.push(g)
        nodes.push({ id: g.id, type: 'branch', branches: g.branches })
      }
      continue
    }
    if (node.type === 'notify') {
      nodes.push(node)
      continue
    }
    // 未展开的引用原样带走（它不是分支节点，没有 branches 可映射）
    if (node.type === 'ref') {
      nodes.push(node)
      continue
    }
    nodes.push({ ...node, branches: mapBranches(node.branches) })
  }

  /*
   * 注入的「轮完走向」分支，目标统一重映射一次（理由见 injectedExits 的声明）。
   * 目标是普通环节 → `firstOf` 里没有这条记录 → 原样保留，
   * 与 `rename` 对"卡片外环节 id 不变"的口径一致。
   */
  for (const g of injectedExits) {
    const mapped = firstOf[g.exitTo.stepId]
    if (mapped) {
      g.exitTo.stepId = mapped
    }
  }

  return { flow: nodes, expanded, issues }
}

/**
 * 「轮完走向」：所有组都轮完、**一直没有跳出轮询**时走的那条分支。
 *
 * 形态是「无条件分支 + `exitTo`」—— 复用运行期已有的两样东西（见 types/approval）：
 *   · `conditions: []` 在 `matchBranch` 里是**兜底分支**：流程走到这里必命中；
 *   · 分支上的 `exitTo` 表示"从目标环节**本身**接着办"（`walkSteps` / `walkFlow` 里优先判定）。
 * 所以不用给运行期加任何新概念，展开后它就是流程里一个普通分支组。
 *
 * 为什么必须由**建单期展开**来注入（而不是保存时就写进 flow）：卡片展开成几环是建单时才知道的，
 * "最后一环之后"这个位置在模板里并不存在；而且保存期注入还会被 `ensureRejectLoopBack`
 * 当成"审批环节后面的分支组"往里补「驳回」分支（见那里的说明）。
 *
 * ⚠️ 只在**真的展开了至少一环**时调用（见两处调用点）：一个组都没命中时整张卡片按
 * `whenEmpty: 'skip'` 跳过，那时"轮完"并不成立 —— 保持"跳过"的老语义。
 *
 * ⚠️ 目标必须是本图里的审批 / 提醒环节：与卡片内部的「提前结束轮询」共用同一份白名单
 * （保存期已校验，见 utils/approvalFlow 的 readAfterLoop），运行期 `exitTo` 找不到目标会直接抛错。
 */
function loopEndBranchGroup (
  cardId: string,
  target: string,
): { id: string, branches: ApprovalBranch[], exitTo: { stepId: string } } {
  const exitTo = { stepId: target }
  return {
    id: `${cardId}:after-loop`,
    branches: [{
      id: `${cardId}:after-loop:branch`,
      name: '轮询走完',
      conditions: [],
      steps: [],
      isEnd: false,
      exitTo,
    }],
    // 交给调用方登记后处理重映射（上面那趟循环）
    exitTo,
  }
}

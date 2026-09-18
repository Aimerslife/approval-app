/**
 * 审批环节（ApprovalNode）提交上来的办理数据。
 * 由父组件负责上传附件并写回 approval_chain.chain。
 */
export interface NodeSubmitPayload {
  /** 环节在 chain 中的下标 */
  index: number
  /** 审批结论标识 */
  result: string
  /** 结论文案（如「通过」「驳回」） */
  result_label: string
  /** 各业务表单的补充值（数量、金额、二级原因等） */
  extra: Record<string, unknown>
  /** 备注 / 审批意见 */
  opinion: string
  /** 待上传的附件 */
  files: File[]
  /** 落库结束后的回调：true 关闭弹窗，false 保持打开便于重试 */
  done: (ok: boolean) => void
}

/** 审批环节附件的引用（文件实体存在 approval_files 集合，这里只存索引） */
export interface ApprovalAttachment {
  /** approval_files 记录 id */
  id: string
  /** 原始文件名 */
  name: string
  /** 文件访问地址（PocketBase files 接口） */
  url: string
}

export interface ApprovalChainItem {
  name?: string
  email?: string
  avatar?: string
  is_tenant_manager?: boolean
  is_leader?: boolean
  type?: 'manager' | 'cc' | string
  /** 所属部门：该成员在组织架构中最近的上级部门 */
  department?: string
  /** 部门完整路径，如 "XX公司 / 技术部 / 前端组"，用于悬浮展示 */
  department_path?: string

  // ===== 办理信息：审批人提交后回填，随 chain 一起存库 =====
  /** 审批结论标识：pass / reject / receive / recycle / scrap / rework / discard */
  result?: string
  /** 结论文案（如「通过」「驳回」），便于列表直接展示 */
  result_label?: string
  /** 各选项的补充值：数量、金额、二级原因等 */
  extra?: Record<string, unknown>
  /** 备注 / 审批意见 */
  opinion?: string
  /** 该环节上传的附件 */
  files?: ApprovalAttachment[]
  /** 办理时间（ISO 字符串） */
  handled_at?: string

  // ===== 转办（运行期追加的成员带这几个字段，见 mergeExtraMembers）=====
  /** 转办来源：被接替的那位审批人姓名。带这个字段的成员 = 转办进来的人（type 为 manager） */
  delegated_from?: string
  /** 转办时间（ISO 字符串） */
  delegated_at?: string
  /** 仅用于展示：该审批人已把本环节转办给谁（重算时由 mergeExtraMembers 打上，不落库） */
  transferred_to?: string

  /** 动态审批人（角色）：模板里带这个字段、没有具体姓名，建单时解析成真人 */
  role?: ApprovalRole
}

/**
 * 动态审批人（角色）：模板里**不写死人名**，建单时按组织架构解析成真人并快照进单。
 *
 * 为什么需要：白板上多处写的是「推送至相关部门负责人」「团队负责人审批」——
 * 这类环节的审批人不是某个固定的人，而是"某一层的负责人"。
 * 写死人名的话，人员一变动（换组长、换部门负责人）模板就得跟着改一遍。
 *
 * 解析口径（utils/approvalRoles.ts）：**建单时**解析、结果写进单据的 flow 快照，
 * 之后重算链路只读快照 —— 与业务数据快照同一套理由：
 * 历史单不能因为后来的人事变动而被改写。
 */
export interface ApprovalRole {
  /** 解析方式：部门负责人 / 组织管理员 */
  kind: 'dept_leader' | 'tenant_admin'
  /** 固定部门名（与 deptFrom 二选一；两个都填时 dept 优先） */
  dept?: string
  /** 部门名取自**数据行字段**（中文列名，如「组别」「团队」）——
     *  「推送至相关部门负责人」就是这种：具体是哪个部门由这一行数据决定 */
  deptFrom?: string
}

/** 角色的可读描述（模板里没解析时，卡片上显示它；建单失败时的报错也用它） */
export function roleLabel (role: ApprovalRole): string {
  const kind = role.kind === 'tenant_admin' ? '组织管理员' : '部门负责人'
  const dept = role.dept ? `（${role.dept}）` : (role.deptFrom ? `（取数据行「${role.deptFrom}」）` : '')
  return `${kind}${dept}`
}

export type ApprovalChain = ApprovalChainItem[][]

/**
 * 把运行期追加的成员（抄送 / 转办）合并进重算出来的 chain。
 *
 * 为什么必须单独存（`approval_chain.chain.extraMembers`，按 stepId 索引）：
 *   chain 是 `rebuildChain(flow, decisions, context)` 的**重算产物**，
 *   直接往 chain 里塞人，下一次重算就没了；而写进 flow 又会改到模板、影响后续所有单。
 *
 * 顺带处理**转办的展示口径**：转办进来的人是 `type: 'manager'`（他接替办理），
 * 若只做追加，同一环节会出现两位"审批人"，看起来像会签 —— 实际只有接替者在办。
 * 所以这里把被接替的那位标上 `transferred_to`（**仅展示用，不落库**），
 * 前端据此渲染成「已转办 → X」。
 */
export function mergeExtraMembers (
  chain: ApprovalChain,
  stepIds: string[],
  extraMembers?: Record<string, ApprovalChainItem[]>,
): ApprovalChain {
  if (!extraMembers) {
    return chain
  }
  for (const [i, step] of chain.entries()) {
    const adds = extraMembers[stepIds[i]]
    if (!adds?.length) {
      continue
    }
    for (const m of adds) {
      step.push({ ...m })
    }

    // 同一环节可能转过多次：取**最后**一位接替者（与 handleSelect 里"最后一位 manager 才是现经办人"一致）
    const transfers = adds.filter(m => m.delegated_from)
    const transfer = transfers.at(-1)
    if (!transfer) {
      continue
    }
    for (const m of step) {
      // 已办过的成员不标（那是历史轨迹）；仅展示字段，不影响任何求值
      if (m.type === 'manager' && !m.delegated_from && !m.result) {
        m.transferred_to = transfer.name
      }
    }
  }
  return chain
}

/** 单个环节的办理结论（运行时流水，按实际办理顺序追加）。
 *  同一 stepId 可出现多次 —— 驳回回退后重审会再产生一条，旧结论完整保留用于追溯。 */
export interface NodeDecision {
  /** 对应 flow / 分支 steps 里的步骤 id */
  stepId: string
  /** 审批结论标识：pass / reject / ... 取值见 APPROVAL_RESULTS */
  result: string
  /** 结论文案（如「通过」「驳回」） */
  result_label?: string
  /** 各选项的补充值：数量、金额、二级原因等，参与条件求值 */
  extra?: Record<string, unknown>
  /** 备注 / 审批意见 */
  opinion?: string
  /** 该环节上传的附件 */
  files?: ApprovalAttachment[]
  /** 办理时间（ISO 字符串） */
  handled_at?: string
}

// ===== 分支 =====
// 需求：同一个流程内可以有几条不同的走向，每条走向就是一个「分支」。
// 分支负责命名走向，并承载命中条件，走哪条由条件求值（或审批结果）决定。
// 流程被抽象成「顺序节点」，节点是以下两种之一：
//   1) approval —— 普通审批环节（等价于原来的 chain[i]）
//   2) branch   —— 分支组：内含若干命名分支，按「业务字段命中条件」或「上一环节审批结果」分流
// 画布上 approval 节点可有多条出线，出现第二条出线后这些出线即「审批结果分支」：
//   无条件出线为主线（审批通过 / 其余结论未命中时走这里，排 chain 时即主链路），
//   其余出线各绑定一个审批结论（data.condition 形如 { field: 'result', op: 'eq', value: 'reject' }）。
// 该结构保存时被拍平为「审批环节 + 结果分支组(branch)」两个顺序 flow 节点。
// condition 节点对应「业务字段条件分支组」；两者共用 branch flow 结构。
// 分支内允许再出现分支：分支步骤里 type='branch' 的步骤即嵌套分支组（可任意层级递归），
// 运行时按「局部汇聚」理解——嵌套分支组汇聚后回到父分支继续，不必先汇聚再拆。
// 旧数据（纯线性 chain）不需要迁移，用 chainToFlow() 升级即可。

/** 分支内的一个步骤：
 *  - 默认形态（type 缺省 / 'approval'）：一个或多个并行的审批人（即会签），保留旧数据的线性子步骤兼容；
 *  - type='branch'：一个嵌套分支组（分支内再按审批结果 / 业务条件分流），分支组步骤通过 branches 递归承载，
 *    支持任意层级「分支内再分分支」，无需先汇聚。
 */
export interface ApprovalFlowStep {
  id: string
  /** 步骤名（可选），如「初审」「复核」 */
  name?: string
  /** 步骤形态：缺省 'approval'（兼容旧数据）；'branch' = 嵌套分支组 */
  type?: 'approval' | 'branch'
  /** 该步骤的审批人（多人即会签）；type='branch' 的分支组步骤可留空 */
  members?: ApprovalChainItem[]
  /** type='branch' 时的嵌套分支列表（各组内仍可继续递归出现 type='branch' 的步骤） */
  branches?: ApprovalBranch[]
  /** 兼容旧结构的线性子步骤（无新生产方；flowToChain 仍会递归拍平） */
  steps?: ApprovalFlowStep[]
}

/** 分支命中条件：字段 + 操作符 + 值；branch.condition 为空表示兜底（默认）分支 */
export interface BranchCondition {
  /** 参与判断的表单字段 key，如 amount / department */
  field: string
  /** 操作符 */
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'
  /** 比较值（数字或字符串，求值时自动尝试数值比较） */
  value: string | number
}

/**
 * 条件组：把若干条件（或更小的组）按 logic 组合起来。
 *
 * 为什么需要它：一组条件原先只能有一个 `logic`，于是「灯具>5000 **或** 非灯具>2000」
 * 这种**分档阈值**表达不了（只能拆成两层条件节点绕开）；也没有括号与取反。
 * 有了组就能直接写 `(是否灯具=是 and 金额>5000) or (是否灯具=否 and 金额>2000)`。
 *
 * 递归结构（组里可以再放组），求值见 `evalConditionExpr`。
 */
export interface ConditionGroup {
  /** 组内组合方式：and = 全部满足（默认），or = 任一满足 */
  logic: 'and' | 'or'
  /** 组内成员：条件，或更小的组 */
  items: ConditionExpr[]
}

/** 条件表达式：单个条件，或一个条件组（可任意嵌套） */
export type ConditionExpr = BranchCondition | ConditionGroup

/** 是不是条件组（组有 items，单个条件有 field） */
export function isConditionGroup (expr: ConditionExpr): expr is ConditionGroup {
  return Array.isArray((expr as ConditionGroup)?.items)
}

/**
 * 「选择接收人员」结论码。
 *
 * 语义：这一环的办理人**当场指定人**，选中的人填充到**下一环节**、成为它的审批人。
 * 所以模板里那个接收环节**可以留空**（`allowEmptyMembers`，编辑器已放开）——
 * 「谁办下一环」由业务在办理时根据实际情况决定，写死在模板里反而做不到。
 * 白板上的「指定接收团队」就是这种环节。
 *
 * 两侧共用这个常量：办理弹窗收集人选、useNodeSubmit 负责填充。
 */
export const PICK_MEMBERS_RESULT = 'pick_members'

/** 审批结论选项：value 与运行时办理结论（result 码）保持一致，供「审批结果分支」配置与校验 */
export const APPROVAL_RESULTS: ReadonlyArray<{ value: string, label: string }> = [
  { value: 'pass', label: '通过' },
  { value: 'reject', label: '驳回' },
  { value: 'receive', label: '接收' },
  { value: 'part_receive', label: '部分接收' },
  { value: 'recycle', label: '回收' },
  { value: 'scrap', label: '报废清仓' },
  { value: 'rework', label: '建议返工' },
  { value: 'discard', label: '建议弃置' },
  { value: 'lack_demand', label: '市场需求不足' },
  { value: 'other_reason', label: '其他原因' },
  { value: 'pending', label: '待定' },
  // 「选择接收人员」：办理人当场指定人，选中的人**填充到下一环节**（成为它的审批人）。
  // 配套的是「允许没有审批人的环节」—— 模板里把接收环节留空，由上一环指定。
  // 白板上的「指定接收团队」就是这个环节。
  { value: PICK_MEMBERS_RESULT, label: '选择接收人员' },
  // —— 原因分类：来自「库存管理流程规范」白板的「筛选一级原因/二级原因」环节——
  // 那一环的出线在图上没写标签，分类写在**目标节点标题**上，所以这些类是审批人的结论选项。
  // 纯新增，不影响已有模板（结论选项是按 flow 里绑的条件算出来的）。
  { value: 'cat_operation', label: '运营类' },
  { value: 'cat_infringe', label: '产品侵权类' },
  { value: 'cat_stock', label: '库存管理类' },
  { value: 'cat_env', label: '外部环境类' },
  { value: 'cat_dev', label: '开发类' },
  { value: 'cat_supply', label: '供应链类' },
]

/** 审批单状态（approval_chain.status） */
export const APPROVAL_STATUS = {
  /** 进行中：仍有环节待办 */
  PENDING: 0,
  /** 通过：流程走完且未落入驳回类走向 */
  APPROVED: 1,
  /** 驳回：流程因驳回类走向而终止 */
  REJECTED: 2,
} as const

/** 视为「驳回」的结论值，用于终态判定：
 *  终止分支绑定了这些结论，或最后一个办理环节的结论属于这些值。
 *  业务上若要把「建议弃置」「报废清仓」也算驳回终态，往这里加即可。 */
export const REJECT_RESULTS: ReadonlyArray<string> = ['reject']

/**
 * 命中即**终结流程**的结论：这一步办完流程就结束，后面的环节不再展开、也就没人有权限办。
 *
 * 目前只有「选择接收人员」：接收方是**结果**（谁接下这批货），不是下一环的审批人。
 * 所以模板里配这条结论的那个分支，后面接什么都不会生效（建议直接连到结束节点）。
 *
 * 与 REJECT_RESULTS 的唯一区别在终态判定：这里的终结算**通过**（流程正常走完），
 * REJECT_RESULTS 算驳回。见 outcomeOf()。
 */
export const CLOSE_FLOW_RESULTS: ReadonlyArray<string> = [PICK_MEMBERS_RESULT]

/** 分支：一条命名的走向，可以挂直属审批人 + 顺序步骤（步骤里可再嵌分支组，即分支内的分支） */
export interface ApprovalBranch {
  id: string
  /** 分支名，如「财务审批」「技术审批」 */
  name: string
  /** 命中条件（可选）；为空 = 默认分支（审批结果分支里即「主线」）。
         field 为保留字段 result 时表示按上一环节审批结论分流，value 取值见 APPROVAL_RESULTS。
         单条件时代留下的字段，等价于 conditions[0]；新数据以 conditions 为准 */
  condition?: BranchCondition | null
  /** 多条件组合方式：and = 全部满足（默认），or = 任一满足 */
  logic?: 'and' | 'or'
  /** 该分支的全部命中条件（可按 and/or 组合，允许嵌条件组）。
     *  审批结果分支要求**顶层**有一个结论条件（field='result'），它是硬前提；
     *  放进组里的 result 条件不做硬前提，按该组 logic 参与运算。 */
  conditions?: ConditionExpr[]
  /** 顶级分支直属审批人（可选，顺序排在 steps 之前） */
  members?: ApprovalChainItem[]
  /** 顺序步骤：分支自己的审批环节链；允许出现 type='branch' 的嵌套分支组步骤（递归），
         也允许普通审批步骤带旧式线性 steps（兼容旧数据） */
  steps: ApprovalFlowStep[]
  /** 驳回/打回回到指定步骤：分支不再向后推进，而是把整条审批流回退到目标步骤（按步骤 id 引用）。
     *  steps 可为空（也可附带返回前的处理步骤，如通知）。该分支不会进入主干主链/主干汇聚。 */
  loopBackTo?: { stepId: string }
  /** 是否为「出口」：该分支的连线直达结束节点，命中即整条流程终止。
     *  由 graphToFlowFrom 在转换时写入 —— 它算过分支终点，不必等运行时回查画布。
     *  为什么需要：分支汇到后续节点时 steps 同样为空，光看 steps 分不清「终止」和「继续」。
     *  旧数据没有该字段时，运行时退化为查画布快照（buildBranchTerminalMap）。 */
  isEnd?: boolean
}

/** 流程节点：普通审批环节 */
export interface ApprovalFlowApprovalNode {
  id: string
  type: 'approval'
  /** 该环节的审批人，多人时为会签 */
  nodes: ApprovalChainItem[]
}

/** 流程节点：分支组 */
export interface ApprovalFlowBranchNode {
  id: string
  type: 'branch'
  /** 分支列表 */
  branches: ApprovalBranch[]
}

export type ApprovalFlowNode = ApprovalFlowApprovalNode | ApprovalFlowBranchNode

/** 完整审批流：顺序节点，支持分支 */
export type ApprovalFlow = ApprovalFlowNode[]

// ===== Vue Flow 画布节点 data =====

/** 审批节点（approval）的画布 data：环节名 + 成员（审批人/抄送人） */
export interface ApprovalNodeData {
  /** 环节名，如「初审」「财务复核」 */
  title: string
  /** 成员列表，type 区分审批人（manager）/ 抄送人（cc） */
  members: ApprovalChainItem[]
}

/** 生成节点 / 分支的本地 id */
export function uid (): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 按分支名查找分支：运行时由提交人指定分支名时用 */
export function findBranch (node: ApprovalFlowBranchNode, name: string): ApprovalBranch | null {
  return node.branches.find(b => b.name === name) ?? null
}

// ===== 条件求值（运行时自动选路） =====

/** 分支的全部命中条件：优先用多条件 conditions，兼容旧的单条件 condition */
export function branchConditions (b: ApprovalBranch): ConditionExpr[] {
  if (b.conditions && b.conditions.length > 0) {
    return b.conditions
  }
  return b.condition ? [b.condition] : []
}

/**
 * 求值一个条件表达式（条件或条件组）。
 *
 * 空组按「恒真」处理：组还没配条件时不该把分支拦掉 ——
 * 与"整条分支没有任何条件 = 兜底分支"保持一致的直觉。
 */
export function evalConditionExpr (expr: ConditionExpr, form: Record<string, unknown>): boolean {
  if (isConditionGroup(expr)) {
    if (!expr.items?.length) {
      return true
    }
    return expr.logic === 'or'
      ? expr.items.some(i => evalConditionExpr(i, form))
      : expr.items.every(i => evalConditionExpr(i, form))
  }
  return evalCondition(expr, form[expr.field])
}

/** 该条件是不是「按上一环节审批结论分流」的结果条件 */
export function isResultCondition (expr: ConditionExpr): boolean {
  return !isConditionGroup(expr) && expr.field === 'result'
}

/**
 * 取分支**顶层**结果条件的取值（没有则 undefined）。
 *
 * 「顶层」这两个字是关键：审批结果分支里结论条件是**硬前提**（见 matchBranch），
 * 放在组里的 result 条件则按普通条件参与该组运算 —— 两处口径必须一致，
 * 所以判定终态、收集可选结论都用这一个函数。
 */
export function firstResultValueOf (b: ApprovalBranch): string | undefined {
  const hit = branchConditions(b).find(isResultCondition) as BranchCondition | undefined
  return hit ? String(hit.value ?? '').trim() || undefined : undefined
}

/** 该分支是否为默认（兜底）分支：没有任何命中条件 */
export function isDefaultBranch (b: ApprovalBranch): boolean {
  return branchConditions(b).length === 0
}

function evalCondition (c: BranchCondition, raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === '') {
    return false
  }
  /*
     * 千分位串要在**比较时**还原成数字："6,000" 直接 Number() 是 NaN，
     * 于是 gt/gte/lt/lte 一律判 false —— 而两个来源都可能是这种写法：
     *   ① 表格里的行数据（formatDatas 把数字格式化成 "1,234"）；
     *   ② 办理时审批人手填的金额。
     * 业务上下文那条路径已经在 toFlowContext 里归一化过，这里再兜一道，
     * 保证"条件比较的值"与"数据从哪来"无关。
     */
  const a = Number(typeof raw === 'string' ? raw.replace(/,/g, '').trim() : raw)
  const b = Number(typeof c.value === 'string' ? c.value.replace(/,/g, '').trim() : c.value)
  const numeric = !Number.isNaN(a) && !Number.isNaN(b)
  switch (c.op) {
    case 'eq': { return numeric ? a === b : String(raw) === String(c.value)
    }
    case 'ne': { return numeric ? a !== b : String(raw) !== String(c.value)
    }
    case 'gt': { return numeric && a > b
    }
    case 'gte': { return numeric && a >= b
    }
    case 'lt': { return numeric && a < b
    }
    case 'lte': { return numeric && a <= b
    }
    case 'contains': { return String(raw).includes(String(c.value))
    }
  }
}

/**
 * 按表单数据（含 result 等运行时字段）选择分支：
 * 返回第一个条件命中的分支；都不命中时返回无条件的默认分支；连默认分支都没有则 null。
 * 审批结果分流时，form 需带上上一环节的 result（如 { result: 'reject' }）；
 * 多条件分支按 logic 组合：and = 全部满足，or = 任一满足；
 * 但首条为审批结果条件（field=result）时它是硬性前提，logic 只作用于其后的附加条件。
 */
export function matchBranch (branches: ApprovalBranch[], form: Record<string, unknown>): ApprovalBranch | null {
  let fallback: ApprovalBranch | null = null
  for (const b of branches) {
    const list = branchConditions(b)
    if (list.length === 0) {
      fallback ??= b
      continue
    }
    // 顶层的「审批结论」条件是**硬性前提**：必须命中，且不参与 or 组合，
    // 否则「金额>5000」这类附加条件会在结论不是该结果时也把分支命中。
    // （放进**组里**的 result 条件不受这个优待，按该组自己的 logic 参与运算，
    //   口径与 firstResultValueOf 的说明一致。）
    const results = list.filter(isResultCondition) as BranchCondition[]
    if (results.some(c => !evalCondition(c, form[c.field]))) {
      continue
    }
    const rest = list.filter(i => !isResultCondition(i))
    const hit
      = rest.length === 0
        ? results.length > 0
        : ((b.logic ?? 'and') === 'or'
            ? rest.some(i => evalConditionExpr(i, form))
            : rest.every(i => evalConditionExpr(i, form)))
    if (hit) {
      return b
    }
  }
  return fallback
}

/**
 * 收集每个审批环节「可选的审批结论」：取自它后面那个分支组里各分支绑定的 result 条件。
 *
 * 这样办理表单就能按模板配置渲染（某环节能选什么结论，由画布上它连了哪些结果分支决定），
 * 而不是按环节在链中的下标硬编码表单类型。
 *
 * - 有条件分支（field=result）→ 取条件值，如 reject / pending / recycle；
 * - 无条件分支（主线）→ 视为 pass，它是通过 / 其余结论未命中时的兜底走向；
 * - 嵌套分支组同样处理：分支 steps 里的 branch 步骤，归属于它前面那个审批步骤。
 *
 * @returns stepId → 结论标识数组（去重），如 { '财务初审': ['reject', 'pass'] }
 */
export function collectStepResultOptions (flow: ApprovalFlow): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  /** 主线（无条件分支）对应的结论 */
  const MAIN_RESULT = 'pass'

  /** 从分支组提取结论列表 */
  function optionsOf (branches: ApprovalBranch[]): string[] {
    const list: string[] = []
    for (const b of branches) {
      // 顶层结果条件 = 该分支对应的审批结论；只靠条件组命中的分支不贡献结论
      const v = firstResultValueOf(b)
      if (v) {
        list.push(v)
      } else if (branchConditions(b).length === 0) {
        list.push(MAIN_RESULT)
      } // 无条件 = 主线兜底走向
    }
    return Array.from(new Set(list))
  }

  /** 分支内的步骤序列：branch 步骤归属于它前面那个审批步骤 */
  function collectSteps (steps: ApprovalFlowStep[] | undefined) {
    let prev: string | undefined
    for (const s of steps ?? []) {
      if (s.type === 'branch' && s.branches?.length) {
        if (prev) {
          map[prev] = optionsOf(s.branches)
        }
        for (const b of s.branches) {
          collectSteps(b.steps)
        }
        continue
      }
      prev = s.id
    }
  }

  let prevTop: string | undefined
  for (const node of flow) {
    if (node.type === 'approval') {
      prevTop = node.id
      continue
    }
    if (node.type === 'branch') {
      if (prevTop) {
        map[prevTop] = optionsOf(node.branches)
      }
      for (const b of node.branches) {
        collectSteps(b.steps)
      }
    }
  }
  return map
}

/**
 * 分支 id → 是否为「出口」（该分支的连线直达结束节点）。
 *
 * 为什么需要它：flow 里分支的 steps 只在「该分支独占一段审批环节」时才非空；
 * 当分支直接汇聚到后续节点、或直接连到结束节点时 steps 都是空的。
 * 仅凭 flow 无法区分这两种情况（都会表现为 steps.length === 0），
 * 必须回到画布快照看这条分支线的 target 是不是结束节点。
 */
export type BranchTerminalMap = Record<string, boolean>

/**
 * 参与条件求值的**业务上下文**：关联数据行的字段快照（中文 key → 值）。
 *
 * 为什么要**快照**而不是每次去读关联行：
 * `rebuildChain` 是纯函数，且**每次读取都会重算**（审批页 / 抽屉 / 提交前都要重算）。
 * 若条件直接读实时业务数据，而 `bi_rows` 每次同步都会重写（行 id 都可能变），
 * 那么同一批 decisions 在不同时间会**算出不同的链路** —— 历史单的已办轨迹、终态
 * 会跟着业务数据一起"回放性变化"，审批单就不再是可信凭证了。
 * 所以：**建单时把数据快照写进单里**（`approval_chain.chain.context`），此后只读快照。
 *
 * json 字段，加这个不需要迁移。
 */
export type FlowContext = Record<string, unknown>

/** 由画布快照构建出口表：分支线的 target 是 end 节点即为出口。
 *  没有 graph（旧数据）时返回空表，调用方退化为「不提前终止」。 */
export function buildBranchTerminalMap (graph?: FlowGraph | null): BranchTerminalMap {
  const map: BranchTerminalMap = {}
  if (!graph?.edges?.length) {
    return map
  }
  const endIds = new Set((graph.nodes ?? []).filter(n => n.type === 'end').map(n => n.id))
  for (const e of graph.edges) {
    map[e.id] = endIds.has(e.target)
  }
  return map
}

/**
 * 由「模板 flow + 办理流水 decisions」重建运行时 chain。
 *
 * 纯函数：同样的 (flow, decisions) 必得同样的 chain。因此驳回回退、分支选路、重审
 * 全部自然生效，不需要在旧链上做增删改的补丁操作 —— chain 是 flow 的投影，不是事实源。
 *
 * 关键约定：
 * - 环节的结论按「该环节第几次办理」从 decisions 取（round 轮次），
 *   回退重审会展开成新的 chain 环节，旧结论仍留在 decisions 里可追溯；
 * - 第一个「没有对应结论」的环节即当前待办，currentStep 指向它，其后的走向不再展开；
 * - 分支 steps 为空（连线直达结束节点）视为流程出口，整体终止并置 done。
 */
export function rebuildChain (
  flow: ApprovalFlow,
  decisions: NodeDecision[] = [],
  terminalMap: BranchTerminalMap = {},
  context: FlowContext = {},
): {
  chain: ApprovalChain
  stepIds: string[]
  currentStep: number
  done: boolean
  /** 终态：pending 进行中 / approved 通过 / rejected 驳回 */
  outcome: 'pending' | 'approved' | 'rejected'
} {
  const chain: ApprovalChain = []
  // chain 下标 → 步骤 id，办理时据此把结论记到正确的 stepId 上
  const stepIds: string[] = []

  // stepId → 该环节历次办理结论（按办理时间顺序）
  const byStep = new Map<string, NodeDecision[]>()
  for (const d of decisions) {
    const list = byStep.get(d.stepId)
    if (list) {
      list.push(d)
    } else {
      byStep.set(d.stepId, [d])
    }
  }
  // stepId → 已展开次数，用于取「第几轮」结论（重审 = 第二轮）
  const round = new Map<string, number>()

  // stepId → 成员（顶层节点 + 所有嵌套分支内步骤），回退重审时要据此重建环节
  const membersById = new Map<string, ApprovalChainItem[]>()
  // 顶层审批节点 → 在 flow 中的下标，回退后从它的下一个节点继续推进
  const flowIndexById = new Map<string, number>()
  // stepId → 它所在的 steps 序列及位置，回退到分支内步骤时从它后面继续展开
  const containerById = new Map<string, { steps: ApprovalFlowStep[], index: number }>()

  for (const [i, n] of flow.entries()) {
    if (n.type === 'approval') {
      membersById.set(n.id, n.nodes)
      flowIndexById.set(n.id, i)
    }
  }
  /** 递归收集嵌套分支内的步骤：成员 + 所在容器 */
  function collect (steps: ApprovalFlowStep[] | undefined) {
    for (let i = 0; i < (steps?.length ?? 0); i++) {
      const s = steps![i]
      if (s.type === 'branch') {
        for (const b of s.branches ?? []) {
          collect(b.steps)
        }
      } else {
        membersById.set(s.id, s.members ?? [])
      }
      containerById.set(s.id, { steps: steps!, index: i })
    }
  }
  for (const node of flow) {
    if (node.type === 'branch') {
      for (const b of node.branches) {
        collect(b.steps)
      }
    }
  }

  let currentStep = -1
  let done = false
  let guard = 0
  /** 导致流程终止的分支，用于判定终态是「通过」还是「驳回」 */
  let terminalBranch: ApprovalBranch | null = null
  /** 最后一个已办理环节的结论：终止分支未绑定结论时用它兜底判定 */
  let lastResult: string | undefined

  /** 该分支是否为流程出口（连线直达结束节点）。
     *  优先取转换时写入的 isEnd；旧数据没有该字段才回查画布快照。
     *  两者都没有时按「非出口」处理，交给后续节点自然走完，避免误判成终止。 */
  function isExit (b: ApprovalBranch): boolean {
    if (typeof b.isEnd === 'boolean') {
      return b.isEnd
    }
    return terminalMap[b.id] === true
  }

  /** 取该环节「第 n 次办理」的结论，n = 已展开次数 */
  function takeDecision (stepId: string): NodeDecision | undefined {
    const r = round.get(stepId) ?? 0
    round.set(stepId, r + 1)
    return (byStep.get(stepId) ?? [])[r]
  }

  /**
     * 结论 → 选路表单：result 是保留字段，extra 里的业务字段一并参与条件求值。
     *
     * 业务上下文（关联数据行的快照）垫在最底层 —— 分支条件里写的业务字段
     * （如「总库存金额 > 5000」）就是从这里取的；审批结论与办理人填的 extra 覆盖它，
     * 因为那是本次办理的即时事实，比建档时的快照更权威。
     */
  function formOf (d: NodeDecision): Record<string, unknown> {
    return { ...context, result: d.result, ...d.extra }
  }

  /**
   * 该结论是否**终结流程**（见 CLOSE_FLOW_RESULTS）。
   * 命中就不再往后展开：后面的环节不进 chain、也就没人有权限办 ——
   * 「选择接收团队」就是这种：接收方是结果，不是下一环的审批人。
   */
  function closesFlow (d: NodeDecision | undefined): boolean {
    return !!d && CLOSE_FLOW_RESULTS.includes(d.result)
  }

  /** 生成一个 chain 环节并回填其结论；返回结论（undefined = 该环节待办） */
  function pushStep (stepId: string): NodeDecision | undefined {
    const d = takeDecision(stepId)
    const step = (membersById.get(stepId) ?? []).map(m => ({ ...m }))
    if (d) {
      lastResult = d.result
      // 结论记在审批人上，ApprovalNode 读 manager 的这些字段来展示
      const target = step.find(i => i.type === 'manager') ?? step[0]
      if (target) {
        target.result = d.result
        target.result_label = d.result_label
        target.extra = d.extra
        target.opinion = d.opinion
        target.handled_at = d.handled_at
        if (d.files?.length) {
          target.files = d.files
        }
      }
    }
    chain.push(step)
    stepIds.push(stepId)
    return d
  }

  /** 回退到目标环节重新办理，并按重审结论续走后续路径 */
  function loopBackTo (stepId: string): boolean {
    const d = pushStep(stepId)
    if (!d) {
      // 还没有重审结论 → 它就停在这一步等着重审
      currentStep = chain.length - 1
      return false
    }
    // 重审时选了终结类结论 → 同样到此结束
    if (closesFlow(d)) {
      done = true
      terminalBranch = null
      return false
    }
    const form = formOf(d)
    const idx = flowIndexById.get(stepId)
    if (idx !== undefined) {
      return walkFlow(idx + 1, form)
    }
    const c = containerById.get(stepId)
    if (c) {
      return walkSteps(c.steps.slice(c.index + 1), form)
    }
    return true
  }

  /** 展开分支内的步骤序列；返回 false 表示已停在待办或流程终止 */
  function walkSteps (steps: ApprovalFlowStep[], form: Record<string, unknown>): boolean {
    for (const s of steps) {
      if (guard++ > 500) {
        return false
      } // 防御：回退 + 同样的结论会形成死循环
      if (s.type === 'branch' && s.branches?.length) {
        const b = matchBranch(s.branches, form)
        if (!b) {
          return false
        }
        if (b.loopBackTo) {
          return loopBackTo(b.loopBackTo.stepId)
        }
        // steps 为空只说明该分支没独占环节，不等于终止 —— 是否终止看出口表
        if (b.steps.length > 0 && !walkSteps(b.steps, form)) {
          return false
        }
        if (isExit(b)) {
          done = true // 连线直达结束节点
          terminalBranch = b
          return false
        }
        continue
      }
      const d = pushStep(s.id)
      if (!d) {
        currentStep = chain.length - 1
        return false
      }
      // 终结类结论：分支内的步骤同样到此为止
      if (closesFlow(d)) {
        done = true
        terminalBranch = null
        return false
      }
      form = formOf(d)
    }
    return true
  }

  /** 从 flow 的第 start 个节点开始推进 */
  function walkFlow (start: number, form: Record<string, unknown>): boolean {
    let i = start
    while (i < flow.length) {
      if (guard++ > 500) {
        return false
      }
      const node = flow[i]
      if (node.type === 'approval') {
        const d = pushStep(node.id)
        if (!d) {
          currentStep = chain.length - 1
          return false
        }
        // 终结类结论（如「选择接收团队」）：这一步办完流程即结束，后面接的环节不会生效
        if (closesFlow(d)) {
          done = true
          terminalBranch = null
          return false
        }
        form = formOf(d)
        i++
        continue
      }
      if (node.type === 'branch') {
        const b = matchBranch(node.branches, form)
        if (!b) {
          done = true
          terminalBranch = null
          return false
        }
        if (b.loopBackTo) {
          return loopBackTo(b.loopBackTo.stepId)
        }
        // steps 为空可能是「直接汇聚到下一个节点」，只有出口表认定为终止才停
        if (b.steps.length > 0 && !walkSteps(b.steps, form)) {
          return false
        }
        if (isExit(b)) {
          done = true
          terminalBranch = b
          return false
        }
        i++
        continue
      }
      i++
    }
    done = true
    return true
  }

  /**
     * 终态判定：优先看「终止分支」绑定的审批结论（模板作者意图最明确），
     * 终止分支没绑结论时（如兜底的默认分支）再看最后一个环节的结论。
     */
  function outcomeOf (): 'pending' | 'approved' | 'rejected' {
    if (!done) {
      return 'pending'
    }
    const v = terminalBranch ? firstResultValueOf(terminalBranch) : undefined
    if (v) {
      return REJECT_RESULTS.includes(v) ? 'rejected' : 'approved'
    }
    return lastResult && REJECT_RESULTS.includes(lastResult) ? 'rejected' : 'approved'
  }

  // 起始表单也要带上业务上下文：第一个环节之前若有条件节点，它同样要能按业务数据分流
  walkFlow(0, { ...context })
  return { chain, stepIds, currentStep, done, outcome: outcomeOf() }
}

// ===== Vue Flow 画布持久化快照 =====

/** 画布节点快照（剥离 vue-flow 运行时字段，仅存可还原的最小集） */
export interface FlowGraphNode {
  id: string
  type: string
  position: { x: number, y: number }
  data?: Record<string, unknown>
}

/** 画布连线快照；data.conditions 保存该分支的命中条件（可多条，logic 决定 and/or） */
export interface FlowGraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
  /** 连线形状：default=贝塞尔 smoothstep=圆角折线 step=直角折线 straight=直线（vue-flow 内置类型） */
  type?: string
  /** 连线形状参数：curvature（贝塞尔弯曲度 0~1）、borderRadius（折线圆角）等，透传给 vue-flow 连线组件 */
  pathOptions?: { curvature?: number, borderRadius?: number, offset?: number }
  data?: {
    /** 兼容旧数据的单条件，等价于 conditions[0] */
    condition?: BranchCondition | null
    /** 该分支的全部命中条件（可以是条件组嵌套） */
    conditions?: ConditionExpr[]
    /** 多条件组合方式，默认 and */
    logic?: 'and' | 'or'
    /** 手动拖拽曲线（type=adjustable）的弯点；双击圆点可复位 */
    cp?: { x: number, y: number }
  }
}

/** 整图快照：节点 + 连线 + 视口，保存后可原样还原画布 */
export interface FlowGraph {
  nodes: FlowGraphNode[]
  edges: FlowGraphEdge[]
  viewport: { x: number, y: number, zoom: number }
}

/** 把带分支的流程拍平成线性 chain：分支节点优先取无条件默认分支（审批结果分支即主线），否则取第一个。
 *  支持任意层级嵌套：遇到 type='branch' 的嵌套分支组步骤时取它的默认分支继续递归。 */
export function flowToChain (flow: ApprovalFlow): ApprovalChain {
  const chain: ApprovalChain = []
  function pushMembers (members: ApprovalChainItem[] | undefined) {
    if (members && members.length > 0) {
      chain.push(members)
    }
  }
  function walkBranch (branch: ApprovalBranch) {
    pushMembers(branch.members)
    for (const step of branch.steps) {
      walkStep(step)
    }
  }
  function walkStep (step: ApprovalFlowStep) {
    if (step.type === 'branch' && step.branches?.length) {
      // 嵌套分支组：默认走无条件主线（通过/兜底）；都带条件时才退到第一个分支兼容旧模板
      const first = step.branches.find(isDefaultBranch) ?? step.branches[0]
      if (first) {
        walkBranch(first)
      }
      return
    }
    pushMembers(step.members)
    for (const sub of step.steps ?? []) {
      walkStep(sub)
    }
  }
  for (const node of flow) {
    if (node.type === 'approval') {
      if (node.nodes.length > 0) {
        chain.push(node.nodes)
      }
      continue
    }
    const first = node.branches.find(isDefaultBranch) ?? node.branches[0]
    if (!first) {
      continue
    }
    walkBranch(first)
  }
  return chain
}

/** 旧的线性 chain 升级为 flow：每个环节变成一个 approval 节点 */
export function chainToFlow (chain: ApprovalChain): ApprovalFlow {
  return chain
    .filter(step => step.length > 0)
    .map(step => ({ id: uid(), type: 'approval' as const, nodes: step }))
}

/**
 * approval_chain 审批订单记录。
 * 字段与 PocketBase collection 保持一致
 * （见 pocketbase/pb_migrations/1788230497_created_approval_chain.js）
 * 除 id 外，collection 中其余字段均为非必填，故声明为可选。
 */
export interface ApprovalOrder {
  id: string
  /** 审批单号 */
  order_no?: string
  /** 审批状态 */
  status?: number
  /** 查询时带了 `expand: 'relation'` 才会有：被展开的 bi_rows 记录（PB 原始记录，
     *  含 snake_case 列与 data 快照）。交给 toProductView 即可转成界面用的中文 key 对象。
     *  没关联数据、或调用方未登录（bi_rows.viewRule 要求已登录）时为空。 */
  expand?: { relation?: Record<string, unknown> | null }
  /** 关联的 `bi_rows` 记录 id（指向 bi_rows 的 relation 字段）。
     *  单值：该字段 maxSelect = 0，按 PB 约定等价于 single，值就是字符串。
     *  见 pocketbase/pb_migrations/1789548325_updated_approval_chain.js */
  relation?: string
  /** 关联行的业务键兜底（= `bi_rows.sync_key`，SKU|店铺|仓位|组别|是否属于呆滞库存）。
     *  bi_rows 每次同步都会重写，行被 prune 后重新出现会换新 id，relation 就指空了；
     *  这一列由业务字段拼成、不受重写影响，用来把单重新对回数据。
     *  见 pocketbase/pb_migrations/1789660200_updated_approval_chain.js */
  sync_key?: string
  /** 审批链快照（json 字段）。
     *  chain 为运行时链路（由 flow + decisions 重算得出，含已办轨迹与当前待办），
     *  flow 为带分支的完整流程（模板，只读），graph 为画布快照，
     *  decisions 为办理流水（按办理顺序追加，同一环节可有多条 = 驳回重审）。 */
  chain?: {
    chain: ApprovalChain
    flow?: ApprovalFlow
    graph?: FlowGraph
    decisions?: NodeDecision[]
    /** 运行时追加的成员（抄送/转办）：stepId → 成员列表。
         *  不能只写进 chain —— chain 是 flow+decisions 的重算结果，下次重算会丢失；
         *  也不能写进 flow —— 那是模板，改了会影响后续所有审批单。 */
    extraMembers?: Record<string, ApprovalChainItem[]>
    /** 建单时冻结的**业务数据快照**：分支条件里的业务字段从这里取（见 FlowContext）。
         *  必须冻结：bi_rows 每次同步都会重写，读实时数据会让历史单的链路回放性变化。 */
    context?: FlowContext
  }
  created?: string
  updated?: string
}

export interface ApprovalModal {
  /** chain 为拍平后的线性链路（兼容旧渲染），flow 为带分支的完整流程，graph 为画布快照 */
  chain: { chain: ApprovalChain, flow?: ApprovalFlow, graph?: FlowGraph }
  name: string
  status: number
  created: string
  id: string
  updated: string
}

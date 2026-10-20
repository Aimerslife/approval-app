/**
 * loopCardGraph.ts
 *
 * 「组间轮询」卡片**内部那一小张画布** ↔ 卡片内部子流程（`ApprovalFlowStep[]`）的转换。
 *
 * 为什么卡片内部用**完整的小画布**（含开始 / 结束节点），而不是自造一套迷你结构：
 *   · 保存时能直接复用**同一个** `graphToFlowFrom` —— 分支命名、条件填全、汇聚点一致、
 *     成环检测、出口判定这一整套规则与校验全部继承，不必再写第二套转换器；
 *     "两套实现"迟早会在某个角落不一致（而那种不一致只在建单时才暴露）；
 *   · 编辑器里看到的就是编主流程时的同一批节点组件与交互，学习成本为零。
 *
 * 与主流程**唯一**的语义差别：内部那个「结束节点」只代表"**这一环**走完了"（继续下一环），
 * 不是"整条流程结束" —— 所以转换时把分支的 `isEnd`（出口）一律清掉，见 flowNodesToSteps。
 */
import type { ApprovalBranch, ApprovalFlow, ApprovalFlowStep } from '@/types/approval'
import { graphToFlowFrom } from '@/utils/approvalFlow'

/** 卡片内部的画布快照（与模板的 `graph` 同一形状，见 types/approval 的 FlowGraph） */
export interface CardGraph {
  nodes: any[]
  edges: any[]
  viewport?: { x: number, y: number, zoom: number }
}

export interface CardGraphResult {
  /** 转换出来的卡片内部子流程（建单期按组各复制一份，见 utils/approvalRotation） */
  steps: ApprovalFlowStep[]
  /** 转换不了的原因；**有它就别用 steps**（保存期直接报给用户） */
  error?: string
  /** 出错的那个内部节点 / 连线，保存时用来在卡片里定位 */
  errorNodeId?: string
  errorEdgeId?: string
}

/**
 * 卡片内部图 → 卡片内部子流程。
 *
 * "里面还什么都没画"单独报一句人话：`graphToFlowFrom` 对空图只会说「缺少开始节点」，
 * 那句话在"卡片刚拖出来还没编辑"的场景里看不出上下文。
 */
export function cardGraphToSteps (
  graph: CardGraph | undefined | null,
  opts: {
    /**
     * 允许"某个审批节点还没配审批人"。默认 true —— 与主画布保存时同一口径
     * （`createStream` 传的也是 true）：**草稿模板先搭架子**是正当需求。
     *
     * 那"没人办"怎么办？不靠这里拦，靠**建单期**拦：展开时会逐环检查卡片内部的
     * 审批节点有没有人（见 utils/approvalRotation），报出来让这一条建单失败 ——
     * 与项目一直以来的口径一致（"没人办的环节会让单子永远停住，当场报出来比事后追查好"）。
     */
    allowEmptyMembers?: boolean
    /**
     * **卡片外**可作跳转目标的环节 id 白名单（口径见 utils/exitTargets）。
     *
     * 卡片内部的分支可以「提前结束轮询 → 跳到卡片外的环节」（面板上配，数据写在内部连线
     * 的 `data.exitMode/exitTo` 上，与主画布同一份格式）。那个环节不在内部图里，
     * 所以既要在转换时放行（透传给 graphToFlowFrom），也要在这里用它做**保存期校验** ——
     * 目标不在名单里就是"外面那个环节被删了"，当场报错，而不是等建单时抛「目标环节不存在」。
     */
    externalApprovalIds?: Set<string>
    /**
     * 环内那条线**没选目标**时的兜底目标（节点 id）—— 卡片上**唯一那条**「提前跳出」出线的目标
     * （见 utils/approvalFlow 的 readLoopOuts）。
     *
     * 有兜底时"只标了提前结束轮询、没选目标"是**合法**的：去向在卡片上配一次就够；
     * 没有兜底才报错（老口径）。
     */
    defaultJumpTarget?: string
    /**
     * 卡片上「提前跳出」出线有几条（见 readLoopOuts 的 earlyCount）。
     *
     * 只用于**报错文案**：多条时没有兜底目标，环内那条线必须自己选 —— 这时要让用户知道
     * "不是漏配了、而是卡片上有多条线得指明走哪一条"，否则他会以为是程序没读到他画的线。
     */
    earlyLineCount?: number
  } = {},
): CardGraphResult {
  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  if (nodes.filter(n => n.type !== 'start' && n.type !== 'end').length === 0) {
    return { steps: [], error: '卡片内部还是空的，请至少放一个审批节点' }
  }
  if (nodes.some(n => n.type === 'loop')) {
    return { steps: [], error: '卡片内部不能再放「组间轮询」卡片（一个环里再套一层环没有确定的含义）' }
  }
  /*
   * 「引用模板」卡片同理：轮询卡片内部是"按组各走一遍"，
   * 而引用搬进来的是一整段流程（还可能自带轮询），"每组各引一份"的语义虽然能实现，
   * 但先明确拒绝 —— 好过留一个没人验证过的组合（见 utils/templateRef 的文件头）。
   */
  if (nodes.some(n => n.type === 'ref')) {
    return { steps: [], error: '轮询卡片内部不能再放「引用模板」卡片，请把它放在卡片外的流程里' }
  }
  /*
   * 至少要有一个审批节点：只有「飞书提醒」的卡片，展开后是一串"到达即穿过"的环 ——
   * 没人办、流程自己走完，单据看起来"已通过"却没有任何人做过决定。
   * 与主流程"至少要有一个审批环节"同一口径（见 utils/approvalFlow）。
   */
  if (!nodes.some(n => n.type === 'approval')) {
    return {
      steps: [],
      error: '卡片内部至少要有一个审批节点（飞书提醒只通知、不办理，整张卡片会没人办）',
    }
  }
  /*
   * 「提前结束轮询」的**死目标**在保存期就拦下来（别留到建单那一刻 —— 那时单子已经建出来了）。
   * 能在这里拦，是因为外层环节清单就是调用方传进来的白名单：
   *   · 选了「提前结束轮询」却没选目标 → **有卡片级兜底时放行**（落到卡片上那条「提前跳出」出线），
   *     否则报错并给出两条出路；
   *   · 目标不在白名单里 → 外面那个环节被删过了，报错。
   * 目标在名单里 = 合法，交给 graphToFlowFrom 原样写进 branch.exitTo。
   */
  const fallback = String(opts.defaultJumpTarget ?? '').trim()
  const earlyCount = Math.max(0, Number(opts.earlyLineCount ?? 0))
  const jumpEdges = edges.filter(e => e?.data?.exitMode === 'jump')
  for (const e of jumpEdges) {
    const to = e.data?.exitTo ? String(e.data.exitTo) : ''
    if (!to) {
      if (fallback) {
        continue
      }
      return {
        steps: [],
        error: earlyCount > 1
          // 多条「提前跳出」时没有"缺省那一条"，必须逐条指明 —— 否则跳去哪说不清
          ? `有分支选了「提前结束轮询」但没选目标环节：这张卡片接了 ${earlyCount} 条「提前跳出」出线，`
            + '程序不知道走哪一条，请在连线下面板里选具体的目标环节'
          : '有分支选了「提前结束轮询」但没选目标环节：请在连线下面板里选一个，'
            + '或者在卡片上拉一条标着「提前跳出」的出线（那条线的目标就是它的去向）',
        errorEdgeId: e.id,
      }
    }
    if (!opts.externalApprovalIds?.has(to)) {
      return { steps: [], error: '有分支的「提前结束轮询」目标环节已不存在（卡片外的那个环节可能被删了），请重新选择', errorEdgeId: e.id }
    }
  }
  const inner = graphToFlowFrom(nodes, edges, {
    allowEmptyMembers: opts.allowEmptyMembers ?? true,
    ...(opts.externalApprovalIds ? { externalApprovalIds: opts.externalApprovalIds } : {}),
    ...(fallback ? { defaultJumpTarget: fallback } : {}),
  })
  if (inner.error) {
    return {
      steps: [],
      error: inner.error,
      errorNodeId: inner.errorNodeId,
      errorEdgeId: inner.errorEdgeId,
    }
  }
  return { steps: flowNodesToSteps(inner.flow) }
}

/**
 * 内部 flow（节点数组）→ 子流程步骤数组（卡片内部存的就是这个形状）。
 *
 * 开始 / 结束节点不产生步骤（它们只是画布的锚点）。
 *
 * ⚠️ **清掉 `isEnd`**：内部分支的连线直达**内部的**结束节点，`graphToFlowFrom` 会把它标成
 * "出口 = 命中即整条流程终止"。可在卡片里它只是"**这一环**走完了"——
 * 照搬的话 A 组走完就把整单结了，后面的组根本轮不到。
 */
export function flowNodesToSteps (flow: ApprovalFlow): ApprovalFlowStep[] {
  const out: ApprovalFlowStep[] = []
  for (const node of flow) {
    if (node.type === 'approval') {
      out.push({
        id: node.id,
        type: 'approval',
        members: node.nodes,
        // 环节级选项树（配在审批节点上）随卡片内部子流程一起带走
        ...(node.optionGroups?.length ? { optionGroups: node.optionGroups } : {}),
      })
      continue
    }
    if (node.type === 'notify') {
      out.push({
        id: node.id,
        type: 'notify',
        name: node.name,
        members: node.members,
        ...(node.content ? { content: node.content } : {}),
      })
      continue
    }
    if (node.type === 'probe') {
      out.push({
        id: node.id,
        type: 'probe',
        name: node.name,
        probe: node.spec,
        branches: node.branches.map(b => clearExit(b)),
      })
      continue
    }
    if (node.type === 'branch') {
      out.push({ id: node.id, type: 'branch', branches: node.branches.map(b => clearExit(b)) })
      continue
    }
    /*
     * `loop`：卡片内部不允许再放卡片（cardGraphToSteps 已拦）。
     * 走到这里说明数据是绕过保存链路塞进来的 —— 不静默丢掉整段子流程，交给展开期报错
     * （见 utils/approvalRotation 的 hasInnerRotation）。
     */
  }
  return out
}

/** 去掉分支的出口标记（见 flowNodesToSteps），并递归处理分支内的嵌套分支 */
function clearExit (b: ApprovalBranch): ApprovalBranch {
  const { isEnd: _isEnd, ...rest } = b
  return { ...rest, steps: (b.steps ?? []).map(s => clearExitStep(s)) }
}

function clearExitStep (s: ApprovalFlowStep): ApprovalFlowStep {
  if (s.type !== 'branch') {
    return s
  }
  return { ...s, branches: (s.branches ?? []).map(b => clearExit(b)) }
}

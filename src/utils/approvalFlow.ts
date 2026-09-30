import type {
  ApprovalBranch,
  ApprovalChainItem,
  ApprovalFlow,
  ApprovalFlowBranchNode,
  ApprovalFlowStep,
  ApprovalNodeData,
  ApprovalOptionGroup,
  BranchCondition,
  ConditionExpr,
  FlowContext, LoopNodeData, ProbeNodeData, ProbeSpec, RotationSpec,
} from '../types/approval'
import { branchConditions, FIELD_REF_PREFIX, isConditionGroup, isResultCondition, normalizeOptionGroups, normalizeOptionTexts, uid } from '../types/approval'
import { findBadProbe } from './approvalProbe'
import { collectRotations, findBadRotation } from './approvalRotation'
import { deriveFlowFields } from './biRowFields'
/*
 * 卡片内部那张小画布 → 子流程（见 loopCardGraph 的说明）。
 * 这里与 loopCardGraph 是**互相 import** 的（它要调本文件的 graphToFlowFrom 转换内部图），
 * 但两处都只在函数体里调用，ESM 的循环依赖完全没问题（模块初始化时谁都不碰对方的值）。
 */
import { cardGraphToSteps } from './loopCardGraph'

/**
 * 把画布图转换为 ApprovalFlow 结构（保存时调用）。
 *
 * 结构要点：
 * - approval 单出边 → 顺序审批环节；多出边 → 先产出审批环节，紧跟一个「审批结果分支组」：
 *   每条出线绑定一个审批结论；**可以**留一条无条件出线当主线兜底（审批通过 / 其余结论走它），
 *   也**允许一条兜底都不留**（每条线各绑自己的结论 —— 见 collectBranchesRaw 的说明）；
 * - condition 节点 → 条件分支组：每条出边是一个分支（label 为分支名，data.condition/conditions 为命中条件）；
 * - 每条分支沿出边走，直到结束节点或「与兄弟分支合流」的汇聚点，中间审批节点拍成该分支 steps；
 * - 分支内允许再出现分支（条件节点 / 出线 > 1 的审批节点）：walkBranch 会递归收集成
 *   type='branch' 的嵌套分支组步骤挂在父分支 steps 里，支持任意层级「分支内再分分支」，无需先汇聚。
 *
 * @param nodes 画布节点（至少含 id / type / data）
 * @param edges 画布连线（至少含 id / source / target / label / data）
 */
export function graphToFlowFrom (
  nodes: any[],
  edges: any[],
  opts: {
    /**
         * 允许「一个审批人都没有」。默认 **false**（正常保存必须至少配一个审批人，
         * 否则单据走到那儿没人办）。
         * 置 true 的两个正当场景：① 批量生成的**草稿模板**（环节先搭好、人后配）；
         * ② 停用状态的模板。生成脚本走的就是这条。
         */
    allowEmptyMembers?: boolean
    /**
     * 「跳出循环」的**外部目标白名单**（节点 id）。
     *
     * 正常保存时这一项是空的：分支的「跳出循环」目标必须是**本图内**的审批环节，
     * 找不到就报「目标环节已不存在」（下面那段校验）。
     *
     * 唯一需要它的地方是**「组间轮询」卡片的内部图**（见 utils/loopCardGraph）：
     * 卡片内部的分支可以「提前结束轮询 → 跳到卡片外的环节」，那个环节当然不在内部图里。
     * 只对卡片内部图开这个口子 —— 卡片内部图走的是**同一个** graphToFlowFrom，
     * 语义上确实允许"引用外层"，所以在校验处放行、而不是另写一套转换器。
     */
    externalApprovalIds?: Set<string>
  } = {},
): {
  flow: ApprovalFlow
  error?: string
  /**
     * 出错的那个**环节**（节点 id）。校验错误原先只给一句文案，用户看到
     * 「请检查连线」却不知道检查哪一条 —— 保存时拿它把环节标红并定位过去。
     * 与画布无关的错误（比如「缺少开始节点」）没有这个字段。
     */
  errorNodeId?: string
  /** 出错的那条**连线**（如分支未命名、分支重名），用于高亮线条 */
  errorEdgeId?: string
} {
  const nodesById = new Map(nodes.map(n => [n.id, n]))
  /**
   * 本图内**可以当「跳出循环」目标**的环节 id：审批环节 + 飞书提醒。
   *
   * 传给卡片内部图当「外部目标白名单」（卡片内部的分支可「提前结束轮询 → 跳到卡片外的环节」，
   * 见 opts.externalApprovalIds）。
   *
   * ⚠️ 这份口径必须与下面的**类型校验**一致：白名单先拦，拦下来报的是"目标环节已不存在" ——
   * 两边不一致时（比如这里只放审批、校验却允许提醒）就会出现"明明选了却报不存在"的假错。踩过。
   */
  const outerExitIds = new Set(
    nodes.filter(n => n.type === 'approval' || n.type === 'notify').map(n => String(n.id)),
  )
  const out = new Map<string, any[]>()
  const inMap = new Map<string, string[]>()
  for (const e of edges) {
    if (!nodesById.has(e.source) || !nodesById.has(e.target)) {
      continue
    }
    out.set(e.source, [...(out.get(e.source) ?? []), e])
    const srcs = inMap.get(e.target) ?? []
    srcs.push(e.source)
    inMap.set(e.target, srcs)
  }

  const start = nodes.find(n => n.type === 'start')
  if (!start) {
    return { flow: [], error: '缺少开始节点' }
  }
  let cur = out.get(start.id)?.[0]?.target
  if (!cur) {
    return { flow: [], error: '开始节点未连接，请从「开始」节点拖出连线到第一个环节', errorNodeId: start.id }
  }

  const flow: ApprovalFlow = []
  const visited = new Set<string>()
  /** 主流程已处理过的步骤（仅由主循环写入），用于识别「驳回/打回返回上层」 */
  const mainVisited = new Set<string>()
  let hasMember = false
  let guard = 0

  /**
     * 给错误补上「是哪个环节出错」。
     *
     * 校验失败的分支有十几处（出线数不对 / 分支没命名 / 分支重名 / 条件没填全 / 只能有一条主线…），
     * 但每处的**责任人**其实都很清楚 —— 就是当前正在处理的节点或那条出线。
     * 与其在每个 return 上手写一遍（漏一个就少一处提示），不如在这里统一补：
     * 已有更精确的归属就不覆盖（嵌套调用里内层先标好）。
     */
  function tagNode<T extends { error?: string, errorNodeId?: string, errorEdgeId?: string }> (
    res: T,
    nodeId?: string,
    edgeId?: string,
  ): T {
    if (res.error) {
      if (nodeId && !res.errorNodeId) {
        res.errorNodeId = nodeId
      }
      if (edgeId && !res.errorEdgeId) {
        res.errorEdgeId = edgeId
      }
    }
    return res
  }

  /** 某节点是否存在「来自本分支已覆盖区域之外」的入线：
     *  入度 > 1 且至少一条入线不属于 inside → 它把本分支与兄弟分支（或上游路径）合流，属于上层汇聚点。 */
  function mergesFromOutside (id: string, inside: Set<string>): boolean {
    const srcs = inMap.get(id) ?? []
    return srcs.length > 1 && srcs.some(s => !inside.has(s))
  }

  /** 标记一个节点已进入流程；已标记说明存在环 / 反向回连 */
  function visit (id: string): boolean {
    if (visited.has(id)) {
      return false
    }
    visited.add(id)
    return true
  }

  /**
   * 审批节点上配的**环节级选项树**（见 ApprovalNodeData.optionGroups）→ 编译产物的字段。
   *
   * 挂在审批环节本身（`ApprovalFlowApprovalNode.optionGroups` / 分支内 `ApprovalFlowStep.optionGroups`），
   * 不再挂到各条结果分支上 —— 办事时整个环节就呈现这一棵树（见 collectStepOptionItems）。
   * **没配就不写字段**，flow 形状与老模板保持一致。
   */
  function optionGroupsField (d?: ApprovalNodeData): { optionGroups?: ApprovalOptionGroup[] } {
    const groups = normalizeOptionGroups(d?.optionGroups)
    return groups.length > 0 ? { optionGroups: groups } : {}
  }

  /**
     * 收集某节点的全部出边为「分支组」：
     * - kind 'approval'：审批结果分支，每条绑定一个审批结论（field=result）；
     *   无条件主线**可选**、至多一条；
     * - kind 'condition'：条件分支，默认分支与表单命中条件可混排；
   * - kind 'probe'：数据查询，两条出边（「存在」/「不存在」），无分支条件 —— 走向由建单期的
   *   查询结果决定（见 utils/approvalProbe），所以这里只收出边、不校验条件。
     * 每条分支用 walkBranch 沿出边走，直到结束节点或「与兄弟分支合流」的汇聚点；
     * 要求所有分支的终点一致（或都到结束），否则该层无法用线性 flow 表达。
     * 分支内允许继续出现分支（条件节点 / 出线 > 1 的审批节点），由 walkBranch 递归收集，
     * 嵌套分支组以 type='branch' 的步骤挂在父分支 steps 里，支持任意层级，无需先汇聚再拆分。
     */
  /**
     * 分支收集的**统一入口**：把错误归属到 sourceId 这个环节上。
     * 这个函数里的错误全出在 sourceId 身上（出线数不够 / 分支没命名 / 重名 / 条件没填全 / 主线不唯一），
     * 所以不需要在每个 return 上手写归属 —— 漏一个就少一处提示。
     */
  function collectBranches (sourceId: string, kind: 'approval' | 'condition' | 'probe') {
    return tagNode(collectBranchesRaw(sourceId, kind), sourceId)
  }

  function collectBranchesRaw (
    sourceId: string,
    kind: 'approval' | 'condition' | 'probe',
  ): {
    branches: ApprovalBranch[]
    converge?: string
    /** 本分支组覆盖的节点（不含其汇聚点），供上层判断嵌套汇聚归属 */
    territory: Set<string>
    error?: string
    errorNodeId?: string
    errorEdgeId?: string
  } {
    /** 该节点是否为结束节点：分支终点是它 → 该分支为出口（命中即终止） */
    const isEndNode = (id?: string) => !!id && nodesById.get(id)?.type === 'end'

    const branchEdges = out.get(sourceId) ?? []
    if (branchEdges.length < 2) {
      return {
        branches: [],
        territory: new Set([sourceId]),
        error:
                    kind === 'approval'
                      ? '审批结果分支至少需要两条出线（一条主线 + 结果分支），请从节点下方拖出连线'
                      : (kind === 'probe'
                          ? '数据查询至少需要两条出边（「存在」与「不存在」），请从节点下方拖出连线'
                          : '条件分支至少需要两条出边（分支），请从节点下方拖出连线'),
      }
    }
    const sourceName = String(nodesById.get(sourceId)?.data?.title ?? '')
    const branches: ApprovalBranch[] = []
    const territory = new Set<string>([sourceId])
    let defaultSeen = false
    let converge: string | undefined
    for (const be of branchEdges) {
      const name = String(be.label ?? '').trim()
      if (!name) {
        return {
          branches, territory,
          error: '请为每条出线命名（点击连线后在上方面板填写）',
          errorEdgeId: be.id,
        }
      }
      if (branches.some(b => b.name === name)) {
        return { branches, territory, error: `分支「${name}」重名，请修改`, errorEdgeId: be.id }
      }
      // 条件：优先用 conditions（可能是条件组），兼容旧的单条件 condition
      const list: ConditionExpr[] = Array.isArray(be.data?.conditions)
        ? be.data.conditions
        : (be.data?.condition
            ? [be.data.condition]
            : [])
      const logic = be.data?.logic === 'or' ? 'or' : 'and'

      /*
       * 这条线上配的「选项文本」（结果分支专用，见 types/approval 的 ApprovalNodeOption）：
       * 办理下拉里按它们逐条渲染，**选哪个都走这条线绑定的那个审批结论**。
       * 没配就**不写这个字段** —— flow 形状与老模板保持一致。
       */
      const optionTexts = normalizeOptionTexts(be.data?.options)

      /*
       * 这条线配的**选项树**（类别 → 一级 → 二级，一级自带"实际链路"）—— 见 types/approval 的 ApprovalOptionGroup。
       * 与选项文本一样，没配就**不写这个字段**，flow 形状与老模板保持一致。
       */
      const optionGroups = normalizeOptionGroups(be.data?.optionGroups)

      /** 递归校验：条件组里的条件也要填全（组可任意嵌套，所以必须递归） */
      const findBad = (items: ConditionExpr[], where: string): string | null => {
        for (const [k, it] of items.entries()) {
          if (isConditionGroup(it)) {
            const err = findBad(it.items ?? [], `${where}第 ${k + 1} 个条件组里的`)
            if (err) {
              return err
            }
            continue
          }
          if (!String(it.field ?? '').trim()) {
            return `${where}第 ${k + 1} 个条件未填写字段名`
          }
          /*
           * 值是数组时（只有「包含」会这样）按"有效值拼接"来看：
           * String(['a','b']) = "a,b" 没问题，但 String(['','']) = "," 会被当成填过，
           * 而它其实一个值都没填 —— 那种情况应该照常报"未填写比较值"。
           */
          const rawValue = (Array.isArray(it.value)
            ? it.value.filter(v => String(v ?? '').trim() !== '').join(',')
            : String(it.value ?? '')).trim()
          if (rawValue === '') {
            return `${where}第 ${k + 1} 个条件未填写比较值`
          }
          /*
           * 「@字段名」= 引用另一个字段的值（见 types/approval 的 FIELD_REF_PREFIX）。
           * 下面两种写法都会**静默失效**（条件永远不命中），所以在这里明确拦下：
           *   ① 只写了一个 @，没写字段名；
           *   ② 审批结论条件写成了引用 —— 它的值会被 firstResultValueOf 当结论码读走
           *      （用来判定终态和可选结论），引用语法对它一律不生效。
           */
          if (rawValue === FIELD_REF_PREFIX) {
            return `${where}第 ${k + 1} 个条件写了「${FIELD_REF_PREFIX}」但没写引用的字段名`
          }
          if (it.field === 'result' && rawValue.startsWith(FIELD_REF_PREFIX)) {
            return `${where}第 ${k + 1} 个条件是审批结论条件，比较值必须是结论码，不能写成「${FIELD_REF_PREFIX}字段名」`
          }
        }
        return null
      }

      if (kind === 'approval') {
        if (list.length > 0) {
          // 结果分支必须有一个**顶层**结论条件。
          // 组里的 result 不做硬前提、按组运算（口径见 firstResultValueOf），所以不算数。
          if (!list.some(isResultCondition)) {
            return {
              branches,
              territory,
              // 带上出错的那条线：编辑器据此把它标红（只说"哪条线"不够，得让人一眼看到）
              error: `「${name}」不是有效的审批结果分支，请点击该线，在连页面板里选择对应审批结论`,
              errorEdgeId: be.id,
            }
          }
          const err = findBad(list.filter(x => !isResultCondition(x)), `「${name}」的`)
          if (err) {
            return { branches, territory, error: err }
          }
        } else {
          if (defaultSeen) {
            return {
              branches,
              territory,
              error: `「${sourceName || '未命名审批'}」只能有一条主线（无条件出线），其余结果分支需分别绑定审批结论`,
            }
          }
          defaultSeen = true
        }
      } else {
        const err = findBad(list, `分支「${name}」的`)
        if (err) {
          return { branches, territory, error: err }
        }
      }

      const walk = walkBranch(be.target, sourceId, name)
      if (walk.error) {
        return {
          branches, territory, error: walk.error,
          errorNodeId: walk.errorNodeId, errorEdgeId: walk.errorEdgeId,
        }
      }
      for (const t of walk.territory) {
        territory.add(t)
      }

      if (walk.loopBackTo) {
        // 驳回/打回返回上层：该分支的走向不再推进主干，仅记录 loopBackTo，
        // 不参与本层「汇聚」判定（避免与正常分支的汇聚点不一致而误报）。
        branches.push({
          id: be.id,
          name,
          // 兼容旧结构：单条件取首条；多条件走 conditions + logic
          condition: asSingleCondition(list[0]),
          logic,
          conditions: list.length > 0 ? list : undefined,
          steps: walk.steps,
          ...(optionTexts.length > 0 ? { options: optionTexts } : {}),
          ...(optionGroups.length > 0 ? { optionGroups } : {}),
          loopBackTo: { stepId: walk.loopBackTo },
          // 回退目标是已办环节，通常不是出口；仍按终点如实记录
          isEnd: isEndNode(walk.terminal),
        })
        continue
      }

      if (converge !== undefined && converge !== walk.terminal) {
        // 允许「部分分支直接走到结束（视为出口）+ 其余分支汇聚到同一节点」的形态：
        // 真实业务中常见「某审批结果直接结束流、其它结果继续推进」（如驳回/撤回→结束，通过→继续）。
        // 仅当多条非结束分支各自汇到不同节点（无法确定下一步）时仍然报错。
        if (isEndNode(converge) && !isEndNode(walk.terminal)) {
          // 之前已设的汇聚是结束，现在这条分支继续推进 → 以该节点为新汇聚
          converge = walk.terminal
        } else if (!isEndNode(converge) && isEndNode(walk.terminal)) {
          // 这条分支直接结束（出口），不影响已有汇聚
        } else {
          return {
            branches,
            territory,
            error: '多条分支必须汇聚到同一个节点（或都接到结束节点），请检查连线',
          }
        }
      } else {
        converge = walk.terminal
      }

      /*
       * 「跳出循环」的目标环节由画布面板写在连线 data 上（见 pages/createStream.vue 的分支面板）。
       * 校验放在**保存期**：目标缺失 / 指向自己 / 指向非审批节点都当场报错并指出是哪条线，
       * 否则只能等运行期 rebuildChain 抛错或静默跳过 —— 那时最难查（单据已经建出来了）。
       */
      const exitMode = be.data?.exitMode === 'jump' ? 'jump' : 'end'
      const exitToId = exitMode === 'jump' && be.data?.exitTo ? String(be.data.exitTo) : ''
      if (exitMode === 'jump' && !exitToId) {
        return {
          branches,
          territory,
          error: `「${name}」选了「跳出循环」但没选目标环节，请在上面板里选择要跳到哪个环节`,
          errorEdgeId: be.id,
        }
      }
      if (exitToId) {
        const target = nodesById.get(exitToId)
        // 卡片内部图引用的"卡片外环节"：本图里当然找不到（见 opts.externalApprovalIds）
        const external = !!opts.externalApprovalIds?.has(exitToId)
        if (!target && !external) {
          return {
            branches,
            territory,
            error: `「${name}」的「跳出循环」目标环节已不存在（连线可能被删过），请重新选择`,
            errorEdgeId: be.id,
          }
        }
        if (exitToId === sourceId) {
          return {
            branches,
            territory,
            error: `「${name}」的「跳出循环」目标不能是本分支所在的那个环节自己`,
            errorEdgeId: be.id,
          }
        }
        /*
         * 目标可以是**审批环节**（跳过去接着办），也可以是**飞书提醒**：
         * 提醒节点本身就是"到达即穿过"（不记结论、不停留，但会真的发一条通知），
         * 所以"某个组做完先通知一下、再继续往下走"是有意义的跳法。
         * 开始 / 结束 / 分支 / 数据查询都没有"到达"这一步，仍然不允许。
         * 外部目标（卡片内部图引用的卡片外环节）的类型由外层图自己保证 —— 白名单就是照它们建的。
         */
        if (target && !['approval', 'notify'].includes(String(target.type))) {
          return {
            branches,
            territory,
            error: `「${name}」的「跳出循环」目标必须是审批环节或飞书提醒`,
            errorEdgeId: be.id,
          }
        }
      }

      branches.push({
        id: be.id,
        name,
        // 兼容旧结构：单条件取首条；多条件走 conditions + logic
        condition: asSingleCondition(list[0]),
        logic,
        conditions: list.length > 0 ? list : undefined,
        steps: walk.steps,
        // 这条线配的选项文本（办理下拉按它渲染，选哪个都走本分支的结论码）
        ...(optionTexts.length > 0 ? { options: optionTexts } : {}),
        // 这条线配的选项树（办理时展开成「类别 → 一级 → 二级」，一级的 link 决定实际链路）
        ...(optionGroups.length > 0 ? { optionGroups } : {}),
        // 出口标记在此写死：分支汇到后续节点时 steps 同样为空，
        // 运行时靠它区分「终止」与「汇聚后继续」，不必回查画布。
        // ⚠️ 「跳出循环」的分支连线仍指向「结束」节点（画布是树，画不出"汇回主干"的合并线），
        //    但它**不是**出口 —— 运行时要跳到目标环节继续办，所以这里必须写死 false。
        isEnd: exitToId ? false : isEndNode(walk.terminal),
        ...(exitToId ? { exitTo: { stepId: exitToId } } : {}),
      })
    }
    /*
     * 这里**不再**强制"必须有一条主线"。
     *
     * 原规则：审批结果分支组里必须留一条无条件出线当兜底（其余出线各自绑结论）。
     * 现在允许**每条出线都绑自己的结论 / 条件**，一条兜底都不留 —— 业务上更精确：
     * 想走哪条就走哪条，不再有"悄悄落到兜底线上"的余地。
     *
     * 代价与配套（三处口径必须一致，改这里时一并想清楚）：
     *   · "最多一条主线"仍然保留（上面 defaultSeen 那段）—— 两条无条件出线无法确定走哪条；
     *   · 运行期"一条都没命中"的情况变多了，types/approval.ts 里对它的处理已改为
     *     **停在当前环节**（不再是静默 done=true 判成已通过）；
     *   · 真要"其它结论都走这条"时，仍然可以留一条无条件主线（语义不变）。
     */
    // 所有分支都返回上层 → 主干没有继续推进的走向
    if (branches.length > 0 && branches.every(b => b.loopBackTo)) {
      return {
        branches,
        territory,
        error: `「${sourceName || '未命名节点'}」的所有分支都设置了「返回上层」，主干缺少继续推进的分支，请至少保留一条向前走的分支`,
      }
    }
    return { branches, converge, territory }
  }

  /**
     * 沿一条分支从 startId 一路走到它的终点：
     * - 终点 = 结束节点，或「入度 > 1 且入线来自本分支覆盖区域之外」的汇聚点（即在此与兄弟分支合流）；
     *   终点不写入 territory，它归属上层继续处理；
     * - 路径上遇到条件节点，或出线 > 1 的审批节点，表示分支内还要再分流：
     *   递归收集成嵌套分支组；审批分流时该审批节点自身先在本分支里作为一个审批步骤；
     *   嵌套分支组的汇聚点若只合并本分支内部的子分支，就当作分支内的普通节点继续往下走，
     *   直到真正的本层汇聚点 —— 因此「分支内再分分支」无需先汇聚。
     */
  /** 分支行走的**统一入口**：分支内的错误（走不通 / 成环 / 悬空）兜底归属到分支起点 */
  function walkBranch (startId: string, ownerId: string, branchName: string) {
    return tagNode(walkBranchRaw(startId, ownerId, branchName), startId)
  }

  function walkBranchRaw (
    startId: string,
    ownerId: string,
    branchName: string,
  ): {
    steps: ApprovalFlowStep[]; terminal?: string; territory: Set<string>
    error?: string; loopBackTo?: string; errorNodeId?: string; errorEdgeId?: string
  } {
    const steps: ApprovalFlowStep[] = []
    const territory = new Set<string>()
    let p: string | undefined = startId
    let g = 0
    while (g++ < 500) {
      if (!p) {
        return { steps, territory, error: `分支「${branchName}」未连接完整，请接回主流程或结束节点` }
      }
      // 驳回/打回返回上一层：分支路径走到主流程之前已经处理过的步骤 → 视为「返回上层」分支
      // （要先于 ownerId 判定，否则「回到分支源」会被误报为环）
      if (mainVisited.has(p)) {
        return { steps, territory, terminal: p, loopBackTo: p }
      }
      if (p === ownerId) {
        return { steps, territory, error: '流程中检测到环，请检查画布' }
      }
      const pn = nodesById.get(p)
      if (!pn) {
        return { steps, territory, error: '流程中存在悬空连线' }
      }
      if (pn.type === 'end') {
        return { steps, territory, terminal: p }
      }

      // 与兄弟分支在此合流 → 本分支到此为止，汇聚点交给上层
      if (mergesFromOutside(p, territory)) {
        return { steps, territory, terminal: p }
      }

      territory.add(p)
      const outs: any[] = out.get(p) ?? []

      /*
       * 分支内再分流：条件节点 / 数据查询 / 出线 > 1 的审批节点。
       *
       * 「数据查询」允许放在分支里：它和「按组轮询」一样在**建单期**求值、展开成"命中的那条分支"，
       * 所以"父分支到底走没走到"不影响它 —— 展开后结构是确定的。
       * 代价也与轮转一致：**没走到的那条分支里的查询也会被执行一次**
       * （轮转的组也照样会去查），这是"建单期冻结"这条路必须付的。
       */
      if (pn.type === 'condition' || pn.type === 'probe' || (pn.type === 'approval' && outs.length > 1)) {
        const kind = pn.type === 'approval' ? 'approval' : (pn.type === 'probe' ? 'probe' : 'condition')
        const nested = collectBranches(p, kind)
        if (nested.error) {
          return { steps, territory, error: nested.error }
        }
        if (pn.type === 'approval') {
          // 结果分流前，该审批环节自身先在本分支里审一次（与顶层「审批环节 + 结果分支组」一致）
          if (!visit(p)) {
            return { steps, territory, error: '流程中检测到环（节点被重复经过），请检查连线' }
          }
          const d = pn.data as ApprovalNodeData
          if (d.members.length > 0) {
            hasMember = true
          }
          steps.push({
            id: pn.id,
            name: d.title,
            members: d.members.map((m: ApprovalChainItem) => ({ ...m })),
            // 环节级选项树（画布上配在审批节点上）：办理时整个环节呈现这一棵树
            ...optionGroupsField(d),
          })
        } else if (!visit(p)) {
          return { steps, territory, error: '流程中检测到环（节点被重复经过），请检查连线' }
        }
        for (const t of nested.territory) {
          territory.add(t)
        }
        if (pn.type === 'probe') {
          /*
           * 数据查询：校验集合名与两条出边之后**原样**挂成一步 ——
           * 不在这里求值，求值统一发生在建单期的 expandProbes（见 utils/approvalProbe）。
           */
          const d = pn.data as ProbeNodeData | undefined
          const filter = String(d?.probe?.filter ?? '').trim()
          const spec: ProbeSpec = {
            collection: String(d?.probe?.collection ?? '').trim(),
            ...(filter ? { filter } : {}),
          }
          const bad = findBadProbe(spec, (nested.branches ?? []).map(b => b.name))
          if (bad) {
            return { steps, territory, error: bad, errorNodeId: pn.id }
          }
          const title = String(d?.title ?? '').trim()
          steps.push({
            id: `${pn.id}:nested`,
            ...(title ? { name: title } : {}),
            type: 'probe',
            probe: spec,
            branches: nested.branches,
          })
        } else {
          // 嵌套分支组作为一个分支步骤挂进来（branches 可继续递归，即分支内的分支）
          steps.push({
            id: `${pn.id}:nested`,
            type: 'branch',
            branches: nested.branches,
          })
        }

        // 嵌套分支组都汇到结束：本分支也随之终止
        if (nested.converge === undefined || nested.converge === 'end') {
          return { steps, territory, terminal: nested.converge ?? p }
        }
        // 嵌套汇聚点若还与其它兄弟分支合流 → 是本分支终点；否则只是分支内部汇聚，继续走
        if (mergesFromOutside(nested.converge, territory)) {
          return { steps, territory, terminal: nested.converge }
        }
        p = nested.converge
        continue
      }

      // 普通审批步骤（单条出线）
      if (pn.type === 'approval') {
        if (outs.length === 0) {
          return {
            steps,
            territory,
            error: `「${(pn.data as ApprovalNodeData)?.title || '未命名环节'}」没有出线，请从节点下方拖出连线到下一步或结束`,
          }
        }
        if (!visit(p)) {
          return { steps, territory, error: '流程中检测到环（节点被重复经过），请检查连线' }
        }
        const d = pn.data as ApprovalNodeData
        if (d.members.length > 0) {
          hasMember = true
        }
        steps.push({
          id: pn.id,
          name: d.title,
          members: d.members.map((m: ApprovalChainItem) => ({ ...m })),
          ...optionGroupsField(d),
        })
        p = outs[0].target
        continue
      }

      // 飞书提醒：分支里的一环，同样只通知、不办理（不占审批人、不等待结论）
      if (pn.type === 'notify') {
        const notifyName = String(pn.data?.title ?? '').trim() || '飞书提醒'
        if (outs.length !== 1) {
          return {
            steps,
            territory,
            error: `「${notifyName}」是飞书提醒节点，必须恰好有一条出线（它没有审批结论，无法分流）`,
            errorNodeId: p,
          }
        }
        const ms = (pn.data?.members ?? []).map((m: any) => ({ ...m }))
        if (ms.length === 0) {
          return {
            steps,
            territory,
            error: `「${notifyName}」还没有添加提醒对象，请点击该节点添加`,
            errorNodeId: p,
          }
        }
        if (!visit(p)) {
          return { steps, territory, error: '流程中检测到环（节点被重复经过），请检查连线' }
        }
        const content = String(pn.data?.content ?? '').trim()
        steps.push({
          id: pn.id,
          type: 'notify',
          name: notifyName,
          members: ms,
          ...(content ? { content } : {}),
        })
        p = outs[0].target
        continue
      }

      /*
       * 「组间轮询」卡片（落在分支链里的形态）：转成 `type='loop'` 的**步骤**。
       *
       * 它与"顶层卡片"唯一的不同只是产物形态（顶层展开成节点、分支里展开成步骤），
       * 展开逻辑与全部校验都共用一份（见 utils/approvalRotation）。
       * 这就是「先按条件分流、只有某条分支里才轮询各组」—— 把卡片画在条件/结果分支后面即可。
       */
      if (pn.type === 'loop') {
        const d = pn.data as LoopNodeData
        const title = String(d?.title ?? '').trim() || '组间轮询'
        if (outs.length === 0) {
          return {
            steps,
            territory,
            error: `卡片「${title}」没有出线，请从卡片下方拖出连线接回本分支后续或结束节点`,
            errorNodeId: p,
          }
        }
        /*
         * 卡片不接受多条出线：它的每一条出线都要按组复制一份，"第几环走哪条"说不清。
         * 要按结论分流就把条件分支画进卡片内部（那里是按组各判一次的）。
         */
        if (outs.length > 1) {
          return {
            steps,
            territory,
            error: `卡片「${title}」只能有一条出线；要按审批结论分流，请把条件分支画在卡片内部`,
            errorNodeId: p,
          }
        }
        if (!visit(p)) {
          return { steps, territory, error: '流程中检测到环（节点被重复经过），请检查连线' }
        }
        // 卡片内部图允许「提前结束轮询」跳到**卡片外**的环节 → 把本图的审批环节当白名单传进去
        const inner = cardGraphToSteps(d?.graph, { externalApprovalIds: outerExitIds })
        if (inner.error) {
          return { steps, territory, error: `卡片「${title}」内部：${inner.error}`, errorNodeId: p }
        }
        if (!d?.rotation) {
          return { steps, territory, error: `卡片「${title}」还没有轮询配置，请点卡片填写「组字段」`, errorNodeId: p }
        }
        steps.push({
          id: pn.id,
          type: 'loop',
          name: title,
          rotation: d.rotation,
          steps: inner.steps,
        })
        p = outs[0].target
        continue
      }
      return { steps, territory, error: '流程中存在不支持的节点类型，请检查画布' }
    }
    return { steps, territory, error: '流程中检测到环，请检查画布' }
  }

  while (guard++ < 500) {
    if (!cur) {
      return { flow: [], error: '主路径未连接到结束节点' }
    }
    const node = nodesById.get(cur)
    if (!node) {
      return { flow: [], error: '流程中存在悬空连线' }
    }
    // 分支/主线汇聚之后，业务节点只允许被主路径经过一次；重复经过即存在环或反向回连
    if ((node.type === 'approval' || node.type === 'condition' || node.type === 'notify' || node.type === 'probe') && visited.has(cur)) {
      const t = String((node.data as ApprovalNodeData)?.title || '未命名环节')
      return {
        flow: [],
        error: `「${t}」被重复经过（流程中检测到环），请检查连线`,
        errorNodeId: cur,
      }
    }

    if (node.type === 'end') {
      // 校验：所有业务节点都必须挂在主路径上
      const orphans = nodes.filter(
        n => (n.type === 'approval' || n.type === 'condition' || n.type === 'notify' || n.type === 'probe') && !visited.has(n.id),
      )
      if (orphans.length > 0) {
        // 点名说清是哪几个环节 —— 只说「存在未连接的节点」用户在几十个框里找不到
        const names = orphans
          .slice(0, 3)
          .map(n => `「${String((n.data as ApprovalNodeData)?.title || '未命名环节')}」`)
          .join('、')
        return {
          flow: [],
          error: `${names}${orphans.length > 3 ? ` 等 ${orphans.length} 个环节` : ''}没有连接进主流程，请检查连线`,
          errorNodeId: orphans[0].id,
        }
      }
      /*
       * 至少要有一个「审批环节」。
       *
       * 飞书提醒环只通知、不办理，**没有谁能推进它** ——
       * 「开始 → 提醒 → 结束」这种模板建单后会永远停在「进行中」（currentStep 是 -1，
       * done 也不会变 true），而下面那道 hasMember 检查是为"草稿模板先搭架子"放行的
       * （编辑器保存时传的是 allowEmptyMembers: true），拦不住它。
       * 宁可当场拒绝，也不要留一张谁也推不动的单。
       *
       * 判"画布上有没有审批节点"就够：走到这里时所有审批节点都已被 orphans 检查确认接入流程。
       */
      /*
       * 「组间轮询」卡片也算：卡片内部**必须**至少有一个审批节点
       * （见 utils/loopCardGraph 的校验），所以它一定含"有人办"的环节。
       * 只放一张卡片、没有别的审批节点的模板是合法的（开始 → 卡片 → 结束）。
       */
      if (!nodes.some(n => n.type === 'approval' || n.type === 'loop')) {
        return {
          flow: [],
          error: '流程里至少要有一个审批环节：飞书提醒只通知、不办理，没法单独构成流程',
        }
      }
      if (!hasMember && !opts.allowEmptyMembers) {
        // 同样点名：没人办的那一环是哪个
        const noMember = nodes.find(
          n => n.type === 'approval' && !(n.data as ApprovalNodeData)?.members?.length,
        )
        const t = noMember ? String((noMember.data as ApprovalNodeData)?.title || '未命名环节') : ''
        return {
          flow: [],
          error: noMember
            ? `「${t}」还没有添加审批人，请点击该环节添加`
            : '请至少添加一个审批人',
          ...(noMember ? { errorNodeId: noMember.id } : {}),
        }
      }
      /*
       * 轮询配置的保存期校验。
       *
       * 走 `collectRotations` 而不是在 walk 里逐处查：那个函数已经覆盖了所有能配轮询的位置
       * （顶层审批节点 / 分支步骤），加校验不必去改四五个地方 —— 漏一处就有一处配错不被拦。
       */
      for (const { id, spec } of collectRotations(flow)) {
        const err = findBadRotation(spec)
        if (err) {
          return { flow: [], error: err, errorNodeId: id }
        }
      }
      return { flow }
    }

    if (node.type === 'approval') {
      visited.add(cur)
      mainVisited.add(cur)
      const d = node.data as ApprovalNodeData
      if (d.members.length > 0) {
        hasMember = true
      }
      flow.push({
        id: node.id,
        type: 'approval',
        nodes: d.members.map((m: ApprovalChainItem) => ({ ...m })),
        // 环节级选项树（画布上配在审批节点上）：办理时整个环节呈现这一棵树
        ...optionGroupsField(d),
      })
      const nexts = out.get(cur) ?? []
      if (nexts.length === 0) {
        return {
          flow: [],
          error: `「${d.title || '未命名环节'}」没有出线，请从节点下方拖出连线到下一步或结束`,
          errorNodeId: cur,
        }
      }
      // 单条出线 = 顺序推进
      if (nexts.length === 1) {
        cur = nexts[0].target
        continue
      }
      // 多条出线 = 审批结果分支：本环节审批结束后按审批结论走不同走向
      const result = collectBranches(cur, 'approval')
      if (result.error) {
        return {
          flow: [], error: result.error,
          errorNodeId: result.errorNodeId, errorEdgeId: result.errorEdgeId,
        }
      }
      flow.push({ id: `${node.id}:result`, type: 'branch', branches: result.branches! })
      cur = result.converge
      continue
    }

    if (node.type === 'loop') {
      /*
       * 「组间轮询」卡片：把卡片内部那张小画布转成子流程（steps），交给建单期按组复制
       * （见 utils/approvalRotation 的 stampRing）。
       *
       * 内部图走**同一个** graphToFlowFrom（分支命名、条件填全、汇聚、成环检测全部继承），
       * 转换失败就把原因归到卡片这个节点上 —— 保存时能直接标红定位。
       */
      visited.add(cur)
      mainVisited.add(cur)
      const d = node.data as LoopNodeData
      const name = d?.title || '组间轮询'
      // 同上：卡片内部图可以用「提前结束轮询」跳到卡片外的环节
      const inner = cardGraphToSteps(d?.graph, { externalApprovalIds: outerExitIds })
      if (inner.error) {
        return {
          flow: [],
          error: `卡片「${name}」内部：${inner.error}`,
          errorNodeId: cur,
        }
      }
      flow.push({
        id: node.id,
        type: 'loop',
        name,
        rotation: d?.rotation as RotationSpec,
        steps: inner.steps,
      })
      const nexts = out.get(cur) ?? []
      if (nexts.length === 0) {
        return {
          flow: [],
          error: `卡片「${name}」没有出线，请从卡片下方拖出连线到下一步或结束`,
          errorNodeId: cur,
        }
      }
      /*
       * 卡片是"一段子流程"，**不支持**多条出线（审批结果分流）：
       * 它的每一条出线都要按组复制一份，语义上说不清"第几环走哪条"。
       * 要按结论分流，请把分支画在卡片**内部**（那才是"每个组各自分流"）。
       */
      if (nexts.length > 1) {
        return {
          flow: [],
          error: `卡片「${name}」只能有一条出线；要按审批结论分流，请把条件分支画在卡片内部`,
          errorNodeId: cur,
        }
      }
      cur = nexts[0].target
      continue
    }

    if (node.type === 'condition') {
      visited.add(cur)
      mainVisited.add(cur)
      const res = collectBranches(cur, 'condition')
      if (res.error) {
        return {
          flow: [], error: res.error,
          errorNodeId: res.errorNodeId, errorEdgeId: res.errorEdgeId,
        }
      }
      flow.push({ id: node.id, type: 'branch', branches: res.branches! })
      cur = res.converge
      continue
    }

    /*
     * 数据查询节点：**两条出边**（存在 / 不存在），本身不带分支条件 ——
     * 走哪条由**建单期**的查询结果决定（见 utils/approvalProbe）。
     * 所以这里只收出边 + 做保存期校验（集合白名单、两条出边名字对不对），不校验条件。
     */
    if (node.type === 'probe') {
      visited.add(cur)
      mainVisited.add(cur)
      const res = collectBranches(cur, 'probe')
      if (res.error) {
        return {
          flow: [], error: res.error,
          errorNodeId: res.errorNodeId, errorEdgeId: res.errorEdgeId,
        }
      }
      const d = node.data as ProbeNodeData | undefined
      const filter = String(d?.probe?.filter ?? '').trim()
      const spec: ProbeSpec = {
        collection: String(d?.probe?.collection ?? '').trim(),
        ...(filter ? { filter } : {}),
      }
      const bad = findBadProbe(spec, (res.branches ?? []).map(b => b.name))
      if (bad) {
        return { flow: [], error: bad, errorNodeId: cur }
      }
      const title = String(d?.title ?? '').trim()
      flow.push({
        id: node.id,
        type: 'probe',
        ...(title ? { name: title } : {}),
        spec,
        branches: res.branches!,
      })
      cur = res.converge
      continue
    }

    // 飞书提醒：只通知、不办理 —— 直接穿过，成为 flow 里的一个 notify 节点
    if (node.type === 'notify') {
      visited.add(cur)
      const notifyName = String(node.data?.title ?? '').trim() || '飞书提醒'
      const outs: any[] = out.get(cur) ?? []
      // 它没有审批结论、也没有条件可分流，所以出线必须恰好一条
      if (outs.length !== 1) {
        return {
          flow: [],
          error: `「${notifyName}」是飞书提醒节点，必须恰好有一条出线（它没有审批结论，无法分流）`,
          errorNodeId: cur,
        }
      }
      const members = (node.data?.members ?? []).map((m: any) => ({ ...m }))
      // 没有人可提醒 = 这一环什么也不会发生。当场报出来，别留一个静默的空环节
      if (members.length === 0) {
        return {
          flow: [],
          error: `「${notifyName}」还没有添加提醒对象，请点击该节点添加`,
          errorNodeId: cur,
        }
      }
      const content = String(node.data?.content ?? '').trim()
      flow.push({
        id: node.id,
        type: 'notify',
        name: notifyName,
        members,
        ...(content ? { content } : {}),
      })
      cur = outs[0].target
      continue
    }

    return { flow: [], error: `未知的节点类型「${String(node.type ?? '')}」，请检查画布`, errorNodeId: cur }
  }
  return { flow: [], error: '流程中检测到环，请检查画布' }
}

// ===== 自动补「驳回 → 回退到上一级」 =====

/** 自动生成的回退分支名 */
/* ==================== 条件求值的业务上下文 ==================== */

/** 这些不是业务字段（记录元数据 / 关联展开），不参与条件求值 */
const META_KEYS = new Set([
  'id', 'sync_key', 'component_id', 'fetched_at', 'created', 'updated',
  'collectionId', 'collectionName', 'key', 'expand',
])

/**
 * 千分位数值字符串还原成数字。
 * 页面上的行是**展示用**的（formatDatas 把数字格式化成 "1,234"），
 * 直接拿去比较时 Number("1,234") === NaN → 所有数值条件都会判 false。
 */
function normalizeValue (v: unknown): unknown {
  if (typeof v !== 'string') {
    return v
  }
  const s = v.trim()
  return /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? Number(s.replace(/,/g, '')) : s
}

/**
 * 把一行数据（PB 原始记录 / 中文 key 的视图对象）转成条件求值用的业务上下文。
 * PB 记录的真正业务列在 `data` 里，这里会摊平进来。
 */
export function toFlowContext (row?: Record<string, unknown> | null): FlowContext {
  if (!row) {
    return {}
  }
  const out: FlowContext = {}
  for (const [k, v] of Object.entries(row)) {
    if (META_KEYS.has(k)) {
      continue
    }
    if (k === 'data' && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [dk, dv] of Object.entries(v as Record<string, unknown>)) {
        out[dk] = normalizeValue(dv)
      }
      continue
    }
    out[k] = normalizeValue(v)
  }
  // 派生指标（毛利率、海外仓库存金额）BI 里没有这两列，必须算进来 ——
  // 流程条件写的就是它们（如「毛利率 > 0」），不补上条件永远不会成立
  return { ...out, ...deriveFlowFields(out) }
}

/**
 * 单据的条件求值上下文：**优先用建单时的快照**（见 FlowContext 的注释），
 * 老单（没有快照）退化为读实时关联数据 —— 至少让它们按当前数据正确分流。
 *
 * ⚠️ 三个重算入口（审批页 / 首页抽屉 / 提交环节）**必须都走这个函数**取上下文：
 * 只要有一处少传或传了不同的数据，算出的 stepIds 就会不一致，
 * 结论会被记到别的环节上（而且看不出来）。
 */
export function flowContextOfOrder (order?: {
  chain?: { context?: FlowContext }
  expand?: { relation?: Record<string, unknown> | null }
} | null): FlowContext {
  const snap = order?.chain?.context
  if (snap && Object.keys(snap).length > 0) {
    return snap
  }
  return toFlowContext(order?.expand?.relation ?? null)
}

export const REJECT_BACK_NAME = '驳回回退上一级'
/** 回退分支组里与驳回并列的主线分支名 */
const MAIN_LINE_NAME = '主线'

/** 回退分支的命中条件：上一环节审批结论 = reject */
function rejectCondition (): BranchCondition {
  return { field: 'result', op: 'eq', value: 'reject' }
}

/** 造一条「驳回 → 回退到 targetId 环节」的分支 */
function makeRejectBackBranch (targetId: string): ApprovalBranch {
  const c = rejectCondition()
  return {
    id: uid(),
    name: REJECT_BACK_NAME,
    // 兼容旧结构：单条件取首条；多条件走 conditions
    condition: c,
    logic: 'and',
    conditions: [c],
    // 回退分支不独占环节：命中后由 rebuildChain 的 loopBackTo 处理
    steps: [],
    loopBackTo: { stepId: targetId },
    // 明确非出口。不写的话旧数据会回查画布快照（terminalMap），
    // 而自动注入的分支不在画布上，查不到会被当「非出口」——写上更直白且不受快照影响
    isEnd: false,
  }
}

/**
 * 回退分支组的两个分支：[驳回→回退, 主线]。
 * 主线（无条件兜底分支）**必须**有：否则非驳回结论在 matchBranch 里拿不到兜底分支，
 * 会被判成「无分支命中 → 流程终止」，整个流程在第一个环节后就断了。
 */
function rejectBackBranches (targetId: string): ApprovalBranch[] {
  return [
    makeRejectBackBranch(targetId),
    {
      id: uid(),
      name: MAIN_LINE_NAME,
      condition: null,
      conditions: [],
      steps: [],
      isEnd: false,
    },
  ]
}

/**
 * legacy 的**单条件**字段（`condition`）只接受"平条件"（BranchCondition）。
 * `conditions` 里的元素是 `ConditionExpr`，可能是条件、也可能是嵌套条件组 ——
 * 直接把 `ConditionExpr` 赋给 `condition` 过不了类型检查（TS2322）。
 * 条件组不写进 `condition`：新数据一律看 `conditions`，legacy 字段只作兼容读取。
 */
function asSingleCondition (expr: ConditionExpr | undefined): BranchCondition | null {
  if (!expr || Array.isArray(expr) || !('field' in expr)) {
    return null
  }
  return expr
}

/** 该分支首个"平条件"的字段名（条件组不算）——同 asSingleCondition 的收窄理由 */
function firstConditionField (b: ApprovalBranch): string | undefined {
  const first = asSingleCondition(branchConditions(b)[0])
  return first?.field
}

/** 该分支组里是否已有「驳回 → targetId」的回退分支：重复保存时避免叠加 */
function hasRejectBack (branches: ApprovalBranch[], targetId: string): boolean {
  return branches.some(
    b => b.loopBackTo?.stepId === targetId && firstConditionField(b) === 'result',
  )
}

/** 往已有分支组里补一条回退分支；已存在则原样返回 */
function appendRejectBack (branches: ApprovalBranch[], targetId: string) {
  if (hasRejectBack(branches, targetId)) {
    return
  }
  branches.push(makeRejectBackBranch(targetId))
}

export function ensureRejectLoopBack (flow: ApprovalFlow): ApprovalFlow {
  const out: ApprovalFlow = []
  let prevId: string | undefined

  for (let i = 0; i < flow.length; i++) {
    const node = flow[i]

    if (node.type === 'branch') {
      out.push(node)
      for (const b of node.branches) {
        b.steps = ensureRejectLoopBackInSteps(b.steps, prevId)
      }
      continue
    }

    /*
     * 「组间轮询」卡片：内部子流程同样要补「驳回 → 回退上一级」。
     *
     * 卡片内部**首个**环节的"上一级"是卡片**之前**那个环节（incomingPrev）—— 与分支组内的
     * 首个步骤同一口径；卡片作为整体只占一个 prevId（下一节点的驳回目标是卡片本身，
     * 而卡片在展开后会被重映射到第一环的第一个环节，于是"整张卡片重走"）。
     */
    if (node.type === 'loop') {
      out.push({ ...node, steps: ensureRejectLoopBackInSteps(node.steps, prevId) })
      prevId = node.id
      continue
    }

    out.push(node)
    const next = flow[i + 1]
    if (prevId) {
      // 后面已紧跟分支组 → 并进去，保留手绘分支；否则新建一个分支组
      if (next && next.type === 'branch') {
        appendRejectBack(next.branches, prevId)
      } else {
        const group: ApprovalFlowBranchNode = {
          id: `${node.id}:reject-back`,
          type: 'branch',
          branches: rejectBackBranches(prevId),
        }
        out.push(group)
      }
    }
    prevId = node.id
  }
  return out
}

/** 分支内的步骤序列同样处理；incomingPrev 是分支组之前最后一个审批环节（作为首个步骤的「上一级」） */
function ensureRejectLoopBackInSteps (
  steps: ApprovalFlowStep[],
  incomingPrev?: string,
): ApprovalFlowStep[] {
  const out: ApprovalFlowStep[] = []
  let prevId = incomingPrev

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]

    if (s.type === 'branch' && s.branches?.length) {
      out.push(s)
      for (const b of s.branches) {
        b.steps = ensureRejectLoopBackInSteps(b.steps, prevId)
      }
      continue
    }

    /*
     * 「组间轮询」卡片（分支链里的步骤形态）：内部子流程同样要补「驳回 → 回退上一级」。
     * 卡片作为整体只占一个 prevId：卡片内部首个环节的"上一级"就是卡片**之前**那个环节
     * （incomingPrev 一路传下去），与分支组内首个步骤同一口径。
     */
    if (s.type === 'loop') {
      out.push({ ...s, steps: ensureRejectLoopBackInSteps(s.steps ?? [], prevId) })
      prevId = s.id
      continue
    }

    out.push(s)
    const next = steps[i + 1]
    if (prevId) {
      if (next && next.type === 'branch' && next.branches?.length) {
        appendRejectBack(next.branches, prevId)
      } else {
        out.push({
          id: `${s.id}:reject-back`,
          type: 'branch',
          branches: rejectBackBranches(prevId),
        })
      }
    }
    prevId = s.id
  }
  return out
}

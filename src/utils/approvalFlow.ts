import type {
    ApprovalBranch,
    ApprovalChainItem,
    ApprovalFlow,
    ApprovalFlowBranchNode,
    ApprovalFlowStep,
    ApprovalNodeData,
    BranchCondition,
    ConditionExpr,
    FlowContext,
} from '../types/approval'
import { branchConditions, isConditionGroup, isResultCondition, uid } from '../types/approval'
import { deriveFlowFields } from './biRowFields'

/**
 * 把画布图转换为 ApprovalFlow 结构（保存时调用）。
 *
 * 结构要点：
 * - approval 单出边 → 顺序审批环节；多出边 → 先产出审批环节，紧跟一个「审批结果分支组」：
 *   无条件出线为主线（审批通过 / 其余结论兜底走这里），其余出线各绑定一个审批结论；
 * - condition 节点 → 条件分支组：每条出边是一个分支（label 为分支名，data.condition/conditions 为命中条件）；
 * - 每条分支沿出边走，直到结束节点或「与兄弟分支合流」的汇聚点，中间审批节点拍成该分支 steps；
 * - 分支内允许再出现分支（条件节点 / 出线 > 1 的审批节点）：walkBranch 会递归收集成
 *   type='branch' 的嵌套分支组步骤挂在父分支 steps 里，支持任意层级「分支内再分分支」，无需先汇聚。
 *
 * @param nodes 画布节点（至少含 id / type / data）
 * @param edges 画布连线（至少含 id / source / target / label / data）
 */
export function graphToFlowFrom(
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
    const out = new Map<string, any[]>()
    const inMap = new Map<string, string[]>()
    for (const e of edges) {
        if (!nodesById.has(e.source) || !nodesById.has(e.target)) continue
        out.set(e.source, [...(out.get(e.source) ?? []), e])
        const srcs = inMap.get(e.target) ?? []
        srcs.push(e.source)
        inMap.set(e.target, srcs)
    }

    const start = nodes.find(n => n.type === 'start')
    if (!start) return { flow: [], error: '缺少开始节点' }
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
    function tagNode<T extends { error?: string; errorNodeId?: string; errorEdgeId?: string }>(
        res: T,
        nodeId?: string,
        edgeId?: string,
    ): T {
        if (res.error) {
            if (nodeId && !res.errorNodeId) res.errorNodeId = nodeId
            if (edgeId && !res.errorEdgeId) res.errorEdgeId = edgeId
        }
        return res
    }

    /** 某节点是否存在「来自本分支已覆盖区域之外」的入线：
     *  入度 > 1 且至少一条入线不属于 inside → 它把本分支与兄弟分支（或上游路径）合流，属于上层汇聚点。 */
    function mergesFromOutside(id: string, inside: Set<string>): boolean {
        const srcs = inMap.get(id) ?? []
        return srcs.length > 1 && srcs.some(s => !inside.has(s))
    }

    /** 标记一个节点已进入流程；已标记说明存在环 / 反向回连 */
    function visit(id: string): boolean {
        if (visited.has(id)) return false
        visited.add(id)
        return true
    }

    /**
     * 收集某节点的全部出边为「分支组」：
     * - kind 'approval'：审批结果分支，恰好一条无条件主线 + 其余绑定审批结论（field=result）；
     * - kind 'condition'：条件分支，默认分支与表单命中条件可混排。
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
    function collectBranches(sourceId: string, kind: 'approval' | 'condition') {
        return tagNode(collectBranchesRaw(sourceId, kind), sourceId)
    }

    function collectBranchesRaw(
        sourceId: string,
        kind: 'approval' | 'condition',
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
                        : '条件分支至少需要两条出边（分支），请从节点下方拖出连线',
            }
        }
        const sourceName = String(nodesById.get(sourceId)?.data?.title ?? '')
        const branches: ApprovalBranch[] = []
        const territory = new Set<string>([sourceId])
        let defaultSeen = false
        let converge: string | undefined
        for (let i = 0; i < branchEdges.length; i++) {
            const be = branchEdges[i]
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
                : be.data?.condition
                    ? [be.data.condition]
                    : []
            const logic = be.data?.logic === 'or' ? 'or' : 'and'

            /** 递归校验：条件组里的条件也要填全（组可任意嵌套，所以必须递归） */
            const findBad = (items: ConditionExpr[], where: string): string | null => {
                for (let k = 0; k < items.length; k++) {
                    const it = items[k]
                    if (isConditionGroup(it)) {
                        const err = findBad(it.items ?? [], `${where}第 ${k + 1} 个条件组里的`)
                        if (err) return err
                        continue
                    }
                    if (!String(it.field ?? '').trim()) return `${where}第 ${k + 1} 个条件未填写字段名`
                    if (String(it.value ?? '').trim() === '') return `${where}第 ${k + 1} 个条件未填写比较值`
                }
                return null
            }

            if (kind === 'approval') {
                if (list.length) {
                    // 结果分支必须有一个**顶层**结论条件。
                    // 组里的 result 不做硬前提、按组运算（口径见 firstResultValueOf），所以不算数。
                    if (!list.some(isResultCondition)) {
                        return {
                            branches,
                            territory,
                            error: `「${name}」不是有效的审批结果分支，请点击该线在上方面板选择对应审批结论`,
                        }
                    }
                    const err = findBad(list.filter(x => !isResultCondition(x)), `「${name}」的`)
                    if (err) return { branches, territory, error: err }
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
                if (err) return { branches, territory, error: err }
            }

            const walk = walkBranch(be.target, sourceId, name)
            if (walk.error) {
                return {
                    branches, territory, error: walk.error,
                    errorNodeId: walk.errorNodeId, errorEdgeId: walk.errorEdgeId,
                }
            }
            for (const t of walk.territory) territory.add(t)

            if (walk.loopBackTo) {
                // 驳回/打回返回上层：该分支的走向不再推进主干，仅记录 loopBackTo，
                // 不参与本层「汇聚」判定（避免与正常分支的汇聚点不一致而误报）。
                branches.push({
                    id: be.id,
                    name,
                    // 兼容旧结构：单条件取首条；多条件走 conditions + logic
                    condition: list[0] ?? null,
                    logic,
                    conditions: list.length ? list : undefined,
                    steps: walk.steps,
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
            branches.push({
                id: be.id,
                name,
                // 兼容旧结构：单条件取首条；多条件走 conditions + logic
                condition: list[0] ?? null,
                logic,
                conditions: list.length ? list : undefined,
                steps: walk.steps,
                // 出口标记在此写死：分支汇到后续节点时 steps 同样为空，
                // 运行时靠它区分「终止」与「汇聚后继续」，不必回查画布
                isEnd: isEndNode(walk.terminal),
            })
        }
        if (kind === 'approval' && !defaultSeen) {
            return {
                branches,
                territory,
                error: `「${sourceName || '未命名审批'}」需要保留一条主线（无条件出线，审批通过 / 其余结论未命中时走这条）`,
            }
        }
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
    function walkBranch(startId: string, ownerId: string, branchName: string) {
        return tagNode(walkBranchRaw(startId, ownerId, branchName), startId)
    }

    function walkBranchRaw(
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
            if (p === ownerId) return { steps, territory, error: '流程中检测到环，请检查画布' }
            const pn = nodesById.get(p)
            if (!pn) return { steps, territory, error: '流程中存在悬空连线' }
            if (pn.type === 'end') return { steps, territory, terminal: p }

            // 与兄弟分支在此合流 → 本分支到此为止，汇聚点交给上层
            if (mergesFromOutside(p, territory)) return { steps, territory, terminal: p }

            territory.add(p)
            const outs: any[] = out.get(p) ?? []

            // 分支内再分流：条件节点 / 出线 > 1 的审批节点
            if (pn.type === 'condition' || (pn.type === 'approval' && outs.length > 1)) {
                const nested = collectBranches(p, pn.type === 'condition' ? 'condition' : 'approval')
                if (nested.error) return { steps, territory, error: nested.error }
                if (pn.type === 'approval') {
                    // 结果分流前，该审批环节自身先在本分支里审一次（与顶层「审批环节 + 结果分支组」一致）
                    if (!visit(p)) {
                        return { steps, territory, error: '流程中检测到环（节点被重复经过），请检查连线' }
                    }
                    const d = pn.data as ApprovalNodeData
                    if (d.members.length) hasMember = true
                    steps.push({
                        id: pn.id,
                        name: d.title,
                        members: d.members.map((m: ApprovalChainItem) => ({ ...m })),
                    })
                } else if (!visit(p)) {
                    return { steps, territory, error: '流程中检测到环（节点被重复经过），请检查连线' }
                }
                for (const t of nested.territory) territory.add(t)
                // 嵌套分支组作为一个分支步骤挂进来（branches 可继续递归，即分支内的分支）
                steps.push({
                    id: `${pn.id}:nested`,
                    type: 'branch',
                    branches: nested.branches,
                })

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
                if (d.members.length) hasMember = true
                steps.push({
                    id: pn.id,
                    name: d.title,
                    members: d.members.map((m: ApprovalChainItem) => ({ ...m })),
                })
                p = outs[0].target
                continue
            }

            return { steps, territory, error: '流程中存在不支持的节点类型，请检查画布' }
        }
        return { steps, territory, error: '流程中检测到环，请检查画布' }
    }

    while (guard++ < 500) {
        if (!cur) return { flow: [], error: '主路径未连接到结束节点' }
        const node = nodesById.get(cur)
        if (!node) return { flow: [], error: '流程中存在悬空连线' }
        // 分支/主线汇聚之后，业务节点只允许被主路径经过一次；重复经过即存在环或反向回连
        if ((node.type === 'approval' || node.type === 'condition') && visited.has(cur)) {
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
                n => (n.type === 'approval' || n.type === 'condition') && !visited.has(n.id),
            )
            if (orphans.length) {
                // 点名说清是哪几个环节 —— 只说「存在未连接的节点」用户在几十个框里找不到
                const names = orphans
                    .slice(0, 3)
                    .map((n) => `「${String((n.data as ApprovalNodeData)?.title || '未命名环节')}」`)
                    .join('、')
                return {
                    flow: [],
                    error: `${names}${orphans.length > 3 ? ` 等 ${orphans.length} 个环节` : ''}没有连接进主流程，请检查连线`,
                    errorNodeId: orphans[0].id,
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
            return { flow }
        }

        if (node.type === 'approval') {
            visited.add(cur)
            mainVisited.add(cur)
            const d = node.data as ApprovalNodeData
            if (d.members.length) hasMember = true
            flow.push({ id: node.id, type: 'approval', nodes: d.members.map((m: ApprovalChainItem) => ({ ...m })) })
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
function normalizeValue(v: unknown): unknown {
    if (typeof v !== 'string') return v
    const s = v.trim()
    return /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? Number(s.replace(/,/g, '')) : s
}

/**
 * 把一行数据（PB 原始记录 / 中文 key 的视图对象）转成条件求值用的业务上下文。
 * PB 记录的真正业务列在 `data` 里，这里会摊平进来。
 */
export function toFlowContext(row?: Record<string, unknown> | null): FlowContext {
    if (!row) return {}
    const out: FlowContext = {}
    for (const [k, v] of Object.entries(row)) {
        if (META_KEYS.has(k)) continue
        if (k === 'data' && v && typeof v === 'object' && !Array.isArray(v)) {
            for (const [dk, dv] of Object.entries(v as Record<string, unknown>)) out[dk] = normalizeValue(dv)
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
export function flowContextOfOrder(order?: {
    chain?: { context?: FlowContext }
    expand?: { relation?: Record<string, unknown> | null }
} | null): FlowContext {
    const snap = order?.chain?.context
    if (snap && Object.keys(snap).length) return snap
    return toFlowContext(order?.expand?.relation ?? null)
}

export const REJECT_BACK_NAME = '驳回回退上一级'
/** 回退分支组里与驳回并列的主线分支名 */
const MAIN_LINE_NAME = '主线'

/** 回退分支的命中条件：上一环节审批结论 = reject */
function rejectCondition(): BranchCondition {
    return { field: 'result', op: 'eq', value: 'reject' }
}

/** 造一条「驳回 → 回退到 targetId 环节」的分支 */
function makeRejectBackBranch(targetId: string): ApprovalBranch {
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
function rejectBackBranches(targetId: string): ApprovalBranch[] {
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

/** 该分支组里是否已有「驳回 → targetId」的回退分支：重复保存时避免叠加 */
function hasRejectBack(branches: ApprovalBranch[], targetId: string): boolean {
    return branches.some(
        b => b.loopBackTo?.stepId === targetId && branchConditions(b)[0]?.field === 'result',
    )
}

/** 往已有分支组里补一条回退分支；已存在则原样返回 */
function appendRejectBack(branches: ApprovalBranch[], targetId: string) {
    if (hasRejectBack(branches, targetId)) return
    branches.push(makeRejectBackBranch(targetId))
}

export function ensureRejectLoopBack(flow: ApprovalFlow): ApprovalFlow {
    const out: ApprovalFlow = []
    let prevId: string | undefined

    for (let i = 0; i < flow.length; i++) {
        const node = flow[i]

        if (node.type === 'branch') {
            out.push(node)
            for (const b of node.branches) b.steps = ensureRejectLoopBackInSteps(b.steps, prevId)
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
function ensureRejectLoopBackInSteps(
    steps: ApprovalFlowStep[],
    incomingPrev?: string,
): ApprovalFlowStep[] {
    const out: ApprovalFlowStep[] = []
    let prevId = incomingPrev

    for (let i = 0; i < steps.length; i++) {
        const s = steps[i]

        if (s.type === 'branch' && s.branches?.length) {
            out.push(s)
            for (const b of s.branches) b.steps = ensureRejectLoopBackInSteps(b.steps, prevId)
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

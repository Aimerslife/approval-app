import type { ApprovalChainItem, ApprovalOrder, NodeDecision } from '@/types/approval'
import { branchTerminalMapOf, rebuildChain } from '@/types/approval'
// 选项条件（offerWhen）的求值上下文：必须与展示侧 / 提交侧同一口径
import { flowContextOfOrder, optionContextOf } from '@/utils/approvalFlow'
// 环节负责人口径（mainOf）与同人判定（sameApprover）：与时间线合并、提交侧完全一致
import { mainOf, sameApprover } from '@/utils/approvalRuntime'

/**
 * 「同一审批人连续两个环节」的**提交前预览**（中间态）。
 *
 * 背景：`rebuildChain` 只展开到第一个待办环节（见 types/approval 的文件头），
 * 所以办理面板在提交**之前**根本看不到"下一环是谁" —— 现在的做法是提交落库、
 * 链路重算之后，才把下一环显示出来（ApprovalHandleForm 的 waitingNext）。
 * 业务上同一个人的连续环节通常可以一次办完，用户希望能先看到下一环节。
 *
 * 做法：把当前选中的结论**假装成一条流水**喂给 `rebuildChain`（纯函数：不写库、
 * 不发通知），得到"假如提交了会走到哪"。
 * 只有当下一环**仍是同一人**时才交给办理面板渲染；点提交之前，任何数据都不落库。
 *
 * ⚠️ 三条口径必须与提交侧 `composables/useNodeSubmit` 完全一致，否则预览的环
 * 与真正提交时落到的环会错位（stepId / index 全都会对不上）：
 *   · stepId 由 `rebuildChain(flow, decisions).stepIds[index]` **现算**；
 *   · 分支上下文用 `flowContextOfOrder(order)`；
 *   · 终结映射用 `branchTerminalMapOf(snapshot)`。
 */

/** 尚未提交的办理决定（点选项后就有 result；extra 在提交时才收集，预览不需要） */
export interface DraftDecisionInput {
  /** 本环节在 chain 中的下标 */
  index: number
  /** 选中的结论码 */
  result: string
  /** 结论文案（只影响预览展示，可缺省） */
  result_label?: string
  /** 补充值（预览不需要完整，提交时才用真实的那份） */
  extra?: Record<string, unknown>
}

/** 预览出来的「下一环节」：直接可以喂给 ApprovalHandleForm 渲染 */
export interface PreviewNextStep {
  /** 该环节在 chain 中的下标 —— 提交时原样回传（与真实提交后的下标一致） */
  index: number
  /** 该环节的 stepId（调用方据此查 allowedOptions / resultOptions 两张表） */
  stepId: string
  /** 该环节的成员（`data[0]` 那条 manager 就是办理人） */
  data: ApprovalChainItem[]
  /** 该环节的选项条件上下文（`result` = 刚选的那个结论） */
  optionContext: Record<string, unknown>
}

/** 入参归一：单个草稿 / 一串草稿（同一人连续多环时逐层累积）都认 */
function draftsOf (input: DraftDecisionInput | DraftDecisionInput[]): DraftDecisionInput[] {
  return Array.isArray(input) ? input : [input]
}

/**
 * 把「已选的结论」当成一串流水重算链路（不落库）。
 * 拿不到 flow / 结论为空 / 任一环 stepId 对不上时返回 undefined。
 *
 * ⚠️ 必须**逐条**追加再重算：后一环的 stepId 依赖前面几环的模拟流水
 * （与 useNodeSubmit 顺序提交时的口径完全一致）。
 */
function previewRuntimeOf (order: ApprovalOrder | null | undefined, input: DraftDecisionInput | DraftDecisionInput[]) {
  const drafts = draftsOf(input)
  const snapshot = order?.chain
  const flow = snapshot?.flow
  if (!order?.id || !flow?.length || drafts.length === 0) {
    return undefined
  }
  const terminalMap = branchTerminalMapOf(snapshot)
  const context = flowContextOfOrder(order)
  const decisions = snapshot?.decisions ?? []

  const simulated: NodeDecision[] = []
  let rt = rebuildChain(flow, decisions, terminalMap, context)
  for (const draft of drafts) {
    if (!draft.result) {
      return undefined
    }
    // stepId 现算：口径与 useNodeSubmit 的提交口一致（见上面的文件头）
    const stepId = rt.stepIds[draft.index]
    if (!stepId) {
      return undefined
    }
    simulated.push({
      stepId,
      result: draft.result,
      result_label: draft.result_label ?? draft.result,
      extra: draft.extra ?? {},
      opinion: '',
      handled_at: new Date().toISOString(),
    })
    rt = rebuildChain(flow, [...decisions, ...simulated], terminalMap, context)
  }
  return rt
}

/**
 * 最后一环选定结论后，**紧挨着的下一环是不是还是同一个人办**；
 * 是 → 返回那一环（供办理面板继续往后铺），否则 undefined（到此为止）。
 *
 * @param input 单个草稿，或"当前环 + 已铺出来的各环"的草稿序列（多环时逐层累积）
 *
 * 只认"往后一条"：驳回回退 / 跳转（index 变小）不属于这个中间态，
 * 一律返回 undefined —— 那些情况提前渲染反而会误导办理人。
 */
export function previewNextStepOf (
  order: ApprovalOrder | null | undefined,
  input: DraftDecisionInput | DraftDecisionInput[],
): PreviewNextStep | undefined {
  const drafts = draftsOf(input)
  if (drafts.length === 0) {
    return undefined
  }
  const rt = previewRuntimeOf(order, drafts)
  if (!rt || rt.done) {
    return undefined
  }
  const last = drafts[drafts.length - 1]
  // 最后一环的负责人（预览链里这一环已经带上刚选的结论）
  const me = mainOf(rt.chain[last.index])
  if (!me) {
    return undefined
  }

  for (let i = last.index + 1; i < rt.chain.length; i++) {
    const step = rt.chain[i]
    if (!step?.length) {
      continue
    }
    // 「飞书提醒」环是到达即穿过，不是待办：跳过后面对比下一环
    if (step.some(item => item.type === 'notify')) {
      continue
    }
    const next = mainOf(step)
    // 已经办过的环（重审展开的历史环节）跳过
    if (!next || next.handled_at || next.result) {
      continue
    }
    // 中间隔了别人：不是"同一个人连续两环"，不预览
    if (!sameApprover(me, next)) {
      return undefined
    }
    return {
      index: i,
      stepId: rt.stepIds[i] ?? '',
      data: step,
      // 选项的 offerWhen 要按"含本次结论"的链路求值（否则下一环的选项集合会错）
      optionContext: optionContextOf(order, rt.chain, i),
    }
  }
  return undefined
}

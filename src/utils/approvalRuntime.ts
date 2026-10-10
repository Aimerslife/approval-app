import type { ApprovalChainItem, ApprovalNodeOption, ApprovalOrder } from '@/types/approval'
import { buildBranchTerminalMap, mainOf, mergeExtraMembers, rebuildChain, sameApprover } from '@/types/approval'
import { flowContextOfOrder } from '@/utils/approvalFlow'

/*
 * 环节负责人（mainOf）与「同一审批人」判定（sameApprover）：实现在 types/approval
 * —— 回退目标的计算（collectRejectTargets）也要用同一套口径，放基础模块两边都引得到。
 * 下面再**转出去**一份，原有 `from '@/utils/approvalRuntime'` 的调用点不用改。
 */
export { mainOf, sameApprover } from '@/types/approval'

/**
 * 审批单的「运行期视图」：用单据自带的快照（flow + decisions + context）重算链路。
 *
 * 为什么抽出来：home.vue（所有审批单）与 mine.vue（我的审批单）**各写了一份，而且已经漂了** ——
 * mine.vue 那份漏传了业务上下文（`flowContextOfOrder`），有分支条件的流程会把当前环节算偏，
 * 而表格的「当前审批人」、抽屉里"是否轮到我办"全都取自这里。
 * 合成一份之后，两处不可能再不一致。
 *
 * 纯函数（不碰 PocketBase 客户端），可被 tsx 直接断言。
 */

/**
 * 重算链路。
 *
 * 三个口径与审批页/提交侧保持一致，缺一处就会偏：
 *  1. 有 flow 才重算；旧单（只有 chain、没有 flow）原样沿用；
 *  2. 业务上下文要传进去（分支条件靠它选路）；
 *  3. 运行期追加的抄送/转办要合并回来（转办会把被接替者标成「已转办」）。
 *
 * 返回类型交给推断：legacy 分支的 `chain` 是旧结构（ApprovalChain），
 * 显式标注反而要写一个两分支的联合类型，得不偿失。
 */
export function runtimeOf (order: ApprovalOrder) {
  const snapshot = order.chain
  const flow = snapshot?.flow
  if (!flow?.length) {
    const legacy = snapshot?.chain ?? []
    // end: 旧单没有 flow、也就无从判断"为什么停" —— 显式给 undefined，保持返回形状一致
    return { chain: legacy, stepIds: legacy.map((_, i) => `legacy-${i}`), currentStep: -1, done: false, end: undefined }
  }
  const r = rebuildChain(
    flow,
    snapshot?.decisions ?? [],
    buildBranchTerminalMap(snapshot?.graph),
    flowContextOfOrder(order),
  )
  // 合并运行期追加的抄送/转办（转办会把被接替者标成「已转办」，实现见 mergeExtraMembers）
  mergeExtraMembers(r.chain, r.stepIds, snapshot?.extraMembers)
  return { ...r, done: r.done }
}

/**
 * 一组「同一审批人**连续**办理」的环节。
 *
 * 为什么要有它：A 办完流转到下一环，而下一环的审批人又是 A —— 时间线上就会出现同一个人的
 * 两条节点，看着像重复，还得连点两次办理。合成一组后：时间线只渲染**一条**节点，
 * 弹窗里把这一串动作**连着办**（见 ApprovalNode 的 activeStep）。
 *
 * 只在**相邻**且**同一人**时合并：中间隔了别人的环节就各走各的（那确实是两个环节）。
 */
export interface ApproverStepGroup {
  /** 组内每一步在整条链里的下标（提交时回传 index，见 NodeSubmitPayload） */
  indexes: number[]
  /** 组内每一步的 stepId（对应 runtimeOf().stepIds） */
  stepIds: string[]
  /** 组内每一步的成员 */
  steps: ApprovalChainItem[][]
  /** 组内每一步的起始时间（对应 stepStartTimesOf 的结果） */
  startTimes: string[]
}

/**
 * 把相邻的「同一审批人」环节合成一组（入参用 runtimeOf() 的 chain / stepIds + stepStartTimesOf 的 startTimes）。
 *
 * 返回顺序与 chain 一致；每组至少含一个环节（不合并时就是"一环一组"）。
 */
export function groupApproverSteps (
  chain: ApprovalChainItem[][],
  stepIds: string[],
  startTimes: string[],
): ApproverStepGroup[] {
  const out: ApproverStepGroup[] = []
  for (const [i, step] of chain.entries()) {
    const last = out.at(-1)
    // 与**上一组的最后一环**比：相邻且同一人才合并
    const prevStep = last ? chain[last.indexes.at(-1)!] : undefined
    if (last && sameApprover(mainOf(prevStep), mainOf(step))) {
      last.indexes.push(i)
      last.stepIds.push(stepIds[i] ?? '')
      last.steps.push(step)
      last.startTimes.push(startTimes[i] ?? '')
      continue
    }
    out.push({
      indexes: [i],
      stepIds: [stepIds[i] ?? ''],
      steps: [step],
      startTimes: [startTimes[i] ?? ''],
    })
  }
  return out
}

/**
 * 交给 ApprovalNode 的「同一审批人**后续**环节」（组内第 2 步起）。
 *
 * 时间线上它们与本人合并成一条节点；弹窗里排成一条"链"：办完第 1 个动作自动接第 2 个
 * （都由本人办），全部办完才关窗 —— 见 ApprovalNode 的 activeStep / handleConfirm。
 */
export interface ApprovalNextStep {
  /** 该环节在整条链里的下标（提交时回传 index） */
  index: number
  /** 该环节的成员（渲染它的办理结果用） */
  data: ApprovalChainItem[]
  /** 该环节的办理选项（与 ApprovalNode 的 `allowed-options` 同口径） */
  allowedOptions?: ApprovalNodeOption[]
  /** 该环节可选的审批结论（与 ApprovalNode 的 `allowed-results` 同口径） */
  allowedResults?: string[]
}

/**
 * 一组里的第 2..N 环 → ApprovalNode 的 `next-steps`。
 * 选项按各自的 stepId 从两张表里取（就是页面上传给 `allowed-options` / `allowed-results` 的那两张）。
 */
export function nextStepsOf (
  group: ApproverStepGroup,
  optionItems: Record<string, ApprovalNodeOption[]> = {},
  resultOptions: Record<string, string[]> = {},
): ApprovalNextStep[] {
  return group.indexes.slice(1).map((index, k) => {
    const stepId = group.stepIds[k + 1] ?? ''
    return {
      index,
      data: group.steps[k + 1] ?? [],
      allowedOptions: optionItems[stepId],
      allowedResults: resultOptions[stepId],
    }
  })
}

/**
 * 提交某一环之后，**紧挨着的下一环是不是还是同一个人办** —— 弹窗据此决定"先别关、接着办"。
 *
 * 为什么必须由落库方现算（组件自己判断不出来）：
 * chain 是「flow + decisions」的投影，且**只展开到第一个待办环节为止**
 * （见 types/approval 的 rebuildChain：第一个没有结论的环节即 currentStep，其后不再展开）。
 * 所以提交**前**组件手里的链路根本看不到"下一环是谁" —— 写库、链路多展开一环之后才知道。
 *
 * 口径与 `groupApproverSteps`（同一审批人连续多环合并成一条节点）**完全一致**：
 * 邮箱优先、缺邮箱退回姓名；只有紧挨着的下一环还是同一人才算，中间隔了别人就不算
 * —— 否则弹窗会白留着，而页面上那两个环节本来就是两个节点。
 *
 * @param chain   落库后重建出来的新链路
 * @param index   刚办完的那一环在 chain 中的下标
 */
export function nextStepSameApprover (chain: ApprovalChainItem[][], index: number): boolean {
  const me = mainOf(chain[index])
  if (!me) {
    return false
  }
  // 往后找第一个「有人办、且还没办」的环节：提醒 / 抄送这类没有 manager 的环节会被 mainOf 兜底取到，跳过
  for (let i = index + 1; i < chain.length; i++) {
    const next = mainOf(chain[i])
    if (!next || next.handled_at) {
      continue
    }
    return sameApprover(me, next)
  }
  return false
}

/**
 * 各环节的起始时间：首环节 = 建单时间，其余 = 上一环节的办理时间。
 * 与审批页的 stepStartTimes 同一口径（表格的「审批时长」、抽屉里的每步耗时都用它）。
 */
export function stepStartTimesOf (order: ApprovalOrder, chain: ApprovalChainItem[][]) {
  let prev: string | undefined = order.created
  return chain.map(step => {
    const from = prev ?? ''
    const m = mainOf(step)
    if (m?.handled_at) {
      prev = m.handled_at // 已办理才推进基线
    }
    return from
  })
}

/**
 * 「弃置审批段」在时间线上的起点（没进入弃置时返回 -1）。
 *
 * 口径（业务给定，**两个条件同时成立**）：
 *   ① 环节下标 ≥ `DISCARD_MIN_INDEX`（即"审批节点大于 3"，第 4 个环节起）；
 *   ② 这一环是**财务审批**。
 * 命中那一环就是弃置段的**第一环**，它之后的每一环都属于弃置段。
 *
 * 为什么这么定（而不是按环节名 / 引用卡片）：
 *   · **环节名在时间线上拿不到**：`ApprovalChainItem` 只有"人"，没有环节名；那段内容的环节名
 *     只存在源模板画布节点的 `data.title` 上（建单期搬进来的 flow 步骤本身不带 name），
 *     所以"财务"只能按**审批人的部门**认（本案财务环节的审批人在财务部门：财务BP组）；
 *   · **主链第 0 环往往也是财务**（财务初审），所以必须叠加"下标大于 3"才能唯一 —— 这正是业务口径。
 *
 * ⚠️ 改口径只改这里两处：`DISCARD_MIN_INDEX`（第几环起）与 `isFinanceStep`（怎么认财务）。
 *
 * 时间线据此把圆点从这一环起逐渐缩小、并把整段包进独立背景（见 ApprovalNode 的 inDiscardSegment）。
 *
 * @param chain rebuildChain（或 runtimeOf）给出的链路，时间线上的分组与它同源
 * @returns 弃置段**第一环**在 chain 里的下标；没进入弃置 → -1
 */
export const DISCARD_MIN_INDEX = 4

export function discardSegmentStart (chain: ApprovalChainItem[][]): number {
  return chain.findIndex((step, index) => index >= DISCARD_MIN_INDEX && isFinanceStep(step))
}

/**
 * 这一环是不是"财务审批"。
 *
 * 按**部门**认（`department` / `department_path` 里带"财务"）而不是按环节名 —— 理由见上。
 * 用 `some` 而不是只看负责人：会签时财务可能不是第一位（第 0 环就是「财务初审 + 抄送」那种）。
 */
function isFinanceStep (step: ApprovalChainItem[]): boolean {
  return step.some(m => /财务/.test(`${m.department ?? ''}${m.department_path ?? ''}`))
}

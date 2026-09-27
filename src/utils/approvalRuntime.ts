import type { ApprovalChainItem, ApprovalOrder } from '@/types/approval'
import { buildBranchTerminalMap, mergeExtraMembers, rebuildChain } from '@/types/approval'
import { flowContextOfOrder } from '@/utils/approvalFlow'

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
    return { chain: legacy, stepIds: legacy.map((_, i) => `legacy-${i}`), currentStep: -1, done: false }
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
 * 环节的负责人：优先 manager。
 *
 * 办理信息（handled_at / result）记在 manager 那一项上，所以取它的口径要与
 * ApprovalNode 一致；没有 manager（例如只有一个角色项）时退回第一项。
 */
export function mainOf (step?: ApprovalChainItem[]) {
  return step?.find(i => i.type === 'manager') ?? step?.[0]
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
    if (m?.handled_at) prev = m.handled_at // 已办理才推进基线
    return from
  })
}

import type { ApprovalBranch, ApprovalChain, ApprovalChainItem, ApprovalFlow, ApprovalNodeOption, ApprovalOrder, FlowEndInfo } from '@/types/approval'
import { APPROVAL_STATUS, branchTerminalMapOf, CLOSE_FLOW_RESULTS, firstResultValueOf, mainOf, mergeExtraMembers, rebuildChain, sameApprover } from '@/types/approval'
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
    // 旧单没有 flow，引擎那套"为什么停"重算不了 —— 但同一套判定条件能从链路反推（见 legacyFlowEndOf）
    return {
      chain: legacy,
      stepIds: legacy.map((_, i) => `legacy-${i}`),
      currentStep: -1,
      done: false,
      end: legacyFlowEndOf(order),
    }
  }
  const r = rebuildChain(
    flow,
    snapshot?.decisions ?? [],
    branchTerminalMapOf(snapshot),
    flowContextOfOrder(order),
  )
  // 合并运行期追加的抄送/转办（转办会把被接替者标成「已转办」，实现见 mergeExtraMembers）
  mergeExtraMembers(r.chain, r.stepIds, snapshot?.extraMembers)
  return { ...r, done: r.done }
}

/**
 * 链路里**最后一条已办**的记录（含办理人 / 结论 / 意见 / 时间）。
 *
 * @param endIndex 只看 `chain[0, endIndex)`：表格的「审批结论」列要的是整条链路的最后一条，
 *                 「上一轮审批信息」（见 utils/arrivalNotice）要的是**当前环节之前**的那一条 ——
 *                 同一份查找，两处都别自己写。
 *
 * 放在这里的原因：这是"从链路里认人 / 认结论"的口径，时间线、表格、飞书文案必须一致，
 * 各处自己实现必然漂（有的取最后一个 manager、有的取最后一个有 handled_at 的）。
 */
export function lastHandledIn (
  chain: ApprovalChain,
  endIndex: number = chain.length,
): ApprovalChainItem | undefined {
  const end = Math.min(Math.max(endIndex, 0), chain.length)
  for (let i = end - 1; i >= 0; i--) {
    const items: ApprovalChainItem[] = chain[i] ?? []
    // 优先取「办理人」那一条；飞书提醒环没有办理人，退到第一条有办理痕迹的
    const hit = items.find(x => x?.type === 'manager' && hasHandledTrace(x))
      ?? items.find(hasHandledTrace)
    if (hit) {
      return hit
    }
  }
  return undefined
}

/** 整条链路的最后一条已办（表格的「审批结论」列用） */
export function lastHandledOf (chain: ApprovalChain): ApprovalChainItem | undefined {
  return lastHandledIn(chain)
}

/**
 * 这张单**现在是不是压在他手上**：当前待办环节的负责人就是他。
 *
 * 「我的审批」页里"当前待办"那一档的"自己名下"口径 —— 注意与下面的 orderHandledBy 是**两回事**：
 * 这一条只认"还没办的那一环归谁"，办结的单一律 false。
 *
 * @param who 登录者（userStore.member）；没登录时调用方传 undefined，这里一律返回 false
 */
export function orderPendingOn (order: ApprovalOrder, who?: ApprovalChainItem | null): boolean {
  if (!who) {
    return false
  }
  const rt = runtimeOf(order)
  if (rt.currentStep < 0) {
    return false
  }
  return sameApprover(mainOf(rt.chain[rt.currentStep]), who)
}

/**
 * 这张单他**经手过**：链路上有任一环节是他作为**审批人**办掉的
 * （「我的审批」页里"历史审批"那一档的口径）。
 *
 * 为什么不是"最后一个环节是他"：单据办到一半换了人（转办）或他办完后又流转给别人时，
 * 最后那位并不是他 —— 但那确实是他办过的单，历史里必须看得到（实测：
 * 一张单他办完第 3 环、第 4 环由别人办结，按"最后一位"口径就漏了）。
 *
 * 只认**已办**的环节（有结论 / 办理时间）：未办环节上挂着的是"接下来该谁办"，不算经手；
 * **只认审批人（type='manager'）**：抄送（cc）与飞书提醒环上挂的人并没有对这张单做决定，
 * 认进来会让"我办过的单"里混进一堆只是被通知过的记录。
 */
export function orderHandledBy (order: ApprovalOrder, who?: ApprovalChainItem | null): boolean {
  if (!who) {
    return false
  }
  const rt = runtimeOf(order)
  return rt.chain.some(step =>
    (step ?? []).some(m => m?.type === 'manager' && hasHandledTrace(m) && sameApprover(m, who)),
  )
}

/**
 * 这张单**抄送给了他**：链路上（含运行期追加的抄送）有 `type === 'cc'` 的成员是他。
 *
 * 「我的审批单」页「抄送我的」那一档的口径。与 orderHandledBy 刻意分开：
 * 抄送只是"通知到了"，不代表他对这张单做过决定，所以不算「我经手过」
 * （见 orderHandledBy 的说明）——但在「抄送我的」里必须看得到。
 *
 * @param who 登录者（userStore.member）；没登录时调用方传 undefined，这里一律返回 false
 */
export function orderCcTo (order: ApprovalOrder, who?: ApprovalChainItem | null): boolean {
  if (!who) {
    return false
  }
  const rt = runtimeOf(order)
  return rt.chain.some(step => (step ?? []).some(m => m?.type === 'cc' && sameApprover(m, who)))
}

/**
 * 这张单是**他提交的**（「我的审批单」页「我发起的」那一档）。
 *
 * 只能按建单时落库的 `creator`（users id）判 —— 快照里没有"提交人"这个东西：
 * 链路上只有审批人（manager）与抄送人（cc），都没有"谁建的"的含义。
 *
 * 历史单（加字段之前建的）没有 creator，这里返回 false，不会把它们错算给别人。
 *
 * @param userId 登录者 id（userStore.user?.id），与 creator 同源
 */
export function orderCreatedBy (order: ApprovalOrder, userId?: string | null): boolean {
  const id = String(userId ?? '').trim()
  return !!id && String(order.creator ?? '') === id
}

/**
 * 审批页右上角「上一个 / 下一个」该跳到哪两张单。
 *
 * 队列 = **某人名下的在办单**（按 `-created` 排，与首页表格同序，见 pages/approvalPage）。
 *
 * ## 为什么要单独一条口径（踩过）
 *
 * 当前打开的这一张**常常不在队列里**：刚办完一张，它要么已办结、要么流转给了下一位 ——
 * 两种情况下"当前审批人"都不再是刚办完的人，队列里也就没有它。
 * 而"我刚办完这一张，想接着办下一张"恰恰是最需要这两个按钮的时刻：
 * 早先直接用"当前单在队列里的下标"取左右邻居，那时下标是 -1 → 两个箭头全灰、
 * 整排按钮还会被当成"只有一张单"藏起来，表现就是**办完跳不动**。
 *
 * 所以这里按**建单时间**给当前单在队列里插一个站位（列表降序，插位处那张就是
 * "列表里紧随其后的单"），让「下一个」仍然指向他接着该办的那张。
 *
 * @param orders  队列（**降序**：新 → 旧，与 getApprovalOrder 的 `-created` 同序）
 * @param current 当前打开的那张单；不在队列里时按它的 `created` 插位
 */
export function queueCursorOf (
  orders: ApprovalOrder[],
  current?: ApprovalOrder | null,
): { prev?: ApprovalOrder, next?: ApprovalOrder } {
  const queue = orders ?? []
  const no = current?.order_no ?? current?.id
  const i = no ? queue.findIndex(o => (o.order_no ?? o.id) === no) : -1
  // 在队列里：正常左右邻居
  if (i >= 0) {
    return {
      prev: i > 0 ? queue[i - 1] : undefined,
      next: i < queue.length - 1 ? queue[i + 1] : undefined,
    }
  }
  // 队列为空：没有任何可跳的目标
  if (queue.length === 0) {
    return { prev: undefined, next: undefined }
  }
  const created = String(current?.created ?? '')
  // 取不到建单时间：不敢乱插位，只把队首（最新那张）当作"下一个"
  if (!created) {
    return { prev: undefined, next: queue[0] }
  }
  const at = queue.findIndex(o => String(o.created ?? '') < created)
  /*
   * 没有比它更旧的单 → 在列表里它后面已经没有单了：只留「上一个」= 队尾（最旧那张）。
   * 不能拿队尾当「下一个」，那等于指回队列里。
   */
  if (at === -1) {
    return { prev: queue[queue.length - 1], next: undefined }
  }
  return {
    prev: at > 0 ? queue[at - 1] : undefined,
    next: queue[at],
  }
}

/**
 * **旧单**（快照里没有 flow）的结束依据 —— 引擎那套"为什么停"重算不了，
 * 但按**同一套判定条件**能从链路 + 流水反推出来：
 *
 *   ① 单据还没结束（`status === PENDING`）→ 进行中，**不给依据**（与 rebuildChain 的 done=false 一致）；
 *   ② 最后一条已办的结论属于**终结类结论**（CLOSE_FLOW_RESULTS，如「选择接收团队」）→ 它本身就是结果；
 *   ③ 其余 → 所有环节都已办完（附最后一个环节的结论）。
 *
 * 与 rebuildChain 的 `markEnd` 同口径（同一份 CLOSE_FLOW_RESULTS、同样取"最后一条已办"），
 * 所以旧单与新单在时间线上看到的是**同一种表述**。
 * 旧单唯一的欠缺：拿不到"命中的是哪条分支线"（那要有 flow 才算得出来），所以不写 `exit` 那一类。
 *
 * ⚠️ 时间字段只认 `handled_at`（与全仓一致）；更老的记录若用别的字段名，这里就退化成不显示时间，
 * 不影响"为什么结束"的判断。
 */
export function legacyFlowEndOf (order: ApprovalOrder): FlowEndInfo | undefined {
  const chain = order.chain?.chain ?? []
  // ① 还在流转：不编造"结束依据"，否则时间线上会给进行中的单挂一条假的结束说明
  if (Number(order.status ?? APPROVAL_STATUS.PENDING) === APPROVAL_STATUS.PENDING) {
    return undefined
  }
  const last = lastHandledOf(chain)
  const result = last?.result
  const label = last?.result_label || result || ''
  const facts = {
    ...(label ? { resultLabel: label } : {}),
    ...(last?.name ? { byName: last.name } : {}),
    ...(last?.handled_at ? { at: last.handled_at } : {}),
  }
  // ② 终结类结论收尾：这就是引擎里 `kind: 'closed'` 的判定条件
  if (result && CLOSE_FLOW_RESULTS.includes(result)) {
    return {
      kind: 'closed',
      reason: `本环节的结论「${label}」是终结类结论，流程到此结束`,
      ...(Object.keys(facts).length ? { facts } : {}),
    }
  }
  // ③ 其余按"所有环节都办完了"算：拿不到分支线，就不假装知道
  return {
    kind: 'finished',
    reason: '所有环节都已办完，流程结束',
    ...(label ? { detail: `最后一个环节的结论：${label}` } : {}),
    ...(Object.keys(facts).length ? { facts } : {}),
  }
}

/** 这条记录上有没有"办过"的痕迹（未办环节只有姓名，什么都没有） */
function hasHandledTrace (m?: ApprovalChainItem): boolean {
  return Boolean(m && (m.handled_at || m.result || m.result_label || m.opinion))
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
 * 「弃置审批段」在时间线上盖住**哪几环**。
 *
 * ## 判据（可靠 → 兜底）
 *
 * ① **语义**：画布上绑定**弃置流程入口结论**的那条分支（本项目是「建议弃置」= `result: discard`），
 *    **它子树里的环节**就是弃置段。段在模板里本来就是"一条按结论进入的线"，
 *    模板随便加一环、财务换个人都不会失效。
 * ② **结构**：第一处「引用模板」搬进来的内容（id 带 `:ref:`，见 utils/templateRef 的 prefixFlow）——
 *    本项目里那段就是弃置流程；老单快照里没有 flow 时靠它。
 * ③ **兜底**（**只在没有任何结构可用时**才启用，很老的单据）：部门含"财务" 且 下标 ≥ `DISCARD_MIN_INDEX`。
 *
 * ## 为什么是"id 集合"而不是"起点往后的都算"（踩过两次）
 *
 * · 第一次：判定完全落空，整段没有背景与标志 —— 那是 `DISCARD_MIN_INDEX = 4` 与
 *   "第 4 个环节起"差一位（弃置段恰好从下标 3 开始）。
 * · 第二次（本次）：判定**误报**。办到一半点「回退上一级」会把流程送回**这一段之前**的环节
 *   （例如又一次财务审批），从那里重新往前走出来的环节**不是**弃置段的一部分；
 *   按"起点往后全算"就会把它们一起染成弃置 —— 现象是"回退到财务，这里被判成弃置"。
 *
 * 所以现在按**节点 id** 认：只有真的落在弃置子树里的环节才算（回退重新走过的那些自然不算）。
 * 并且把它们归成**若干连续段** —— 一段被打断（回退出去又绕回来）就重新起一段，
 * 每段各自算段首/段尾，背景圆角与「进入弃置流程」标志才落在对的地方。
 *
 * ⚠️ 以后改口径只改这三处：`DISCARD_ENTRY_RESULTS`（哪些结论算弃置入口）、
 * `REF_STEP_MARK`、`DISCARD_MIN_INDEX` + `isFinanceStep`（兜底口径）。
 */
export const DISCARD_MIN_INDEX = 3

/** 弃置段在时间线上的标注（见 discardMarksOf） */
export interface DiscardMark {
  /** 段内序号（0 起）：圆点缩小幅度、段首标志都按它算（见 ApprovalNode 的 inDiscardSegment） */
  seq: number
  /** 它所在的**这一段**有多长（同一段内相同）：用来认出"哪条是段尾"（背景圆角） */
  size: number
}

/**
 * 弃置段的标注表：下标与 `runtime.chain` **一一对应**，不属于弃置段的位置是 `undefined`。
 *
 * @param runtime 运行期视图：chain / stepIds（`runtimeOf` 的返回值）+ 单据快照里的 flow
 */
export function discardMarksOf (
  runtime: { chain: ApprovalChainItem[][], stepIds?: string[], flow?: ApprovalFlow | null },
): Array<DiscardMark | undefined> {
  const chain = runtime?.chain ?? []
  const stepIds = runtime?.stepIds ?? []
  const flags = discardFlags(chain, stepIds, runtime?.flow)
  /*
   * 把"属于弃置段"的环节归成**若干连续段**：每段各自从 0 编号 ——
   * 段首挂「进入弃置流程」标志、段首段尾留圆角、中间的直角首尾相接拼成一整块背景
   * （见 ApprovalNode 的 discardZoneStyle）。
   */
  const marks: Array<DiscardMark | undefined> = new Array(chain.length).fill(undefined)
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) {
      continue
    }
    let end = i
    while (end + 1 < flags.length && flags[end + 1]) {
      end++
    }
    const size = end - i + 1
    for (let k = i; k <= end; k++) {
      marks[k] = { seq: k - i, size }
    }
    i = end
  }
  return marks
}

/** 每一环是否属于弃置段（判据见 discardMarksOf 的说明） */
function discardFlags (
  chain: ApprovalChainItem[][],
  stepIds: string[],
  flow?: ApprovalFlow | null,
): boolean[] {
  if (flow?.length) {
    /*
     * ① 语义：弃置入口分支子树里的节点 id —— 再按**源模板标识**把同一份模板的其它入口一并认下
     * （见 refSourceKeys 的说明：同一张引用卡片在模板里可能放在多处，每处卡片 id 都不同）。
     */
    const inside = discardSubtreeIds(flow)
    if (inside.size > 0) {
      const keys = refSourceKeysOf(inside)
      return stepIds.map(id => inDiscardById(id, inside, keys))
    }
    // ② 结构：老单（没有 flow）看不到分支，只能拿**第一处**引用段认源模板，再按它认其余入口
    const byRef = discardFlagsByRef(stepIds)
    if (byRef) {
      return byRef
    }
    /*
     * 两条都不成立 = **这一单没有弃置段**（模板里就没配弃置入口，也没有引用段）。
     * 这里必须直接返回空标记，**不能**顺手退到 ③ —— 见下面的说明。
     */
    return stepIds.map(() => false)
  }
  /*
   * ③ 兜底：**只有连 flow 都没有的老单据**才走这里。
   * "第几环之后的财务"是当初按模板形状定的近似口径 —— 拿它去判有 flow 的单，
   * 就会把"回退到财务"这种正常环节误判成弃置（实测踩到），所以严格限定在无结构的情形。
   */
  const flags = stepIds.map(() => false)
  const at = chain.findIndex((step, index) => index >= DISCARD_MIN_INDEX && isFinanceStep(step))
  for (let i = at; i >= 0 && i < flags.length; i++) {
    flags[i] = true
  }
  return flags
}

/**
 * 「弃置流程」的入口结论 —— 画布上绑了这些结论的分支，其下游就是弃置段。
 *
 * 为什么不直接用 utils/approvalTypes 里那组「处置类」：
 *   · 那组里有 `rework`（**返工**）—— 它与弃置是**并列**的两条线（真实模板就是
 *     「建议返工 / 建议弃置」两分支），算进来会把返工那条线也标成弃置；
 *   · `scrap`（报废清仓）、`supplier_recycle`（供应商回收）、`recycle` 出现在弃置段
 *     **内部**，当成入口会在段内又找一个"起点"，段首标志跟着跑到中间去。
 * 所以只列弃置流程**本身的入口**：`discard`（建议弃置）+ `lack_demand`（无需求走弃置）。
 */
const DISCARD_ENTRY_RESULTS = ['discard', 'lack_demand']

/** 建单期从「引用模板」搬进来的内容，id 上带这个标记（见 utils/templateRef 的 prefixFlow） */
const REF_STEP_MARK = ':ref:'

/**
 * 判定 ①：flow 里**每一处**绑了弃置入口结论的分支，收集**它们子树里的全部节点 id**。
 *
 * 为什么要"每一处"而不是"第一处"：多组模板里「建议弃置」是**按组各有一条**的（实测一家模板 12 处），
 * 只认第一处的话，走其它组的单一个标都拿不到（弃置段整段不显示）。
 * 一个单只会真正走进其中一条，其它几处的 id 不会出现在它的链路里，收全了也不会误标。
 *
 * 给集合而不是"第一环的下标"：同一段可能因为回退被重复经过，
 * 而"从第一环往后全算"会把回退之后重新走过的普通环节也算进弃置段（见 discardMarksOf 的说明）。
 */
function discardSubtreeIds (flow: ApprovalFlow): Set<string> {
  const out = new Set<string>()
  /** 这一段（含嵌套分支组、轮询卡片内部）里的所有节点 id */
  const addAll = (steps: any[] | undefined) => {
    for (const s of steps ?? []) {
      if (!s) {
        continue
      }
      const id = String(s.id ?? '')
      if (id) {
        out.add(id)
      }
      for (const b of (s.branches ?? []) as ApprovalBranch[]) {
        addAll(b?.steps)
      }
      addAll(s?.steps)
    }
  }
  const walk = (nodes: any[] | undefined) => {
    for (const node of nodes ?? []) {
      /*
       * **凡是有 branches 就往下走**，不是只认 type='branch'：
       * 引用卡片自己、以及审批节点的按结论分流也都带 branches
       * （同一个坑在 utils/templateRef 的展开里踩过一次 —— 那里的收集器也改成了看 branches）。
       */
      for (const b of (node?.branches ?? []) as ApprovalBranch[]) {
        // 回退 / 跳出这类分支不是"往下走"，不算弃置入口
        if (!b?.loopBackTo && !b?.exitTo && branchEntersDiscard(b)) {
          addAll(b.steps)
          // 已整段收下：段内不会再有"入口"（段内的回收 / 报废分支不在 entry 名单里）
          continue
        }
        walk(b.steps)
      }
      walk(node?.steps)
    }
  }
  walk(flow as unknown as any[])
  return out
}

/**
 * 从 id 里取出**源模板标识**：每个 `:ref:` 标记**之后**的那一段。
 *
 * 建单期搬进来的 id 形如 `` `${引用卡片id}:ref:${源模板标识}` ``（见 utils/templateRef 的 prefixFlow）：
 *   · 标记**之前**是**卡片 id** —— 同一份源模板被放在模板的**多处**时，每处都不一样；
 *   · 标记**之后**是**源模板**的标识 —— 同一份源模板处处相同。
 *
 * 所以"这一环是不是弃置段"要按**后面的**那一段认，不能按卡片 id 认（踩过：一张真实单据
 * 走的入口不是我们找到的那几条分支，按卡片 id 判定就整段落空 → 没有背景也没有标志）。
 * 嵌套引用会串出多段（`a:ref:b:ref:c`），这里把每一段都取出来，比对时命中任意一段即可。
 */
function refSourceKeys (raw: unknown): string[] {
  const id = String(raw ?? '')
  const keys: string[] = []
  let at = id.indexOf(REF_STEP_MARK)
  while (at >= 0) {
    const key = id.slice(at + REF_STEP_MARK.length)
    if (key) {
      keys.push(key)
    }
    at = id.indexOf(REF_STEP_MARK, at + REF_STEP_MARK.length)
  }
  return keys
}

/** 一组 id 里出现过的全部源模板标识 */
function refSourceKeysOf (ids: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const id of ids) {
    for (const key of refSourceKeys(id)) {
      out.add(key)
    }
  }
  return out
}

/**
 * 这一环算不算弃置段：**直接**落在弃置子树里，或者**来自同一份源模板**。
 *
 * 后一条是实测补上的：同一个「引用模板」卡片在模板里可能放在多处（本案弃置模板就有 6+ 处入口，
 * 还有一条走「数据查询 → 不存在 → 引用段」的线），只按子树里的 id 认会漏掉其它入口。
 */
function inDiscardById (raw: unknown, inside: Set<string>, keys: Set<string>): boolean {
  const id = String(raw ?? '')
  if (inside.has(id)) {
    return true
  }
  return keys.size > 0 && refSourceKeys(id).some(k => keys.has(k))
}

/**
 * 判定 ②（老单没有 flow，看不到分支）：拿**第一处**引用段认源模板，
 * 再按同一份源模板认其余入口 —— 与判定 ① 的补充口径同源，只是少了"子树"那一半。
 */
function discardFlagsByRef (stepIds: string[]): boolean[] | undefined {
  const first = stepIds.find(id => String(id ?? '').includes(REF_STEP_MARK))
  if (!first) {
    return undefined
  }
  const keys = refSourceKeysOf([String(first)])
  if (keys.size === 0) {
    return undefined
  }
  return stepIds.map(id => refSourceKeys(id).some(k => keys.has(k)))
}

/** 这条分支是不是"弃置流程的入口"（**顶层**结论条件命中弃置入口结论；口径同 firstResultValueOf） */
function branchEntersDiscard (b: ApprovalBranch): boolean {
  return DISCARD_ENTRY_RESULTS.includes(String(firstResultValueOf(b) ?? '').trim())
}

/**
 * 这一环是不是"财务审批"（**兜底判定**用，见 discardMarksOf 的 ③）。
 *
 * 按**部门**认（`department` / `department_path` 里带"财务"）而不是按环节名：
 * `ApprovalChainItem` 只有"人"、没有环节名，环节名只存在源模板画布节点上。
 * 用 `some` 而不是只看负责人：会签时财务可能不是第一位。
 */
function isFinanceStep (step: ApprovalChainItem[]): boolean {
  return step.some(m => /财务/.test(`${m.department ?? ''}${m.department_path ?? ''}`))
}

/**
 * 某个（合并后的）时间线节点落在弃置段里吗 —— 落在就返回它的标注（段内序号 + 段长）。
 *
 * 口径集中在这里（原先 home / mine / approvalPage 三页各抄了一份）。
 * 取组内**第一个落在段里**的环节：组可能跨段（同一人连着办，段前那一环 + 段首那一环被合并成一条），
 * 以"在段里"的那一环为准 —— 否则整组会被漏掉，看起来"还是没背景"。
 */
export function discardMarkOf (
  group: ApproverStepGroup,
  marks: Array<DiscardMark | undefined>,
): DiscardMark | undefined {
  for (const i of group.indexes) {
    const mark = marks[i]
    if (mark) {
      return mark
    }
  }
  return undefined
}

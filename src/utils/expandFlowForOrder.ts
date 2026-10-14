import type { ApprovalFlow } from '@/types/approval'
import { expandProbes, flowHasProbe } from '@/utils/approvalProbe'
import { expandRotations } from '@/utils/approvalRotation'
import { getTemplateFlowForRef } from '@/utils/collection'
import { resolveProbes } from '@/utils/probeQuery'
import { resolveAllRotationGroups } from '@/utils/rotationData'
import { expandTemplateRefs, hasTemplateRef } from '@/utils/templateRef'

export interface OrderFlowExpansion {
  /** 展开好的流程（原对象不改）；有 issues 时**不要**用它建单 */
  flow: ApprovalFlow
  /** 展开不了的地方。**非空即应判该条建单失败**（见各模块的文件头：宁可当场报，也别建出残缺的单） */
  issues: string[]
}

/**
 * 把**模板 flow** 变成**本单可快照的 flow**（建单期唯一入口，pages/workStream 里调用）。
 *
 * 这里做三件事，顺序是硬要求：
 *   ⓪ 「引用模板」：读源模板、把它的流程整段搬进来（`expandTemplateRefs`，见 utils/templateRef）；
 *      —— 必须排在最前：搬进来的段落里可能自带查询与轮询，那些也要被下面两步求值展开；
 *   ① 「数据查询」节点：先打库取答案，再只保留**命中那条分支**（`expandProbes`）；
 *      —— 必须在 ② 之前：否则"没走的那条分支"里配的查询/轮询也会被查一遍，
 *      白查一次库，更糟的是那次失败会把这条本来正常的建单判成失败；
 *   ② 「组间轮询」：按数据查出来的组，把卡片/环节展开成 N 个普通环节（`expandRotations`）。
 *
 * ## 为什么这一步不能省（踩过）
 *
 * flow 是**静态快照**：查询与分环都只在建单那一刻算一次，之后 `rebuildChain` 不再求值
 * （见 types/approval 里 ProbeSpec / RotationSpec 的说明）。所以漏掉这一步，快照里就会
 * 留下没展开的 `probe` / `loop` 节点，而 `rebuildChain` 遇到它们会**直接抛错**
 * （"没有在建单时展开，单据数据不完整"）—— 表现是：单子建得出来、前面几环也能办，
 * **办到那一环时提交失败**，而且这个单怎么重试都过不去。
 *
 * ## 角色解析不在这里
 *
 * `resolveFlowRoles`（部门负责人 → 真人）需要组织架构树，由调用方在我们**之后**调用 ——
 * 顺序不能反：轮询展开出来的那一环，成员是「该组负责人（role.dept = 组名）」，
 * 得让角色解析去填人（见 utils/approvalRotation 的文件头）。
 *
 * @param ctx 本单的业务数据上下文（`toFlowContext(行数据)`）：查询占位符 `{:列名}` 从它取值
 */
export async function expandFlowForOrder (
  templateFlow: ApprovalFlow,
  ctx: Record<string, unknown>,
): Promise<OrderFlowExpansion> {
  let flow = templateFlow

  /*
   * ⓪ 引用模板：把 `ref` 换成源模板的流程（id 加前缀、清掉源模板的出口标记）。
   * 必须在 ①② 之前 —— 搬进来的段落里可能自带查询 / 轮询，顺序反了它们就漏展开了。
   */
  if (hasTemplateRef(flow)) {
    try {
      const refs = await expandTemplateRefs(flow, getTemplateFlowForRef)
      if (refs.issues.length > 0) {
        return { flow, issues: refs.issues }
      }
      flow = refs.flow
    } catch (error) {
      return { flow, issues: [`展开「引用模板」失败：${error instanceof Error ? error.message : String(error)}`] }
    }
  }

  // ① 数据查询：求值 → 只留命中那条分支
  if (flowHasProbe(flow)) {
    try {
      const answers = await resolveProbes(flow, ctx)
      const probed = expandProbes(flow, answers)
      if (probed.issues.length > 0) {
        return { flow, issues: probed.issues }
      }
      flow = probed.flow
    } catch (error) {
      // 查不出来不猜（列名写错 / 占位符取不到值都在这里暴露）
      return { flow, issues: [error instanceof Error ? error.message : String(error)] }
    }
  }

  // ② 组间轮询：按组展开（没配轮询时两次调用都是空跑，不查库）
  try {
    const groups = await resolveAllRotationGroups(flow, ctx)
    const rotated = expandRotations(flow, groups)
    if (rotated.issues.length > 0) {
      return { flow, issues: rotated.issues }
    }
    flow = rotated.flow
  } catch (error) {
    return { flow, issues: [error instanceof Error ? error.message : String(error)] }
  }

  /*
   * ③ 收尾自检：展开完**不该**再残留 probe / loop。
   *
   * 为什么还要查一遍（上面两步各自的 issues 已经报过"配置错误"）：这里兜的是"**根本没被收集到**"——
   * 收集器没走到的形状（嵌套层级、以后新加的容器）会悄悄漏过去，而漏过去的后果是
   * **单子已经建出来、前面几环也办了**，直到办到那一环提交时才炸（正是这次踩的坑）。
   * 建单那一刻报出来，代价最小。
   */
  const leftovers = leftoverFlowNodes(flow)
  if (leftovers.length > 0) {
    return { flow, issues: [`流程里还有没展开的${leftovers.join('、')}（见 utils/expandFlowForOrder 的说明）`] }
  }

  return { flow, issues: [] }
}

/** 流程里残留的「数据查询」/「组间轮询」/「引用模板」（顶层、分支内、卡片内都看） */
function leftoverFlowNodes (flow: ApprovalFlow): string[] {
  const probes: Array<Record<string, any>> = []
  const loops: Array<Record<string, any>> = []
  const refs: Array<Record<string, any>> = []
  const walkSteps = (steps?: Array<Record<string, any>>) => {
    for (const s of steps ?? []) {
      if (s.type === 'probe') {
        probes.push(s)
      }
      if (s.type === 'loop') {
        loops.push(s)
      }
      if (s.type === 'ref') {
        refs.push(s)
      }
      if (s.type === 'branch') {
        for (const b of s.branches ?? []) {
          walkSteps(b.steps)
        }
      }
      walkSteps(s.steps)
    }
  }
  for (const n of flow as unknown as Array<Record<string, any>>) {
    if (n.type === 'probe') {
      probes.push(n)
    }
    if (n.type === 'loop') {
      loops.push(n)
    }
    if (n.type === 'ref') {
      refs.push(n)
    }
    if (n.type === 'branch') {
      for (const b of n.branches ?? []) {
        walkSteps(b.steps)
      }
    }
    walkSteps(n.steps)
  }
  const out: string[] = []
  if (probes.length > 0) {
    out.push(`「数据查询」节点（${nameList(probes)}）`)
  }
  if (loops.length > 0) {
    out.push(`「组间轮询」卡片（${nameList(loops)}）`)
  }
  if (refs.length > 0) {
    out.push(`「引用模板」卡片（${nameList(refs)}）`)
  }
  return out
}

/**
 * 把残留节点列成**人能认出来的样子**：优先打名字（画布上的卡片名），没名字才退回 id。
 *
 * 为什么改：原来只列一串 uuid，用户在模板里根本对不上是哪张卡片 ——
 * 而这句报错的作用就是"让人回去把那张卡片改掉"，对不上等于白报。
 * 超过 5 处只列前 5 个 + 总数：一段流程几十处漏展开时，全列出来反而看不清重点。
 */
function nameList (nodes: Array<Record<string, any>>): string {
  const label = (n: Record<string, any>) => {
    const name = String(n.name ?? '').trim()
    return name ? `「${name}」` : `id=${String(n.id ?? '')}`
  }
  const head = nodes.slice(0, 5).map(label).join('、')
  return nodes.length > 5 ? `${head} 等 ${nodes.length} 处` : head
}

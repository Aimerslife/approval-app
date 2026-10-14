import dayjs from 'dayjs'
import type { ApprovalChain, ApprovalChainItem } from '@/types/approval'
// "从链路里认最后一条已办"的口径与表格共用（纯函数，不拉 PocketBase 客户端）
import { lastHandledIn } from '@/utils/approvalRuntime'

/**
 * 「流程到达某个环节」通知的**纯逻辑**（文案 + 位置计算）。
 *
 * 为什么单独一个模块：发送那一端（utils/notifySteps）顶层 import 了 `@/api/api`
 * → 会拉进 `@/pocketbase.ts`（用了 `import.meta.env`），**在 Node 里 import 不进来**，
 * 纯逻辑就没法用 tsx 直接跑断言。与 notifyText / biQuery / excelTable 是同一个理由。
 */

/**
 * 这一轮**新到达**的环节从 `after` 的第几个开始 —— 取与 `before` 的**公共前缀长度**。
 *
 * 为什么不是"after 里有、before 里没有"（集合差）：
 * 驳回重审会让流程**回到走过的环节**，那个 stepId 早就在 before 里了，
 * 集合差看不见它 —— 结果是"被驳回回来的人收不到通知"，而他要办的东西恰恰变了。
 * 按公共前缀算，`before=[A,B,C]` / `after=[A,B,C,A]` 的新到达就是最后一个 A（第 4 个）✓。
 *
 * ⚠️ 两条链必须由**同一个 flow** 重算而来（同一次提交的"推进前 / 推进后"），
 * 否则位置对不上 —— 调用方见 composables/useNodeSubmit 与 utils/collection 的 notifyOnCreate。
 */
export function arrivedFrom (before: readonly string[], after: readonly string[]): number {
  let i = 0
  while (i < before.length && i < after.length && before[i] === after[i]) {
    i++
  }
  return i
}

/**
 * 「上一轮审批信息」：该环节之前**最后一个已办理**的环节是谁、什么结论、意见、什么时候。
 *
 * 给收件人一眼就能决定要不要马上打开：是自己上次的意见被驳回回来了，还是别人刚过了一手。
 * 取不到（本环节就是第一环）时返回空串，调用方不显示这一行。
 *
 * @param chain 推进后的链路（与 stepIds 同序，由 rebuildChain 产出）
 * @param index 环节在 chain 里的下标
 */
export function previousApprovalText (chain: ApprovalChain, index: number): string {
  // 查找口径与表格的「审批结论」列共用（见 utils/approvalRuntime 的 lastHandledIn）
  const m = lastHandledIn(chain, index)
  if (!m) {
    return ''
  }
  const time = m.handled_at ? dayjs(m.handled_at).format('MM-DD HH:mm') : ''
  return [
    m.name || m.email || '',
    m.result_label || m.result || '',
    // 意见可能很长：截断，别让一条通知被一段话撑爆
    trimOpinion(m.opinion),
    time ? `（${time}）` : '',
  ].filter(Boolean).join(' ')
}

/** 意见截断（留给手机通知栏一行多一点的长度） */
function trimOpinion (opinion?: string): string {
  const text = String(opinion ?? '').trim()
  if (!text) {
    return ''
  }
  return `「${text.length > 40 ? `${text.slice(0, 40)}…` : text}」`
}

/**
 * 「到达某环节」的通知正文：环节名 + **单号** + **上一轮审批信息**。
 *
 * 形如：
 * ```
 * 【待审批】一审
 * 单号：1789...
 * 上一轮：张三 通过「同意」（10-13 15:20）
 * ```
 */
export function buildArrivalText (args: {
  /** 环节名；模板没配名字时传空 */
  title?: string
  orderNo?: string
  /** 见 previousApprovalText；没有上一轮（第一环）时传空 */
  previous?: string
}): string {
  const title = String(args.title ?? '').trim()
  return [
    title ? `【待审批】${title}` : '【待审批】有新的审批环节需要您办理',
    args.orderNo ? `单号：${args.orderNo}` : '',
    args.previous ? `上一轮：${args.previous}` : '',
  ].filter(Boolean).join('\n')
}

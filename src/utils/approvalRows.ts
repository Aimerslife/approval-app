import type { ApprovalOrder } from '@/types/approval'
import { APPROVAL_STATUS } from '@/types/approval'
import { APPROVAL_STAGE_META, approvalStageOf, toCellText, type ApprovalStage, type FilterableRow } from '@/utils/approvalFilters'
import { flowContextOfOrder } from '@/utils/approvalFlow'
import { lastHandledOf, mainOf, runtimeOf } from '@/utils/approvalRuntime'
// PB 的 bi_rows 记录（含 data 快照）→ 界面用的中文 key 产品对象
import { toProductView } from '@/utils/biRowFields'
import { formatDate, formatTimeDiff } from '@/utils/utils'

/**
 * 审批单「表格行」的组装与列定义。
 *
 * 为什么抽出来：home.vue（所有审批单，两个 tab）与 mine.vue（我的审批单）各自复制了一份，
 * 加一列要改两处、还容易只改一处。现在这是唯一的一份。
 *
 * ⚠️ 本模块**不是**纯模块：`formatTimeDiff` 来自 utils/utils，而后者间接 import 了
 * PocketBase 客户端（`import.meta.env`），因此 tsx 里 import 不进来。
 * 需要断言的纯逻辑放在 utils/approvalRuntime（重算）与 utils/approvalFilters（筛选）里。
 */

/**
 * 表格行。继承 FilterableRow —— "能被筛选的字段"由类型保证：
 * 以后往筛选项里加字段却忘了在这里补上，type-check 会报错
 * （以前靠人肉对齐，漏掉的表现是"筛出来永远是空"）。
 */
export interface ApprovalRow extends FilterableRow {
  id: string
  /** 当前待办环节的审批人；流程已走完则显示最后一个环节的审批人 */
  approver: string
  duration: string
  /** 展示状态**取值** 0..6（未审批/审批中/待定/通过/驳回/已接收/异常，见 utils/approvalFilters 的 APPROVAL_STAGE） */
  statusStage: ApprovalStage
  /** 展示状态的 chip 颜色（文案见 FilterableRow.statusText） */
  statusColor: string
  /**
   * **最后的审批结论**（如「通过」「驳回」「待定」「选择接收组别」）。
   *
   * 只对**走完流程**的单有意义（见 approvalRows 的说明）—— 还在流转的单给 `—`。
   */
  conclusion: string
  /** 结论的补充说明（办理人 · 结论 · 意见 · 时间），给单元格做悬浮提示 */
  conclusionDetail: string
}

/** 表格列定义：加一列只改这里，两个页面同时生效 */
export const APPROVAL_TABLE_HEADERS = [
  { title: '审批单号', key: 'order_no', align: 'start' },
  { title: 'SKU', key: 'sku' },
  { title: '主MODEL', key: '主MODEL' },
  { title: '部门', key: '部门' },
  { title: '当前审批人', key: 'approver' },
  { title: '状态', key: 'status', align: 'center' },
  // 最后的审批结论：只有走完流程的单才有内容（见 toApprovalRow）
  { title: '审批结论', key: 'conclusion' },
  { title: '创建时间', key: 'created' },
  { title: '审批时长', key: 'duration' },
  { title: '操作', key: 'actions', align: 'center', sortable: false },
] as const

/** 单据 → 表格行 */
export function toApprovalRow (order: ApprovalOrder): ApprovalRow {
  const p = toProductView(order.expand?.relation)
  const rt = runtimeOf(order)
  /*
   * 业务字段取**建单时的快照**（flowContextOfOrder 优先返回 chain.context），
   * 而不是关联行的当前值：审批单记录的是"当时那批货的情况"，筛选也该按当时的值。
   * 没有快照的旧单会得到 '—'，被筛选选项排除掉（不会误导成"这单没有平台"）。
   */
  const ctx = flowContextOfOrder(order)
  /*
   * 「审批人」这一列：在办取**当前待办环节**的负责人，已办结取**最后一条已办**的人。
   *
   * 为什么已办结不能取"链尾那一环"：链尾往往不是人 —— 可能是单据中途收尾后**从没办过**的环节，
   * 也可能是收尾的「飞书提醒」节点（实测一张单的链尾是「回收通知」，显示的"最后办理人"就成了
   * 一个环节名，按它筛选当然筛不到那张单）。口径与其它页面（mine.vue 的 toRow、审批页）保持一致。
   */
  const approverName = (rt.currentStep >= 0 ? mainOf(rt.chain[rt.currentStep]) : lastHandledOf(rt.chain))?.name
  // 办结时间 = 最后一个有办理时间的环节；还没办结就算到当下
  let finishedAt: string | undefined
  for (const step of rt.chain) {
    const m = mainOf(step)
    if (m?.handled_at) finishedAt = m.handled_at
  }

  /*
   * 展示状态：7 档取值（0 未审批 / 1 审批中 / 2 待定 / 3 通过 / 4 驳回 / 5 已接收 / 6 异常），
   * 见 approvalStageOf 的表。存储仍然是 0/1/2 —— 这里只派生展示口径，不动库、不影响引擎与跑批。
   * end.kind 传进去是为了认出「卡住」的单（它还是"进行中"，但谁也办不了）。
   */
  const statusStage = approvalStageOf(order.status, order.chain?.decisions, rt.end?.kind)
  const stageMeta = APPROVAL_STAGE_META[statusStage]
  /*
   * 最后的审批结论：**只对走完流程的单**给出。
   *
   * 还在流转的单没有"最后结论"可言（现在这条结论只是中间某一环的），给它显示一个结论
   * 反而误导 —— 所以那种情况一律 '—'。走完的单取**最后一条已办**（含办理人/意见/时间，
   * 放进 conclusionDetail 当悬浮提示）。
   */
  const finished = Number(order.status ?? APPROVAL_STATUS.PENDING) !== APPROVAL_STATUS.PENDING
  const last = finished ? lastHandledOf(rt.chain) : undefined
  const conclusion = last ? (last.result_label || last.result || '—') : '—'
  const conclusionDetail = last
    ? [
      last.name || '',
      conclusion,
      last.opinion ? `意见：${last.opinion}` : '',
      last.handled_at ? formatDate(last.handled_at) : '',
    ].filter(Boolean).join(' · ')
    : ''

  return {
    id: order.id,
    order_no: order.order_no ?? order.id,
    status: Number(order.status ?? APPROVAL_STATUS.PENDING),
    statusStage,
    statusText: stageMeta.text,
    statusColor: stageMeta.color,
    sku: String(p.SKU ?? p['库存SKU'] ?? '—'),
    主MODEL: String(p['主MODEL'] ?? '—'),
    部门: String(p['部门'] ?? '—'),
    approver: approverName ?? '—',
    duration: formatTimeDiff(order.created, finishedAt ?? null),
    created: order.created ?? '',
    conclusion,
    conclusionDetail,
    平台: toCellText(ctx['平台']),
  }
}

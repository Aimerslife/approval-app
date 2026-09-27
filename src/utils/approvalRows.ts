import type { ApprovalOrder } from '@/types/approval'
import { APPROVAL_STATUS } from '@/types/approval'
import { toCellText, type FilterableRow } from '@/utils/approvalFilters'
import { flowContextOfOrder } from '@/utils/approvalFlow'
import { mainOf, runtimeOf } from '@/utils/approvalRuntime'
// PB 的 bi_rows 记录（含 data 快照）→ 界面用的中文 key 产品对象
import { toProductView } from '@/utils/biRowFields'
import { formatTimeDiff } from '@/utils/utils'

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
}

/** 表格列定义：加一列只改这里，两个页面同时生效 */
export const APPROVAL_TABLE_HEADERS = [
  { title: '审批单号', key: 'order_no', align: 'start' },
  { title: 'SKU', key: 'sku' },
  { title: '主MODEL', key: '主MODEL' },
  { title: '部门', key: '部门' },
  { title: '当前审批人', key: 'approver' },
  { title: '状态', key: 'status', align: 'center' },
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
  // 当前审批人：有未办环节取它；全办完则取最后一环
  const idx = rt.currentStep >= 0 ? rt.currentStep : rt.chain.length - 1
  // 办结时间 = 最后一个有办理时间的环节；还没办结就算到当下
  let finishedAt: string | undefined
  for (const step of rt.chain) {
    const m = mainOf(step)
    if (m?.handled_at) finishedAt = m.handled_at
  }
  return {
    id: order.id,
    order_no: order.order_no ?? order.id,
    status: Number(order.status ?? APPROVAL_STATUS.PENDING),
    sku: String(p.SKU ?? p['库存SKU'] ?? '—'),
    主MODEL: String(p['主MODEL'] ?? '—'),
    部门: String(p['部门'] ?? '—'),
    approver: mainOf(rt.chain[idx])?.name ?? '—',
    duration: formatTimeDiff(order.created, finishedAt ?? null),
    created: order.created ?? '',
    平台: toCellText(ctx['平台']),
    销售状态: toCellText(ctx['销售状态']),
    一级品类: toCellText(ctx['一级品类']),
  }
}

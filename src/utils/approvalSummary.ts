import type { ApprovalOrder } from '@/types/approval'
import { APPROVAL_RESULTS, APPROVAL_STATUS, mainOf, receivedQuantities } from '@/types/approval'
import { flowContextOfOrder } from '@/utils/approvalFlow'
// 单据 → 表格行：「审批人 / 状态 / 审批时长 / 最后结论」的口径**只此一份**
import { toApprovalRow } from '@/utils/approvalRows'
import { rotationReceiptsOf, runtimeOf, stepStartTimesOf } from '@/utils/approvalRuntime'
// PB 的 bi_rows 记录 → 界面用的中文 key 产品对象
import { toProductView } from '@/utils/biRowFields'
import { formatDate, formatTimeDiff, shareValueText } from '@/utils/utils'

/**
 * 审批结束后的「审批信息表」：把一张单整理成可以**直接导出 PDF** 的三段表格。
 *
 * 为什么单独一个模块而不是写在组件里：
 *   · 口径全部复用现成的实现 —— 状态 / 审批人 / 审批时长来自 `toApprovalRow`（表格列同一份），
 *     接收数量来自 `receivedQuantities`（引擎、办理端的上限校验、时间线都是它），
 *     团队明细来自 `rotationReceiptsOf`。各处自己再算一遍必然漂，而这张表是要归档给人看的。
 *   · 组件只负责排版与导出，数据长什么样在这里定死，方便日后加列（加一处即可）。
 *
 * ⚠️ 与 utils/approvalRows 一样**不是纯模块**（utils/utils 间接拉进 PB 客户端），
 *    需要断言的纯逻辑请放到 utils/approvalRuntime / utils/approvalFilters。
 */

/** 键值对（基本信息、结论、汇总用） */
export interface SummaryField {
  label: string
  value: string
}

/** 审批过程的一行（一个已办环节） */
export interface SummaryStepRow {
  /** 组内序号（1 起）：同一人连续办理时是多个环节，序号让人看得出办理顺序 */
  index: number
  approver: string
  department: string
  /** 结论文案（优先落库时记的 result_label） */
  result: string
  opinion: string
  /** 本环节接收的数量 / 折算金额（不是接收类的结论留空） */
  qty: string
  amount: string
  /** 办理时间 */
  at: string
  /** 本环节耗时（上一环办理 → 本环办理） */
  duration: string
}

/** 接收情况的一行（一个轮询团队 / 合计 / 剩余） */
export interface SummaryReceiptRow {
  name: string
  qty: string
  amount: string
  /** 补充说明（结论 / 办理人）；合计与剩余行留空 */
  note: string
}

export interface ApprovalSummary {
  /** 导出 PDF 用的文件名（不含扩展名） */
  fileName: string
  orderNo: string
  statusText: string
  /** 表一：审批信息（单号 / 发起人 / 发起时间 / 审批时长…） */
  info: SummaryField[]
  /** 表二：审批过程（逐环节） */
  steps: SummaryStepRow[]
  /** 表三：接收情况（各团队 + 合计 + 剩余）；没有轮询环时只有合计与剩余两行 */
  receipts: SummaryReceiptRow[]
  /** 表四：审批结论 */
  conclusion: SummaryField[]
}

/**
 * 这张单是不是**已经审批结束**了。
 *
 * 判据与表格「状态」列同源：`status` 一旦离开 PENDING 就是终态（通过 / 驳回），
 * 但历史脏数据里出现过 status 没跟上、链路其实已经没有人待办的单 ——
 * 所以再看一眼运行期链路有没有待办环节。`卡住`的单不算结束：它谁也办不了，得有人去修模板。
 */
export function isOrderFinished (order?: ApprovalOrder | null): boolean {
  if (!order) {
    return false
  }
  if (Number(order.status ?? APPROVAL_STATUS.PENDING) !== APPROVAL_STATUS.PENDING) {
    return true
  }
  const rt = runtimeOf(order)
  return rt.currentStep < 0 && rt.end?.kind !== 'stuck'
}

/**
 * 单据 → 审批信息表。
 *
 * @param creatorName 发起人姓名。单上只存了 `creator`（users 记录 id），姓名由调用方给
 *                    （能 expand 到就用展开值，否则用登录者姓名兜底，见 components/approval/ApprovalSummaryTable）
 */
export function buildApprovalSummary (order: ApprovalOrder, creatorName = ''): ApprovalSummary {
  // 口径与表格列完全一致（状态、审批人、审批时长、最后结论）
  const row = toApprovalRow(order)
  const rt = runtimeOf(order)
  const ctx = flowContextOfOrder(order)
  const product = toProductView(order.expand?.relation)
  const startTimes = stepStartTimesOf(order, rt.chain)

  /*
   * 办结时间 = **最后一个有办理时间的环节**（与 toApprovalRow 里 duration 的终点同一个口径）。
   * 不能用 order.updated：单据会被抄送 / 转办 / 催办改写，那不是审批结束的时间。
   */
  let finishedAt = ''
  for (const step of rt.chain) {
    const m = mainOf(step)
    if (m?.handled_at) {
      finishedAt = m.handled_at
    }
  }

  /*
   * 数量与金额：总库存取建单快照（ctx），快照里没有才退到关联行当前值 ——
   * 与 approvalPage 的 stockQty / stockAmount 一致，否则"剩余金额"会和页面上的数对不上。
   */
  const ledger = receivedQuantities(order.chain?.decisions ?? [], ctx)
  const stockQty = String(ledger.total ?? ctx['总库存数量'] ?? product['总库存数量'] ?? '')
  const stockAmount = String(ctx['总库存金额'] ?? product['总库存金额'] ?? '')
  /** 数量 → 折算金额（与办理弹窗「剩余接收数量」旁边那个金额同一个算法） */
  const amountOf = (qty: unknown) => shareValueText(stockAmount, stockQty, qty)

  const info: SummaryField[] = [
    { label: '审批单号', value: row.order_no },
    { label: '审批状态', value: row.statusText },
    { label: '发起人', value: creatorName || '—' },
    { label: '所属部门', value: String(row['部门'] || '—') },
    { label: '发起时间', value: formatDate(order.created) || '—' },
    { label: '结束时间', value: formatDate(finishedAt) || '—' },
    { label: '审批时长', value: row.duration || '—' },
    { label: 'SKU', value: String(row.sku || '—') },
    { label: '主MODEL', value: String(row.主MODEL || '—') },
    { label: '平台 / 团队', value: [ctx['平台'], product['团队'] ?? product['组别']].filter(Boolean).join(' / ') || '—' },
  ]

  /*
   * 审批过程：逐环节一行（**不合并**同一审批人 —— 合并是时间线的展示口径，
   * 归档表格要的是每一步各自的时间与结论）。
   * 「飞书提醒」环不是审批动作，跳过（它没有办理人）。
   */
  const steps: SummaryStepRow[] = []
  rt.chain.forEach((step, i) => {
    const who = mainOf(step)
    if (!who || who.type === 'notify') {
      return
    }
    // 只收已办：未办环节上挂着的是"接下来该谁办"，写进归档表会被当成办过
    if (!who.handled_at && !who.result) {
      return
    }
    const qty = String(who.extra?.qty ?? '').trim()
    steps.push({
      index: steps.length + 1,
      approver: who.name || '—',
      department: who.department || who.department_path || '—',
      result: resultLabelOf(who.result_label, who.result),
      opinion: String(who.opinion ?? '').trim() || '—',
      qty: qty || '—',
      amount: (qty ? amountOf(qty) : '') || '—',
      at: formatDate(who.handled_at) || '—',
      duration: who.handled_at ? formatTimeDiff(startTimes[i], who.handled_at) : '—',
    })
  })

  /*
   * 接收情况：轮询各团队各接多少（有轮询才有多行）+ 合计 + 剩余。
   * 金额同样按「总额 ÷ 总数量 × 数量」折算 —— 件数说明不了轻重，归档要能看出接了多少钱。
   */
  const receipts: SummaryReceiptRow[] = rotationReceiptsOf(rt.chain).map(r => ({
    name: r.group,
    qty: r.qty === undefined ? '—' : String(r.qty),
    amount: (r.qty === undefined ? '' : amountOf(r.qty)) || '—',
    note: [r.resultLabel, r.byName].filter(Boolean).join(' · '),
  }))
  receipts.push({
    name: '团队接收合计',
    qty: String(ledger.received),
    amount: amountOf(ledger.received) || '—',
    note: `总库存数量 ${stockQty || '—'}`,
  })
  receipts.push({
    name: '剩余',
    qty: ledger.remaining === undefined ? '—' : String(ledger.remaining),
    amount: (ledger.remaining === undefined ? '' : amountOf(ledger.remaining)) || '—',
    note: `总库存金额 ${stockAmount || '—'}`,
  })

  const lastHandled = [...rt.chain].reverse()
    .map(step => mainOf(step))
    .find(m => m && (m.handled_at || m.result))
  const conclusion: SummaryField[] = [
    { label: '审批结论', value: row.conclusion || '—' },
    { label: '结论人', value: lastHandled?.name || '—' },
    { label: '结论时间', value: formatDate(lastHandled?.handled_at) || '—' },
    { label: '结束依据', value: rt.end?.reason || '—' },
  ]

  const orderNo = row.order_no
  return {
    fileName: `审批单-${orderNo}-审批信息`,
    orderNo,
    statusText: row.statusText,
    info,
    steps,
    receipts,
    conclusion,
  }
}

/** 结论文案：落库时记的优先，其次码表，最后原样返回结论码 */
function resultLabelOf (label: unknown, code: unknown): string {
  const text = String(label ?? '').trim()
  if (text) {
    return text
  }
  const value = String(code ?? '').trim()
  if (!value) {
    return '—'
  }
  return APPROVAL_RESULTS.find(r => r.value === value)?.label ?? value
}

import type { ApprovalChainItem, ApprovalOrder } from '../src/types/approval'
/*
 * 「我的审批」的四个分类判据**直接复用前端那一套纯函数** —— 这是本模块最重要的约定：
 *   · orderPendingOn  —— 当前待办环节的负责人是他（待办）
 *   · orderHandledBy  —— 任一环节作为审批人办掉了（已审批）
 *   · orderCcTo       —— 链上有 type='cc' 的他（抄送我的）
 *   · orderCreatedBy  —— 建单 creator 是他（我发起的）
 * 在这里另写一份判定，等于给"什么算我的单"开了第二个口径：
 * 页面与接口一旦有分歧，表现就是"列表里有一张、点开却说不是你的"。
 */
import {
  orderCcTo,
  orderCreatedBy,
  orderHandledBy,
  orderPendingOn,
} from '../src/utils/approvalRuntime'
import { adminToken, assertUser, PB_URL } from './pbAdmin'

/** 左栏的五个分类（与 pages/mine.vue 的 MineTab 一一对应） */
export type MineTab = 'pending' | 'approved' | 'cc' | 'created' | 'history'

const TABS = new Set<MineTab>(['pending', 'approved', 'cc', 'created', 'history'])

export interface MineOrdersResult {
  /** 本次返回的是哪一档（服务端纠正过非法值） */
  tab: MineTab
  /** **五档各自的条数**：左栏的角标要显示它们，而按 tab 懒加载时只回来一档，所以每次都一起算 */
  counts: Record<MineTab, number>
  /** 该档的整单（含 expand.relation，前端渲染产品信息要用） */
  rows: ApprovalOrder[]
}

/**
 * 按 tab 读「我的审批」。
 *
 * ## 为什么放在服务端
 *
 * 四档的判据都要**按 flow + decisions 重算链路**（utils/approvalRuntime 的 runtimeOf），
 * PocketBase 的 filter 表达不了。放在前端就只能"先把全部单拉回来再本地筛" ——
 * 这正是改懒加载前的做法：进页面就拖着所有单（每条都带完整流程快照，几十 KB）跑一遍。
 * 挪到服务端后，浏览器每次只拿当前这一档。
 *
 * ## 身份
 *
 * 不接受前端传来的 open_id / email：拿调用者的 PB token 去问 PocketBase（assertUser）。
 * 否则随便伪造一个 open_id 就能看别人的待办。
 */
export async function readMineOrders (opts: { token: string, tab: string }): Promise<MineOrdersResult> {
  const me = await assertUser(opts.token)
  // 与 stores/user 的 member 同一个形状（sameApprover 先比邮箱、没有邮箱才比姓名）
  const who: ApprovalChainItem = {
    ...(me.open_id ? { open_id: me.open_id } : {}),
    ...(me.name ? { name: me.name } : {}),
    ...(me.email ? { email: me.email } : {}),
  }

  const orders = await readAllOrders()
  const buckets: Record<MineTab, ApprovalOrder[]> = {
    pending: [],
    approved: [],
    cc: [],
    created: [],
    history: [],
  }

  for (const order of orders) {
    if (orderPendingOn(order, who)) {
      buckets.pending.push(order)
    }
    /*
     * 「已审批」= **我经手过的历史单**，与「待办」**不互斥**。
     *
     * 早先这里写的是 `!pending && handled`（当成一对补集），于是这类单会整块消失：
     * 一张单我在第 1 环办过、现在又轮到我办第 5 环 —— 它既在「待办」，也该在「已审批」
     * （"我办过哪些"是历史事实，不会因为单子转回我手上而抹掉）。现场反馈"我经手的单不在
     * 已审批里"就是这个（实测单号 1792744889839：第 1 环他办过、第 5 环等他办）。
     */
    if (orderHandledBy(order, who)) {
      buckets.approved.push(order)
    }
    if (orderCcTo(order, who)) {
      buckets.cc.push(order)
    }
    if (orderCreatedBy(order, me.id)) {
      buckets.created.push(order)
    }
    buckets.history.push(order)
  }

  const tab = normalizeTab(opts.tab)
  return {
    tab,
    counts: {
      pending: buckets.pending.length,
      approved: buckets.approved.length,
      cc: buckets.cc.length,
      created: buckets.created.length,
      history: buckets.history.length,
    },
    rows: buckets[tab],
  }
}

function normalizeTab (raw: unknown): MineTab {
  const tab = String(raw ?? '').trim() as MineTab
  // 认不出就按「待办」：这是进页面默认看的那一档，不会给出一个空表格
  return TABS.has(tab) ? tab : 'pending'
}

/**
 * 读**全部**审批单（管理员凭据）。
 *
 * 用管理员而不是调用者的 token：`approval_chain` 的 listRule 对普通员工是受限的
 * （只能看到与自己相关的单），而这里要先拿到全部才能算出"哪些与我相关"。
 * 权限边界由 assertUser + 本函数只读不写来保证：调用者最终只拿到属于自己的那几档。
 *
 * 分页按 PB 的上限 200 走；`sort=-created` 与列表页同序（新的在前）。
 */
async function readAllOrders (): Promise<ApprovalOrder[]> {
  const token = await adminToken()
  const out: ApprovalOrder[] = []
  for (let page = 1; ; page++) {
    const url = new URL('/api/collections/approval_chain/records', PB_URL)
    url.searchParams.set('perPage', '200')
    url.searchParams.set('page', String(page))
    url.searchParams.set('sort', '-created')
    // 与 getApprovalOrder 一致：expand 要写字段名 relation（写集合名会被静默忽略）
    url.searchParams.set('expand', 'relation')
    const res = await fetch(url.toString(), { headers: { Authorization: token } })
    if (!res.ok) {
      throw new Error(`读取审批单失败：HTTP ${res.status}`)
    }
    const body: { items?: ApprovalOrder[], totalPages?: number } = await res.json()
    out.push(...(body.items ?? []))
    if (page >= (body.totalPages ?? 1)) {
      break
    }
  }
  return out
}

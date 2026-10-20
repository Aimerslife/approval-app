// 审批单状态（0 进行中 / 1 通过 / 2 驳回）：与前端**共用同一份**常量，
// 免得这里写死一个 0 之后，那边改了语义两边对不上（这个文件没有任何运行时依赖，服务端引它不拖前端代码）
import { APPROVAL_STATUS } from '../src/types/approval'
import './env'
import { type AdminCaller, adminToken, assertSuperAdmin, PB_URL } from './pbAdmin'

/**
 * 「删除审批单」——**只有超级管理员**能调，删的是**整条单**：`approval_chain` 记录
 * 以及它的附件（`approval_files`，按 `order_id` 关联）。
 *
 * ## 为什么必须放在服务端
 *
 * `approval_chain` 与 `approval_files` 在 PocketBase 里的 `deleteRule` 都是**空**
 * （空规则 = 只有 superuser 能删），前端哪怕绕过界面直接调 SDK 也会被 PB 拒掉。
 * 这里用**管理员凭据**执行，所以"调用者是不是 superAdmin"必须在服务端校验
 * （见 pbAdmin.assertSuperAdmin：拿调用者自己的 token 去问 PB，前端说什么都不作数）。
 *
 * ## 为什么连附件一起删
 *
 * `approval_files` 只有 `order_id` 一个外键指向单子，PB 不会级联删。
 * 只删单子的话，这些文件就**永远打不开**了（列表按 order_id 取，界面上再也找不到入口），
 * 白占空间还留着业务数据。既然删单是"这单不要了"，就把它的东西一起清掉。
 * 顺序上先删附件再删单：中途失败时留在库里的是"单子还在、附件少了几条"（可再删一次），
 * 反过来则会出现"单子没了、附件成了孤儿"。
 *
 * ## 幂等
 *
 * 单子已经被删掉（404）时**返回成功**、`deleted: false` —— 连点两下、或两个人同时删，
 * 第二个人看到的应该是"已删除"，而不是一个红色报错。
 *
 * ## 两个入口
 *
 *   1. `deleteApprovalOrder`  —— 删**一张**（表格「操作」栏的删除按钮）；
 *   2. `deleteHistoryOrders`  —— 删**全部历史审批单**（已办结的，见下面的 HISTORY_FILTER）。
 * 除了规模，两者的口径（身份校验、先附件后单、幂等）是同一套，别只改其中一个。
 */

export interface DeleteOrderSummary {
  id: string
  /** 单号（读取失败 / 已被删掉时为空串） */
  order_no: string
  /** 删除前的状态；已被删掉时为 null */
  status: number | null
  /** 这次调用**真的删了**没有（false = 之前就已经不在了） */
  deleted: boolean
  /** 一起清掉的附件条数 */
  filesDeleted: number
  /** 谁删的（服务端问 PB 问出来的，不是前端传的） */
  by: AdminCaller
}

/** PB 记录 id 的形状（15 位小写字母数字）——先卡一道，免得把 id 拼进 filter 时出意外 */
const RECORD_ID_RE = /^[a-z0-9]{15}$/

export async function deleteApprovalOrder (opts: { token: string, id: string }): Promise<DeleteOrderSummary> {
  // ① 身份：只有超级管理员（文案里带上实际动作，与界面按钮对得上）
  const by = await assertSuperAdmin(opts.token, '删除审批单')

  const id = String(opts.id ?? '').trim()
  if (!RECORD_ID_RE.test(id)) {
    throw new Error('审批单 id 不合法（应形如 z3k9p1q7r2s4t5u）')
  }

  const admin = await adminToken()

  // ② 先把这条单读出来：拿到单号（写日志 / 回执），顺便判"是不是已经没了"
  const read = await fetch(new URL(`/api/collections/approval_chain/records/${id}`, PB_URL).toString(), {
    headers: { Authorization: admin },
  })
  if (read.status === 404) {
    return { id, order_no: '', status: null, deleted: false, filesDeleted: 0, by }
  }
  if (!read.ok) {
    throw new Error(`读取审批单失败：HTTP ${read.status}`)
  }
  const record: { order_no?: unknown, status?: unknown } = await read.json()

  // ③ 附件（先删，理由见文件头）
  const filesDeleted = await deleteFilesOfOrder(id, admin)

  // ④ 单子本身
  const del = await fetch(new URL(`/api/collections/approval_chain/records/${id}`, PB_URL).toString(), {
    method: 'DELETE',
    headers: { Authorization: admin },
  })
  if (!del.ok) {
    throw new Error(`删除审批单失败：HTTP ${del.status}`)
  }

  return {
    id,
    order_no: record.order_no === undefined ? '' : String(record.order_no),
    status: typeof record.status === 'number' ? record.status : null,
    deleted: true,
    filesDeleted,
    by,
  }
}

/**
 * 删掉某张单的全部附件，返回条数。
 *
 * 循环取到空为止（一单的附件通常个位数，一次 200 条足够；循环只是兜住极端情况）。
 * 任何一条删失败都**直接报错**：宁可让调用方看到"删了一半"，也别静默跳过留下孤儿文件。
 */
async function deleteFilesOfOrder (orderId: string, token: string): Promise<number> {
  let deleted = 0
  for (;;) {
    const url = new URL('/api/collections/approval_files/records', PB_URL)
    url.searchParams.set('perPage', '200')
    url.searchParams.set('fields', 'id')
    url.searchParams.set('filter', `order_id = "${orderId}"`)

    const res = await fetch(url.toString(), { headers: { Authorization: token } })
    if (!res.ok) {
      throw new Error(`读取该单的附件失败：HTTP ${res.status}`)
    }
    const body: { items?: Array<{ id?: unknown }> } = await res.json()
    const ids = (body?.items ?? []).map(r => String(r.id ?? '')).filter(Boolean)
    if (ids.length === 0) {
      break
    }

    for (const fileId of ids) {
      const del = await fetch(new URL(`/api/collections/approval_files/records/${fileId}`, PB_URL).toString(), {
        method: 'DELETE',
        headers: { Authorization: token },
      })
      if (!del.ok) {
        throw new Error(`删除附件失败：HTTP ${del.status}`)
      }
      deleted += 1
    }
  }
  return deleted
}

/* ==================== 删除全部历史审批单 ==================== */

/**
 * 「历史审批单」的判定 —— 与前端 `useApprovalTable` 的 `historyRows` **同一份口径**：
 * 已办结（通过 / 驳回）= `status !== PENDING`。
 *
 * ⚠️ 进行中的单**一张都不碰**：它们还在流转，删掉之后当前办理人一提交就会写到一条
 *    不存在的单上（办理记录、附件全成孤儿），而且没有任何界面能把它找回来。
 *    所以这里的过滤条件是"不等于 PENDING"，而不是"删全部 approval_chain"。
 */
const HISTORY_FILTER = `status != ${APPROVAL_STATUS.PENDING}`

export interface DeleteHistorySummary {
  /** 这次调用有没有真删（dryRun 只统计） */
  dryRun: boolean
  /** 命中「历史审批单」的单数 —— dryRun 时它就是"将要删掉多少" */
  targeted: number
  /** 真的删掉的单数（多人同时点时会小于 targeted） */
  deletedOrders: number
  /** 一起清掉的附件条数 */
  filesDeleted: number
  /** 谁删的（服务端问 PB 问出来的，不是前端传的） */
  by: AdminCaller
}

/**
 * 删除**全部历史审批单**（含它们的附件）。只有超级管理员能调。
 *
 * 单条删除走 deleteApprovalOrder，这里是批量版，两者的"先删附件再删单"顺序、
 * 幂等（已经不在 = 成功）、身份校验（assertSuperAdmin）完全一致 —— 差别只在规模，
 * 所以实现上不能沿用单条那套"逐单查附件"（那是 N 次请求），见 deleteFilesOfOrders。
 *
 * `dryRun` 只数不删：界面上的确认框先用它把"将要删掉多少张"摆出来再让人确认
 * （与 /api/bi/sync、清空 BI 数据同一套老规矩）。
 */
export async function deleteHistoryOrders (
  opts: { token: string, dryRun?: boolean },
): Promise<DeleteHistorySummary> {
  const dryRun = opts.dryRun === true
  const by = await assertSuperAdmin(opts.token, '删除历史审批单')
  const admin = await adminToken()

  // ① 先把目标单的 id 全部取出来再动手：边翻页边删会让游标错位、漏掉记录
  const ids = await listHistoryOrderIds(admin)
  if (dryRun || ids.length === 0) {
    return { dryRun, targeted: ids.length, deletedOrders: 0, filesDeleted: 0, by }
  }

  // ② 附件先删（与单条删除同理：中途失败留下的是"单还在、附件缺了几条"，重跑一次即可；
  //    反过来会出现"单没了、附件成孤儿"，那种状态界面上再也找不到入口）
  const filesDeleted = await deleteFilesOfOrders(new Set(ids), admin)

  // ③ 单子本身
  const deletedOrders = await deleteRecords('approval_chain', ids, admin)

  console.log(
    `[orderDelete] 历史审批单清理完成：命中 ${ids.length} 张 → 删除 ${deletedOrders} 张、附件 ${filesDeleted} 个`
    + `（${by.email ?? by.id}）`,
  )
  return { dryRun, targeted: ids.length, deletedOrders, filesDeleted, by }
}

/** 分页取「历史审批单」的 id（只取 id，别把整条 chain 拉下来） */
async function listHistoryOrderIds (token: string): Promise<string[]> {
  const ids: string[] = []
  for (let page = 1; ; page++) {
    const url = new URL('/api/collections/approval_chain/records', PB_URL)
    url.searchParams.set('page', String(page))
    url.searchParams.set('perPage', '500')
    url.searchParams.set('fields', 'id')
    url.searchParams.set('filter', HISTORY_FILTER)

    const res = await fetch(url.toString(), { headers: { Authorization: token } })
    if (!res.ok) {
      throw new Error(`读取审批单列表失败：HTTP ${res.status}`)
    }
    const body: { items?: Array<{ id?: unknown }>, totalPages?: unknown } = await res.json()
    const pageIds = (body?.items ?? []).map(r => String(r.id ?? '')).filter(Boolean)
    ids.push(...pageIds)
    // 取完最后一页就停：不能只靠"这一页是空的"，PB 的 page 超界会返回空数组但 totalPages 不变
    const totalPages = Number(body?.totalPages ?? page)
    if (pageIds.length === 0 || page >= totalPages) {
      break
    }
  }
  return ids
}

/**
 * 删掉**这批单**的附件，返回条数。
 *
 * 为什么整表扫一遍、而不是逐单 `order_id = "x"` 查一次：批量删的是几百上千张单，
 * 逐单查就是几百上千次请求；`approval_files` 只有 `order_id` 一个外键、体量可控，
 * 一次翻页扫完反而更快（单条删除仍走 deleteFilesOfOrder 的按单查 —— 那种场景它更省）。
 */
async function deleteFilesOfOrders (orderIds: Set<string>, token: string): Promise<number> {
  // 先收集 id、再删：边翻页边删同样会让游标错位
  const fileIds: string[] = []
  for (let page = 1; ; page++) {
    const url = new URL('/api/collections/approval_files/records', PB_URL)
    url.searchParams.set('page', String(page))
    url.searchParams.set('perPage', '500')
    url.searchParams.set('fields', 'id,order_id')

    const res = await fetch(url.toString(), { headers: { Authorization: token } })
    if (!res.ok) {
      throw new Error(`读取附件列表失败：HTTP ${res.status}`)
    }
    const body: { items?: Array<{ id?: unknown, order_id?: unknown }>, totalPages?: unknown } = await res.json()
    const items = body?.items ?? []
    for (const file of items) {
      const orderId = String(file.order_id ?? '')
      if (orderId && orderIds.has(orderId)) {
        fileIds.push(String(file.id ?? ''))
      }
    }
    const totalPages = Number(body?.totalPages ?? page)
    if (items.length === 0 || page >= totalPages) {
      break
    }
  }
  return deleteRecords('approval_files', fileIds, token)
}

/**
 * 并发删一批记录，返回成功条数。
 *
 * 并发 20，与「清空 BI 数据」（server/purgeData.ts 的 deleteAll）取同一档 ——
 * 本地 PB 并发再高也只是互相排队。
 *
 * 404 也算成功：别人已经删掉了，对调用方来说结果就是"它不在了"。
 * 但**一批全失败**要直接抛错 —— 那通常是权限/集合名的问题，继续跑只会原地打转
 * （否则界面上看到的是"命中 300 张、删除 0 张"，却不知道为什么）。
 */
async function deleteRecords (collection: string, ids: string[], token: string): Promise<number> {
  let deleted = 0
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20)
    const results = await Promise.all(chunk.map(id =>
      fetch(new URL(`/api/collections/${collection}/records/${id}`, PB_URL).toString(), {
        method: 'DELETE',
        headers: { Authorization: token },
      }).then(res => res.ok || res.status === 404).catch(() => false),
    ))
    const okCount = results.filter(Boolean).length
    deleted += okCount
    if (okCount === 0) {
      throw new Error(`删除 ${collection} 失败：这一批 ${chunk.length} 条全部被拒绝，请检查权限与集合名`)
    }
  }
  return deleted
}

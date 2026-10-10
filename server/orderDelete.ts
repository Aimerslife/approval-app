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

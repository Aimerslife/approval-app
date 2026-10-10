import './env'
// 管理员凭据 + 「调用者是不是超级管理员」的校验：与「删除审批单」等特权操作**共用一份**
// （见 server/pbAdmin.ts 的说明：这类校验最怕两处各写一遍）
import { type AdminCaller, adminToken, assertSuperAdmin, PB_URL } from './pbAdmin'

/**
 * 「清空 BI 数据」——**只有超级管理员**能调，且**只清 `bi_rows` 这一张表**。
 *
 * ## 为什么只有这一张表
 *
 * `bi_rows` 是 BI 同步进来的**镜像**：它随时可以用 `POST /api/bi/sync` 重新拉回来，
 * 所以清空它是**可恢复**的。审批单、模板、账号都不是镜像（删了就真没了），
 * 这个功能刻意不碰它们 —— 需要清那些请单独加动作、单独想清楚。
 *
 * ## 为什么必须放在服务端
 *
 * 前端删不掉：这些集合在 PocketBase 里的 `deleteRule` 是**空**（空规则 = 只有 superuser 能删），
 * 实测 `bi_rows` 就是空。所以前端哪怕把按钮藏起来、哪怕直接调 SDK，也会被 PB 拒掉。
 * 这里用**管理员凭据**绕过规则执行，因此「只有超级管理员」必须在**服务端**校验：
 * 前端隐藏按钮只是界面礼貌，不是权限。
 *
 * ## dryRun
 *
 * `?dryRun=1` 只统计条数、不删 —— 与 `/api/bi/sync` 的老规矩一致；
 * 界面上的确认框先用它把"将要删掉多少"摆出来再让人确认。
 */

/** 会被清空的集合（当前只有一张；做成数组是为了将来要加时不必改循环） */
export const PURGE_COLLECTIONS = ['bi_rows'] as const

/**
 * **明确不动**的东西（返回给界面显示，让人放心点确认）。
 * 尤其要提 `users`：账号删了谁都登不进来，包括执行者自己。
 */
export const PURGE_KEPT = [
  'users',
  'approval_chain',
  'app_chain',
  'approval_files',
  'group_approvers',
] as const

/**
 * 调用者信息（本模块叫「Purge」是因为它诞生在清空数据里；实现已上移到 server/pbAdmin）。
 * 保留这个名字是为了不惊动既有调用方与响应形状。
 */
export type PurgeCaller = AdminCaller

/** 某集合现有多少条 */
async function countOf (collection: string, token: string): Promise<number> {
  const res = await fetch(
    new URL(`/api/collections/${collection}/records?perPage=1&fields=id`, PB_URL).toString(),
    { headers: { Authorization: token } },
  )
  if (!res.ok) {
    return 0
  }
  const body: { totalItems?: number } = await res.json()
  return Number(body?.totalItems ?? 0)
}

/**
 * 删光一个集合：分页取 id、并发 20 个 DELETE。
 *
 * 为什么不用"删集合重建"：会把表结构一起丢掉（迁移里定义的那些列），
 * 而这里要清的只是**数据**。
 */
async function deleteAll (collection: string, token: string): Promise<number> {
  let deleted = 0
  for (;;) {
    const res = await fetch(
      new URL(`/api/collections/${collection}/records?perPage=500&fields=id`, PB_URL).toString(),
      { headers: { Authorization: token } },
    )
    if (!res.ok) {
      throw new Error(`读取 ${collection} 失败：HTTP ${res.status}`)
    }
    const body: { items?: Array<{ id?: string }> } = await res.json()
    const ids = (body?.items ?? []).map(r => String(r.id ?? '')).filter(Boolean)
    if (ids.length === 0) {
      break
    }
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20)
      const oks = await Promise.all(chunk.map(id =>
        fetch(new URL(`/api/collections/${collection}/records/${id}`, PB_URL).toString(), {
          method: 'DELETE',
          headers: { Authorization: token },
        }).then(r => r.ok).catch(() => false),
      ))
      const okCount = oks.filter(Boolean).length
      deleted += okCount
      if (okCount === 0) {
        // 这一批全被拒：再循环也是原地打转，直接报错（通常是集合名写错或没有权限）
        throw new Error(`删除 ${collection} 失败：这一批 ${chunk.length} 条全部被拒绝，请检查集合名与权限`)
      }
    }
  }
  return deleted
}

export interface PurgeSummary {
  dryRun: boolean
  /** 谁执行的（写进响应与日志，便于追溯） */
  by: PurgeCaller
  collections: Array<{ name: string, count: number, deleted: number }>
  kept: readonly string[]
  totalCount: number
  totalDeleted: number
}

/**
 * 清空 `bi_rows`（**唯一目标**；要扩到别的表请先想清楚"删了还能不能恢复"）。
 *
 * `dryRun` 只统计不删 —— 界面用它先展示"将要删掉多少"。
 */
export async function purgeBiData (opts: { token: string, dryRun: boolean }): Promise<PurgeSummary> {
  const by = await assertSuperAdmin(opts.token, '清空数据')
  const admin = await adminToken()

  const collections: PurgeSummary['collections'] = []
  let totalCount = 0
  let totalDeleted = 0
  for (const name of PURGE_COLLECTIONS) {
    const count = await countOf(name, admin)
    totalCount += count
    let deleted = 0
    if (!opts.dryRun && count > 0) {
      deleted = await deleteAll(name, admin)
      totalDeleted += deleted
    }
    collections.push({ name, count, deleted })
  }

  return { dryRun: opts.dryRun, by, collections, kept: PURGE_KEPT, totalCount, totalDeleted }
}

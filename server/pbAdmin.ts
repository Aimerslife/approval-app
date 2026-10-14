import { config } from './config'

/**
 * 服务端的**管理员凭据**与**调用者身份校验**。
 *
 * ## 为什么单独一个模块
 *
 * 所有"绕过 PocketBase 规则"的写操作（清空 BI 数据、删除审批单……）都要这两件事：
 *   1. 用 superuser 凭据执行写操作 —— 这些集合的 `deleteRule` / `writeRule` 是**空**的
 *      （空规则 = 只有 superuser 能动），前端哪怕绕过界面也删不掉；
 *   2. 拿**调用者自己的 token** 去问 PocketBase"这是谁、role 是不是 superAdmin" ——
 *      因为上一步用的是管理员凭据，权限判定必须在服务端做，且不能采信前端传来的任何字段。
 *
 * 这种代码最怕"两处各写一遍"：哪天校验口径收紧（比如加个"必须同时是租户管理员"），
 * 漏改一处就等于留了个后门。所以放这里，一处改、处处生效。
 */

/** PocketBase 地址（取自 server/config.ts —— 默认值只有那一份，别在这里再写一遍） */
export const PB_URL = config.pbUrl

/**
 * 取管理员 token：PB 0.23+ 是 `/api/collections/_superusers/...`，更早是 `/api/admins/...`。
 * 两个都试一遍，避免因为版本不同整个功能不可用。
 */
export async function adminToken (): Promise<string> {
  const email = config.pbAdminEmail
  const password = config.pbAdminPassword
  const errors: string[] = []
  for (const path of [
    '/api/collections/_superusers/auth-with-password',
    '/api/admins/auth-with-password',
  ]) {
    try {
      const res = await fetch(new URL(path, PB_URL).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: email, password }),
      })
      if (res.ok) {
        const body: { token?: string } = await res.json()
        if (body?.token) {
          return String(body.token)
        }
      }
      errors.push(`${path}: HTTP ${res.status}`)
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`PB 管理员登录失败（检查 .env.local 的 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD）：${errors.join('; ')}`)
}

/** 通过校验的调用者（服务端自己去 PB 问出来的，不采信前端传的字段） */
export interface AdminCaller {
  id: string
  role: string
  name?: string
  email?: string
}

/**
 * 校验调用者身份：必须是 `users.role === 'superAdmin'`。
 *
 * 用调用者自己的 token 调 `auth-refresh` —— 让 **PocketBase** 判定这个 token 是真的，
 * 而不是信前端传来的任何字段（前端说自己是谁不作数）。
 *
 * @param action 失败文案里的动作名（如「清空数据」「删除审批单」）—— 让提示读起来是对应那个功能
 */
export async function assertSuperAdmin (token: string, action = '执行该操作'): Promise<AdminCaller> {
  if (!token) {
    throw new Error('缺少登录凭据（请求头里没有 token）')
  }
  const res = await fetch(new URL('/api/collections/users/auth-refresh', PB_URL).toString(), {
    method: 'POST',
    headers: { Authorization: token },
  })
  if (!res.ok) {
    throw new Error(`登录凭据无效或已过期（HTTP ${res.status}），请重新登录后再试`)
  }
  const body: { record?: Record<string, unknown> } = await res.json()
  const record = body?.record ?? {}
  const role = String(record.role ?? '')
  if (role !== 'superAdmin') {
    throw new Error(`只有超级管理员可以${action}（当前角色：${role || '未设置'}）`)
  }
  return {
    id: String(record.id ?? ''),
    role,
    name: record.name ? String(record.name) : undefined,
    email: record.email ? String(record.email) : undefined,
  }
}

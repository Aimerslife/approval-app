import pb from '@/pocketbase.ts'
import { getUserOrg } from '@/api/api'

/**
 * 允许登录的企业（飞书 tenant_key），在 .env.local 里配置 VITE_COMPANY_ID。
 *
 * 留空 = 不校验（仅便于本地调试）—— 线上必须配置，否则任何飞书租户都能登录。
 * 未配置时会打一条 warn，避免"以为配了其实没配"。
 */
const ALLOWED_TENANT_KEY = import.meta.env.VITE_COMPANY_ID as string | undefined

/** 飞书 OAuth2 的原始 userinfo（PB 放在 meta.rawUser 里透传） */
interface LarkRawUser {
    open_id?: string
    tenant_key?: string
    email?: string
    name?: string
}

/**
 * 飞书 OAuth2 登录。
 *
 * 完整流程：授权 → 企业校验 → 回写飞书侧字段 → 拉企业与部门信息落库。
 * 任一步失败都抛错并清掉登录态，由调用方决定如何提示。
 *
 * @returns 落库后的 users 记录
 */
export async function loginWithLark() {
    if (!ALLOWED_TENANT_KEY) {
        console.warn('[loginWithLark] 未配置 VITE_COMPANY_ID，跳过企业校验（线上必须配置）')
    }

    // ---- 1. 飞书授权 ----
    let authData
    try {
        authData = await pb.collection('users').authWithOAuth2({
            provider: 'lark',
            redirectUri: window.location.origin + '/home',
        })
    } catch (error: any) {
        console.error('飞书登录失败:', error)
        console.error('失败详情(data):', error.response?.data ?? error.data ?? error)
        throw new Error('飞书授权失败，请重试')
    }

    const rawUser: LarkRawUser = authData.meta?.rawUser?.data ?? {}
    const openId = rawUser.open_id
    const tenantKey = rawUser.tenant_key
    // 飞书返回的完整头像 URL（含签名，形如
    // https://p3-feishu-sign.feishucdn.com/obj/v3_xxx.webp?v=...&secret=...&ts=...）
    // 注意：users 集合的 avatar 是 file 类型，不接受 URL，需存到自定义 text 字段 avatar_url
    const fullAvatar = authData.meta?.avatarURL as string | undefined
    const recordId = authData.record.id

    // ---- 2. 企业校验 ----
    // 此处 PB 已经建号并签发了 token，所以拒绝登录必须显式清掉登录态，
    // 否则会出现"被拒绝但仍是已登录状态"的矛盾状态。
    // 取不到 tenant_key 时同样拒绝（fail-closed）：宁可登录失败，也不能放行未知租户。
    if (ALLOWED_TENANT_KEY && tenantKey !== ALLOWED_TENANT_KEY) {
        pb.authStore.clear()
        console.warn('[loginWithLark] 企业不匹配，已拒绝登录:', {
            期望: ALLOWED_TENANT_KEY,
            实际: tenantKey,
        })
        throw new Error(
            tenantKey ? '当前飞书账号不属于本企业，无法登录' : '未能获取所属企业信息，无法登录',
        )
    }

    // ---- 3. 回写飞书侧字段 ----
    // 飞书 OAuth2 登录时 PB 只会把配置的字段映射（name/avatar/email 等）写进 users，
    // open_id / tenant_key 默认只落到 _externalAuths 表，需从 userinfo 原始响应手动回写。
    // 这里合并成一次 update：原来分两次，多一次往返，且中途失败会留下半更新状态。
    const patch: Record<string, unknown> = {}
    if (openId) patch.open_id = openId
    if (tenantKey) patch.tenant_key = tenantKey
    if (fullAvatar) patch.avatar_url = fullAvatar

    // ---- 4. 企业与部门信息 ----
    // 属于补充信息，失败时降级为告警、不阻塞登录（否则飞书组织接口抖动会导致全员登录不了）
    if (openId) {
        try {
            const org = await getUserOrg(openId)
            patch.company_name = org.data.company_name
            patch.department = org.data.department_name
            patch.department_path = org.data.department_path
        } catch (err) {
            console.error('[loginWithLark] 获取企业与部门信息失败:', err)
        }
    }

    // ---- 5. 落库并同步 authStore ----
    try {
        const updated = await pb.collection('users').update(recordId, patch)
        // 同步回 authStore，保证 userStore.syncFromPb 能立即读到新字段
        pb.authStore.save(pb.authStore.token, updated)
        return updated
    } catch (error: any) {
        console.error('写入用户信息失败:', error)
        console.error('失败详情(data):', error.response?.data ?? error.data ?? error)
        throw new Error('登录信息保存失败，请重试')
    }
}

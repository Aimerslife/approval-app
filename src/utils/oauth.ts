import { getUserOrg } from '@/api/api'
import pb from '@/pocketbase.ts'

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
 * 授权返回里**我们真正用到**的部分。
 *
 * 只声明用到的字段（而不是引 SDK 的完整类型）：入口拿到的是 `{ record, meta }` 结构，
 * 函数签名只要覆盖用到的字段就够了，也顺带说明这里不碰 token 之类的敏感项。
 */
interface LarkAuthPayload {
  record: { id: string }
  meta?: Record<string, any>
}

/**
 * 飞书登录（授权页嵌在应用内 —— 对话框 + iframe）。
 *
 * 实现要点：**不自己实现 OAuth2**，而是用 PB SDK 的 `authWithOAuth2({ urlCallback })`：
 *   · SDK 会先建好一次性 realtime 订阅，再回调把授权地址交给我们；
 *   · 我们把它放进自己的 iframe（取代默认的 `window.open` 弹窗）；
 *   · 用户授权后 PB 通过**实时连接**把 code 送回 SDK，由 SDK 自己完成换登录态。
 *
 * 为什么不用"轮询 iframe 地址取 code"（这条弯路踩过）：
 *   PB 的 `/api/oauth2-redirect` 不渲染页面，而是 **307 跳到它自己的界面**
 *   （`/_/#/auth/oauth2-redirect-*`）—— 带 code 的那个地址**从未被渲染**，
 *   前端 JS 根本读不到，所以永远等不到结果。
 *
 * @param onAuthUrl 拿到授权地址时回调（调用方负责把它显示出来，比如打开对话框里的 iframe）
 * @returns 落库后的 users 记录
 */
export async function loginWithLarkEmbedded (onAuthUrl: (url: string) => void) {
  let authData
  try {
    authData = await pb.collection('users').authWithOAuth2({
      provider: 'lark',
      // 只替换"打开方式"，其余（state、PKCE、redirect_uri、取 code、换 token）全交给 SDK
      urlCallback: (url) => {
        onAuthUrl(url)
      },
    })
  } catch (error: any) {
    console.error('飞书登录失败:', error)
    console.error('失败详情(data):', error.response?.data ?? error.data ?? error)
    throw new Error('飞书授权失败，请重试', { cause: error })
  }

  return applyAuthData(authData)
}

/**
 * 飞书 OAuth2 登录（PB 默认的**弹窗**流程，保留作兜底）。
 *
 * 什么时候用它：`urlCallback` 那条路出问题时的对照/退路（例如宿主环境不允许嵌 iframe）。
 */
export async function loginWithLark () {
  let authData
  try {
    authData = await pb.collection('users').authWithOAuth2({
      provider: 'lark',
    })
  } catch (error: any) {
    console.error('飞书登录失败:', error)
    console.error('失败详情(data):', error.response?.data ?? error.data ?? error)
    throw new Error('飞书授权失败，请重试', { cause: error })
  }

  return applyAuthData(authData)
}

/**
 * 授权拿到之后的公共落地流程：企业校验 → 回写飞书侧字段 → 拉企业与部门 → 落库。
 *
 * 两条路（应用内嵌 / 弹窗）都走这里，保证口径一致。
 *
 * @returns 落库后的 users 记录
 */
async function applyAuthData (authData: LarkAuthPayload) {
  if (!ALLOWED_TENANT_KEY) {
    console.warn('[loginWithLark] 未配置 VITE_COMPANY_ID，跳过企业校验（线上必须配置）')
  }

  const meta = (authData.meta ?? {}) as Record<string, any>
  const rawUser: LarkRawUser = meta.rawUser?.data ?? {}
  const openId = rawUser.open_id
  const tenantKey = rawUser.tenant_key
  // 飞书返回的完整头像 URL（含签名，形如
  // https://p3-feishu-sign.feishucdn.com/obj/v3_xxx.webp?v=...&secret=...&ts=...）
  // 注意：users 集合的 avatar 是 file 类型，不接受 URL，需存到自定义 text 字段 avatar_url
  const fullAvatar = meta.avatarURL as string | undefined
  const recordId = authData.record.id

  // ---- 1. 企业校验 ----
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

  // ---- 2. 回写飞书侧字段 ----
  // 飞书 OAuth2 登录时 PB 只会把配置的字段映射（name/avatar/email 等）写进 users，
  // open_id / tenant_key 默认只落到 _externalAuths 表，需从 userinfo 原始响应手动回写。
  // 这里合并成一次 update：原来分两次，多一次往返，且中途失败会留下半更新状态。
  const patch: Record<string, unknown> = {}
  if (openId) {
    patch.open_id = openId
  }
  if (tenantKey) {
    patch.tenant_key = tenantKey
  }
  if (fullAvatar) {
    patch.avatar_url = fullAvatar
  }

  // ---- 3. 企业与部门信息 ----
  // 属于补充信息，失败时降级为告警、不阻塞登录（否则飞书组织接口抖动会导致全员登录不了）
  if (openId) {
    try {
      const org = await getUserOrg(openId)
      patch.company_name = org.data.company_name
      patch.department = org.data.department_name
      patch.department_path = org.data.department_path
    } catch (error) {
      console.error('[loginWithLark] 获取企业与部门信息失败:', error)
    }
  }

  // ---- 4. 落库并同步 authStore ----
  try {
    const updated = await pb.collection('users').update(recordId, patch)
    // 同步回 authStore，保证 userStore.syncFromPb 能立即读到新字段
    pb.authStore.save(pb.authStore.token, updated)
    return updated
  } catch (error: any) {
    console.error('写入用户信息失败:', error)
    console.error('失败详情(data):', error.response?.data ?? error.data ?? error)
    throw new Error('登录信息保存失败，请重试', { cause: error })
  }
}

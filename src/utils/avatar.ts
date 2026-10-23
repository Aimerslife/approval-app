/**
 * 飞书头像 URL 的解析与「最终给 <img src> 用哪个地址」—— 全项目只此一处。
 *
 * ## 飞书头像的三种形态（线上都真实存在）
 *
 *   1. **完整签名 URL**：`https://p3-feishu-sign.feishucdn.com/obj/v3_xxx.webp?secret=…&ts=…`
 *      —— 能直接用，但**会过期**（带 ts / secret / signed_token）。过期后浏览器 403，
 *      表现就是"某天开始所有头像都变成空圈"，而且看控制台只有一个 403，很难联想到签名到期。
 *   2. **纯路径**（库里只存了 `v3_xxx.webp`）—— 没有域名与签名，直接拼 CDN 域名通常依然 403。
 *   3. **同源相对路径**（`/api/feishu/avatar?url=…`、`/files/…`）—— 已经是可用的同源地址，
 *      **原样使用**，绝不能再拼一次 CDN 域名（以前拼过，结果是一串必然 404 的怪地址）。
 *
 * ## 为什么最终要走服务端代理
 *
 * 服务端代理（`GET /api/feishu/avatar?url=…`，见 vite 的 `/api/feishu` 转发）每次用**现行凭据**
 * 去取图，客户端就不再受签名有效期影响 —— 接收人头像一直走的就是这条路（见 api.ts 的 proxyAvatar）。
 * 时间线上的审批人头像早先直接吃签名 URL，所以签名一到期就整片消失。
 *
 * 代理之外仍保留**原地址兜底**：代理服务临时不可用时，只要签名还没过期，头像照样能显示。
 * 这份"先代理、失败退回原地址、再失败才首字"的顺序由 `avatarSources` 给出，
 * 逐次降级的状态机在 composables/useAvatarSrc（两个页面共用）。
 */

/** 飞书 CDN 域名前缀（纯路径兜底用） */
const FEISHU_CDN_BASE = 'https://p3-feishu-sign.feishucdn.com/obj/'

/**
 * 哪些域名算"飞书头像"，值得走代理。
 * 别的绝对地址（PocketBase 的 /files、第三方图床）原样用 —— 走飞书代理只会 404。
 */
const FEISHU_AVATAR_HOST = /(^|\.)(feishucdn\.com|larksuitecdn\.com|feishu\.cn|larksuite\.com)$/i

/** 服务端头像代理（与 api.ts 的 proxyAvatar 同一个端点；改路径只改这里） */
export const AVATAR_PROXY_PATH = '/api/feishu/avatar'

/** 把飞书头像包成服务端代理地址（不做任何判断，调用方负责挑 url） */
export function avatarProxyUrl (raw: string): string {
  return `${AVATAR_PROXY_PATH}?url=${encodeURIComponent(raw)}`
}

/**
 * 飞书头像 URL 兜底解析（**不判断是否需要代理**，只补全域名）。
 *
 * 单值调用一律走 `avatarSources` / `avatarSrcOf`：它们才处理"代理优先 + 原地址兜底"。
 */
export function resolveAvatar (raw?: string | null): string {
  const url = String(raw ?? '').trim()
  if (!url) {
    return ''
  }
  // 同源相对路径：已经是可用地址（代理路径 / PB 文件），拼域名只会得到坏地址
  if (url.startsWith('/')) {
    return url
  }
  if (/^https?:\/\//i.test(url)) {
    return url
  }
  const path = url.replace(/^\/+(?:obj\/)?/, '')
  return `${FEISHU_CDN_BASE}${path}`
}

/** 取 URL 的 host（拿不到就空串），用于判断是不是飞书域名 */
function hostOf (url: string): string {
  const hit = /^https?:\/\/([^/?#]+)/i.exec(url)
  return hit ? hit[1].toLowerCase() : ''
}

/**
 * 一个头像的**候选地址**（按优先级）。
 *
 *   · 同源相对路径 → `[它自己]`
 *   · 飞书域名 → `[代理地址, 原地址]`（代理优先，代理挂了还能退回签名地址）
 *   · 其它绝对地址 → `[原地址]`
 *   · 纯路径 → 先补全成飞书域名，再按上一条处理
 *
 * 空值返回空数组（调用方直接退回首字，不要再造一个 "undefined" 地址）。
 */
export function avatarSources (raw?: string | null): string[] {
  const url = String(raw ?? '').trim()
  if (!url) {
    return []
  }
  const absolute = resolveAvatar(url)
  if (absolute.startsWith('/')) {
    return [absolute]
  }
  if (!FEISHU_AVATAR_HOST.test(hostOf(absolute))) {
    return [absolute]
  }
  return [avatarProxyUrl(absolute), absolute]
}

/** 首选地址（不需要逐次降级的场景用它，例如选人列表里的缩略图） */
export function avatarSrcOf (raw?: string | null): string {
  return avatarSources(raw)[0] ?? ''
}

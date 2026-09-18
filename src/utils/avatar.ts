/**
 * 飞书头像 URL 兜底解析。
 *
 * 飞书头像完整 URL 形如：
 *   https://p3-feishu-sign.feishucdn.com/obj/v3_xxx.webp?v=xxx&secret=xxx&signed_token=xxx&ts=xxx
 *
 * 数据库里可能只存了 /obj/ 之后的路径（如 v3_xxx.webp，缺域名+签名），
 * 这种值无法直接访问，此函数做最大努力还原：
 *   - 已含 http(s):// 的完整 URL → 原样返回
 *   - 纯路径 → 拼上飞书 CDN 域名（注意：无签名通常 403，仅作为兜底）
 * 要彻底修复，需在登录时保存飞书返回的完整 URL（含签名）。
 */
const FEISHU_CDN_BASE = 'https://p3-feishu-sign.feishucdn.com/obj/'

export function resolveAvatar(raw?: string | null): string {
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    const path = raw.replace(/^\/+(?:obj\/)?/, '')
    return `${FEISHU_CDN_BASE}${path}`
}

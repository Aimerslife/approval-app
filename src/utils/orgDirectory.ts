import type { OrgTreeNode } from '@/api/api'
import { resolveAvatar } from '@/utils/avatar'

/**
 * **通讯录索引**（纯逻辑）：把组织架构缓存那棵树拍成"按人找"的几张表。
 *
 * 两个消费方，口径必须一致，所以只写一份：
 *   · 展示层查头像 —— `stores/avatarDirectory`（快照里不存头像，按 open_id / email 现查）；
 *   · 建单期给老成员**补 open_id** —— 老模板画布里的成员是"只有邮箱/姓名"的（那时还没有 open_id），
 *     而发飞书通知、查头像都优先用 open_id，缺了它就只能退回邮箱（没邮箱的人就收不到、也没头像）。
 *
 * 与 `@/api/api` 只发生**类型**上的关系（`import type`），运行时不拉 PocketBase 客户端 ——
 * 所以它能被 tsx 直接跑断言（与 utils/approvalRoles、utils/notifyText 同一个理由）。
 */
export interface OrgDirectoryEntry {
  /** 飞书 open_id（组织架构缓存里每个人都有） */
  open_id: string
  name: string
  /** 头像地址（已过 resolveAvatar 兜底；没有就是空串） */
  avatar: string
  /** email / mobile（小写、去空白）：给"只有邮箱没有 open_id"的老成员反查用 */
  contacts: string[]
}

export interface OrgDirectory {
  byOpenId: Map<string, OrgDirectoryEntry>
  /** email / mobile → 人 */
  byContact: Map<string, OrgDirectoryEntry>
  /** 姓名 → 人（**只收全公司唯一的姓名**，见 buildOrgDirectory 的说明） */
  byName: Map<string, OrgDirectoryEntry>
  /** 扁平清单（按树序） */
  all: OrgDirectoryEntry[]
}

export function buildOrgDirectory (tree?: OrgTreeNode[] | null): OrgDirectory {
  const all: OrgDirectoryEntry[] = []
  const byOpenId = new Map<string, OrgDirectoryEntry>()
  const byContact = new Map<string, OrgDirectoryEntry>()
  const nameHits = new Map<string, OrgDirectoryEntry[]>()
  const walk = (nodes?: OrgTreeNode[] | null) => {
    for (const n of nodes ?? []) {
      for (const u of n.users ?? []) {
        const entry: OrgDirectoryEntry = {
          open_id: String(u.open_id ?? '').trim(),
          name: String(u.name ?? '').trim(),
          avatar: resolveAvatar(u.avatar),
          contacts: [u.email, u.mobile]
            .map(v => String(v ?? '').trim().toLowerCase())
            .filter(Boolean),
        }
        all.push(entry)
        if (entry.open_id && !byOpenId.has(entry.open_id)) {
          byOpenId.set(entry.open_id, entry)
        }
        for (const c of entry.contacts) {
          if (!byContact.has(c)) {
            byContact.set(c, entry)
          }
        }
        if (entry.name) {
          nameHits.set(entry.name, [...(nameHits.get(entry.name) ?? []), entry])
        }
      }
      walk(n.children)
    }
  }
  walk(tree)

  /*
   * 按姓名反查**只在全公司唯一时**才建 —— 重名的人（同一个名字两个员工）宁可查不到，
   * 也不能把通知发给另一个人：那是"审批消息发错人"，比收不到严重得多。
   */
  const byName = new Map<string, OrgDirectoryEntry>()
  for (const [name, hits] of nameHits) {
    if (hits.length === 1) {
      byName.set(name, hits[0])
    }
  }
  return { byOpenId, byContact, byName, all }
}

/**
 * 给一个成员找它的 open_id：**自带的优先**，其次按 email / mobile，最后按姓名（唯一时才认）。
 *
 * 返回空串 = 通讯录里认不出这个人，调用方保持原样（发消息时再退回邮箱）。
 */
export function memberOpenId (
  dir: OrgDirectory,
  member: { open_id?: string, email?: string, name?: string },
): string {
  const own = String(member.open_id ?? '').trim()
  if (own) {
    return own
  }
  const contact = String(member.email ?? '').trim().toLowerCase()
  if (contact) {
    const hit = dir.byContact.get(contact)
    if (hit?.open_id) {
      return hit.open_id
    }
  }
  const name = String(member.name ?? '').trim()
  return (name ? dir.byName.get(name)?.open_id : '') ?? ''
}

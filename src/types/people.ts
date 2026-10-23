/**
 * 人员配置（团队 → 默认审批人）的**数据结构与校验**。
 *
 * 数据只有一份：仓库根目录的 `data/people.json`。
 *   · 前端启动时从 app server（GET /api/people）读一次，覆盖 `utils/organazation` 里那份导入的初始值；
 *   · 「角色设置 → 人员配置 → 新增团队」写它（POST /api/people，服务端落文件）。
 *
 * 为什么校验放在这里、而不是只写在前端或只写在服务端：
 *   两边都要拦（前端为了即时提示，服务端为了不把脏数据写进文件），
 *   而"什么叫合法的一行"只能有一个口径 —— 分开写迟早一边严一边松。
 *
 * 本模块刻意**不依赖任何东西**（连 @/ 别名都不用），服务端能直接 `import` 它。
 */

/** 人员配置的一行（= data/people.json 的一个元素） */
export interface PersonRow {
  /** 所属部门（团队表里的 `parent`） */
  parent: string
  /**
   * 该部门的负责人（部门级，同部门的多行写同一个值；取用时按"首条非空"，
   * 见 utils/organazation 的 parentManagerOf）。
   * 新增团队时因为不知道部门有没有负责人，允许留空 —— 留空不会覆盖已有的部门负责人。
   */
  parentManager: string
  /** 团队名（唯一键：去空白后不许重复） */
  group: string
  /** 该团队的默认审批人 */
  manager: string
  /** 审批人邮箱（可选：从通讯录选人时顺手记下来，表格里能直接看到） */
  managerEmail?: string
  /** 审批人头像（可选，口径同上） */
  managerAvatar?: string
}

/** 这份 JSON 在仓库里的位置（提示文案里要告诉用户去哪儿看/改，只写一处） */
export const PEOPLE_JSON_PATH = 'data/people.json'

/**
 * 团队名的比较键：**去掉所有空白 + 忽略大小写**。
 *
 * 与 utils/organazation / utils/approvalRoles 的 squash 口径一致：
 * 白板与数据里常有多余空格（「美1组 」「美 1 组」），这些在业务上是同一个团队。
 */
export function personKey (group: unknown): string {
  return String(group ?? '').replace(/\s+/g, '').toLowerCase()
}

/** 任意来源（JSON 文件 / 接口返回 / 历史脏数据）→ 规范的一行；认不出必需的三个字段就返回 null */
export function normalizePersonRow (raw: unknown): PersonRow | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const r = raw as Record<string, unknown>
  const parent = String(r.parent ?? '').trim()
  const group = String(r.group ?? '').trim()
  const manager = String(r.manager ?? '').trim()
  if (!parent || !group || !manager) {
    return null
  }
  const row: PersonRow = {
    parent,
    parentManager: String(r.parentManager ?? '').trim(),
    group,
    manager,
  }
  const email = String(r.managerEmail ?? '').trim()
  const avatar = String(r.managerAvatar ?? '').trim()
  if (email) {
    row.managerEmail = email
  }
  if (avatar) {
    row.managerAvatar = avatar
  }
  return row
}

/** 整份清单规范化：丢掉认不出的行、按团队名去重（先出现的赢） */
export function normalizePeople (raw: unknown): PersonRow[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const out: PersonRow[] = []
  for (const item of list) {
    const row = normalizePersonRow(item)
    if (!row) {
      continue
    }
    const key = personKey(row.group)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * 新增一行时的校验。返回**给人看的问题描述**，没问题返回 null。
 *
 * @param draft  待新增的草稿（字段都可空，逐个报）
 * @param others 已有的行（判重用；比较键见 personKey）
 */
export function findPersonProblem (
  draft: { parent?: unknown, group?: unknown, manager?: unknown },
  others: readonly { group: string }[],
): string | null {
  const parent = String(draft.parent ?? '').trim()
  const group = String(draft.group ?? '').trim()
  const manager = String(draft.manager ?? '').trim()
  if (!parent) {
    return '请填写上级部门'
  }
  if (!group) {
    return '请填写团队名'
  }
  if (!manager) {
    return '请选择默认审批人'
  }
  const key = personKey(group)
  if (others.some(o => personKey(o.group) === key)) {
    return `团队「${group}」已经在人员配置里了`
  }
  return null
}

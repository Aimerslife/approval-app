import { groupManage } from '@/utils/organazation'

/**
 * 组别 → 默认审批人。
 *
 * 两个来源合并成一张表：
 *   1. **默认值**：`utils/organazation.ts` 里人工维护的 `groupManage`（改它即刻生效）；
 *   2. **覆盖值**：在「角色设置」里通过通讯录换过的人（PocketBase `group_approvers` 表）。
 *
 * 合并口径一句话：覆盖值按 `group` 匹配就顶掉默认值并标成 `custom`，
 * 其余保持 `default` —— 「恢复默认」就是删掉那条覆盖记录。
 *
 * 本模块刻意保持**纯**（不碰 PocketBase），所以能被 tsx 直接断言；
 * 读写那张表在 `utils/collection.ts`（`getGroupApproverOverrides` 等）。
 */

/** 文件里默认值的形状（即 `groupManage` 的元素） */
export interface GroupManagerDefault {
  parent: string
  group: string
  manager: string
}

/** 覆盖记录：`group_approvers` 的一行 */
export interface GroupApproverOverride {
  group: string
  parent?: string
  manager: string
  manager_email?: string
  manager_avatar?: string
  manager_department?: string
  manager_department_path?: string
}

/** 界面上一行 */
export interface GroupApproverRow {
  parent: string
  group: string
  manager: string
  email: string
  avatar: string
  department: string
  departmentPath: string
  /** default = 用文件里的默认；custom = 在角色设置里换过人 */
  source: 'default' | 'custom'
}

/** 默认值 → 行（文件里只有"组别 + 是谁"，联系方式一类留空） */
export function defaultGroupApproverRows (
  defaults: readonly GroupManagerDefault[] = groupManage,
): GroupApproverRow[] {
  return defaults.map(d => ({
    parent: d.parent,
    group: d.group,
    manager: d.manager,
    email: '',
    avatar: '',
    department: '',
    departmentPath: '',
    source: 'default' as const,
  }))
}

/**
 * 合并默认值与覆盖值。
 *
 * 三条口径：
 *   · 顺序以**默认值**为准 —— 那是人工排的，组别顺序本身有含义（按部门归类）；
 *   · 覆盖值里若出现默认值里没有的组别，**追加到末尾**：新组别往往是先在角色设置里配上、
 *     之后再补进 organazation.ts，不能让它在表里凭空消失；
 *   · 覆盖值同时补上默认值没有的联系方式（邮箱/头像/部门），有则覆盖。
 */
export function mergeGroupApprovers (
  defaults: GroupApproverRow[],
  overrides: readonly GroupApproverOverride[],
): GroupApproverRow[] {
  const rest = new Map(overrides.map(o => [o.group, o]))

  const merged = defaults.map(row => {
    const hit = rest.get(row.group)
    if (!hit) {
      return row
    }
    rest.delete(row.group) // 已消费，剩下的就是"默认值里没有的组别"
    return {
      ...row,
      manager: hit.manager || row.manager,
      email: hit.manager_email ?? '',
      avatar: hit.manager_avatar ?? '',
      department: hit.manager_department ?? '',
      departmentPath: hit.manager_department_path ?? '',
      source: 'custom' as const,
    }
  })

  for (const o of rest.values()) {
    merged.push({
      parent: o.parent ?? '',
      group: o.group,
      manager: o.manager,
      email: o.manager_email ?? '',
      avatar: o.manager_avatar ?? '',
      department: o.manager_department ?? '',
      departmentPath: o.manager_department_path ?? '',
      source: 'custom' as const,
    })
  }

  return merged
}

/** 有几个组别被换过人（工具栏上显示用） */
export function countCustom (rows: readonly GroupApproverRow[]): number {
  return rows.filter(r => r.source === 'custom').length
}

/* ==================== 团队 → 组别 ==================== */

/**
 * 去掉所有空白再比：白板与数据里常有多余空格
 * （口径同 utils/approvalRoles.ts 的 squash，两处判断的是同一批名字）
 */
function squashName (s: string): string {
  return s.replace(/\s+/g, '')
}

/**
 * 组别 → 所属团队（`groupManage` 的 `parent`）；匹配不到返回 null。
 *
 * 团队**不是数据列**：`bi_rows` 里只有「组别」「部门」，团队与组别的归属只维护在
 * utils/organazation.ts 这张表里。所以"同团队有哪些组别"这种判断只能回这里查，
 * 写不进 PocketBase 的 filter —— utils/rotationData.ts 的 `sameTeam` 用的就是它。
 */
export function teamOfGroup (group: string): string | null {
  const want = squashName(String(group ?? ''))
  if (!want) {
    return null
  }
  const hit = groupManage.find(g => squashName(String(g.group)) === want)
  return hit ? String(hit.parent) : null
}

/**
 * 与给定组别**同团队**的全部组别（含它自己，顺序沿用文件里的书写顺序）。
 *
 * 找不到这个组别、或它没有 `parent` → 返回**空数组**：那是维护漏项，
 * 调用方应据此报错，不要静默当成"没有同团队的组"（会让这一环悄悄没人办）。
 */
export function sameTeamGroups (group: string): string[] {
  const team = teamOfGroup(group)
  if (!team) {
    return []
  }
  const want = squashName(team)
  return groupManage
    .filter(g => squashName(String(g.parent)) === want)
    .map(g => String(g.group))
}

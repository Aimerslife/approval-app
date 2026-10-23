import { deptOfTeam, groupManage, parentManagerOf } from '@/utils/organazation'

/**
 * 团队（原「组别」）→ 默认审批人。
 *
 * 界面上这一层统一叫「团队」，与模板里的人员选择口径一致；
 * 变量名与 PB 字段仍沿用 `group`（表结构不动，见 utils/collection）。
 *
 * 两个来源合并成一张表：
 *   1. **默认值**：`data/people.json`（经 utils/organazation 的 `groupManage` 进来）；
 *      页面上的「新增团队」写的就是这份 JSON，改它即刻生效；
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
  /** 从通讯录选人时记下的联系方式（可缺：手工写进 JSON 的行往往只有名字） */
  managerEmail?: string
  managerAvatar?: string
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
    // 新增团队时从通讯录选的人会带着邮箱/头像，JSON 里也存了 —— 这里直接用，表格才有得显示
    email: d.managerEmail ?? '',
    avatar: d.managerAvatar ?? '',
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

/** 有几个团队被换过人（工具栏上显示用） */
export function countCustom (rows: readonly GroupApproverRow[]): number {
  return rows.filter(r => r.source === 'custom').length
}

/* ==================== 部门 → 部门审批人（parentManager） ==================== */

/**
 * 部门审批人的**覆盖值**：只存"在角色设置里通过通讯录换过的人"（PocketBase `dept_approvers` 表）。
 *
 * 与团队那一套的区别：一行一个**部门**（`parent`），同一部门下的团队共用这一个审批人；
 * 默认值仍取 `groupManage` 的 `parentManager`（口径同 organazation.parentManagerOf）。
 */
export interface DeptApproverOverride {
  dept: string
  manager: string
  manager_email?: string
  manager_avatar?: string
  manager_department?: string
  manager_department_path?: string
}

/** 部门审批人：界面上一行（部门级） */
export interface DeptApproverRow {
  dept: string
  manager: string
  email: string
  avatar: string
  department: string
  departmentPath: string
  /** default = 用文件里的默认；custom = 在角色设置里换过人 */
  source: 'default' | 'custom'
}

/**
 * 默认值 → 行：部门清单来自 `groupManage` 的 `parent`（去重，沿用表里的书写顺序），
 * 负责人取部门级的 `parentManager`（首条非空，见 organazation.parentManagerOf）。
 *
 * 部门没维护负责人 → 空串，界面显示「—」，不要拿某个团队的负责人顶上。
 */
export function defaultDeptApproverRows (
  defaults: readonly GroupManagerDefault[] = groupManage,
): DeptApproverRow[] {
  const out = new Map<string, DeptApproverRow>()
  for (const d of defaults) {
    const dept = String(d.parent ?? '').trim()
    if (!dept) {
      continue
    }
    const key = dept.replace(/\s+/g, '')
    if (out.has(key)) {
      continue
    }
    out.set(key, {
      dept,
      manager: '',
      email: '',
      avatar: '',
      department: '',
      departmentPath: '',
      source: 'default',
    })
  }

  // 部门负责人取表里维护的 parentManager（首条非空）
  for (const row of out.values()) {
    row.manager = parentManagerOf(row.dept) ?? ''
  }
  return [...out.values()]
}

/**
 * 合并部门审批人的默认值与覆盖值。
 *
 * 口径与 `mergeGroupApprovers` 完全一致（顺序以默认值为准、多出来的部门追加到末尾、
 * 覆盖值顺带补联系方式），只是匹配键从 `group` 换成 `dept`。
 */
export function mergeDeptApprovers (
  defaults: DeptApproverRow[],
  overrides: readonly DeptApproverOverride[],
): DeptApproverRow[] {
  const rest = new Map(overrides.map(o => [o.dept, o]))

  const merged = defaults.map(row => {
    const hit = rest.get(row.dept)
    if (!hit) {
      return row
    }
    rest.delete(row.dept)
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
      dept: o.dept,
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

/**
 * 角色设置那张表的一行：团队行 + 它所属部门的审批人。
 *
 * 为什么要贴在团队行上：界面是一行一个团队，「部门审批人」作为一列展示；
 * 同部门的多个团队会显示同一个人（部门级维护，改一处全部门生效）。
 */
export interface ApproverDisplayRow extends GroupApproverRow {
  deptManager: string
  deptManagerEmail: string
  deptManagerAvatar: string
  deptManagerDepartment: string
  deptManagerDepartmentPath: string
  /** 部门审批人的来源（与团队自己的 `source` 分开，两个都能各自被改过） */
  deptSource: 'default' | 'custom'
}

/** 把部门审批人按 `parent` 贴到团队行上（部门在清单里找不到时留空） */
export function attachDeptApprovers (
  rows: GroupApproverRow[],
  depts: readonly DeptApproverRow[],
): ApproverDisplayRow[] {
  const byDept = new Map(depts.map(d => [squashName(d.dept), d]))
  return rows.map(row => {
    const hit = byDept.get(squashName(row.parent))
    return {
      ...row,
      deptManager: hit?.manager ?? '',
      deptManagerEmail: hit?.email ?? '',
      deptManagerAvatar: hit?.avatar ?? '',
      deptManagerDepartment: hit?.department ?? '',
      deptManagerDepartmentPath: hit?.departmentPath ?? '',
      deptSource: hit?.source ?? 'default',
    }
  })
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
 * 与给定**团队**同属一个**部门**的全部团队（含它自己，顺序沿用文件里的书写顺序）。
 *
 * 口径：团队 = `groupManage.group`，部门 = `groupManage.parent`。
 * 部门**不是数据列**：`bi_rows` 里只有「团队」「部门」这些列名，团队与部门的归属
 * 只维护在 utils/organazation.ts 这张表里。所以"同部门有哪些团队"只能回这里查，
 * 写不进 PocketBase 的 filter —— utils/rotationData.ts 的 `sameTeam` 用的就是它。
 *
 * 找不到这个团队、或它没有 `parent` → 返回**空数组**：那是维护漏项，
 * 调用方应据此报错，不要静默当成"没有同部门的团队"（会让这一环悄悄没人办）。
 */
export function sameTeamGroups (group: string): string[] {
  const dept = deptOfTeam(group)
  if (!dept) {
    return []
  }
  const want = squashName(dept)
  return groupManage
    .filter(g => squashName(String(g.parent)) === want)
    .map(g => String(g.group))
}

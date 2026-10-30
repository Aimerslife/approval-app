import { normalizePeople, type PersonRow } from '@/types/people'
import peopleConfig from '../../data/people.json'

/*
 * ===== 团队表（团队 → 部门 / 团队负责人 / 部门负责人）=====
 *
 * **数据只有一份**：仓库根目录的 `data/people.json`（结构见 types/people 的 PersonRow）。
 *
 *   · 下面 import 进来的是**打包时的快照**：服务没起 / 首屏渲染时先用它，页面不会空着；
 *   · 启动后 main.ts 会向 app server 拉同一份文件（GET /api/people），用 applyPeopleConfig 覆盖
 *     —— 这样"别人新增的团队"刷新页面也能看到（打包快照是死的，不会自己变）；
 *   · 「角色设置 → 人员配置 → 新增团队」写的就是那份文件（POST /api/people 落盘）。
 *
 * 也可以直接手工编辑 data/people.json：开发期 Vite 会热更新，改完即生效。
 * 新增条目只要保证 parent / group / manager 三项齐全，其余可省（见 normalizePersonRow）。
 */
export const groupManage: TeamGroupRow[] = normalizePeople(peopleConfig as unknown as PersonRow[])

/**
 * 用服务端那份 JSON 覆盖内存里的团队表 —— **原地替换**。
 *
 * ⚠️ 必须 `splice` 而不是 `groupManage = rows`：
 *    别的模块都是 `import { groupManage }` 拿到的**同一个数组引用**，
 *    换引用它们看到的还是旧数组 —— 表现就是"新增的人在人员配置里可见，
 *    但流程/选团队的地方找不到"（本仓库在别处也踩过同一类坑）。
 */
export function applyPeopleConfig (rows: readonly PersonRow[]): void {
  groupManage.splice(0, groupManage.length, ...normalizePeople(rows))
}

/**
 * 团队表的一行：**部门（parent）→ 团队（group）**，`manager` 是该团队负责人。
 *
 * 口径（整个项目统一）：团队 = `group`（多站点组 / 美1组…），部门 = `parent`（B2C / 市场部…）。
 * 组织架构里建的是"部门"，所以按部门找负责人时要先做 团队 → 部门 的映射（见 utils/approvalRoles）。
 */
export interface TeamGroupRow {
  /** 所属部门（如 B2C / 市场部） */
  parent: string
  /** 团队名（如 多站点组 / 美1组） */
  group: string
  /** 该团队负责人 */
  manager: string
  /**
   * 该团队所属**部门**的负责人（部门级，来源于表里的 `parentManager` 列）。
   *
   * ⚠️ 这一列在每一行上都写了一遍（同一部门的多行应当一致），实际维护时可能不一致或留空 ——
   * 取用时以 `parentManagerOf()` 为准：**该部门第一条非空值**（按表的书写顺序），
   * 避免"同一部门在不同行上得到不同负责人"。
   */
  parentManager?: string
  /** 默认审批人的邮箱（从通讯录选人时记下来的，可缺；表格里直接展示） */
  managerEmail?: string
  /** 默认审批人的头像（可缺，口径同上） */
  managerAvatar?: string
}

/**
 * 团队表**按部门分组**：`name` = 部门（`parent`），`groups` = 该部门下的团队。
 *
 * 为什么由这个模块出（而不是写在组件里）：候选口径就是这张表 ——
 * 组件里再抄一份，改了表却漏改组件，表现是"表里新加的团队在办理时选不到"。
 * 纯函数，能被 tsx 直接断言（见 utils/approvalRotation 等同类做法）。
 *
 * @param keyword 搜索词：匹配**团队名**或**负责人**（大小写不敏感，去空格比较）
 */
export function teamGroups (keyword = ''): Array<{ name: string, groups: TeamGroupRow[] }> {
  const kw = keyword.trim().toLowerCase()
  const hit = (r: TeamGroupRow) =>
    !kw || r.group.toLowerCase().includes(kw) || r.manager.toLowerCase().includes(kw)

  const byParent = new Map<string, TeamGroupRow[]>()
  for (const r of groupManage as TeamGroupRow[]) {
    if (!hit(r)) {
      continue
    }
    const list = byParent.get(r.parent) ?? []
    list.push(r)
    byParent.set(r.parent, list)
  }
  return [...byParent].map(([name, groups]) => ({ name, groups }))
}

/**
 * 团队表里一共有多少个团队（提示文案用，如「共 11 个团队」）。
 *
 * ⚠️ 写成**函数**而不是 `export const TEAM_GROUP_COUNT = groupManage.length`：
 *    团队表在启动后会被服务端那份 JSON 覆盖（见 applyPeopleConfig），
 *    常量在 import 那一刻就定死了 —— 新增团队后文案会一直停在旧数字上。
 */
export function teamGroupCount (): number {
  return groupManage.length
}

/**
 * 某个**团队**属于哪个**部门**（团队表里反查 `parent`）。
 *
 * 用途一：「接收团队」的候选要**限定在本部门内**（不涉及其他部门）——
 * 单据快照里有「团队」（如 美2组），据此反查出部门（B2C），再列出该部门下的团队。
 * 用途二：模板的动态审批人（部门负责人）要把数据行里的团队名映射成部门名
 * （见 utils/approvalRoles 的 dept）。
 *
 * 名字比较去掉空白：数据与表里常有多余空格（口径同 utils/approvalRotation 的 squash）。
 */
export function deptOfTeam (team: string): string | undefined {
  const key = String(team ?? '').replace(/\s+/g, '')
  if (!key) {
    return undefined
  }
  const hit = (groupManage as TeamGroupRow[]).find(r => r.group.replace(/\s+/g, '') === key)
  return hit?.parent
}

/**
 * 某个**部门**下的全部团队（团队表里按 `parent` 取）。
 *
 * 与 teamGroups 的分工：那个给"全部部门、按部门分组"的列表（没识别出部门时的兜底）；
 * 这个给"只要某个部门的团队"（识别出来了就只列这些，不夹带别的部门）。
 */
export function groupsOfTeam (team: string): TeamGroupRow[] {
  const key = String(team ?? '').replace(/\s+/g, '')
  if (!key) {
    return []
  }
  return (groupManage as TeamGroupRow[]).filter(r => r.parent.replace(/\s+/g, '') === key)
}

/**
 * 「选择接收团队」的**平铺候选清单**：办理页把全部团队一次性摊开、每队后面跟一个接收数量，
 * 不再是"点开面板挑一个"（一批货分给几个团队时，那样要反复点开、还会漏掉本来该给的团队）。
 *
 *   · 给了部门（单据数据行里的团队反查出来的 `parent`）→ 只列该部门下的团队；
 *   · 没给 / 该部门在表里一个团队都没有 → 退回**全部部门**的团队：
 *     宁可多列几个，也不要出现"一个人都选不了"的办理页。
 *
 * 顺序沿用团队表的书写顺序（同一个部门的人排在一起），界面按 `parent` 分组展示时不会跳来跳去。
 */
export function teamRowsForReceiver (dept?: string): TeamGroupRow[] {
  const key = String(dept ?? '').replace(/\s+/g, '')
  const all = groupManage as TeamGroupRow[]
  if (!key) {
    return [...all]
  }
  const hit = groupsOfTeam(key)
  return hit.length > 0 ? hit : [...all]
}

/* ==================== 团队负责人 / 部门负责人（动态审批人的取值口径） ==================== */

/**
 * 某个**团队**的负责人（表里的 `manager` 列）。
 *
 * 口径：模板里的动态审批人（`dept_leader`）**以这张表为准**——
 * 数据行里的「团队」列先在这里找团队，命中就用该行维护的人（如 多站点组 → 魏燕玲），
 * 不去组织架构里找部门的 is_leader（那张表的负责人可能和这里维护的不一样）。
 * 见 utils/approvalRoles 的 resolveOne。
 *
 * 名字比较去掉空白：数据与表里常有多余空格。表里没有 / 没维护 → undefined。
 */
export function teamManagerOf (team: string): string | undefined {
  const key = String(team ?? '').replace(/\s+/g, '')
  if (!key) {
    return undefined
  }
  const hit = (groupManage as TeamGroupRow[]).find(r => r.group.replace(/\s+/g, '') === key)
  const manager = String(hit?.manager ?? '').trim()
  return manager || undefined
}

/**
 * 某个**部门**的负责人（表里的 `parentManager` 列）。
 *
 * 口径：动态审批人拿到的值不是团队名、而是部门名时（如 `B2C销售部`），走这里取部门负责人
 * （如 张卓艳）。与 teamManagerOf 是同一套取值链的两个层级。
 *
 * 口径细节：取该部门**第一条非空**的 `parentManager`。为什么不是"逐行各取各的"——
 * 同部门的多行理论上写的是同一个人，但人工维护时会出现不一致（有的行写了、有的空着、
 * 甚至写了别人）。取首条非空既是确定的（跟表的书写顺序走），也避免了"同一部门在
 * 不同行上得到不同负责人"这种说不清的状态。
 *
 * 表里没填 → 返回 undefined（调用方应当据此提示"该部门还没维护负责人"，不要静默留空）。
 */
export function parentManagerOf (dept: string): string | undefined {
  const key = String(dept ?? '').replace(/\s+/g, '')
  if (!key) {
    return undefined
  }
  const hit = (groupManage as TeamGroupRow[]).find(
    r => r.parent.replace(/\s+/g, '') === key && String(r.parentManager ?? '').trim() !== '',
  )
  return hit ? String(hit.parentManager).trim() : undefined
}

export interface ParentTeamRow {
  /** 部门名（表里的 `parent`） */
  name: string
  /** 部门负责人（表里的 `parentManager`，没维护就是空串） */
  manager: string
  /** 该部门下的团队（沿用表里的书写顺序） */
  groups: TeamGroupRow[]
}

/**
 * **部门层**聚合：按 `parent` 去重列出部门 + 部门负责人，可选按关键字过滤。
 *
 * ⚠️ 这里是**部门**层（供「选择接收部门」用）：选团队请用 `teamGroups()`（团队 = `group`）。
 *
 * @param keyword 搜索词：匹配**部门名**、**部门负责人**，或该部门下任一**团队名**
 *                （按团队名也能找到所属部门，办理人常常只记得团队名）
 */
export function parentTeams (keyword = ''): ParentTeamRow[] {
  const kw = keyword.trim().toLowerCase()
  const out = new Map<string, ParentTeamRow>()

  for (const r of groupManage as TeamGroupRow[]) {
    const name = String(r.parent ?? '').trim()
    if (!name) {
      continue
    }
    const key = name.replace(/\s+/g, '')
    const row = out.get(key)
    if (row) {
      row.groups.push(r)
      continue
    }
    out.set(key, { name, manager: String(r.parentManager ?? '').trim(), groups: [r] })
  }

  // 负责人在同一团队里可能有的行空、有的行有值 → 统一按"首条非空"补上（口径同 parentManagerOf）
  for (const row of out.values()) {
    if (!row.manager) {
      row.manager = parentManagerOf(row.name) ?? ''
    }
  }

  const list = [...out.values()]
  if (!kw) {
    return list
  }
  return list.filter(row =>
    row.name.toLowerCase().includes(kw)
    || row.manager.toLowerCase().includes(kw)
    || row.groups.some(g => g.group.toLowerCase().includes(kw)),
  )
}

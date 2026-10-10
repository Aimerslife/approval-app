export const groupManage=[
    {   
        parent:"TK",
        parentManager:'戴丽淑',
        group:"TK",
        manager:"戴丽淑",
    },
    {   
        parent:"市场部",
        parentManager:'林泽昆',
        group:"拓业部",
        manager:"彭诗懿",
    },
    {   
        parent:"市场部",
        parentManager:'林泽昆',
        group:"市场部1组",
        manager:"林思诺",
    },
    {   
        parent:"市场部",
        parentManager:'张卓艳',
        group:"市场部2组",
        manager:"林思诺",
    },
    {   
        parent:"B2C",
        parentManager:'',
        group:"美2组",
        manager:"周开胜",
    },
    {   
        parent:"B2C",
        parentManager:'张卓艳',
        group:"美1组",
        manager:"范少玲",
    },
    {   
        parent:"B2C",
        parentManager:'张卓艳',
        group:"美3组",
        manager:"李凯杰",
    },
    {   
        parent:"B2C",
        parentManager:'张卓艳',
        group:"夜灯-其他",
        manager:"陈颖",
    },
    {   
        parent:"B2C",
        parentManager:'张卓艳',
        group:"亚马逊-未维护",
        manager:"陈颖",
    },
     {   
        parent:"B2C",
        parentManager:'张卓艳',
        group:"多站点组",
        manager:"魏燕玲",
    },
     {   
        parent:"B2C",
        parentManager:'张卓艳',
        group:"欧洲组",
        manager:"黄伟强",
    }
]

/** 团队表的一行：团队（parent）→ 组（group），manager 是该组负责人 */
export interface TeamGroupRow {
  parent: string
  group: string
  /** 该组负责人（组长） */
  manager: string
  /**
   * 该组所属**团队**的负责人（团队级，来源于表里的 `parentManager` 列）。
   *
   * ⚠️ 这一列在每一行上都写了一遍（同一团队的多行应当一致），实际维护时可能不一致或留空 ——
   * 取用时以 `parentManagerOf()` 为准：**该团队第一条非空值**（按表的书写顺序），
   * 避免"同一团队在不同行上得到不同负责人"。
   */
  parentManager?: string
}

/**
 * 「接收团队」选择器的候选：把上面的团队表**按团队分组**，可选按关键字过滤。
 *
 * 为什么由这个模块出（而不是写在组件里）：候选口径就是这张表 ——
 * 组件里再抄一份，改了表却漏改组件，表现是"表里新加的组在办理时选不到"。
 * 纯函数，能被 tsx 直接断言（见 utils/approvalRotation 等同类做法）。
 *
 * @param keyword 搜索词：匹配**组名**或**负责人**（大小写不敏感，去空格比较）
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

/** 团队表里一共有多少个组（提示文案用，如「共 10 个组」） */
export const TEAM_GROUP_COUNT = groupManage.length

/**
 * 某个**组别**属于哪个团队（团队表里反查 `parent`）。
 *
 * 用途：「接收组别」的候选要**限定在本团队内**（不涉及其他团队）——
 * 单据快照里有「组别」（如 美2组），据此反查出团队（B2C），再列出该团队的组别。
 * 组名比较去掉空白：数据与表里常有多余空格（口径同 utils/approvalRotation 的 squash）。
 */
export function teamOfGroup (group: string): string | undefined {
  const key = String(group ?? '').replace(/\s+/g, '')
  if (!key) {
    return undefined
  }
  const hit = (groupManage as TeamGroupRow[]).find(r => r.group.replace(/\s+/g, '') === key)
  return hit?.parent
}

/**
 * 某个团队下的**组别**（团队表里按 `parent` 取）。
 *
 * 与 teamGroups 的分工：那个给"全部团队、按团队分组"的列表（没识别出团队时的兜底）；
 * 这个给"只要某个团队的组别"（识别出来了就只列这些，不夹带别的团队）。
 */
export function groupsOfTeam (team: string): TeamGroupRow[] {
  const key = String(team ?? '').replace(/\s+/g, '')
  if (!key) {
    return []
  }
  return (groupManage as TeamGroupRow[]).filter(r => r.parent.replace(/\s+/g, '') === key)
}

/* ==================== 团队负责人（parentManager） ==================== */

/**
 * 某个**团队**的负责人（表里的 `parentManager` 列）。
 *
 * 口径：取该团队**第一条非空**的 `parentManager`。为什么不是"逐行各取各的"——
 * 同团队的多行理论上写的是同一个人，但人工维护时会出现不一致（有的行写了、有的空着、
 * 甚至写了别人）。取首条非空既是确定的（跟表的书写顺序走），也避免了"同一团队在
 * 不同行上得到不同负责人"这种说不清的状态。
 *
 * 表里没填 → 返回 undefined（调用方应当据此提示"该团队还没维护负责人"，不要静默留空）。
 */
export function parentManagerOf (team: string): string | undefined {
  const key = String(team ?? '').replace(/\s+/g, '')
  if (!key) {
    return undefined
  }
  const hit = (groupManage as TeamGroupRow[]).find(
    r => r.parent.replace(/\s+/g, '') === key && String(r.parentManager ?? '').trim() !== '',
  )
  return hit ? String(hit.parentManager).trim() : undefined
}

export interface ParentTeamRow {
  /** 团队名（表里的 `parent`） */
  name: string
  /** 团队负责人（表里的 `parentManager`，没维护就是空串） */
  manager: string
  /** 该团队下的组（沿用表里的书写顺序） */
  groups: TeamGroupRow[]
}

/**
 * 「选择接收团队」的候选：**按团队**列出去重后的团队 + 各自的负责人，可选按关键字过滤。
 *
 * 与 `teamGroups()` 的分工：那个是"按团队分组列**组别**"（选接收组别用）；
 * 这个是"列**团队**本身"（选接收团队用）—— 选的是哪一层，候选就该是哪一层。
 *
 * @param keyword 搜索词：匹配**团队名**、**团队负责人**，或该团队下任一**组名**
 *                （按组名也能找到所属团队，办理人常常只记得组名）
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

import type { OrgTreeData, OrgTreeNode, UserBrief } from '@/api/api'
import type {
  ApprovalBranch,
  ApprovalChainItem,
  ApprovalFlow,
  ApprovalFlowStep,
  ApprovalRole,
} from '@/types/approval'
import { roleLabel } from '@/types/approval'

/**
 * 动态审批人（角色）的解析：把模板里的「部门负责人」这类角色，按组织架构换成真人。
 *
 * 三个口径（都踩过）：
 *  1. **建单时解析、结果快照进单**：解析结果写进单据的 flow，之后重算只读快照 ——
 *     否则换了个组长，历史单的待办人、已办轨迹会跟着变，审批单就不再是可信凭证。
 *  2. **本部门没设负责人就往上级找**：白板上「该团队负责人」这类环节，
 *     小组常常没单独设负责人，卡在这里会让整单建不出来。
 *  3. **解析不出来 = 建单失败**（不是静默留空 ✗）：一个没人办的环节，
 *     单据会永远停在那儿，当场报出来比事后追查好。
 */

interface DeptHit {
  node: OrgTreeNode
  /** 部门完整路径，如「XX公司 / 技术部 / 前端组」 */
  path: string
  parent?: DeptHit
}

/** 把部门树拍成「部门名 → 命中」；重名时保留层级最深（最具体）的那个 */
function indexDepts (
  tree: OrgTreeNode[],
  parent?: DeptHit,
  path: string[] = [],
  out = new Map<string, DeptHit>(),
): Map<string, DeptHit> {
  for (const node of tree ?? []) {
    const selfPath = [...path, node.name]
    const cur: DeptHit = { node, path: selfPath.join(' / '), parent }
    const key = node.name.trim()
    const prev = out.get(key)
    if (!prev || selfPath.length >= prev.path.split(' / ').length) {
      out.set(key, cur)
    }
    indexDepts(node.children ?? [], cur, selfPath, out)
  }
  return out
}

function allUsers (tree: OrgTreeNode[]): UserBrief[] {
  const out: UserBrief[] = []
  const walk = (nodes: OrgTreeNode[]) => {
    for (const n of nodes ?? []) {
      out.push(...(n.users ?? []))
      walk(n.children ?? [])
    }
  }
  walk(tree)
  return out
}

function toMember (u: UserBrief, role: ApprovalRole, hit?: DeptHit): ApprovalChainItem {
  return {
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    is_leader: u.is_leader,
    is_tenant_manager: u.is_tenant_manager,
    type: 'manager',
    ...(hit ? { department: hit.node.name, department_path: hit.path } : {}),
    role,
  }
}

/** 这一环是哪个部门：固定部门优先，否则取数据行的字段值 */
function deptNameOf (role: ApprovalRole, ctx: Record<string, unknown>): string {
  if (role.dept?.trim()) {
    return role.dept.trim()
  }
  if (!role.deptFrom) {
    return ''
  }
  return String(ctx[role.deptFrom] ?? '').trim()
}

/** 解析一个角色 → 真人（可能多人：一个部门有多个负责人时会签同等） */
function resolveOne (
  role: ApprovalRole,
  org: OrgTreeData | null,
  ctx: Record<string, unknown>,
): { members: ApprovalChainItem[], reason?: string } {
  if (!org?.tree?.length) {
    return { members: [], reason: '组织架构缓存为空（去「组织架构」页点一次刷新）' }
  }

  if (role.kind === 'tenant_admin') {
    const admins = allUsers(org.tree).filter(u => u.is_tenant_manager)
    if (admins.length === 0) {
      return { members: [], reason: '组织里没有设置管理员' }
    }
    return { members: admins.map(u => toMember(u, role)) }
  }

  const want = deptNameOf(role, ctx)
  if (!want) {
    return {
      members: [],
      reason: role.deptFrom
        ? `数据行字段「${role.deptFrom}」是空的，认不出是哪个部门`
        : '没有指定部门',
    }
  }

  const byName = indexDepts(org.tree)
  // 名字对不上时再试一次"去掉空白后比对"：白板/组织架构里常有多余空格
  const squash = (s: string) => s.replace(/\s+/g, '')
  const hit = byName.get(want)
    ?? [...byName.entries()].find(([k]) => squash(k) === squash(want))?.[1]
  if (!hit) {
    return { members: [], reason: `组织架构里找不到部门「${want}」` }
  }

  // 本部门没设负责人就往上找（小组常常没单独设）
  let cur: DeptHit | undefined = hit
  while (cur) {
    const leaders = (cur.node.users ?? []).filter(u => u.is_leader)
    if (leaders.length > 0) {
      return { members: leaders.map(u => toMember(u, role, cur)) }
    }
    if (!cur.parent) {
      break
    }
    cur = cur.parent
  }
  return { members: [], reason: `部门「${want}」及其上级都没有设负责人` }
}

/** 流程里有没有动态审批人（没有的话就不必去拉组织架构） */
export function flowHasRoles (flow: ApprovalFlow): boolean {
  let found = false
  const walkSteps = (steps?: ApprovalFlowStep[]) => {
    for (const s of steps ?? []) {
      if (found) {
        return
      }
      if (s.type === 'branch') {
        for (const b of s.branches ?? []) {
          walkSteps(b.steps)
        }
      }
      // ⚠️ 步骤上存成员的字段是 `members`（ApprovalFlowStep），**不是** `nodes`
      //    （`nodes` 是顶层流程节点 ApprovalFlowApprovalNode 的字段）。
      //    写错过一次：嵌套分支里的动态负责人因此完全没被解析，而且测试也跟着写错、假通过。
      else if (s.members?.some(m => m.role)) {
        found = true
      }
    }
  }
  for (const node of flow) {
    if (found) {
      break
    }
    if (node.type === 'approval') {
      if (node.nodes.some(m => m.role)) {
        found = true
      }
      continue
    }
    // 提醒节点的「提醒对象」同样可能是动态负责人：
    // 不一起算进来的话，建单时不会去拉组织架构，这一环就解析不出人
    if (node.type === 'notify') {
      if (node.members?.some(m => m.role)) {
        found = true
      }
      continue
    }
    /*
     * 「组间轮询」卡片：内部的动态负责人同样要算进来。
     * 卡片内部的默认审批人就是 `loop_leader`（"本环的组负责人"），展开时才变成 `dept_leader`；
     * 不在这里认出来，建单时就**不会去拉组织架构缓存**，展开出来的那一环解析不出人。
     * （正常顺序是"先展开、再解析"，那时卡片已经不存在了；这里兜的是"拿未展开的 flow 判断"的场景。）
     */
    if (node.type === 'loop') {
      walkSteps(node.steps)
      continue
    }
    for (const b of node.branches) {
      if (b.members?.some(m => m.role)) {
        found = true; break
      }
      walkSteps(b.steps)
      if (found) {
        break
      }
    }
  }
  return found
}

export interface ResolveRolesResult {
  /** 新的 flow（不改原对象；带 role 的成员已换成真人，并保留 role 备查） */
  flow: ApprovalFlow
  /** 没解析出来的位置：建单时要报出来，不要静默留空 */
  unresolved: Array<{ where: string, reason: string }>
}

/**
 * 解析一整条流程里的动态审批人。
 *
 * @param ctx 业务上下文（`toFlowContext(row)` 的结果）—— `deptFrom` 就是从它取值的，
 *            注意**不能**直接传 PB 原始行（业务列在 `data` 里，摊平后才能按中文列名取到）
 */
export function resolveFlowRoles (
  flow: ApprovalFlow,
  org: OrgTreeData | null,
  ctx: Record<string, unknown>,
): ResolveRolesResult {
  const unresolved: Array<{ where: string, reason: string }> = []

  const membersOf = (members: ApprovalChainItem[] | undefined): ApprovalChainItem[] | undefined => {
    if (!members?.length) {
      return members
    }
    const out: ApprovalChainItem[] = []
    for (const m of members) {
      if (!m.role) {
        out.push({ ...m }); continue
      }
      const r = resolveOne(m.role, org, ctx)
      if (r.members.length === 0) {
        unresolved.push({ where: roleLabel(m.role), reason: r.reason ?? '未知原因' })
        // 保留一条占位，别让环节卡片空着（这一单会被判为建单失败，不会入库）
        out.push({ ...m, name: m.name || roleLabel(m.role) })
        continue
      }
      out.push(...r.members)
    }
    return out
  }

  const stepsOf = (steps: ApprovalFlowStep[] | undefined): ApprovalFlowStep[] | undefined => {
    if (!steps?.length) {
      return steps
    }
    return steps.map(s => {
      if (s.type === 'branch') {
        const branches: ApprovalBranch[] = (s.branches ?? []).map(b => ({
          ...b,
          ...(b.members ? { members: membersOf(b.members) } : {}),
          steps: stepsOf(b.steps) ?? [],
        }))
        return { ...s, branches }
      }
      // 同 flowHasRoles：步骤成员在 `members`；旧式线性子步骤 steps 也要递归
      return {
        ...s,
        ...(s.members ? { members: membersOf(s.members) } : {}),
        ...(s.steps ? { steps: stepsOf(s.steps) } : {}),
      }
    })
  }

  const outFlow: ApprovalFlow = flow.map(node => {
    if (node.type === 'approval') {
      return { ...node, nodes: membersOf(node.nodes) ?? [] }
    }
    // 提醒节点的提醒对象同样要解析（可能含动态负责人）；content 等字段由 ...node 原样带过
    if (node.type === 'notify') {
      return { ...node, members: membersOf(node.members) ?? [] }
    }
    /*
     * 「组间轮询」卡片：内部子流程同样解析（步骤与嵌套分支里的成员都要填真人）。
     * 正常路径下这一步不会遇到卡片 —— 建单期是"先展开、再解析"（展开后卡片已不存在）；
     * 这里兜的是"拿未展开的 flow 直接解析"的场景，照 reason 报错比留一堆空名字好。
     */
    if (node.type === 'loop') {
      return { ...node, steps: stepsOf(node.steps) ?? [] }
    }
    return {
      ...node,
      branches: node.branches.map(b => ({
        ...b,
        ...(b.members ? { members: membersOf(b.members) } : {}),
        steps: stepsOf(b.steps) ?? [],
      })),
    }
  })

  return { flow: outFlow, unresolved }
}

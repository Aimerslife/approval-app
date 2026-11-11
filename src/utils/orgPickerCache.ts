import type { OrgTreeNode, UserBrief } from '@/api/api'
import { fetchOrgTreeCache, getDepartmentUsers, proxyAvatar } from '@/api/api'

/**
 * 选人弹窗（抄送 / 转办）两份通讯录数据的**会话级缓存**。
 *
 * 为什么要有它：`getDepartmentUsers` 是实时飞书代理接口，弹窗每开一次就等它一程，
 * 看起来就是"点了抄送要等通讯录加载"；「全部部门」树也存在弹窗一关就重挂重拉的问题。
 * 现在两个入口改成同一套口径（和转办同一条数据链路）：
 *
 *   · **先弹窗，再加载** —— 弹窗打开是同步的，数据命中缓存直接渲染、未命中才转骨架屏；
 *   · **挂载即预热** —— 办理界面渲染好就后台拉一遍，等用户点按钮时名单多半已经就绪；
 *   · **in-flight 去重** —— 并发打开 / 预热撞车时只发一个请求；
 *   · **TTL + 静默刷新** —— 本部门成员 5 分钟过期，过期先展示旧数据、后台换新。
 */

/** 本部门成员快照（users 里的 avatar 已代理，可直接渲染） */
export interface DeptUsersSnapshot {
  at: number
  deptName: string
  users: UserBrief[]
}

const DEPT_TTL = 5 * 60 * 1000

let deptSnapshot: DeptUsersSnapshot | null = null
let deptInflight: Promise<DeptUsersSnapshot> | null = null

/** 当前缓存的快照（可能过期），没有就是 null */
export function deptUsersCache (): DeptUsersSnapshot | null {
  return deptSnapshot
}

/** 缓存是否仍在 TTL 内 */
export function deptUsersFresh (): boolean {
  return !!deptSnapshot && Date.now() - deptSnapshot.at < DEPT_TTL
}

/**
 * 拉一次本部门成员（带 in-flight 去重，成功后写缓存）。
 * 失败会清掉 in-flight 让下次重试，但不影响已有快照。
 */
export function fetchDeptUsersOnce (openId: string): Promise<DeptUsersSnapshot> {
  if (!deptInflight) {
    deptInflight = (async () => {
      const res = await getDepartmentUsers(openId)
      const snapshot: DeptUsersSnapshot = {
        at: Date.now(),
        deptName: res.data.department_name,
        users: res.data.users.map(u => ({
          ...u,
          avatar: u.avatar ? proxyAvatar(u.avatar) : undefined,
        })),
      }
      deptSnapshot = snapshot
      return snapshot
    })().finally(() => {
      deptInflight = null
    })
  }
  return deptInflight
}

// ---- 全部部门树 ----

let treeNodes: OrgTreeNode[] | null = null
let treeInflight: Promise<OrgTreeNode[]> | null = null

/** 当前缓存的组织树原始数据（没有就是 null） */
export function orgTreeCache (): OrgTreeNode[] | null {
  return treeNodes
}

/**
 * 拉一次组织树（PB 缓存接口，秒级；带 in-flight 去重）。
 * 供 DepartmentNode 渲染与选人弹窗预热共用。
 */
export function fetchOrgTreeOnce (): Promise<OrgTreeNode[]> {
  if (!treeInflight) {
    treeInflight = fetchOrgTreeCache()
      .then(res => {
        treeNodes = res.data.tree
        return treeNodes
      })
      .finally(() => {
        treeInflight = null
      })
  }
  return treeInflight
}

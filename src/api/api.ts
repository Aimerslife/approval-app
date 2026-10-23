import type { ApprovalOrder } from '@/types/approval'
import pb from '@/pocketbase.ts'
// 查询条件的纯逻辑（列名翻译 / 转义 / filter 拼装）在 @/utils/biQuery ——
// 那里不依赖 PocketBase 客户端，能被 tsx 直接跑单测
import { type BiRowQuery, buildBiFilter } from '@/utils/biQuery'
// 请求键：bi_rows 有多个读入口（分页列表 / 导出全量 / 轮询取数 / 探针），不给键会互相取消
import { PB_REQUEST_KEY } from '@/utils/pbRequestKeys'
/**
 * 字段对齐规则（别名表 / 枚举值归一化 / 字段名清洗）已下沉到 `@/utils/productFields`，
 * 因为**上传 Excel 的表头匹配要用完全同一套规则** —— 写两份迟早不一致。
 * 这里只负责「BI 的 fields + 二维 rows → 对象数组」这一步转换。
 */
import { resolveFieldKey, resolveFieldValue } from '@/utils/productFields'
// 头像地址规则（同源路径 / 飞书签名 URL / 纯路径）只写在 utils/avatar，这里取首选地址
import { avatarSrcOf } from '@/utils/avatar'

// ========== 通用工具 ==========

/**
 * 将飞书头像 URL 转为服务端代理 URL，确保浏览器能正确加载。
 *
 * 具体规则（同源路径原样返回、飞书域名走代理、非飞书域名不代理）统一在 utils/avatar 里，
 * 这里只做"取首选地址"这一步 —— 别再在别处手拼 `/api/feishu/avatar?url=`。
 */
export function proxyAvatar(rawUrl?: string): string | undefined {
  if (!rawUrl) {
    console.warn('[proxyAvatar] 原始头像 URL 为空')
    return undefined
  }
  return avatarSrcOf(rawUrl) || undefined
}

async function feishuGet<T = any>(path: string, label: string): Promise<T> {
  console.log(`[${label}] 请求:`, path)
  const res = await fetch(path, { method: 'GET' })
  const data = await res.json()
  console.log(`[${label}] 响应:`, data)
  if (!res.ok) {
    throw new Error(`${label} 失败: HTTP ${res.status}`)
  }
  if (data.code !== 0) {
    throw new Error(`${label} 失败: ${data.msg}`)
  }
  return data as T
}

// ========== 类型 ==========

export interface UserBrief {
  open_id: string
  name: string
  en_name?: string
  email?: string
  mobile?: string
  avatar?: string
  is_tenant_manager: boolean
  is_leader: boolean
}

export interface OrgTreeNode {
  id: string
  name: string
  member_count: number
  has_child: boolean
  children: OrgTreeNode[]
  users?: UserBrief[]
}

export interface OrgTreeData {
  tree: OrgTreeNode[]
  total_departments: number
  total_members: number
}

export interface OrgTreeResponse {
  code: number
  msg: string
  data: OrgTreeData
}

// ========== 密码重置 ==========

export async function resetPassword(email: string) {
  try {
    const res = await pb.collection('users').requestPasswordReset(email)
    console.log('重置邮件已发送，请查收')
    return res
  } catch (error) {
    console.error('发送失败', error)
  }
}

// ========== 部门 ==========

/** 获取指定部门详情 */
export async function getOrgInfo() {
  const deptId = encodeURIComponent(import.meta.env.VITE_FEISHU_DEPARTMENT_ID)
  return feishuGet(`/api/feishu/departments?department_ids=${deptId}`, 'getOrgInfo')
}

/** 获取子部门列表 */
export async function fetchChildDepartments(parentDeptId = '0') {
  const id = encodeURIComponent(parentDeptId)
  return feishuGet(`/api/feishu/departments/children?parent_department_id=${id}`, 'fetchChildDepartments')
}

/** 递归拉取所有部门 */
export async function fetchAllDepartments(parentDeptId = '0'): Promise<any[]> {
  return feishuGet(
    `/api/feishu/departments/children?parent_department_id=${encodeURIComponent(parentDeptId)}&fetch_child=true`,
    'fetchAllDepartments',
  )
}

// ========== 用户 ==========

/** 获取部门直属用户列表 */
export async function getUsersByDepartment(departmentId: string, pageToken?: string) {
  let url = `/api/feishu/users?department_id=${encodeURIComponent(departmentId)}`
  if (pageToken) {
    url += `&page_token=${encodeURIComponent(pageToken)}`
  }
  return feishuGet(url, 'getUsersByDepartment')
}

/** 获取当前用户所在部门及成员（抄送/转办选人用） */
export interface DepartmentUsersData {
  department_id: string
  department_name: string
  users: UserBrief[]
}

export async function getDepartmentUsers(openId: string): Promise<{ code: number, msg: string, data: DepartmentUsersData }> {
  return feishuGet(
    `/api/feishu/department-users?open_id=${encodeURIComponent(openId)}`,
    'getDepartmentUsers',
  )
}

/**
 * 用户的企业与部门信息（登录时落库到 users 集合）。
 * company_name 是服务端写死的常量（server/config.ts 的 companyName）——
 * 不从部门树推导，因为飞书顶层节点常常是「总经理」这类职位部门，推导出来的必然是职位名。
 */
export interface UserOrgData {
  department_id: string
  /** 最近一级部门名 */
  department_name: string
  /** 完整路径，形如「总公司 / 财务部 / 财务BP组」 */
  department_path: string
  /** 企业名（服务端写死的常量，不取自飞书组织架构） */
  company_name: string
}

export async function getUserOrg(openId: string): Promise<{ code: number, msg?: string, data: UserOrgData }> {
  return feishuGet(
    `/api/feishu/user-org?open_id=${encodeURIComponent(openId)}`,
    'getUserOrg',
  )
}

/** 获取单个用户详情 */
export async function getUserDetail(userId: string) {
  return feishuGet(`/api/feishu/users/${encodeURIComponent(userId)}`, 'getUserDetail')
}

// ========== 组织架构树 ==========

/**
 * 从 PocketBase 缓存读取组织架构树（首屏加载，秒级响应）。
 * 首次进入时可能无缓存，需调用 refreshOrgTree() 写入。
 */
export async function fetchOrgTreeCache(): Promise<OrgTreeResponse> {
  return feishuGet<OrgTreeResponse>('/api/org-tree/cache', 'fetchOrgTreeCache')
}

/**
 * 从飞书重新拉取组织架构树并更新 PocketBase 缓存。
 * 仅点击"刷新组织架构"按钮时调用。
 */
export async function refreshOrgTree(): Promise<OrgTreeResponse> {
  const res = await fetch('/api/org-tree/refresh', { method: 'POST' })
  const data = await res.json()
  console.log('[refreshOrgTree] 响应:', data)
  if (!res.ok) {
    throw new Error(`刷新失败: HTTP ${res.status}`)
  }
  if (data.code !== 0) {
    throw new Error(`刷新失败: ${data.msg}`)
  }
  return data as OrgTreeResponse
}

// ========== 发送飞书卡片消息 ==========

export interface SendCardParams {
  receive_id: string
  receive_id_type?: 'open_id' | 'email' | 'chat_id'
  msg_type?: 'interactive' | 'text' | 'post'
  content: string
}

/**
 * 通过飞书 API 发送卡片/消息
 * POST /api/feishu/send-card
 */
export async function sendFeishuCard(params: SendCardParams) {
  const res = await fetch('/api/feishu/send-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  console.log('[sendFeishuCard] 响应:', data)
  if (!res.ok) {
    throw new Error(`发送失败: HTTP ${res.status}`)
  }
  if (data.code !== 0) {
    throw new Error(`发送失败: ${data.msg}`)
  }
  return data
}

// 获取数跨境问题

const base = 'https://work.jiushuyun.com/decision'

/**
 * 取 BI 的访问 token。
 *
 * ⚠️ **必须走我们自己的服务端换**（`POST /api/bi/token`）：
 * 原来这里直接拿 `VITE_ACCESSKEYID / VITE_ACCESSKEYSECRET` 去换 —— 而 `VITE_` 变量会被
 * **打进浏览器产物**，部署到公网后任何人打开 DevTools 都能拿到**永久**密钥（accessKeySecret）。
 * 现在密钥只留在服务端（`BI_ACCESS_KEY_ID/SECRET`，见 server/config.ts），
 * 浏览器拿到的是一次性 token（过期即失效，也能在 BI 侧吊销）。
 *
 * 浏览器侧仍按小时缓存：token 由服务端签发，同一小时内的多次调用不必反复换。
 */
async function getToken(ifNew: boolean) {
  let token: string | null = localStorage.getItem('token')
  const tokenTime = localStorage.getItem('tokenTime')
  if (!ifNew && token && tokenTime && Date.now() - Number.parseInt(tokenTime) < 3600 * 1000) {
    return token
  }
  const tokenRes = await fetch('/api/bi/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }).then((res: Response) => res.json())
  if (!tokenRes?.data?.token) {
    throw new Error('获取 token 失败: ' + (tokenRes?.msg || `HTTP ${tokenRes?.code ?? ''}`))
  }
  token = tokenRes.data.token as string
  if (token) {
    localStorage.setItem('token', token)
    localStorage.setItem('tokenTime', Date.now().toString())
    return token
  }
}

/**
 * BI 组件数据接口的过滤参数。
 *
 * ⚠️ `name` 必须是**仪表板级参数名**（仪表板里的「参数」控件，如筛选器绑定的参数），
 * **不是字段名**。传字段名不会报错，接口会静默忽略，表现为"筛选没效果"。
 *
 * 有效名字只能从仪表板元信息接口取：
 *   GET /api/public/analysis/v1/dashboards/{dashboardId}/meta  →  data.parameters[].name
 *
 * 取值形态随参数类型而定：
 *   单值   { name: '文本参数', value: '华东' }
 *   多值   { name: '文本参数', value: ['华东', '华北'] }
 *   日期   { name: '日期参数', value: { year: 2024, month: 3, day: 15 } }
 */
export interface AnalysisParam {
  name: string
  value: unknown
}

/** BI 组件字段描述 */
export interface BiComponentField {
  id: string
  name: string
  dataType: string
  role: string
}

/** BI 组件数据接口的返回体（data 部分） */
export interface BiComponentData {
  componentId: string
  componentType: string
  fields: BiComponentField[]
  /** 二维数组：每一行是按 fields 顺序排列的值，不是对象 */
  rows: unknown[][]
  page: { pageIndex: number, pageSize: number, hasNext: boolean }
}

/** 接口 pageSize 上限 */
const BI_PAGE_SIZE = 500

/**
 * 把「fields + 二维 rows」的原始返回转成「对象数组」，并套用别名/枚举归一化。
 * 归一化的规则见 productFields.ts 的 resolveFieldKey / resolveFieldValue。
 */
function normalizeBiRows(data: BiComponentData, offset = 0): Record<string, unknown>[] {
  const fields = data.fields ?? []
  return (data.rows ?? []).map((row, idx) => {
    const item: Record<string, unknown> = { id: offset + idx + 1 }
    for (const [i, f] of fields.entries()) {
      const key = resolveFieldKey(f.name)
      item[key] = resolveFieldValue(f.name, row[i], key)
    }
    return item
  })
}

/**
 * 上传结果的形状（对应 server/biSync.ts 的 UploadSummary，这里只声明前端用得到的部分）。
 * 完整字段含义见那边 SyncSummary 的注释。
 */
export interface BiUploadSummary {
  /** 按唯一键去重后的行数 */
  unique: number
  /** 唯一键为空（SKU 为空）被跳过的行数 */
  missingKey: number
  /** 同 key 不同内容、按「先到者保留」被丢弃的行数 */
  conflictRows: number
  /** 有冲突的键（前端只展示前几个） */
  conflicts: { key: string, count: number }[]
  created: number
  updated: number
  unchanged: number
  /** 库里存在、但本次没覆盖到的行数（默认**不删**） */
  orphaned: number
  /** 实际删掉的行数（只在传了 prune 时 > 0） */
  pruned: number
  /** 在映射表里找不到、因此进不了真列的列名（数据仍在 data 快照里） */
  unmappedColumns: string[]
  /** 写入失败明细（唯一索引冲突 / HTTP 错误） */
  failures: string[]
  elapsedMs: number
}

/**
 * 把页面上解析好的行上传到 PocketBase 的 `bi_rows`。
 *
 * ⚠️ 走的是 **app server**（默认 3002，经 vite 的 `/api/bi` 代理），**不是**直连 PB：
 *   1) `bi_rows` 的 createRule / updateRule 都是 null（只有管理员可写），浏览器直写会 403；
 *   2) 唯一键去重（makeSyncKey = SKU|团队|仓位|是否属于待评估库存|店铺）、冲突检查、差异比对那套逻辑
 *      只在 server/biSync.ts 里有一份，前端再实现一遍必然分叉。
 *
 * 所以这里用 fetch 而不是 pb.send：`/api/bi` 前缀在 vite.config.mts 里被专门代理到
 * app server，而 PocketBase 的 SDK 只会往 PB 发。
 *
 * @param rows 原始行（**不要传格式化过的**：数字被换成带千分位的字符串后，
 *             PB 的 number 列会写不进去）
 */
export async function uploadBiRows(
  rows: Record<string, unknown>[],
  opts: { componentId?: string, dryRun?: boolean, prune?: boolean } = {},
): Promise<BiUploadSummary> {
  const qs = new URLSearchParams()
  if (opts.dryRun) {
    qs.set('dryRun', '1')
  }
  // prune：写完把「库里存在、本批没有」的行删掉 —— 也就是「替换」语义。
  // 服务端是**先写后删**（不是先删后写），所以中途失败时旧数据仍在，不会留下空表。
  if (opts.prune) {
    qs.set('prune', '1')
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  const res = await fetch(`/api/bi/upload${suffix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, componentId: opts.componentId }),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `上传失败：HTTP ${res.status}`)
  }
  return payload.data as BiUploadSummary
}

/* ==================== 清空 BI 数据（仅超级管理员） ==================== */

/**
 * 「清空 BI 数据」的返回体，形状与 server/purgeData.ts 的 PurgeSummary 一致。
 *
 * 只清 `bi_rows`（BI 同步进来的镜像，可随时再用「BI 同步」拉回来）；
 * 审批单 / 模板 / 账号刻意**不动** —— 那些删了就真没了。
 */
export interface PurgeSummary {
  dryRun: boolean
  /** 谁执行的：服务端拿调用者的 token 问过 PocketBase，不采信前端传来的任何字段 */
  by: { id: string, role: string, name?: string, email?: string }
  /** 每个目标集合：现有条数 / 实际删除条数（dryRun 时 deleted 恒为 0） */
  collections: Array<{ name: string, count: number, deleted: number }>
  /** 明确**不会**碰的集合（界面上要写出来，让人放心点确认） */
  kept: string[]
  /** 将删除 / 已删除的总条数 */
  totalCount: number
  totalDeleted: number
}

/**
 * 清空 BI 数据（`bi_rows`）。
 *
 * ⚠️ 走 **app server**（`/api/bi` 前缀由 vite 代理到它，与 uploadBiRows 同一条路），
 *    并把**调用者自己的 PB token** 放进 Authorization：服务端据此向 PocketBase 核实
 *    "这是谁、role 是不是 superAdmin"（前端说什么都不作数，见 server/purgeData.ts）。
 *    `dryRun = true` 只统计条数，用于在确认框里先显示"将要删除多少"。
 */
export async function purgeBiData (dryRun = false): Promise<PurgeSummary> {
  const res = await fetch(`/api/bi/purge${dryRun ? '?dryRun=1' : ''}`, {
    method: 'POST',
    headers: { Authorization: pb.authStore.token },
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `清空失败：HTTP ${res.status}`)
  }
  return payload.data as PurgeSummary
}

/* ==================== 快照同步（仅超级管理员） ==================== */

/**
 * 快照同步的返回体，形状与 server/snapshotSync.ts 的 SnapshotSyncSummary 一致。
 *
 * 语义：把 `bi_rows` 的**真实列**回填进 `data` 快照（表格单元格值读的就是 `data`），
 * **只写 `data` 一个字段** —— 列 / `sync_key` / 审批单都不动。
 */
export interface SnapshotSyncSummary {
  dryRun: boolean
  /** 谁执行的：服务端拿调用者 token 问过 PocketBase，不采信前端传来的任何字段 */
  by: { id: string, role: string, name?: string, email?: string }
  componentId: string
  /** 扫描到的行数 */
  scanned: number
  /** 需要重写快照的行数（实际成功多少看 `written`） */
  changed: number
  /** 两样都不需要动、跳过的行数 */
  unchanged: number
  /** 需要重算 `sync_key` 的行数（已排除冲突的） */
  keyChanged: number
  /** 因**唯一索引冲突**跳过改键的行数（这些行快照照常同步；处理掉冲突后再跑一次即可） */
  keyConflicts: number
  /** 改键的例子（最多 8 条；`reason` 非空表示这行是冲突被跳过的） */
  keySamples: { id: string, sku: string, from: string, to: string, reason: string }[]
  /** 实际写入成功的行数（dryRun 恒为 0） */
  written: number
  /** 写入失败的行数（dryRun 恒为 0） */
  failed: number
  /** 本次是否重算了 sync_key */
  rekey: boolean
  /** 每个字段有多少行会被改（按行数降序，最多 12 条）；`zeroed` = 其中"列是 0/空"的次数 */
  fieldChanges: { key: string, column: string, rows: number, zeroed: number }[]
  /** 前几条具体例子 */
  samples: { id: string, sku: string, key: string, from: string, to: string }[]
  /**
   * ⚠️「列里是 0/空」**被跳过**的总处数（默认不写这些字段）。
   * 它们的列值停在 PB 的默认值上（金额类很常见），写下去等于把界面上的金额刷成 0。
   * `includeBlanks = true` 时它表示"确实会写下去"的处数。
   */
  skippedBlanks: number
  /** 本次是否连「列为 0/空」一起写 */
  includeBlanks: boolean
  /** 失败明细（最多 20 条） */
  failures: string[]
  elapsedMs: number
}

/**
 * 同步快照：把真实列回填进 `data`（**只写快照**）。
 *
 * ⚠️ 走 **app server**（`/api/bi` 前缀由 vite 代理到它，与 uploadBiRows / purgeBiData 同一条路），
 *    并把**调用者自己的 PB token** 放进 Authorization —— 服务端据此向 PocketBase 核实
 *    "这是谁、role 是不是 superAdmin"（前端说什么都不作数）。
 *
 * @param opts.dryRun        true = 只统计差异、不写库（界面先用它把"将更新多少行"摆出来）
 * @param opts.ids           只处理指定的行（调试 / 单行修复用；不传则处理整个组件）
 * @param opts.includeBlanks true = 连「列里是 0/空」也写进快照。
 *                           **默认不写**：那些列的 0 多半是"从没被写过"（金额类很常见），
 *                           写下去等于把界面上的金额刷成 0（见 server/snapshotSync.ts 的说明）。
 * @param opts.rekey          true = 顺带按当前列重算 `sync_key`（唯一键）。
 *                           改了「SKU / 团队 / 仓位 / 待评估 / 店铺」这类**参与键的列**之后要用它，
 *                           否则下次全量同步认不出这些行。冲突（两行同一个新键）会跳过并报出来。
 */
export async function syncBiSnapshots (
  opts: { dryRun?: boolean, ids?: string[], includeBlanks?: boolean, rekey?: boolean } = {},
): Promise<SnapshotSyncSummary> {
  const qs = new URLSearchParams()
  if (opts.dryRun) {
    qs.set('dryRun', '1')
  }
  if (opts.ids && opts.ids.length > 0) {
    qs.set('ids', opts.ids.join(','))
  }
  if (opts.includeBlanks) {
    qs.set('includeBlanks', '1')
  }
  if (opts.rekey) {
    qs.set('rekey', '1')
  }
  const res = await fetch(`/api/bi/snapshot${qs.toString() ? `?${qs}` : ''}`, {
    method: 'POST',
    headers: { Authorization: pb.authStore.token },
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `同步快照失败：HTTP ${res.status}`)
  }
  return payload.data as SnapshotSyncSummary
}

/* ==================== 删除审批单（仅超级管理员） ==================== */

/**
 * 删除结果，形状与 server/orderDelete.ts 的 DeleteOrderSummary 一致。
 *
 * `deleted = false` 表示"这次调用没删到东西，因为它之前就已经不在了" ——
 * 服务端把这种情况**当成功**返回（幂等），所以界面照样提示「已删除」。
 */
export interface DeleteOrderSummary {
  id: string
  /** 单号（已被删掉过则为空串） */
  order_no: string
  status: number | null
  deleted: boolean
  /** 一起清掉的附件条数 */
  filesDeleted: number
  /** 谁删的：服务端拿调用者 token 问过 PocketBase，不采信前端字段 */
  by: { id: string, role: string, name?: string, email?: string }
}

/**
 * 删除一张审批单（连同它的附件）。
 *
 * ⚠️ 走 **app server**（`/api/approval` 前缀由 vite 代理到它，与 bi 那几个同一条路），
 *    并把**调用者自己的 PB token** 放进 Authorization：服务端据此向 PocketBase 核实
 *    "这是谁、role 是不是 superAdmin"（前端说什么都不作数，见 server/orderDelete.ts）。
 *    前端删不掉也不该删：`approval_chain` 的 deleteRule 是空的（只有管理员能删）。
 */
export async function deleteApprovalOrder (id: string): Promise<DeleteOrderSummary> {
  const res = await fetch(`/api/approval/order?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: pb.authStore.token },
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `删除失败：HTTP ${res.status}`)
  }
  return payload.data as DeleteOrderSummary
}

/**
 * 批量删除的结果，形状与 server/orderDelete.ts 的 DeleteHistorySummary 一致。
 *
 * `dryRun = true` 时只有 `targeted` 有意义（其余是 0）—— 确认框就是靠它把
 * "将要删掉多少张"先摆出来。
 */
export interface DeleteHistorySummary {
  dryRun: boolean
  /** 命中的历史审批单数（dryRun 时 = 将要删掉多少） */
  targeted: number
  /** 真删掉的单数 */
  deletedOrders: number
  /** 一起清掉的附件条数 */
  filesDeleted: number
  by: { id: string, role: string, name?: string, email?: string }
}

/**
 * 删除**全部历史审批单**（已办结的：通过 / 驳回）。
 *
 * ⚠️ 删的是"一类"，不看页面上的筛选、也不限于当前页 —— 进行中的单不在此列
 *    （口径与 useApprovalTable 的 historyRows 一致，判定在服务端）。
 *    `dryRun = true` 只统计不删。
 *
 * 权限、批量删除与附件清理都在服务端（见 server/orderDelete.ts 的 deleteHistoryOrders）：
 * 前端藏按钮只是界面礼貌。
 */
export async function deleteHistoryOrders (dryRun = false): Promise<DeleteHistorySummary> {
  const res = await fetch(`/api/approval/orders${dryRun ? '?dryRun=1' : ''}`, {
    method: 'DELETE',
    headers: { Authorization: pb.authStore.token },
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `删除失败：HTTP ${res.status}`)
  }
  return payload.data as DeleteHistorySummary
}

/* ==================== 我的审批（按档懒加载） ==================== */

/** 左栏的五档（与 server/mineOrders.ts 的 MineTab 一一对应，改一处要同时改） */
export type MineOrderTab = 'pending' | 'approved' | 'cc' | 'created' | 'history'

export interface MineOrdersResult {
  /** 本次返回的是哪一档（服务端会把非法值纠正成 pending） */
  tab: MineOrderTab
  /** 五档各自的条数：左栏角标要显示全部五档，而每次只回来一档，所以服务端一起算 */
  counts: Record<MineOrderTab, number>
  /** 该档的整单（含 expand.relation，卡片/表格要拿产品信息） */
  rows: ApprovalOrder[]
}

/**
 * 取某一档「我的审批」。
 *
 * ⚠️ 走 **app server**（`/api/mine` 前缀由 vite 代理到它），并带上调用者自己的 PB token：
 *    四档的判据（待办 / 已审批 / 抄送 / 我发起）都要按 flow + decisions **重算链路**，
 *    PocketBase 的 filter 表达不了 —— 放前端算就只能先把全部单拉回来（见 server/mineOrders.ts）。
 *    服务端拿这个 token 去问 PB"你是谁"，前端传什么身份都不作数。
 */
export async function fetchMineOrders (tab: MineOrderTab): Promise<MineOrdersResult> {
  const res = await fetch(`/api/mine/orders?tab=${encodeURIComponent(tab)}`, {
    headers: { Authorization: pb.authStore.token },
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `读取失败：HTTP ${res.status}`)
  }
  return payload.data as MineOrdersResult
}

/* ==================== 从 bi_rows 读数据 ==================== */

// 纯逻辑（列名翻译 / 转义 / filter 拼装）已移到 @/utils/biQuery，这里只做 I/O。
// 对外仍从本模块导出，调用方不用改 import。
export { biColumnOf, type BiRowQuery, buildBiFilter } from '@/utils/biQuery'

export async function fetchBiRows(
  q: BiRowQuery,
): Promise<{ rows: Record<string, unknown>[], totalItems: number }> {
  const res = await pb.collection('bi_rows').getList<{ id: string, data: Record<string, unknown> }>(
    q.page ?? 1,
    q.perPage ?? 20,
    {
      filter: buildBiFilter(q),
      ...(q.sort ? { sort: q.sort } : {}),
      fields: 'id,data',
      requestKey: PB_REQUEST_KEY.biRowsPage,
    },
  )
  return {
    // ⚠️ 入库时 data 里刻意不含 id（那是每次拉取都会变的行号），这里补上 PB 记录 id 供表格做行 key
    rows: res.items.map(it => ({ ...it.data, id: it.id })),
    totalItems: res.totalItems,
  }
}

/** 导出用：按同样条件取**全量**（分批拉，不请求 total） */
export async function fetchAllBiRows(q: BiRowQuery): Promise<Record<string, unknown>[]> {
  const items = await pb.collection('bi_rows').getFullList<{ id: string, data: Record<string, unknown> }>({
    filter: buildBiFilter(q),
    ...(q.sort ? { sort: q.sort } : {}),
    fields: 'id,data',
    batch: 500,
    requestKey: PB_REQUEST_KEY.biRowsAll,
  })
  return items.map(it => ({ ...it.data, id: it.id }))
}

/**
 * 筛选下拉的选项：**服务端**用一条 `SELECT DISTINCT` 算好（app server 的 `/api/bi/facets`）。
 *
 * 为什么不在浏览器里算：PB 的 perPage 上限是 500，8059 行要 **17 个请求、约 2 秒、1.2MB**；
 * 而且中途被打断（切页 / 热更新）时一个选项都拿不到 —— 表现就是「每次进页面都得刷新一次」。
 * 服务端直连 SQLite 做 DISTINCT 只要几十毫秒，一个请求就够。
 *
 * @returns PB 列名 → 去重后的取值数组（服务端已排序；空值已剔除）
 */
export async function fetchBiFacets(
  componentId: string,
  columns: string[],
): Promise<Record<string, string[]>> {
  const qs = new URLSearchParams({ componentId, columns: columns.join(',') })
  const res = await fetch(`/api/bi/facets?${qs}`)
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `读取筛选选项失败：HTTP ${res.status}`)
  }
  return payload.data as Record<string, string[]>
}

export async function getDashbordDatas(
  componentId: string = import.meta.env.VITE_BI_COMPONENT_ID,
  parameters: AnalysisParam[] = [],
): Promise<Record<string, unknown>[]> {
  const token = await getToken(false)
  console.log(token)
  const all: Record<string, unknown>[] = []
  let pageIndex = 1
  for (; ;) {
    const res: { code: number, errorMsg?: string, message?: string, data?: BiComponentData } = await fetch(
      `${base}/api/public/analysis/v1/component/data`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `${token}`,
        },
        body: JSON.stringify({
          componentId,
          pageRequest: { pageIndex, pageSize: BI_PAGE_SIZE },
          ...(parameters.length > 0 ? { parameters } : {}),
        }),
      },
    ).then((res: Response) => res.json())

    if (res.code !== 200) {
      throw new Error('获取数据失败: ' + (res.errorMsg || res.message))
    }
    const data = res.data
    if (!data) {
      break
    }

    all.push(...normalizeBiRows(data, all.length))
    if (!data.page?.hasNext || (data.rows ?? []).length === 0) {
      break
    }
    pageIndex++
  }

  return all
}

/**
 * 一言接口的返回（字段以官方文档为准：https://docs.tenapi.cn/random/yiyan.html）。
 *
 * ⚠️ 字段名是 **hitokoto / author / source**，不是 hitokoto.cn 的 text / from / from_who ——
 *    两家是不同的服务，别混。tenapi 挂掉时服务端会用**同样的字段名**给内置兜底文案，
 *    所以前端只认这一套就行。
 */
export interface YiyanData {
  code?: number
  msg?: string
  data?: {
    /** 一言 id */
    id?: string
    /** 一言正文 */
    hitokoto?: string
    /** 分类码 / 分类名（如 a / Anime - 动画） */
    cat?: string
    catname?: string
    /** 作者 */
    author?: string
    /** 出处 */
    source?: string
    /** 发布时间（字符串形式的秒级时间戳） */
    date?: string
  }
}

/**
 * 随机一言（登录页的装饰文案）。
 *
 * ⚠️ 走服务端代理（`/api/word` → server/index.ts），**不要**在这里直连 tenapi.cn：
 *    那个接口不带 CORS 头，浏览器直连会被拦；服务端还兜了 5 秒超时。
 * 取不到就返回 undefined —— 装饰文案失败不该影响登录。
 */
export async function getWord(): Promise<YiyanData | undefined> {
  try {
    const res = await fetch('/api/word', { method: 'POST' })
    return await res.json()
  } catch (e) {
    console.log(e)
  }
}

/* ==================== 定时跑批的执行日志（「提醒设置」页读它） ==================== */

/*
 * 这两条打的是 **app server**（`/api/reminders/*` 由 vite 代理到 3002），不是 PocketBase。
 * 字段与 server/reminderLog.ts 的 ReminderRunEntry 一一对应 —— 那边是事实源，改口径从那边改。
 *
 * ⚠️ 与「清空 BI 数据」那几个接口不同，这里**不带 Authorization**：服务端这两个口子
 *    本来就不校验身份（跑批要能被外部 cron 无凭据触发，见 server/index.ts）。
 *    所以执行日志的可见范围 = 能打开「提醒设置」页的人。要收紧就在服务端加
 *    assertSuperAdmin（server/pbAdmin.ts 已有现成的），前端再补上 token。
 */

/** 一轮跑批里"该提醒哪些单"的明细 */
export interface ReminderRunTask {
  orderNo: string
  /** 第几环（从 1 开始，给人看的） */
  stepIndex: number
  /** 已等待的工作日小时数 */
  hours: number
  /** '48h' 日常催办 / '5d' 升级 */
  level: string
  /** 这一环还没办的人 */
  waiting: Array<{ name?: string, email?: string }>
}

/** 一轮跑批的记录 */
export interface ReminderRunEntry {
  /** 这一轮开始的时刻（ISO） */
  at: string
  /** timer = 进程内定时 / http = 外部 cron / manual = 页面「立即试算」 */
  trigger: 'timer' | 'http' | 'manual'
  /** true = 只算不发（dry-run） */
  dryRun: boolean
  /** 耗时（毫秒） */
  ms: number
  scanned: number
  due: number
  sent: number
  skippedInterval: number
  noEmail: number
  escalated: number
  intervalHours: number
  /** 被推送规则整轮挡掉的原因（有值 = 这轮连库都没查） */
  gate?: string
  /** 单条失败 / 告警 */
  errors: string[]
  /** 跑批本身抛异常（有它就说明这轮是失败的） */
  fatal?: string
  tasks: ReminderRunTask[]
}

/** GET /api/reminders/log 的返回体 */
export interface ReminderLogPayload {
  /** 本次服务启动时刻 —— 日志只覆盖它之后（进程内缓冲，**重启即清空**） */
  since: string
  /** 进程内定时的开关（enabled=false 表示靠外部 cron 打接口） */
  timer: { enabled: boolean, intervalMin: number, send: boolean }
  /** 服务端的留存上限（页面据此说明"最多留多少轮 / 每轮多少条明细"） */
  limits: { entries: number, tasks: number }
  /** 最近若干轮，**最新的在最前** */
  items: ReminderRunEntry[]
}

/** 读执行日志（「提醒设置」页的「执行日志」板块） */
export async function fetchReminderLog (): Promise<ReminderLogPayload> {
  const res = await fetch('/api/reminders/log')
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `读取执行日志失败：HTTP ${res.status}`)
  }
  return payload.data as ReminderLogPayload
}

/**
 * 立即跑一次（**dry-run**，只算不发）。
 *
 * 带 `src=manual`：这一轮在执行日志里会记为「页面手动试算」——
 * 不带的话它和外部 cron 的记录长得一样，会被误读成"定时任务自己跑过"。
 */
export async function runReminderOnce (): Promise<Partial<ReminderRunEntry>> {
  const res = await fetch('/api/reminders/run?src=manual', { method: 'POST' })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `试算失败：HTTP ${res.status}`)
  }
  return payload as Partial<ReminderRunEntry>
}

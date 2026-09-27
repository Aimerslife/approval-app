import pb from '@/pocketbase.ts'
// 查询条件的纯逻辑（列名翻译 / 转义 / filter 拼装）在 @/utils/biQuery ——
// 那里不依赖 PocketBase 客户端，能被 tsx 直接跑单测
import { type BiRowQuery, buildBiFilter } from '@/utils/biQuery'
/**
 * 字段对齐规则（别名表 / 枚举值归一化 / 字段名清洗）已下沉到 `@/utils/productFields`，
 * 因为**上传 Excel 的表头匹配要用完全同一套规则** —— 写两份迟早不一致。
 * 这里只负责「BI 的 fields + 二维 rows → 对象数组」这一步转换。
 */
import { resolveFieldKey, resolveFieldValue } from '@/utils/productFields'

// ========== 通用工具 ==========

/** 将飞书头像 URL 转为服务端代理 URL，确保浏览器能正确加载 */
export function proxyAvatar(rawUrl?: string): string | undefined {
  if (!rawUrl) {
    console.warn('[proxyAvatar] 原始头像 URL 为空')
    return undefined
  }
  const proxied = `/api/feishu/avatar?url=${encodeURIComponent(rawUrl)}`
  console.log(`[proxyAvatar] ${rawUrl.slice(0, 60)}... → ${proxied.slice(0, 60)}...`)
  return proxied
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
 * company_name 取的是顶层祖先部门名 —— 飞书没有公开的「查企业名」接口。
 */
export interface UserOrgData {
  department_id: string
  /** 最近一级部门名 */
  department_name: string
  /** 完整路径，形如「总公司 / 财务部 / 财务BP组」 */
  department_path: string
  /** 企业名（顶层祖先部门名） */
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
/**
 * 清空 BI 数据（`bi_rows`，**仅超级管理员**）。
 *
 * 只清这一张表 —— 它是 BI 同步进来的镜像，可以再 `POST /api/bi/sync` 拉回来；
 * 审批单/模板/账号不在清空范围内（见 server/purgeData.ts 的说明）。
 *
 * 权限由服务端判定：它拿我们带过去的 token 去问 PocketBase 这是谁、role 是不是 superAdmin。
 * 前端把按钮藏起来只是界面礼貌 —— 真正拦住人的是服务端那一步，别把这里当权限。
 *
 * @param dryRun true = 只统计条数不删（确认框用它先把"要删掉多少"摆出来）
 */
export async function purgeBiData (dryRun = true): Promise<PurgeSummary> {
  const token = pb.authStore.token
  if (!token) {
    throw new Error('未登录')
  }
  const res = await fetch(`/api/admin/purge${dryRun ? '?dryRun=1' : ''}`, {
    method: 'POST',
    headers: { Authorization: token },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.code !== 0) {
    throw new Error(data?.msg || `清空失败：HTTP ${res.status}`)
  }
  return data.data as PurgeSummary
}

/** 清空结果（与 server/purgeData.ts 的 PurgeSummary 对应） */
export interface PurgeSummary {
  dryRun: boolean
  by: { id: string, role: string, name?: string, email?: string }
  collections: Array<{ name: string, count: number, deleted: number }>
  /** 明确不动的集合（账号等），界面上要说明 */
  kept: string[]
  totalCount: number
  totalDeleted: number
}

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
async function getToken(ifNew: boolean) {
  let token: string | null = localStorage.getItem('token')
  const tokenTime = localStorage.getItem('tokenTime')
  if (!ifNew && token && tokenTime && Date.now() - Number.parseInt(tokenTime) < 3600 * 1000) {
    return token
  }
  const tokenRes = await fetch(
    `${base}/api/v1/corp/oauth/token?accessKeyId=${encodeURIComponent(
      import.meta.env.VITE_ACCESSKEYID)}&accessKeySecret=${encodeURIComponent(
        import.meta.env.VITE_ACCESSKEYSECRET,
      )}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } },
  ).then((res: Response) => res.json())
  if (!tokenRes.success || !tokenRes.data) {
    throw new Error('获取 token 失败: ' + (tokenRes.errorMsg || tokenRes.message))
  }
  token = tokenRes.data
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
 *   2) 唯一键去重（makeSyncKey = SKU|店铺|仓位|组别）、冲突检查、差异比对那套逻辑
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
    const res = await fetch('/api/word', { method: 'GET' })
    console.log(res)
    return await res.json()
  } catch (e) {
    console.log(e)
  }
}
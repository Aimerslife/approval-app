import http from 'node:http'
import https from 'node:https'
import * as lark from '@larksuiteoapi/node-sdk'
import Database from 'better-sqlite3'
// 推送规则（「提醒设置」页面配的那份）：默认值 + 记录→规则的映射，与前端**共用同一份**
// （纯函数模块，服务端引它不会拖进任何前端依赖，见 utils/pushRules 的文件头）
import { pushRulesFromRecord, type PushRules } from '../src/utils/pushRules'
import { fetchBiToken, runBiSync, uploadRows } from './biSync'
// 全部配置统一从 server/config.ts 取（env 只在那里读一次、默认值只有一份、启动即校验）
import { assertRequiredKeys, config, configSummary, optionalWarnings } from './config'
// 本次实际加载到的 env 文件列表：启动日志打出来，省得"我改了怎么没生效"要靠猜
import { loadedEnvFiles } from './env'
import { deleteApprovalOrder, deleteHistoryOrders } from './orderDelete'
import { purgeBiData as runPurgeBiData } from './purgeData'
// 跑批执行日志（进程内环形缓冲）：「提醒设置」页的「执行日志」板块读它，见 server/reminderLog.ts
import { readReminderRuns, recordReminderRun, type ReminderTrigger } from './reminderLog'
import { runReminders } from './reminders'
import { syncSnapshots } from './snapshotSync'

/*
 * 飞书凭据**只从环境变量取**（本地 .env.local / 服务器 /etc/approval/env，见 server/env.ts）。
 *
 * 校验统一在 server/config.ts：缺了必填项就打印"缺什么、去哪配"并退出 ——
 * 绝不静默用一个"刚好能跑"的硬编码值（那等于把应用密钥写进源码，推到远端就是泄密，
 * 而且密钥轮换后旧值还留在 git 历史里，很难清干净）。
 */
assertRequiredKeys()

const appId = config.feishuAppId
const appSecret = config.feishuAppSecret
const client = new lark.Client({ appId, appSecret })

const wsClient = new lark.WSClient({
  appId,
  appSecret,
  loggerLevel: lark.LoggerLevel.info,
})

const PORT = config.port
const BASE_URL = `http://127.0.0.1:${PORT}`
const PB_URL = config.pbUrl
/** PB 的库文件（筛选选项直接走 SQL DISTINCT，不走 REST 分页） */
const PB_DB_PATH = config.pbDbPath

// ========== 类型 ==========
interface FlatDeptItem {
  name: string
  parent_department_id: string
  open_department_id?: string
  department_id?: string
  leader_user_id?: string
  member_count?: number
}

interface OrgTreeNode {
  id: string
  name: string
  member_count: number
  has_child: boolean
  children: OrgTreeNode[]
}

interface OrgTreeResult {
  code: number
  msg: string
  data: {
    tree: OrgTreeNode[]
    total_departments: number
    total_members: number
  }
}

interface UserBrief {
  open_id: string
  name: string
  en_name?: string
  email?: string
  mobile?: string
  avatar?: string
  is_tenant_manager: boolean
  is_leader: boolean
}

// ========== 工具函数 ==========
function json (res: http.ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json;charset=utf-8' })
  res.end(JSON.stringify(data))
}

function readBody (req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}

function intParam (url: URL, name: string, def: number): number {
  const v = url.searchParams.get(name)
  return v == null ? def : (Number.parseInt(v) || def)
}

function pickEnumParam<T extends string> (url: URL, name: string, valid: readonly T[]): { [K in string]: T } | Record<string, never> {
  const v = url.searchParams.get(name)
  return v && valid.includes(v as T) ? { [name]: v as T } : {}
}

/** 收集异步迭代器的全部 items（自动处理分页） */
async function collectAllItems<T> (
  iteratorFactory: () => Promise<{ [Symbol.asyncIterator]: () => AsyncGenerator<{ items?: T[] } | null> }>,
): Promise<T[]> {
  const all: T[] = []
  const iterable = await iteratorFactory()
  for await (const chunk of iterable) {
    if (chunk && chunk.items) {
      all.push(...chunk.items)
    }
  }
  return all
}

/** 将平铺的部门列表构建为树结构 */
function buildDeptTree (flatDepts: FlatDeptItem[]): { tree: OrgTreeNode[], totalMembers: number } {
  const map = new Map<string, OrgTreeNode>()
  let totalMembers = 0

  for (const d of flatDepts) {
    const id = d.open_department_id || d.department_id || ''
    if (!id || map.has(id)) {
      continue
    }
    map.set(id, {
      id,
      name: d.name,
      member_count: d.member_count ?? 0,
      has_child: false,
      children: [],
    })
    totalMembers += d.member_count ?? 0
  }

  // 统计每个部门有多少子节点（用于设置 has_child）
  for (const d of flatDepts) {
    const parentId = d.parent_department_id
    const parent = parentId ? map.get(parentId) : undefined
    if (parent) {
      parent.has_child = true
    }
  }

  // 挂载子节点
  for (const d of flatDepts) {
    const id = d.open_department_id || d.department_id || ''
    const node = map.get(id)
    if (!node) {
      continue
    }
    const parentId = d.parent_department_id
    const parent = parentId ? map.get(parentId) : undefined
    if (parent && parent.id !== id) {
      parent.children.push(node)
    }
  }

  // 顶层节点
  const tree = flatDepts
    .filter(d => d.parent_department_id === '0')
    .map(d => map.get(d.open_department_id || d.department_id || '')!)
    .filter(Boolean)

  return { tree, totalMembers }
}

/** 从单个用户接口提取最高清头像 URL */
function pickBestAvatar (avatar?: { avatar_72?: string, avatar_240?: string, avatar_640?: string, avatar_origin?: string } | null): string | undefined {
  return avatar?.avatar_origin || avatar?.avatar_640 || avatar?.avatar_240 || avatar?.avatar_72 || undefined
}

/** 分批获取部门用户（控制并发数） */
async function fetchUsersForDept (deptId: string, leaderUserId?: string): Promise<UserBrief[]> {
  const users: UserBrief[] = []
  try {
    const iterable = await client.contact.user.findByDepartmentWithIterator({
      params: {
        department_id: deptId,
        user_id_type: 'open_id',
        department_id_type: 'open_department_id',
      },
    })
    for await (const chunk of iterable) {
      if (!chunk || !chunk.items) {
        continue
      }
      for (const u of chunk.items) {
        const openId = u.open_id || ''
        const avatarUrl = pickBestAvatar(u.avatar)
        users.push({
          open_id: openId,
          name: u.name,
          en_name: u.en_name,
          email: u.email,
          mobile: u.mobile,
          avatar: avatarUrl,
          is_tenant_manager: u.is_tenant_manager === true,
          is_leader: !!leaderUserId && openId === leaderUserId,
        })
      }
    }
  } catch (error) {
    console.warn(`[OrgTree] 获取部门 ${deptId} 用户失败:`, error)
  }
  return users
}

/** 并发获取单个用户详情，补充缺失的头像数据 */
async function enrichUserAvatars (users: UserBrief[]): Promise<void> {
  const missing = users.filter(u => !u.avatar)
  if (missing.length === 0) {
    return
  }

  console.log(`[OrgTree] 共 ${missing.length} 个用户缺少头像，开始用 getUser 补充...`)
  const CONCURRENCY = 5
  let done = 0
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async user => {
      try {
        const result = await client.contact.user.get({
          path: { user_id: user.open_id },
          params: { user_id_type: 'open_id' },
        })
        const u = result.data?.user
        const avatarUrl = pickBestAvatar(u?.avatar)
        if (avatarUrl) {
          user.avatar = avatarUrl
        }
      } catch {
        // 静默失败，该用户继续无头像
      }
    }))
    done += batch.length
    if (missing.length > 10) {
      console.log(`[OrgTree] 头像补充进度: ${Math.min(done, missing.length)}/${missing.length}`)
    }
  }
  const enriched = missing.filter(u => u.avatar).length
  console.log(`[OrgTree] 头像补充完成: 已补充 ${enriched}/${missing.length} 个`)
}

// ========== 组织架构树获取（核心逻辑，被 refresh 端点复用） ==========

/** 从飞书拉取完整组织架构树（含用户+头像），返回与旧 GET /api/feishu/org-tree 相同格式 */
async function fetchOrgTreeFromFeishu (): Promise<OrgTreeResult> {
  // 1. 拉平所有部门
  console.log('[OrgTree] 开始拉取全公司部门...')
  const flatDepts = await collectAllItems<FlatDeptItem>(() =>
    client.contact.department.childrenWithIterator({
      path: { department_id: '0' },
      params: { fetch_child: true, department_id_type: 'open_department_id' },
    }),
  )
  console.log(`[OrgTree] 获取到 ${flatDepts.length} 个部门`)

  // 2. 建树
  const { tree, totalMembers } = buildDeptTree(flatDepts)

  // 3. 拉取每个部门的用户
  const leaderMap = new Map<string, string>()
  for (const d of flatDepts) {
    const id = d.open_department_id || d.department_id || ''
    if (id && d.leader_user_id) {
      leaderMap.set(id, d.leader_user_id)
    }
  }

  const allDeptIds = flatDepts.map(d => d.open_department_id || d.department_id || '').filter(Boolean)
  console.log(`[OrgTree] 开始拉取 ${allDeptIds.length} 个部门的用户...`)

  const CONCURRENCY = 5
  const userMap = new Map<string, UserBrief[]>()
  for (let i = 0; i < allDeptIds.length; i += CONCURRENCY) {
    const batch = allDeptIds.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(id => fetchUsersForDept(id, leaderMap.get(id))))
    for (const [idx, id] of batch.entries()) {
      userMap.set(id, results[idx])
    }
    console.log(`[OrgTree] 用户拉取进度: ${Math.min(i + CONCURRENCY, allDeptIds.length)}/${allDeptIds.length}`)
  }

  // 4. 补充缺失头像
  const allUsers = new Map<string, UserBrief>()
  for (const users of userMap.values()) {
    for (const u of users) {
      if (!allUsers.has(u.open_id)) {
        allUsers.set(u.open_id, u)
      }
    }
  }
  await enrichUserAvatars([...allUsers.values()])

  // 注入用户到树节点
  function injectUsers (nodes: OrgTreeNode[]) {
    for (const node of nodes) {
      ;(node as any).users = userMap.get(node.id) || []
      injectUsers(node.children)
    }
  }
  injectUsers(tree)

  return {
    code: 0,
    msg: 'success',
    data: { tree, total_departments: flatDepts.length, total_members: totalMembers },
  }
}

// ========== PocketBase 缓存读写 ==========

/** PB REST API 简单请求 */
function pbRequest (method: string, path: string, body?: unknown): Promise<{ status: number, data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, PB_URL)
    const isHttps = url.protocol === 'https:'
    const fetcher = isHttps ? https : http
    const bodyStr = body ? JSON.stringify(body) : undefined
    const req = fetcher.request(
      url.toString(),
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': String(Buffer.byteLength(bodyStr)) } : {}),
        },
      },
      resp => {
        let raw = ''
        resp.on('data', (chunk: Buffer) => (raw += chunk.toString()))
        resp.on('end', () => {
          let data: any = raw
          try {
            data = JSON.parse(raw)
          } catch { /* 非 JSON 保留字符串 */ }
          resolve({ status: resp.statusCode ?? 200, data })
        })
      },
    )
    req.on('error', reject)
    if (bodyStr) {
      req.write(bodyStr)
    }
    req.end()
  })
}

/**
 * 通过飞书发一条**文本**消息（发卡片路由与超时提醒共用）。
 * 用文本而不是卡片：提醒里没有可点的按钮，卡片能表达的东西这里一个都不需要，
 * 少一层 schema 出错的余地。
 */
async function sendFeishuText (
  receiveId: string,
  receiveIdType: 'email' | 'open_id',
  text: string,
): Promise<void> {
  await client.request({
    method: 'POST',
    url: `/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
    data: { receive_id: receiveId, msg_type: 'text', content: JSON.stringify({ text }) },
  })
}

/** 组织管理员（组织架构缓存里 is_tenant_manager）—— 超时升级的推送对象 */
async function orgAdmins (): Promise<Array<{ name?: string, email?: string }>> {
  const cached = await readOrgTreeCache()
  const out: Array<{ name?: string, email?: string }> = []
  const walk = (nodes: any[]) => {
    for (const n of nodes ?? []) {
      for (const u of n.users ?? []) {
        if (u.is_tenant_manager) {
          out.push({ name: u.name, email: u.email })
        }
      }
      walk(n.children ?? [])
    }
  }
  walk((cached?.data?.tree ?? []) as any[])
  return out
}

/**
 * 读「提醒设置」页面保存的推送规则（取最新那条）。
 *
 * 读不到（表还没建、没配过、PB 抽风）→ 回落默认规则：超时提醒**绝不能**因为没有配置而停摆，
 * 默认规则就是改造前的行为（工作日 48h 起、每天催当前审批人）。所以这里不抛错。
 * 每次跑批现读、不缓存：跑批本来就不频繁，而"改了规则要等缓存过期才生效"属于最难排查的一类问题。
 */
async function readPushRules (): Promise<PushRules> {
  try {
    const { status, data } = await pbRequest(
      'GET',
      '/api/collections/push_rules/records?perPage=1&sort=-updated',
    )
    if (status !== 200 || !data?.items?.length) {
      return pushRulesFromRecord(null)
    }
    return pushRulesFromRecord(data.items[0])
  } catch (error: any) {
    console.warn('[PushRules] 读取推送规则失败，按默认规则跑批:', error?.message ?? error)
    return pushRulesFromRecord(null)
  }
}

/**
 * 跑一遍超时提醒（路由与定时任务共用）。规则现读现用，见 readPushRules。
 *
 * 每轮结果都会记一笔执行日志（**失败也记**）——「提醒设置」页的「执行日志」板块读的就是它。
 * 记在这里而不是各个调用点：定时与接口两条路都经过本函数，漏记一处日志就不可信了。
 */
async function runReminderBatch (dryRun: boolean, now?: Date, trigger: ReminderTrigger = 'http') {
  const startedAt = Date.now()
  const at = new Date(startedAt).toISOString()
  try {
    const rules = await readPushRules()
    const report = await runReminders(
      { pbUrl: PB_URL, sendText: sendFeishuText, admins: orgAdmins, rules, log: console.log },
      { dryRun, ...(now ? { now } : {}) },
    )
    recordReminderRun({ at, trigger, dryRun, ms: Date.now() - startedAt, report })
    return report
  } catch (error: any) {
    /*
     * 跑批本身抛异常（读规则挂了、读库挂了……）：也要留一条。
     * 不记的话页面上看起来像"压根没跑过"，而实际是每轮都失败 —— 那是最容易误判的情形。
     */
    recordReminderRun({
      at,
      trigger,
      dryRun,
      ms: Date.now() - startedAt,
      fatal: error?.message || String(error),
    })
    throw error
  }
}

/** 从 PocketBase 读取缓存（org_tree_cache 集合中取第一条记录） */
async function readOrgTreeCache (): Promise<OrgTreeResult | null> {
  try {
    const { status, data } = await pbRequest('GET', '/api/collections/org_tree_cache/records?perPage=1&sort=-updated')
    if (status !== 200 || !data?.items?.length) {
      return null
    }
    const record = data.items[0]
    if (!record.tree_data) {
      return null
    }
    return JSON.parse(JSON.stringify(record.tree_data)) as OrgTreeResult
  } catch (error: any) {
    console.warn('[PB] 读取缓存失败:', error.message)
    return null
  }
}

/** 将组织架构树写入 PocketBase（新增一条记录） */
async function writeOrgTreeCache (result: OrgTreeResult): Promise<void> {
  try {
    const { status, data } = await pbRequest('POST', '/api/collections/org_tree_cache/records', {
      tree_data: result,
    })
    if (status < 200 || status >= 300) {
      console.warn(`[PB] 写入缓存返回 HTTP ${status}:`, JSON.stringify(data).slice(0, 300))
      return
    }
    console.log('[PB] 组织架构树已写入缓存')
  } catch (error: any) {
    console.warn('[PB] 写入缓存失败:', error.message)
  }
}

// ========== 事件处理 ==========

async function handleMessage (data: any) {
  const { message } = data
  const msgId = message.message_id
  const content = JSON.parse(message.content)
  console.log('收到飞书消息', msgId, content)
}

// ========== 启动长连接 ==========
wsClient.start({
  eventDispatcher: new lark.EventDispatcher({}).register({
    'im.message.receive_v1': handleMessage,
    'card.action.trigger': async (data: any) => {
      console.log('收到卡片事件', data)
    },
  }),
})

console.log('飞书长连接服务已启动')

// ========== HTTP API 路由 ==========
http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', BASE_URL)
  const pathname = url.pathname

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    // ─── 部门 ──────────────────────────────────

    // 批量获取部门信息
    // GET /api/feishu/departments?department_ids=od-xxx&department_ids=od-yyy
    if (pathname === '/api/feishu/departments' && req.method === 'GET') {
      const ids = url.searchParams.getAll('department_ids')
      if (ids.length === 0) {
        json(res, 400, { code: -1, msg: '缺少 department_ids 参数' })
        return
      }
      const result = await client.contact.department.batch({
        params: {
          department_ids: ids,
          ...pickEnumParam(url, 'department_id_type', ['open_department_id', 'department_id'] as const),
          ...pickEnumParam(url, 'user_id_type', ['open_id', 'union_id', 'user_id'] as const),
        },
      })
      json(res, 200, result)
      return
    }

    // 获取子部门列表
    // GET /api/feishu/departments/children?parent_department_id=0&fetch_child=true&page_size=50&page_token=xxx
    if (pathname === '/api/feishu/departments/children' && req.method === 'GET') {
      const parentId = url.searchParams.get('parent_department_id') || '0'
      const result = await client.contact.department.children({
        path: { department_id: parentId },
        params: {
          fetch_child: url.searchParams.get('fetch_child') === 'true',
          page_size: intParam(url, 'page_size', 50),
          page_token: url.searchParams.get('page_token') || undefined,
          ...pickEnumParam(url, 'department_id_type', ['open_department_id', 'department_id'] as const),
          ...pickEnumParam(url, 'user_id_type', ['open_id', 'union_id', 'user_id'] as const),
        },
      })
      json(res, 200, result)
      return
    }

    // ─── 用户 ──────────────────────────────────

    // 获取部门直属用户列表
    // GET /api/feishu/users?department_id=od-xxx&page_size=50&page_token=xxx
    if (pathname === '/api/feishu/users' && req.method === 'GET') {
      const deptId = url.searchParams.get('department_id')
      if (!deptId) {
        json(res, 400, { code: -1, msg: '缺少 department_id 参数' })
        return
      }
      const result = await client.contact.user.findByDepartment({
        params: {
          department_id: deptId,
          page_size: intParam(url, 'page_size', 50),
          page_token: url.searchParams.get('page_token') || undefined,
          ...pickEnumParam(url, 'department_id_type', ['open_department_id', 'department_id'] as const),
          ...pickEnumParam(url, 'user_id_type', ['open_id', 'union_id', 'user_id'] as const),
        },
      })
      json(res, 200, result)
      return
    }

    // 获取单个用户信息
    // GET /api/feishu/users/:user_id?user_id_type=open_id
    const userMatch = pathname.match(/^\/api\/feishu\/users\/([^/]+)$/)
    if (userMatch && req.method === 'GET') {
      const userId = decodeURIComponent(userMatch[1])
      const result = await client.contact.user.get({
        path: { user_id: userId },
        params: {
          ...pickEnumParam(url, 'department_id_type', ['open_department_id', 'department_id'] as const),
          ...pickEnumParam(url, 'user_id_type', ['open_id', 'union_id', 'user_id'] as const),
        },
      })
      json(res, 200, result)
      return
    }

    // ─── 组织架构树缓存 ────────────────────────

    // GET /api/org-tree/cache —— 从 PocketBase 读取缓存的架构树
    if (pathname === '/api/org-tree/cache' && req.method === 'GET') {
      const cached = await readOrgTreeCache()
      if (cached) {
        console.log('[OrgTree] 返回 PB 缓存')
        json(res, 200, cached)
      } else {
        json(res, 200, { code: -1, msg: '暂无缓存，请先刷新', data: null })
      }
      return
    }

    // POST /api/org-tree/refresh —— 从飞书重新拉取并更新 PocketBase
    if (pathname === '/api/org-tree/refresh' && req.method === 'POST') {
      console.log('[OrgTree] 收到刷新请求，从飞书重新拉取...')
      const startTime = Date.now()
      const result = await fetchOrgTreeFromFeishu()
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[OrgTree] 刷新完成，耗时 ${elapsed}s`)

      // 写入 PocketBase 缓存
      await writeOrgTreeCache(result)

      json(res, 200, result)
      return
    }

    // 获取当前用户所在部门及成员列表（用于抄送/转办选人）
    // GET /api/feishu/department-users?open_id=xxx
    if (pathname === '/api/feishu/department-users' && req.method === 'GET') {
      const openId = url.searchParams.get('open_id')
      if (!openId) {
        json(res, 400, { code: -1, msg: '缺少 open_id 参数' })
        return
      }
      try {
        // 1. 查询用户详情，得到所属部门（department_ids 为 open_department_id）
        const userRes = await client.contact.user.get({
          path: { user_id: openId },
          params: { user_id_type: 'open_id' },
        })
        const deptIds = userRes.data?.user?.department_ids ?? []
        if (deptIds.length === 0) {
          json(res, 200, { code: 0, data: { department_id: '', department_name: '', users: [] } })
          return
        }
        const deptId = deptIds[0]

        // 2. 查询部门信息（名称 + 真正的部门负责人）
        let deptName = deptId
        let leaderUserId: string | undefined
        try {
          const deptRes = await client.contact.department.get({
            path: { department_id: deptId },
            params: { department_id_type: 'open_department_id', user_id_type: 'open_id' },
          })
          const dept = deptRes.data?.department
          deptName = dept?.name || deptId
          // 部门负责人（user_id_type=open_id，与拉取成员时保持一致）
          leaderUserId = dept?.leader_user_id || undefined
        } catch (error) {
          console.warn('[DepartmentUsers] 获取部门信息失败，使用 id 兜底:', error)
        }

        // 3. 拉取该部门成员：以部门真实负责人作为 leader 标记，并过滤掉当前登录用户自己
        const users = (await fetchUsersForDept(deptId, leaderUserId))
          .filter(u => u.open_id !== openId)

        json(res, 200, {
          code: 0,
          data: { department_id: deptId, department_name: deptName, users },
        })
      } catch (error: any) {
        console.error('[DepartmentUsers] 获取失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || '获取部门成员失败' })
      }
      return
    }

    // 获取用户的企业与部门信息（登录时落库用）
    // GET /api/feishu/user-org?open_id=xxx
    if (pathname === '/api/feishu/user-org' && req.method === 'GET') {
      const openId = url.searchParams.get('open_id')
      if (!openId) {
        json(res, 400, { code: -1, msg: '缺少 open_id 参数' })
        return
      }
      try {
        // 1. 用户所属部门（飞书一个用户可属多部门，取第一个：与 department-users 口径保持一致）
        const userRes = await client.contact.user.get({
          path: { user_id: openId },
          params: { user_id_type: 'open_id' },
        })
        const deptIds = userRes.data?.user?.department_ids ?? []
        if (deptIds.length === 0) {
          json(res, 200, {
            code: 0,
            // 该用户没挂任何部门：部门信息全空，但**企业名照样给**
            //（企业名是写死的常量，与有没有部门无关；给空串会让这一栏莫名空白）
            data: {
              department_id: '',
              department_name: '',
              department_path: '',
              company_name: config.companyName,
            },
          })
          return
        }

        // 2. 沿 parent_department_id 逐级上溯拼祖先链（只用于部门路径）。
        //    飞书没有「一次取回全部祖先」的接口，只能逐级 department.get（深度通常 2~4 层）。
        //    guard 防御脏数据成环导致死循环。
        const names: string[] = []
        let deptId: string | undefined = deptIds[0]
        let guard = 0
        while (deptId && guard++ < 20) {
          const deptRes = await client.contact.department.get({
            path: { department_id: deptId },
            params: { department_id_type: 'open_department_id', user_id_type: 'open_id' },
          })
          const dept = deptRes.data?.department
          if (!dept) {
            break
          }
          names.push(dept.name || deptId)
          const parent = dept.parent_department_id
          // parent 为空或 '0' 即到顶（与 buildDeptTree 判定根节点的口径一致）
          if (!parent || parent === '0') {
            break
          }
          deptId = parent
        }

        // 上溯顺序是「叶子 → 根」，反转后才是「根 / … / 叶子」
        names.reverse()

        json(res, 200, {
          code: 0,
          data: {
            department_id: deptIds[0],
            // 最后一级 = 用户自己的部门
            department_name: names.at(-1) ?? '',
            department_path: names.join(' / '),
            // 企业名是**写死的常量**（server/config.ts 的 companyName），
            // 不从部门树推导 —— 顶层节点常常是「总经理」这种职位部门，推导出来的必然是职位名。
            company_name: config.companyName,
          },
        })
      } catch (error: any) {
        console.error('[UserOrg] 获取失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || '获取企业与部门信息失败' })
      }
      return
    }

    // ─── 头像代理 ──────────────────────────────
    // ─── 随机一言（第三方接口代理）──────────────
    // POST /api/word         ← 我们自己的接口故意用 POST（前端 getWord 就是 POST，两边对齐）
    //
    // ⚠️ 为什么不用 GET：内容是**随机**的，GET 可能被浏览器 / 中间代理缓存，那就永远同一句。
    //    POST 天然不可缓存。**别把它和上游的方法混起来看** —— 上游用什么方法由对方文档决定。
    //
    // 上游：毒鸡汤（夏柔 API）
    //      https://v.api.aa1.cn/api/api-wenan-dujitang/index.php
    //      · 方式 GET（文档声明）
    //      · **参数 aa1 必填**：?aa1=json 回 JSON、?aa1=text 回纯文本；
    //        一个都不带会直接返回「缺少参数或参数错误」（实测过）
    //      · 我们取 aa1=text 拿纯文本 —— 比解析上游的 [{"dujitang":"…"}] 更不容易被改结构搞坏
    //      · 拿回来**统一成前端已认的形状**（data.hitokoto）→ 以后再换供应商，前端不用动
    //
    // 为什么放服务端而不是浏览器直连：
    //   1) 第三方接口基本不带 CORS 头，浏览器直连会被拦（登录页那句装饰文案就永远出不来）；
    //   2) 第三方抖动挡在服务端：5 秒超时 + 兜底文案，登录页不该被一串文案拖住；
    //   3) 以后想换供应商 / 加缓存，只改这一处，前端不用动。
    if (pathname === '/api/word' && req.method === 'POST') {
      try {
        const upstream = await fetch('https://v.api.aa1.cn/api/api-wenan-dujitang/index.php?aa1=text', {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        })
        const rawText = await upstream.text().catch(() => '')
        /*
         * 上游 aa1=text 返回的正文**带 HTML 标签**（实测形如 `<p>“……”</p>`，还可能有 &nbsp; 等实体）。
         * 不剥干净的话，登录页会把 "<p>" 当正文显示出来 —— 剥标签 + 还原常见实体 + 压平空白。
         */
        const text = rawText
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;|&apos;/gi, "'")
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&amp;/gi, '&')
          .replace(/\s+/g, ' ')
          .trim()
        if (!upstream.ok || !text) {
          throw new Error(`上游 HTTP ${upstream.status}`)
        }
        json(res, 200, {
          code: 200,
          msg: 'success',
          data: { hitokoto: text, author: '', source: '毒鸡汤' },
        })
      } catch (err: any) {
        /*
         * 上游挂了也要给一句话：这是**装饰文案**，登录页不该因为第三方接口出错就空着。
         * 兜底**用同样的字段名**（hitokoto/author/source），前端只认一套字段。
         * 不想要兜底就把下面的 json 换回 502 —— 前端允许拿不到（getWord 返回 undefined）。
         */
        console.warn('[Word] 获取一言失败，用内置兜底:', err?.message ?? err)
        const words = [
          { hitokoto: '流水不争先，争的是滔滔不绝。', author: '内置兜底', source: '' },
          { hitokoto: '路虽远行则将至，事虽难做则必成。', author: '内置兜底', source: '' },
          { hitokoto: '把简单的事做到极致，就是不简单。', author: '内置兜底', source: '' },
        ]
        json(res, 200, {
          code: 200,
          msg: 'success',
          data: words[Math.floor(Math.random() * words.length)],
        })
      }
      return
    }

    // GET /api/feishu/avatar?url=xxx
    // 飞书头像 URL 可能为内网地址，通过服务端代理转发，确保前端可加载
    if (pathname === '/api/feishu/avatar' && req.method === 'GET') {
      const avatarUrl = url.searchParams.get('url')
      if (!avatarUrl) {
        json(res, 400, { code: -1, msg: '缺少 url 参数' })
        return
      }
      try {
        const parsed = new URL(avatarUrl)
        console.log(`[Avatar] 代理请求: ${avatarUrl.slice(0, 100)}...`)
        const fetcher = parsed.protocol === 'https:' ? https : http
        const proxyReq = fetcher.request(avatarUrl, { method: 'GET' }, proxyRes => {
          if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
            console.warn(`[Avatar] 上游返回 ${proxyRes.statusCode}: ${avatarUrl.slice(0, 80)}`)
            res.writeHead(proxyRes.statusCode)
            res.end()
            return
          }
          const contentType = proxyRes.headers['content-type'] || 'image/png'
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
          })
          proxyRes.pipe(res)
        })
        proxyReq.on('error', err => {
          console.warn(`[Avatar] 代理失败: ${err.message}, url=${avatarUrl.slice(0, 80)}`)
          res.writeHead(502)
          res.end()
        })
        proxyReq.end()
      } catch {
        console.warn(`[Avatar] 无效 URL: ${avatarUrl}`)
        json(res, 400, { code: -1, msg: '无效的 url' })
      }
      return
    }

    // ─── 发送卡片消息 ──────────────────────────
    // POST /api/feishu/send-card
    if (pathname === '/api/feishu/send-card' && req.method === 'POST') {
      const body = await readBody(req)
      const { receive_id, receive_id_type = 'open_id', msg_type = 'interactive', content } = body
      if (!receive_id || !content) {
        json(res, 400, { code: -1, msg: '缺少必要参数: receive_id, content' })
        return
      }
      try {
        const result = await client.request({
          method: 'POST',
          url: `/open-apis/im/v1/messages?receive_id_type=${receive_id_type}`,
          data: {
            receive_id,
            msg_type,
            content: typeof content === 'string' ? content : JSON.stringify(content),
          },
        })
        console.log('[SendCard] 消息发送成功')
        json(res, 200, { code: 0, data: result })
      } catch (error: any) {
        console.error('[SendCard] 发送失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || '发送失败' })
      }
      return
    }

    // ─── 审批超时提醒 ──────────────────────────
    // 白板：「所有环节 工作日48h 每天飞书提醒」「5 个工作日未处理推送」
    // POST /api/reminders/run          —— 默认 **dry-run**（只算不发，返回"该提醒谁"）
    // POST /api/reminders/run?send=1   —— 真发消息
    // 生产建议用外部 cron 定时打这个地址（进程内定时默认关，见文件末尾）
    //
    // GET /api/reminders/log —— 「提醒设置」页的「执行日志」板块读它：最近几轮跑了什么、
    //   发了多少、被哪条规则挡掉、有没有失败。**只覆盖本次服务启动以来**（进程内缓冲，
    //   见 server/reminderLog.ts 里"为什么不落库"的说明）。
    if (pathname === '/api/reminders/log' && req.method === 'GET') {
      json(res, 200, { code: 0, data: readReminderRuns() })
      return
    }

    if (pathname === '/api/reminders/run' && req.method === 'POST') {
      const dryRun = url.searchParams.get('send') !== '1'
      /*
       * ?src=manual 是页面「立即试算」按钮带的标记：外部 cron 打的记 'http'、页面手点的记 'manual'。
       * 执行日志里两种混在一起时能分清"定时任务真跑过"和"有人手动点过"——
       * 否则看着有记录，会误以为定时器在正常工作。只影响记录，不影响行为。
       */
      const trigger: ReminderTrigger = url.searchParams.get('src') === 'manual' ? 'manual' : 'http'
      /*
       * ?now=<ISO> 把"现在"挪一下 —— 用来在**真实单据**上验证"到点会不会被提醒"
       * （不用真等到 48 小时后）。只在 dry-run 下认这个参数：
       * 真发的时候调时间，等于绕过"工作日 48h"这道业务约束，绝不能给这个口子。
       */
      const nowIso = url.searchParams.get('now')
      const now = dryRun && nowIso ? new Date(nowIso) : undefined
      if (now && Number.isNaN(now.getTime())) {
        json(res, 400, { code: -1, msg: `now 不是合法时间：${nowIso}` })
        return
      }
      try {
        const report = await runReminderBatch(dryRun, now, trigger)
        if (!dryRun) {
          console.log(`[Reminders] 已发 ${report.sent} 条（扫描 ${report.scanned}，应提醒 ${report.due}）`)
        }
        json(res, 200, { code: 0, dryRun, now: now?.toISOString(), ...report })
      } catch (error: any) {
        console.error('[Reminders] 跑批失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || '跑批失败' })
      }
      return
    }

    // ─── BI token（服务端代取，前端不再持有永久密钥）────
    // POST /api/bi/token  用服务端的 BI_ACCESS_KEY_* 换一个短期 token 交给前端。
    //
    // 为什么必须由服务端换：前端原来读 `VITE_ACCESSKEYID/SECRET` —— VITE_ 变量会被
    // **打进浏览器产物**，部署到公网后任何人打开 DevTools 就能拿到**永久**密钥
    // （实测确认过：`src/api/api.ts` 的 getToken 原来就是这么写的）。
    // 现在密钥不出服务端，浏览器拿到的是一次性 token（过期即失效，也能在 BI 侧吊销）。
    if (pathname === '/api/bi/token' && req.method === 'POST') {
      try {
        const token = await fetchBiToken()
        json(res, 200, { code: 0, data: { token } })
      } catch (error: any) {
        console.error('[biToken] 获取失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || '获取 BI token 失败' })
      }
      return
    }

    // ─── BI 筛选选项（去重值） ─────────────────
    // GET /api/bi/facets?componentId=xxx&columns=platform,department,...
    //
    // 为什么必须在服务端做：页面原来是自己分页扫全量再去重 —— PB 的 perPage 上限是 500，
    // 8059 行要 17 个请求、约 2 秒、1.2MB，而且中途被打断（页面切换/热更新）时
    // 一个选项都拿不到，表现就是「每次进页面都得刷新一次」。
    // 这里直接用 SQL 的 DISTINCT：一个请求、几十毫秒。
    //
    // 直连 SQLite 是安全的：只读打开、PB 用 WAL，并发读不会互相影响。
    if (pathname === '/api/bi/facets' && req.method === 'GET') {
      try {
        const componentId = url.searchParams.get('componentId') || ''
        if (!componentId) {
          json(res, 400, { code: -1, msg: '缺少 componentId' })
          return
        }
        // 列名白名单校验：这些名字最终会拼进 SQL，必须挡住注入
        const columns = (url.searchParams.get('columns') || '')
          .split(',')
          .map(c => c.trim())
          .filter(c => /^[a-z_][a-z0-9_]*$/.test(c))
        if (columns.length === 0) {
          json(res, 400, { code: -1, msg: 'columns 为空或不合法' })
          return
        }

        const db = new Database(PB_DB_PATH, { readonly: true, fileMustExist: true })
        try {
          const facets: Record<string, string[]> = {}
          for (const col of columns) {
            const rows = db
              .prepare(
                `SELECT DISTINCT \`${col}\` AS v FROM bi_rows`
                + ` WHERE component_id = ? AND \`${col}\` IS NOT NULL AND \`${col}\` != ''`
                + ` ORDER BY v`,
              )
              .all(componentId) as { v: unknown }[]
            facets[col] = rows.map(r => String(r.v))
          }
          json(res, 200, { code: 0, data: facets })
        } finally {
          db.close()
        }
      } catch (error: any) {
        console.error('[biFacets] 失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || String(error) })
      }
      return
    }

    // ─── BI 数据上传（Excel） ───────────────────
    // POST /api/bi/upload           把前端解析好的行写进 bi_rows（唯一键去重 + upsert）
    // POST /api/bi/upload?dryRun=1  只算差异、不写库
    //   请求体：{ rows: Record<string, unknown>[], componentId?: string }
    //
    // 为什么不让浏览器直接写 bi_rows：
    //   1) 该集合的 createRule / updateRule 是 null（只有管理员可写），浏览器写会 403；
    //   2) 唯一键去重（dedupeBySyncKey）与差异比对（upsertBySyncKey）已经完整地在本服务里，
    //      前端再来一份必然分叉 —— 两条路对同一份数据会得出不同行数，且不会报错。
    if (pathname === '/api/bi/upload' && req.method === 'POST') {
      try {
        const body = await readBody(req)
        const rows = Array.isArray(body?.rows) ? body.rows : []
        if (rows.length === 0) {
          json(res, 400, { code: -1, msg: '缺少 rows（应为对象数组）' })
          return
        }
        const summary = await uploadRows(rows, body?.componentId, {
          dryRun: url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true',
          // prune 默认关闭：上传的往往只是全量的一个子集，一 prune 会把没覆盖到的行删掉
          prune: url.searchParams.get('prune') === '1',
        })
        json(res, 200, { code: 0, data: summary })
      } catch (error: any) {
        console.error('[biUpload] 上传失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || String(error) })
      }
      return
    }

    // ─── BI 数据同步 ───────────────────────────
    // POST /api/bi/sync             拉 BI → 去重 → 写进 bi_rows（一行一条记录）
    // POST /api/bi/sync?dryRun=1    只拉数据、只报差异，**不写库**
    //                               ← 上线前先用它验 SKU 唯一性（会报 conflicts）
    // POST /api/bi/sync?prune=1     额外删除「库里存在但 BI 已不再返回」的行（破坏性）
    if (pathname === '/api/bi/sync' && req.method === 'POST') {
      try {
        const summary = await runBiSync(url.searchParams)
        json(res, 200, { code: 0, data: summary })
      } catch (error: any) {
        console.error('[biSync] 同步失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || String(error) })
      }
      return
    }

    // ─── 清空 BI 数据（仅超级管理员） ───────────
    // POST /api/bi/purge            真正清空（**只清 bi_rows**，它是 BI 的镜像，能再同步回来）
    // POST /api/bi/purge?dryRun=1   只统计条数、不删（确认框先用它把"要删多少"摆出来）
    //   请求头：Authorization: <调用者的 PB token>
    //
    // 为什么权限判定在服务端：bi_rows 的 deleteRule 是空的（只有管理员能删），浏览器直删会被 PB 拒；
    // 这里用管理员凭据绕过规则执行，所以"调用者是不是 superAdmin"必须拿**他的 token** 去问 PB，
    // 前端隐藏按钮只是界面礼貌（见 server/purgeData.ts 的说明）。
    if (pathname === '/api/bi/purge' && req.method === 'POST') {
      try {
        const token = String(req.headers.authorization ?? '')
        const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true'
        const summary = await runPurgeBiData({ token, dryRun })
        if (!dryRun) {
          console.log(`[biPurge] ${summary.by.email ?? summary.by.id} 清空 ${summary.totalDeleted} 条`)
        }
        json(res, 200, { code: 0, data: summary })
      } catch (error: any) {
        console.error('[biPurge] 清空失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || String(error) })
      }
      return
    }

    // ─── 删除审批单（仅超级管理员） ─────────────
    // DELETE /api/approval/order?id=<approval_chain 记录 id>
    //   请求头：Authorization: <调用者的 PB token>（服务端拿它去问 PB「这是谁、是不是 superAdmin」）
    //
    // 为什么权限判定也在服务端：approval_chain / approval_files 的 deleteRule 是空的
    // （只有管理员能删），浏览器直删会被 PB 拒；这里用管理员凭据执行，
    // 所以"调用者是不是 superAdmin"必须由服务端核实（见 server/orderDelete.ts 的说明）。
    if (pathname === '/api/approval/order' && req.method === 'DELETE') {
      try {
        const token = String(req.headers.authorization ?? '')
        const summary = await deleteApprovalOrder({ token, id: url.searchParams.get('id') ?? '' })
        console.log(`[orderDelete] ${summary.by.email ?? summary.by.id} 删除审批单 ${summary.order_no || summary.id}（附件 ${summary.filesDeleted} 个，deleted=${summary.deleted}）`)
        json(res, 200, { code: 0, data: summary })
      } catch (error: any) {
        console.error('[orderDelete] 删除失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || String(error) })
      }
      return
    }

    // ─── 快照同步（把真实列回填进 data，仅超级管理员） ───
    // POST /api/bi/snapshot            只重写 data 快照（列 / sync_key / 审批单都不动）
    // POST /api/bi/snapshot?dryRun=1   只统计差异、不写库（界面先用它把"将更新多少行"摆出来）
    // POST /api/bi/snapshot?ids=a,b    只处理指定行（调试 / 单行修复）
    // POST /api/bi/snapshot?limit=100  只处理前 N 行
    // POST /api/bi/snapshot?includeBlanks=1  连「列里是 0/空」的值一起写（默认跳过）
    // POST /api/bi/snapshot?rekey=1    顺带按当前列重算 sync_key（唯一键；冲突的跳过并报出来）
    //   请求头：Authorization: <调用者的 PB token>
    //
    // 为什么需要它：表格的单元格值来自 data 快照，而筛选/排序/唯一键走真实列 ——
    // 直接在库里改列，界面看不到（详见 server/snapshotSync.ts 的说明）。
    if (pathname === '/api/bi/snapshot' && req.method === 'POST') {
      try {
        const summary = await syncSnapshots({
          token: String(req.headers.authorization ?? ''),
          // 不传就让模块用默认组件（见 snapshotSync.ts 的 DEFAULT_COMPONENT_ID）
          componentId: url.searchParams.get('componentId') ?? undefined,
          dryRun: url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true',
          ids: (url.searchParams.get('ids') ?? '').split(',').map(s => s.trim()).filter(Boolean),
          limit: Number(url.searchParams.get('limit') ?? 0) || 0,
          includeBlanks: url.searchParams.get('includeBlanks') === '1' || url.searchParams.get('includeBlanks') === 'true',
          rekey: url.searchParams.get('rekey') === '1' || url.searchParams.get('rekey') === 'true',
        })
        json(res, 200, { code: 0, data: summary })
      } catch (error: any) {
        console.error('[biSnapshot] 同步失败:', error?.message ?? error)
        json(res, 500, { code: -1, msg: error?.message || String(error) })
      }
      return
    }

    // ─── 健康检查 ──────────────────────────────
    res.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' })
    res.end('feishu ws running')
  } catch (error: any) {
    console.error(`[API Error] ${req.method} ${pathname}`, error?.message ?? error)
    json(res, 500, { code: -1, msg: error?.message || String(error) })
  }
}).listen(PORT, () => {
  /*
   * 启动自检：把"配置从哪来、配没配"打出来。
   * ⚠️ 只报有/无，**绝不打印值** —— 顺手 console.log(config) 就把飞书密钥、
   * PB 管理员密码、BI accessKeySecret 全写进日志了（云上日志往往还转存）。
   */
  console.log(`[配置] ${configSummary()}`)
  console.log(loadedEnvFiles.length > 0
    ? `[配置] 已加载 env 文件：${loadedEnvFiles.join('、')}`
    : '[配置] 未读到任何 env 文件（变量应来自进程环境，例如 systemd 的 EnvironmentFile）')
  for (const warning of optionalWarnings()) {
    console.warn(`[配置] ⚠️ ${warning}`)
  }

  console.log(`服务端口: ${BASE_URL}`)
  console.log(`  缓存读取: GET /api/org-tree/cache`)
  console.log(`  刷新更新: POST /api/org-tree/refresh`)
  console.log(`  部门: GET /api/feishu/departments?department_ids=xxx`)
  console.log(`  子部门: GET /api/feishu/departments/children?parent_department_id=0`)
  console.log(`  部门用户: GET /api/feishu/users?department_id=xxx`)
  console.log(`  用户详情: GET /api/feishu/users/:user_id`)
  console.log(`  企业部门: GET /api/feishu/user-org?open_id=xxx`)
  console.log(`  发送卡片: POST /api/feishu/send-card`)
  console.log(`  BI 同步: POST /api/bi/sync（?dryRun=1 只校验不写库，?prune=1 顺带删除多余行）`)
  console.log(`  超时提醒: POST /api/reminders/run（默认 dry-run；?send=1 真发）`)
  console.log(`  执行日志: GET /api/reminders/log（「提醒设置」页的「执行日志」板块读它；只记本次启动以来的轮次）`)
})

/*
 * 进程内定时跑超时提醒。
 *
 * 默认**不开**：本地起服务不该给同事发真实提醒（dry-run 也照样要有人看才有意义）。
 * 要开就在 .env.local 里设 REMINDER_INTERVAL_MIN=30（分钟）；
 * 加 REMINDER_SEND=1 才会真的发消息 —— 不设就只是算一遍并打日志。
 * 生产更推荐用外部 cron 打 POST /api/reminders/run?send=1：
 * 进程重启不会漏跑，也不会因为多开几个实例重复发。
 *
 * ⚠️ 这个 tick 与「提醒设置」里的**推送间隔**是两回事：
 *     tick = 跑批多久看一次（决定"到点后最迟晚多久发"）；
 *     间隔 = 同一单两次提醒之间至少隔多久（页面里配，默认 24h）。
 *     要让"每 4 小时催一次"准点，tick 必须明显小于 4 小时（比如 10~30 分钟）。
 */
const remindMin = config.reminder.intervalMin
if (remindMin > 0) {
  const sending = config.reminder.send
  const tick = async () => {
    try {
      // 触发来源记 'timer'：执行日志里要能分清"定时器跑的"与"cron / 页面手动打的"
      const report = await runReminderBatch(!sending, undefined, 'timer')
      // 被规则挡掉时单独说一句：否则"记了几行日志但什么都没动"会被误读成没有超时单
      if (report.gate) {
        console.log(`[Reminders] 本轮按推送规则跳过：${report.gate}`)
        return
      }
      console.log(`[Reminders] 跑批：扫描 ${report.scanned}，应提醒 ${report.due}，已发 ${report.sent}`
        + `（推送间隔 ${report.intervalHours}h）`
        + `${report.skippedInterval ? `，间隔未到跳过 ${report.skippedInterval}` : ''}`
        + `${report.errors.length > 0 ? `，错误 ${report.errors.length}` : ''}`)
    } catch (error: any) {
      console.warn('[Reminders] 跑批失败:', error?.message ?? error)
    }
  }
  setInterval(tick, remindMin * 60_000)
  console.log(`[Reminders] 已启用定时跑批：每 ${remindMin} 分钟（真发消息：${sending ? '是' : '否，dry-run'}）`)
}

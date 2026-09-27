import type { ApprovalAttachment, ApprovalChain, ApprovalFlow, ApprovalModal, ApprovalOrder, FlowGraph } from '@/types/approval'
import pb from '@/pocketbase.ts'
// 只要类型：组别→默认审批人的"覆盖记录"形状（合并口径见 utils/groupApprovers）
import type { GroupApproverOverride } from '@/utils/groupApprovers'
import { APPROVAL_STATUS, buildBranchTerminalMap, rebuildChain } from '@/types/approval'
import { sendArrivedNotifies } from '@/utils/notifySteps'

export interface DocumentModel {
  collectionId: string
  collectionName: string
  content: string
  created: string
  id: string
  published: boolean
  updated: string
}

export async function register (email: string, password: string) {
  const body = {
    email,
    emailVisibility: true,
    password,
    passwordConfirm: password,
  }
  try {
    const res = await pb.collection('users').create(body)
    // await pb.collection('users').authWithPassword(email, password)
    console.log('注册成功', res)
    return res
  } catch (error) {
    console.error('注册失败', error)
    return error
  }
}

// 获取文档
export async function getDocument (): Promise<DocumentModel | undefined> {
  try {
    const res = await pb.collection('document').getList<DocumentModel>(1, 1, {
      filter: '',
    })
    return res.items[0]
  } catch (error) {
    console.error(error)
    return undefined
  }
}

// 获取单条文档
export async function getDocumentByOne (id: string): Promise<DocumentModel | undefined> {
  try {
    const res = await pb.collection('document').getOne<DocumentModel>(id)
    return res
  } catch (error) {
    console.error(error)
    return undefined
  }
}

// 保存文档
export async function saveDocument (content: any, id: string, published: boolean) {
  console.log('saveDocument', content, id, published)
  try {
    const res = await pb.collection('document').update<DocumentModel>(id, {
      content,
      published,
    })
    console.log('保存文档成功', res)
    return res
  } catch (error) {
    console.error('保存文档失败', error)
    return error
  }
}

// 更新文档
export async function updateDocument () {}

// 删除文档
export async function deleteDocument () {}

// 增加审批流
// chain.flow 为带条件分支的完整结构（可选）；chain.chain 为拍平后的线性链路，供旧页面兼容渲染；
// chain.graph 为 Vue Flow 画布快照（节点/连线/视口），用于编辑时原样还原画布
export async function addApproval (name: string, status: number, chain: { chain: ApprovalChain, flow?: ApprovalFlow, graph?: FlowGraph }) {
  try {
    const res = await pb.collection('app_chain').create({
      name,
      status,
      chain,
    })
    console.log('增加审批流成功', res)
    return res
  } catch (error: any) {
    // err.data 是 PocketBase 返回的字段级校验详情（如必填、类型、唯一冲突）
    console.error('增加审批流失败:', error.response?.data ?? error.data ?? error)
    return error
  }
}

export async function createApprocalModel (
  data: NonNullable<ApprovalOrder['chain']>,
  opts: { relation?: string, syncKey?: string } = {},
) {
  const order_no = `${Date.now()}`
  try {
    const res = await pb.collection('approval_chain').create<ApprovalOrder>({
      order_no,
      // 新单必然是「进行中」，终态由 rebuildChain 的 outcome 在办理时写入
      status: APPROVAL_STATUS.PENDING,
      chain: data,
      ...(opts.relation ? { relation: opts.relation } : {}),
      ...(opts.syncKey ? { sync_key: opts.syncKey } : {}),
    })
    if (opts.syncKey && !res.sync_key) {
      console.warn(
        '[createApprocalModel] sync_key 没有落库：多半是 PB 还没应用 1789660200 迁移'
        + '（加 sync_key 那一版），重启 PB 后新建的单才会带上兜底键。',
      )
    }
    await notifyOnCreate(data, res)
    return res
  } catch (error: any) {
    console.error('增加审批流失败:', error.response?.data ?? error.data ?? error)
    return error
  }
}

/**
 * 「建单即发」：流程**开头**就是「飞书提醒」环时，到达发生在建单这一刻，而不是第一次办理。
 *
 * 为什么放在这一层，而不是各调用方的页面里：
 * 这里是**所有建单路径的唯一入口**（workspace 批量建单、utils 的演示建单都走它）。
 * 写在页面里迟早会有一条路径漏掉，而"漏发通知"是**静默失败** —— 最难发现的那种。
 *
 * 为什么失败只打日志、不往外抛：
 * 单子已经建好了。这里抛出去会被下面的 catch 当成"建单失败"返回给调用方，
 * 调用方可能据此重试，反而建出重复单。通知发不出去 ≠ 单子没建成。
 */
async function notifyOnCreate (
  data: NonNullable<ApprovalOrder['chain']>,
  order: ApprovalOrder,
): Promise<void> {
  const flow = data.flow
  if (!flow?.length) {
    return
  }
  try {
    const context = data.context ?? {}
    // 建单后的初始链路：还没有任何办理流水，所以只能走到第一个待办环节为止。
    // 开头的提醒环都在这段里 —— 正是要补发的那批。
    const initial = rebuildChain(
      flow,
      data.decisions ?? [],
      buildBranchTerminalMap(data.graph),
      context,
    )
    const res = await sendArrivedNotifies({
      flow,
      before: [], // 建单前什么都没到达过
      after: initial.stepIds,
      orderNo: order.order_no,
      context,
    })
    if (res.failed.length > 0) {
      console.warn('[createApprocalModel] 建单提醒未全部发出:', res.failed.join('；'))
    }
  } catch (error) {
    console.warn('[createApprocalModel] 建单提醒异常（不影响建单）:', error)
  }
}

/**
 * 按「数据行」反查审批单：`relation = <记录 id>` **或** `sync_key = <业务键>`。
 *
 * 这是关联的另一半（写入侧见上面的 createApprocalModel）：
 *   - `relation` 在库里就是目标记录的 id，可以直接当普通字段等值过滤，不需要 expand；
 *   - 但 id 会因 bi_rows 重写而失效，所以再叠一个 sync_key 条件 ——
 *     两个条件用 `||` 连，命中任一个都算「这条数据的单」。
 *   反查同时覆盖两者，是为了让「id 变了之后仍能找到旧单」这件事自动成立，
 *   而不是等出问题再回来补。
 *
 * ⚠️ 失败时**抛错**而不是返回 []：调用方需要区分「没有单」和「查不出来」——
 * 都返回 [] 的话，一次网络抖动就会被当成「没有单」，于是又建一张重复的单。
 * 用 pb.filter 拼条件而不是字符串相加：id / SKU 里出现引号时手拼会把过滤表达式写坏
 * （实测 pb.filter 会把单引号转义成 \'，而单引号正是 PB 过滤表达式的字符串分隔符）。
 */
export async function getOrdersByRow (biRowId: string, syncKey?: string): Promise<ApprovalOrder[]> {
  const conds = [pb.filter('relation = {:id}', { id: biRowId })]
  if (syncKey) {
    conds.push(pb.filter('sync_key = {:key}', { key: syncKey }))
  }
  const res = await pb.collection('approval_chain').getList<ApprovalOrder>(1, 50, {
    filter: conds.join(' || '),
    sort: '-created',
  })
  return res.items
}

/** 每个分块里最多放多少个条件（每行贡献 1~2 个，见下） */
const ORDER_FILTER_CHUNK = 120

/**
 * **批量**按数据行反查审批单（列表页一页 20~200 行，逐行查就是几十个请求）。
 *
 * 关联口径与 getOrdersByRow 完全一致（`relation = 记录 id` **或** `sync_key = 业务键`），
 * 只是把多行的条件用 `||` 拼进**一个** filter。条件串太长会被 PB / 反向代理拒掉，
 * 所以按 ORDER_FILTER_CHUNK 分块发、再合并。
 *
 * ⚠️ 失败时抛错（与 getOrdersByRow 同样理由，见上面的说明）。
 * 返回的是**全部匹配的单**（同一行可能有多张：历史单 + 当前单），由调用方决定取哪张 ——
 * 这里不做「取最新」的裁剪，否则「进行中优先」这类规则就没法实现了。
 */
export async function getOrdersByRows (
  rows: Array<{ id: string, syncKey?: string }>,
): Promise<ApprovalOrder[]> {
  const conds: string[] = []
  for (const row of rows) {
    if (row.id) {
      conds.push(pb.filter('relation = {:id}', { id: row.id }))
    }
    if (row.syncKey) {
      conds.push(pb.filter('sync_key = {:key}', { key: row.syncKey }))
    }
  }
  if (conds.length === 0) {
    return []
  }

  const out: ApprovalOrder[] = []
  const seen = new Set<string>()
  for (let i = 0; i < conds.length; i += ORDER_FILTER_CHUNK) {
    const items = await pb.collection('approval_chain').getFullList<ApprovalOrder>({
      filter: conds.slice(i, i + ORDER_FILTER_CHUNK).join(' || '),
      sort: '-created',
    })
    // 分块之间可能重复命中（同一张单的 relation 在块 1、sync_key 在块 2），按单 id 去重
    for (const item of items) {
      if (seen.has(item.id)) {
        continue
      }
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

/**
 * 取审批流**模板**列表（app_chain）。
 *
 * ⚠️ 别和 getApprovalOrder 搞混：这里是**模板**（app_chain），那边是**审批单**（approval_chain）。
 *   模板上没有 relation 字段，所以这里没有也不该有 expand —— 之前这里被改成读
 *   approval_chain 并写 `expand: 'bi_rows'`，结果是「模板管理页」列出审批单、
 *   且 expand 因为参数不是字段名而被 PB 静默忽略。
 */
export async function getApproval (): Promise<ApprovalModal[]> {
  try {
    const res = await pb.collection('app_chain').getList<ApprovalModal>(1, 10, {
      filter: '',
    })
    return res.items
  } catch (error) {
    console.error(error)
    return []
  }
}

// 获取单条审批流数据（按 id）
export async function getApprovalOne (id: string): Promise<ApprovalModal | undefined> {
  try {
    const res = await pb.collection('app_chain').getOne<ApprovalModal>(id)
    console.log('获取单条审批流成功', res)
    return res
  } catch (error) {
    console.error(error)
    return undefined
  }
}
// 更新审批流模板
export async function updateApprovalModel (id: string, data: Partial<ApprovalModal>): Promise<ApprovalModal | undefined> {
  try {
    const res = await pb.collection('app_chain').update<ApprovalModal>(id, data)
    return res
  } catch (error) {
    console.error(error)
    return undefined
  }
}

// 获取单条审批流模板（按字段过滤，取第一条）
export async function getApprovalFirstByFilter (filter: string): Promise<ApprovalModal | undefined> {
  try {
    const res = await pb.collection('app_chain').getFirstListItem<ApprovalModal>(filter)
    console.log('获取单条审批流成功', res)
    return res
  } catch (error) {
    console.error(error)
    return undefined
  }
}

// 获取一条产品数据
export async function getProduct () {
  try {
    const res = await pb.collection('bi_rows').getList(1, 1, {})
    console.log('获取单条产品成功', res)
    return res
  } catch (error) {
    console.error(error)
    return undefined
  }
}

// 删除审批流模板
export async function deleteApproval (id: string) {
  try {
    const res = await pb.collection('app_chain').delete(id)
    console.log('删除审批流模板成功', res)
    return {
      code: 0,
      message: '删除审批流模板成功',
    }
  } catch (error) {
    console.error(error)
    return {
      code: -1,
      message: '删除审批流模板失败',
    }
  }
}

/**
 * 取审批订单数据，并把**关联的 bi_rows 数据**一起带回来。
 *
 * `expand` 必须写**字段名**（relation），不能写目标集合名（bi_rows）：
 * 写错 PB 不报错、直接忽略，返回里连 expand 字段都没有 —— 很难察觉。
 *
 * ⚠️ expand 会**遵守目标集合的 viewRule**：`bi_rows.viewRule` 要求已登录，
 * 所以未登录时即使字段名写对了，`expand.relation` 也是空的（实测 `expand: {}`）。
 * 页面在登录态下调用，不受影响。
 */
export async function getApprovalOrder (): Promise<ApprovalOrder[]> {
  try {
    // 取全量而不是前 10 条：首页表格是**前端分页**，分页器的页数要按总条数算，
    // 只取 10 条会让页数永远只有 1 页、第 2 页之后就看不到任何单。
    // 审批单的数量级很小（每条一行、json 里带流程快照），一次取回没有压力。
    return await pb.collection('approval_chain').getFullList<ApprovalOrder>({
      filter: '',
      expand: 'relation',
      sort: '-created',
    })
  } catch (error) {
    console.error(error)
    return []
  }
}

/**
 * 按审批单号取一单 —— 首页「前往审批」跳转用。
 *
 * 为什么不能靠 getApprovalOrder 的第 N 条：跳转带的是 order_no，而列表顺序会随着
 * 新单插入而变，位置检索必然指错。查不到（单号不存在）时返回 undefined，交给调用方兜底。
 */
export async function getApprovalOrderByNo (orderNo: string): Promise<ApprovalOrder | undefined> {
  try {
    return await pb.collection('approval_chain').getFirstListItem<ApprovalOrder>(
      pb.filter('order_no = {:no}', { no: orderNo }),
      { expand: 'relation' },
    )
  } catch (error) {
    console.error('按单号查审批单失败:', error)
    return undefined
  }
}

/**
 * 更新审批订单。
 * 主要用于把各环节的办理信息（结论、意见、附件）回填到 chain 字段。
 */
export async function updateApprovalOrder (id: string, data: Partial<ApprovalOrder>) {
  try {
    const res = await pb.collection('approval_chain').update<ApprovalOrder>(id, data)
    console.log('更新审批订单成功', id)
    return res
  } catch (error) {
    console.error('更新审批订单失败:', error)
    throw error
  }
}

/**
 * 上传审批环节附件。
 *
 * approval_chain 集合没有 file 字段，附件单独存在 approval_files 集合，
 * chain 里只保存 { id, name, url } 引用，避免 json 字段被文件撑爆。
 */
export async function uploadApprovalFile (
  orderId: string,
  stepIndex: number,
  file: File,
): Promise<ApprovalAttachment> {
  const form = new FormData()
  form.append('order_id', orderId)
  form.append('step_index', String(stepIndex))
  form.append('file', file, file.name)

  const record = await pb.collection('approval_files').create<{ id: string, file: string }>(form)
  return {
    id: record.id,
    name: file.name,
    url: pb.files.getURL(record, record.file),
  }
}

// 获取用户列表
// PocketBase 记录默认是弱类型 RecordModel，必须用 getList<T>() 显式指定业务类型，
// 否则 res.items 是 RecordModel[]，无法赋给调用方的 UserInfo[]。
export interface UserInfo {
  id: string
  // 业务字段可能为空，PocketBase 不会返回未填写的字段，因此标记为可选
  avatar_url?: string
  created: string
  email: string
  name?: string
  role?: string
}
export async function getUserInfo (page = 1, perPage = 50): Promise<UserInfo[]> {
  try {
    const res = await pb.collection('users').getList<UserInfo>(page, perPage, {
      fields: 'id,avatar_url,created,email,name,role,department,department_path,tenant_key',
    })
    console.log('获取用户信息成功', res.items.length, '条')
    return res.items
  } catch (error) {
    console.error('获取用户信息失败:', error)
    // 列表接口失败时返回空数组，保证调用方拿到的类型稳定为 UserInfo[]
    return []
  }
}
// 更新用户权限
export async function updateUserRole (id: string, role: string) {
  try {
    const res = await pb.collection('users').update(id, {
      role,
    })
    return res
  } catch (error) {
    console.error('获取用户信息失败:', error)
    // 列表接口失败时返回空数组，保证调用方拿到的类型稳定为 UserInfo[]
    return []
  }
}

/* ==================== 组别默认审批人（覆盖值） ==================== */

/**
 * 组别 → 默认审批人 的**覆盖值**：只存"在角色设置里通过通讯录换过的人"。
 * 默认值维护在 `utils/organazation.ts`，两者的合并口径见 `utils/groupApprovers`。
 */
const GROUP_APPROVER_COLLECTION = 'group_approvers'

/**
 * PB 记录 = 业务字段 + 记录 id。
 * 读回来才有 id（update / delete 要靠它定位），写进去时不需要 —— 所以分成两个类型，
 * 避免让"写"的调用方也得编一个 id 出来。
 */
type GroupApproverRecord = GroupApproverOverride & { id: string }

/**
 * 读全部覆盖记录（按组别名排序）。
 *
 * ⚠️ 失败时返回**空数组**而不是抛错：集合可能还没建（PB 没应用 1789700000 迁移），
 * 那种情况下页面应当照常显示文件里的默认值，而不是整页报错。
 */
export async function getGroupApproverOverrides (): Promise<GroupApproverOverride[]> {
  try {
    return await pb
      .collection(GROUP_APPROVER_COLLECTION)
      .getFullList<GroupApproverRecord>({ sort: 'group' })
  } catch (error) {
    console.warn('[groupApprovers] 读取覆盖记录失败（多半是还没应用迁移）:', error)
    return []
  }
}

/**
 * 写入某组别的审批人（同组 upsert）。
 *
 * 为什么先查再写、而不是直接 create 靠唯一索引兜底：那样第二次改同一组会直接报错，
 * 而且错误信息对用户没有意义；先拿到 id 才能"改"它。记录数不增长 —— 同组始终一条。
 *
 * 失败**向上抛**（与读取相反）：这是"改数据"的动作，静默失败会让用户以为改好了。
 */
export async function saveGroupApprover (row: {
  group: string
  parent?: string
  manager: string
  manager_email?: string
  manager_avatar?: string
  manager_department?: string
  manager_department_path?: string
}): Promise<GroupApproverOverride> {
  const existing = await pb
    .collection(GROUP_APPROVER_COLLECTION)
    .getFirstListItem<GroupApproverRecord>(pb.filter('group = {:g}', { g: row.group }))
    .catch(() => null)

  return existing
    ? await pb.collection(GROUP_APPROVER_COLLECTION).update<GroupApproverOverride>(existing.id, { ...row })
    : await pb.collection(GROUP_APPROVER_COLLECTION).create<GroupApproverOverride>({ ...row })
}

/** 恢复默认：删掉该组别的覆盖记录（本来就没有则什么都不做） */
export async function deleteGroupApproverOverride (group: string): Promise<void> {
  const existing = await pb
    .collection(GROUP_APPROVER_COLLECTION)
    .getFirstListItem<GroupApproverRecord>(pb.filter('group = {:g}', { g: group }))
    .catch(() => null)

  if (existing) {
    await pb.collection(GROUP_APPROVER_COLLECTION).delete(existing.id)
  }
}

import type { ApprovalAttachment, ApprovalChain, ApprovalFlow, ApprovalModal, ApprovalOrder, FlowGraph } from '@/types/approval'
// 只要类型：团队/部门 → 默认审批人的"覆盖记录"形状（合并口径见 utils/groupApprovers）
import type { DeptApproverOverride, GroupApproverOverride } from '@/utils/groupApprovers'
import type { WarehouseRow } from '@/utils/warehouse'
import pb from '@/pocketbase.ts'
import { APPROVAL_STATUS, branchTerminalMapOf, rebuildChain } from '@/types/approval'
import { sendArrivedNotifies } from '@/utils/notifySteps'
/*
 * 清单请求的请求键：本文件好几处读的是**同一张表的不同用途**，不给键的话会互相取消
 * （默认键不含查询串，见 pbRequestKeys 的文件头）。
 */
import { PB_REQUEST_KEY } from '@/utils/pbRequestKeys'
// 「引用模板」的引用关系收集（纯逻辑，只依赖类型）：删除模板前查"有没有别的模板引用了它"
import { collectTemplateRefs } from '@/utils/templateRef'
// 仓库清单的取舍口径是纯逻辑（PB 有记录就全用它，否则回落默认值），放在 utils/warehouse 里
import { normalizeWarehouses, resolveWarehouses, warehouseKey } from '@/utils/warehouse'

export interface DocumentModel {
  collectionId: string
  title: string
  subscribe: string
  collectionName: string
  content: string
  created: string
  id: string
  /**
   * **发布标记：1 = 已发布，0 = 未发布**（前端"列表只显示已发布的"认的就是它）。
   * 见 utils/collection 的 getDocument 与 pocketbase/pb_migrations/1791000000_created_document.js。
   */
  status?: number
  /**
   * 脚手架时代留下的旧标记：口径已改看 `status`，这里只是保持同步
   * （发布时顺手写 true），别再拿它当判断依据。
   */
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

/**
 * 获取文档列表 —— **只返回已发布（`status = 1`）的那些**。
 *
 * 「0 状态的文章不在前端显示」这条口径放在这里，而不是放在页面里：
 * 列表页（knowledge）与详情页的无 id 回退（logic）都走这个函数，两处各写一遍 filter
 * 迟早会漏一处（与 utils/exitTargets 那次"两份口径"是同一个教训）。
 *
 * ⚠️ 用的是 **`status`**（number：1 = 已发布 / 0 = 未发布），不是脚手架留下的 `published`(bool)。
 * 「发布」时两个字段都会写（见 publishDocument），但**判断只认 status**；
 * `status` 不是 1（含老数据里没配过的 0）就不显示 —— 发布过才会出现在列表里。
 *
 * 草稿仍然打得开：编辑页按 id 走 `getDocumentByOne`，那里**不过滤** ——
 * 没发布的文档本来就该能继续编辑。
 *
 * ⚠️ 原来是 `getList(1, 10)`（只取前 10 条），文档攒到第 11 篇就会静默消失；
 * 文档量级是几十，改成全量取（与 getApprovalOptions 同一处理）。
 */
export async function getDocument (): Promise<DocumentModel[] | []> {
  try {
    const res = await pb.collection('document').getFullList<DocumentModel>({
      filter: 'status = 1',
    })
    return res
  } catch (error) {
    console.error('[collection] 读文档列表失败:', error)
    return []
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

/**
 * 保存文档正文（编辑器里按 Ctrl+S 走这里）。
 *
 * 只写 `content` 与 `published`：**不碰** `title` / `subscribe` / `status` ——
 * 那几项归 `publishDocument` 管；保存顺手覆盖，会把刚发布时写进去的信息改掉。
 *
 * 返回口径同 `publishDocument` / `deleteApproval`（`{ code, message }`）：**失败要能让人看见**。
 * ⚠️ 原来这里是 catch 后 `return error`，而调用方不看返回值 —— 于是「保存失败」照样弹「已保存!」。
 * 新增的文档（还没落库、没有 id）与网络抖动都会走到这里，属于最典型的静默失败。
 * 调用方（pages/editRule 的 onSave）**必须**按 `code` 决定提示文案。
 */
export async function saveDocument (content: string, id: string, published: boolean) {
  if (!id) {
    console.warn('[collection] saveDocument 缺少文档 id（多半是新增的文档还没落库）')
    return {
      code: -1,
      message: '这篇文档还没有保存过（没有可写入的记录）：请从列表页进入已有文档再改',
    }
  }
  try {
    await pb.collection('document').update<DocumentModel>(id, {
      content,
      published,
    })
    console.log('保存文档成功', id)
    return {
      code: 0,
      message: '文档已保存',
    }
  } catch (error) {
    console.error('[collection] 保存文档失败:', error)
    return {
      code: -1,
      message: '保存失败，请稍后重试',
    }
  }
}

// 更新文档
export async function updateDocument () {}

/**
 * 发布一篇文档：写入**标题 + 简略信息**，并把 `status` 置为 **1**（= 已发布）。
 *
 * 三项一起写是有原因的：文档列表（pages/knowledge.vue）卡片上显示的**就是** `title` + `subscribe`，
 * 只置标记不写这两项，列表里就会出现"没名字的卡片"（发布弹窗也正因此要求必填）。
 *
 * 标记认 `status`（number）；旧字段 `published`(bool) 顺手写成 true，免得两个字段各说各话 ——
 * 判断口径**只认 status**（见 getDocument 的 filter）。
 *
 * 与 `saveDocument`（正文 + 保留发布状态）**分开**：发布**不碰正文** ——
 * 正文以编辑器里的「保存」为准；合在一起会让"发布"顺手覆盖掉别人正在改的内容。
 *
 * 返回口径同 `deleteApproval`（`{ code, message }`）：失败要能让人看见。
 * ⚠️ 调用方成功后**必须**同步本地那份文档：编辑页按 Ctrl+S 时 `onSave`
 * 会把 `data.published` 一起写回去，不同步就会把刚发布的标记又改回未发布。
 */
export async function publishDocument (
  id: string,
  meta: { title: string, subscribe: string },
) {
  try {
    const res = await pb.collection('document').update<DocumentModel>(id, {
      title: String(meta?.title ?? '').trim(),
      subscribe: String(meta?.subscribe ?? '').trim(),
      status: 1,
      published: true,
    })
    console.log('发布文档成功', id)
    return {
      code: 0,
      message: '文档已发布',
      data: res,
    }
  } catch (error) {
    console.error('[collection] 发布文档失败:', error)
    return {
      code: -1,
      message: '发布失败，请稍后重试',
    }
  }
}

/**
 * 删除文档（说明文档页的「删除」按钮用）。
 *
 * 与 `deleteApproval` 同一套返回口径（`{ code, message }`）而不是抛错：
 * 调用方（页面）据此决定提示文案 —— 删除失败必须让人看见，不能静默当成删成功
 * （页面会照旧刷列表，看起来"没删掉"却不知道为什么）。
 */
export async function deleteDocument (id: string) {
  try {
    await pb.collection('document').delete(id)
    console.log('删除文档成功', id)
    return {
      code: 0,
      message: '删除文档成功',
    }
  } catch (error) {
    console.error('[collection] 删除文档失败:', error)
    return {
      code: -1,
      message: '删除文档失败，请稍后重试',
    }
  }
}

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
  /*
   * 建单人：「我的审批单」页「我发起的」那一栏靠它区分（见 utils/approvalRuntime 的 orderCreatedBy）。
   * 取登录者自己的 id，没登录（脚本 / 演示建单）就不写 —— 那时这张单不属于任何人，符合预期。
   */
  const creator = pb.authStore.record?.id
  try {
    const res = await pb.collection('approval_chain').create<ApprovalOrder>({
      order_no,
      // 新单必然是「进行中」，终态由 rebuildChain 的 outcome 在办理时写入
      status: APPROVAL_STATUS.PENDING,
      chain: data,
      ...(opts.relation ? { relation: opts.relation } : {}),
      ...(opts.syncKey ? { sync_key: opts.syncKey } : {}),
      ...(creator ? { creator } : {}),
    })
    if (opts.syncKey && !res.sync_key) {
      console.warn(
        '[createApprocalModel] sync_key 没有落库：多半是 PB 还没应用 1789660200 迁移'
        + '（加 sync_key 那一版），重启 PB 后新建的单才会带上兜底键。',
      )
    }
    if (creator && !res.creator) {
      console.warn(
        '[createApprocalModel] creator 没有落库：多半是 PB 还没应用 1789800000 迁移'
        + '（加 creator 那一版），重启 PB 后新建的单才能进「我发起的」。',
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
      branchTerminalMapOf(data),
      context,
    )
    const res = await sendArrivedNotifies({
      flow,
      before: [], // 建单前什么都没到达过
      after: initial.stepIds,
      // 链路一起带上：审批环节的到达通知要据此取「上一轮审批信息」（建单时通常没有第一行）
      afterChain: initial.chain,
      orderNo: order.order_no,
      context,
    })
    if (res.failed.length > 0) {
      console.warn('[createApprocalModel] 建单提醒未全部发出:', res.failed.join('；'))
    }
    // 测试期闸门跳过的那些也留个痕（见 utils/notifyGate）；闸门关掉后这里恒为空
    if (res.skipped.length > 0) {
      console.info('[createApprocalModel] 建单提醒按测试闸门跳过:', res.skipped.join('；'))
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
    requestKey: PB_REQUEST_KEY.orderByRow,
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
    // 分块之间是 await 串行的，共用同一个键不会自我取消（见 pbRequestKeys 的口径）
    const items = await pb.collection('approval_chain').getFullList<ApprovalOrder>({
      filter: conds.slice(i, i + ORDER_FILTER_CHUNK).join(' || '),
      sort: '-created',
      requestKey: PB_REQUEST_KEY.orderByRows,
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
 * 按任务状态筛数据行时，**允许拼进 filter 的值个数上限**。
 *
 * 为什么是一条硬线而不是"尽量多塞"：filter 是走 URL 的（PB 的 getList 用 GET），
 * 值一多就会撞上 PB 或反向代理的请求行长度限制，而那时的表现是"一筛选就查不出数据"
 * —— 排查的人会去怀疑筛选逻辑，不会想到是 URL 太长。所以宁可提前报错。
 *
 * 160 个值 ≈ 80 张单 ≈ 5.8KB 的 filter（实测每值约 37 字符），
 * 离 nginx 默认的 8KB 请求行上限留了一点余量 —— 但不能更宽了。
 */
export const MAX_STATUS_FILTER_VALUES = 160

/**
 * 取审批单关联的**数据行键**（`relation` + `sync_key`）—— 「工作台」按任务状态筛数据行用。
 *
 * ## 为什么需要它
 *
 * 「任务状态」是页面按行关联 `approval_chain` **算出来**的（见 workStream 的 loadTaskStatus），
 * `bi_rows` 里没有这一列。所以"按状态筛数据行"只能反过来查：先拿到相关单的关联键，
 * 再拼成 bi_rows 的查询条件（见 utils/biQuery 的 matchAny / matchNone）。
 *
 * ## 口径必须与 getOrdersByRows 一致
 *
 * 同样返回 `relation` **和** `sync_key`（id 会因 bi_rows 重写而失效，所以要叠业务键）。
 * 不一致的后果很难查：状态列写着「进行中」，按「进行中」筛却筛不出来。
 *
 * ## 一次取全量，不按状态分四次查
 *
 * 单据是几十~几百的量级（bi_rows 是 8000+），一次拉回来由调用方分组更省事，
 * 也少一个"状态常量传错"的机会。
 */
export interface OrderRowKey {
  /** approval_chain.status（0 进行中 / 1 已通过 / 2 已驳回，见 types/approval 的 APPROVAL_STATUS） */
  status: number
  /** 关联的 bi_rows 记录 id（可能已因 BI 重写而失效，所以只当兜底） */
  relation: string
  syncKey: string
}

/** 一次最多拉多少张单：超过就不再往下走（拉回来也拼不进 filter，见 MAX_STATUS_FILTER_VALUES） */
const MAX_ORDER_KEYS_SCAN = 2000

export async function getOrderRowKeys (): Promise<OrderRowKey[]> {
  const items = await pb.collection('approval_chain').getFullList<{
    status?: number
    relation?: string
    sync_key?: string
  }>({
    fields: 'status,relation,sync_key',
    // 多的那些注定用不了，先按时间倒序取一批 —— 历史单排在后面，反正也塞不进 filter
    sort: '-created',
    requestKey: PB_REQUEST_KEY.orderRowKeys,
  })

  if (items.length > MAX_ORDER_KEYS_SCAN) {
    throw new Error(
      `审批单超过 ${MAX_ORDER_KEYS_SCAN} 张，已无法可靠地按任务状态筛选（当前 ${items.length} 张）`,
    )
  }

  return items.map(it => ({
    status: Number(it.status ?? 0),
    relation: String(it.relation ?? ''),
    syncKey: String(it.sync_key ?? ''),
  }))
}

/**
 * 把一组单摊成 `{ column: values }` 形式的关联键条件。
 *
 * `column` 固定两个（`id` / `sync_key`）—— 调用方不用自己记列名，
 * 但为什么是这两列写在 getOrderRowKeys 的说明里。
 *
 * 空值一律丢掉：`sync_key` 为空的单（历史数据）如果拼成 `sync_key = ""`，
 * 会变成"匹配所有 sync_key 为空的行"—— 那是完全错误的一批数据。
 */
export function orderKeyGroups (
  orders: OrderRowKey[],
): Array<{ column: string, values: string[] }> {
  const ids: string[] = []
  const keys: string[] = []
  for (const o of orders) {
    if (o.relation) {
      ids.push(o.relation)
    }
    if (o.syncKey) {
      keys.push(o.syncKey)
    }
  }
  return [
    { column: 'id', values: [...new Set(ids)] },
    { column: 'sync_key', values: [...new Set(keys)] },
  ]
}

/** 一组关联键条件里总共有多少个值（用于和 MAX_STATUS_FILTER_VALUES 比） */
export function orderKeyGroupCount (groups: Array<{ values: string[] }>): number {
  return groups.reduce((n, g) => n + g.values.length, 0)
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
    /*
     * 取**全量**（按名字排）：模板管理页要把「正本 / 副本」分到两个页签里，
     * 只取前 10 条会让页签里的数字和内容都不对（副本可能一条都看不见）。
     * 模板是几十条的量级，与 getApprovalOptions 同一取舍 —— 那边也要选到任意一张。
     */
    return await pb.collection('app_chain').getFullList<ApprovalModal>({
      sort: 'name',
      requestKey: PB_REQUEST_KEY.chainList,
    })
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
    const res = await pb.collection('bi_rows').getList(1, 1, { requestKey: PB_REQUEST_KEY.biRowsOne })
    console.log('获取单条产品成功', res)
    return res
  } catch (error) {
    console.error(error)
    return undefined
  }
}

/**
 * 读「引用模板」的**源模板流程**（建单期用，见 utils/templateRef）。
 *
 * ⚠️ 读不到（被删 / id 写错）返回 `null`，**不抛错**：调用方会把它变成
 * "这一条建单失败，并报出是哪张卡片" —— 与"静默少一段流程"相比，当场失败才是安全的那一边。
 *
 * 只返回 `flow`、不返回 `graph`：引用搬的是**流程**（画布只用于编辑器还原）。
 */
export async function getTemplateFlowForRef (
  templateId: string,
): Promise<{ id: string, name?: string, flow: ApprovalFlow } | null> {
  try {
    const rec = await pb.collection('app_chain').getOne<ApprovalModal>(templateId)
    const flow = rec?.chain?.flow
    if (!flow?.length) {
      console.warn('[templateRef] 源模板没有流程（或流程为空）:', templateId)
      return null
    }
    return { id: rec.id, name: rec.name, flow }
  } catch (error) {
    console.warn('[templateRef] 读取源模板失败:', templateId, error)
    return null
  }
}

/**
 * 取全部模板的**精简列表**（编辑器里给「引用模板」卡片选源模板用）。
 *
 * 与 `getApproval` 的区别：那个只取 10 条（模板管理页第一页够用），
 * 这里要能选到**任意**一张模板，所以取全量并按名字排（模板数量级是几十，没有负担）。
 * 读失败返回空数组 —— 编辑器据此显示"没有可选模板"，而不是把页面搞崩。
 */
export async function getApprovalOptions (): Promise<{ id: string, name: string, status: number }[]> {
  try {
    const res = await pb.collection('app_chain').getFullList<ApprovalModal>({
      sort: 'name',
      requestKey: PB_REQUEST_KEY.chainOptions,
    })
    return res.map(r => ({ id: r.id, name: String(r.name ?? ''), status: Number(r.status ?? 0) }))
  } catch (error) {
    console.error('[collection] 读取模板列表失败:', error)
    return []
  }
}

/**
 * 找出**引用了**指定模板的那些模板（删除前的安全检查）。
 *
 * 为什么删除前要查：模板之间按 id 引用，删掉被引用的那张，引用它的模板会在
 * **下一次建单时**才失败 —— 那时痛点已经从"改配置"变成"单据建不出来"。
 * 现查一遍（几十条模板、纯内存匹配）比维护一张引用计数表更简单，也不会失真。
 */
export async function findTemplatesUsing (templateId: string): Promise<{ id: string, name: string }[]> {
  try {
    const list = await pb.collection('app_chain').getFullList<ApprovalModal>({
      requestKey: PB_REQUEST_KEY.chainRefs,
    })
    return list
      .filter(rec => rec.id !== templateId)
      .filter(rec => collectTemplateRefs(rec.chain?.flow).some(u => u.refTemplateId === templateId))
      .map(rec => ({ id: rec.id, name: String(rec.name ?? '') }))
  } catch (error) {
    console.error('[collection] 查引用关系失败:', error)
    return []
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
      requestKey: PB_REQUEST_KEY.orderList,
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
/**
 * 取**全部**成员（「角色设置」页那张表）。
 *
 * ⚠️ 必须 `getFullList` 而不是 `getList(page, perPage)`：后者只返回**一页**
 * （原来写死 50 条），第 51 个人之后直接看不见，而且不报错 ——
 * 表现就是"成员列表不全"。getFullList 内部按 batch 自动翻页，一次给全。
 *
 * ⚠️ 能不能读到别人还取决于 users 集合的 `listRule`：PB 给 auth 集合的默认值是
 * `id = @request.auth.id`，那会把结果在**服务端**砍到只剩调用者自己一条
 * （前端给多大的 perPage 都没用）。超级管理员看全部由
 * pb_migrations/1792108800_updated_users_rules.js 放行。
 */
export async function getUserInfo (): Promise<UserInfo[]> {
  try {
    const res = await pb.collection('users').getFullList<UserInfo>({
      fields: 'id,avatar_url,created,email,name,role,department,department_path,tenant_key',
      requestKey: PB_REQUEST_KEY.usersList,
    })
    console.log('获取用户信息成功', res.length, '条')
    return res
  } catch (error) {
    console.error('获取用户信息失败:', error)
    // 列表接口失败时返回空数组，保证调用方拿到的类型稳定为 UserInfo[]
    return []
  }
}

/**
 * 更新某个用户的角色。
 *
 * ⚠️ 这里**故意不 catch**：调用方（角色设置页）要在成功后刷新列表、失败时给出提示，
 * 吞掉错误会让"改了没生效"变成静默失败 —— 旧实现照抄了上面读函数的 catch，
 * 失败也返回 `[]`，前端根本分辨不出来。
 *
 * 改的不是自己时，需要 users 的 `updateRule` 放行超级管理员
 * （见 pb_migrations/1792108800_updated_users_rules.js），否则 PB 返回 403。
 */
export async function updateUserRole (id: string, role: string) {
  return pb.collection('users').update(id, { role })
}

/* ==================== 组别（团队）默认审批人（覆盖值） ==================== */

/**
 * 组别 → 默认审批人 的**覆盖值**：只存"在角色设置里通过通讯录换过的人"。
 * 默认值维护在 `utils/organazation.ts`，两者的合并口径见 `utils/groupApprovers`。
 *
 * ⚠️ 表名与字段名沿用历史叫法（`group_approvers` / `group`，见迁移 1789700000）：
 * 界面上这一层叫「团队」，但库里不改名 —— 改名要连带迁移与线上数据，不值当。
 */
const GROUP_APPROVER_COLLECTION = 'group_approvers'

/**
 * PB 记录 = 业务字段 + 记录 id。
 * 读回来才有 id（update / delete 要靠它定位），写进去时不需要 —— 所以分成两个类型，
 * 避免让"写"的调用方也得编一个 id 出来。
 */
type GroupApproverRecord = GroupApproverOverride & { id: string }

/**
 * 读全部覆盖记录（按团队名排序）。
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
 * 写入某团队的审批人（同名团队 upsert）。
 *
 * 为什么先查再写、而不是直接 create 靠唯一索引兜底：那样第二次改同一团队会直接报错，
 * 而且错误信息对用户没有意义；先拿到 id 才能"改"它。记录数不增长 —— 同一团队始终一条。
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

/** 恢复默认：删掉该团队的覆盖记录（本来就没有则什么都不做） */
export async function deleteGroupApproverOverride (group: string): Promise<void> {
  const existing = await pb
    .collection(GROUP_APPROVER_COLLECTION)
    .getFirstListItem<GroupApproverRecord>(pb.filter('group = {:g}', { g: group }))
    .catch(() => null)

  if (existing) {
    await pb.collection(GROUP_APPROVER_COLLECTION).delete(existing.id)
  }
}

/* ==================== 部门审批人（覆盖值） ==================== */

/**
 * 部门 → 部门审批人 的**覆盖值**：与上面团队那套同构，只有唯一键不同（`dept`）。
 *
 * 一行一个**部门**（`parent`），同一部门下的团队共用这一个审批人；
 * 默认值仍是 `organazation.ts` 的 `parentManager`（合并口径见 utils/groupApprovers）。
 */
const DEPT_APPROVER_COLLECTION = 'dept_approvers'

type DeptApproverRecord = DeptApproverOverride & { id: string }

/**
 * 读全部部门审批人覆盖记录（按部门名排序）。
 *
 * ⚠️ 失败时返回**空数组**而不是抛错：集合可能还没建（PB 没应用 1792200000 迁移），
 * 那时页面照常显示文件里的默认值，只是换不了人。
 */
export async function getDeptApproverOverrides (): Promise<DeptApproverOverride[]> {
  try {
    return await pb
      .collection(DEPT_APPROVER_COLLECTION)
      .getFullList<DeptApproverRecord>({ sort: 'dept' })
  } catch (error) {
    console.warn('[groupApprovers] 读取部门审批人覆盖记录失败（多半是还没应用 1792200000 迁移）:', error)
    return []
  }
}

/**
 * 写入某部门的审批人（同部门 upsert）。
 *
 * 与 saveGroupApprover 一样先查再写（唯一索引只用来兜底，不靠它报错），
 * 失败**向上抛** —— 这是"改数据"，静默失败会让用户以为改好了。
 */
export async function saveDeptApprover (row: DeptApproverOverride): Promise<DeptApproverOverride> {
  const existing = await pb
    .collection(DEPT_APPROVER_COLLECTION)
    .getFirstListItem<DeptApproverRecord>(pb.filter('dept = {:d}', { d: row.dept }))
    .catch(() => null)

  return existing
    ? await pb.collection(DEPT_APPROVER_COLLECTION).update<DeptApproverOverride>(existing.id, { ...row })
    : await pb.collection(DEPT_APPROVER_COLLECTION).create<DeptApproverOverride>({ ...row })
}

/** 恢复默认：删掉该部门的覆盖记录（本来就没有则什么都不做） */
export async function deleteDeptApproverOverride (dept: string): Promise<void> {
  const existing = await pb
    .collection(DEPT_APPROVER_COLLECTION)
    .getFirstListItem<DeptApproverRecord>(pb.filter('dept = {:d}', { d: dept }))
    .catch(() => null)

  if (existing) {
    await pb.collection(DEPT_APPROVER_COLLECTION).delete(existing.id)
  }
}

/* ==================== 仓库（仓位）清单 ==================== */

/**
 * 在「角色设置 → 仓库设置」里维护的仓库清单。
 *
 * 与「团队 → 默认审批人」的差别：那边是**逐行覆盖**（默认值为主、只换个人），
 * 这里是**整表替换** —— 仓库要能新增、改名、删除，逐行覆盖表达不了"删掉某一项"。
 * 所以口径是：本表有记录就完全以它为准；一条都没有就回落到 `utils/warehouse.ts` 的默认值。
 */
const WAREHOUSE_COLLECTION = 'warehouses'

type WarehouseRecord = WarehouseRow & { id: string }

/**
 * 写失败时的报错：集合不存在（PB 还没应用 1790700000 迁移）是**最常见**的一种，
 * 而 PocketBase 默认只给一句 "The requested resource wasn't found."，对用户毫无指向性。
 * 这里换成"该做什么"，其余错误原样抛出（读那边则相反 —— 回落默认值，见 loadWarehouses）。
 */
function warehouseWriteError (error: unknown): Error {
  if ((error as { status?: number } | null)?.status === 404) {
    const e = new Error('仓库维护表还没建：请重启 PocketBase 以应用迁移 1790700000_created_warehouses')
    // 打个标记：调用方据此决定"把这句话原样给用户看"还是换成通用文案（见 WAREHOUSE_SETUP_ERROR）
    e.name = WAREHOUSE_SETUP_ERROR
    return e
  }
  return error instanceof Error ? error : new Error(String(error))
}

/** 上面那种"环境没准备好"的错误名：界面据此直接展示原因，而不是笼统的"保存失败" */
export const WAREHOUSE_SETUP_ERROR = 'WarehouseSetupError'

export interface WarehouseList {
  /** 本次要用的清单（已清洗、去重、排好序） */
  rows: WarehouseRow[]
  /** true = 用的是维护表里的那份；false = 回落到文件默认（界面据此显示"默认 / 已自定义"） */
  custom: boolean
}

/**
 * 读取本次要用的仓库清单。
 *
 * ⚠️ 与 `getGroupApproverOverrides` 一样，**读失败返回默认值**而不是抛错：
 *    集合可能还没建（PB 没应用 1790700000 迁移），那种情况下界面应当照常显示默认清单。
 */
export async function loadWarehouses (): Promise<WarehouseList> {
  let overrides: WarehouseRow[] = []
  try {
    overrides = await pb
      .collection(WAREHOUSE_COLLECTION)
      .getFullList<WarehouseRecord>({ sort: 'parent,name', requestKey: PB_REQUEST_KEY.warehousesList })
  } catch (error) {
    console.warn('[warehouse] 读取维护表失败（多半是还没应用迁移），先用默认清单:', error)
  }
  return { rows: resolveWarehouses(overrides), custom: overrides.length > 0 }
}

/**
 * 把整份清单写回维护表（**整表对齐**）：表里多的删掉、少的建出来、同键的不动。
 *
 * 为什么不是"逐条 upsert"：改名/换分类都会让身份键变掉，逐条写会留下旧行；
 * 这里先删后建，天然不会撞上唯一索引，也不会残留孤儿行。
 * 失败**向上抛**（与读取相反）：这是"改数据"的动作，静默失败会让用户以为改好了。
 */
export async function saveWarehouses (rows: readonly WarehouseRow[]): Promise<void> {
  // 只用 normalizeWarehouses（不看默认值）：传空数组的语义是"清空"，
  // 若走 resolveWarehouses 会被默认清单又填满（那正是"恢复默认"要的另一件事）
  const want = new Map<string, WarehouseRow>()
  for (const row of normalizeWarehouses(rows)) {
    want.set(warehouseKey(row), row)
  }

  try {
    const existing = await pb.collection(WAREHOUSE_COLLECTION).getFullList<WarehouseRecord>({
      requestKey: PB_REQUEST_KEY.warehousesWrite,
    })

    // 先删：改名/改分类 = 键变了，旧行必须先走，否则后面的 create 会撞唯一索引
    for (const rec of existing) {
      const key = warehouseKey(rec)
      if (!want.has(key)) {
        await pb.collection(WAREHOUSE_COLLECTION).delete(rec.id)
        continue
      }
      want.delete(key) // 已经在表里且内容一致：不动它（避免无意义的写入）
    }

    for (const row of want.values()) {
      await pb.collection(WAREHOUSE_COLLECTION).create({ parent: row.parent, name: row.name })
    }
  } catch (error) {
    throw warehouseWriteError(error)
  }
}

/** 恢复默认：清空维护表（之后 `loadWarehouses` 会回落到 utils/warehouse.ts 的默认清单） */
export async function resetWarehouses (): Promise<void> {
  try {
    const existing = await pb.collection(WAREHOUSE_COLLECTION).getFullList<WarehouseRecord>({
      requestKey: PB_REQUEST_KEY.warehousesReset,
    })
    for (const rec of existing) {
      await pb.collection(WAREHOUSE_COLLECTION).delete(rec.id)
    }
  } catch (error) {
    throw warehouseWriteError(error)
  }
}

/*
 * 飞书推送规则（定时推送 / 推送人员 / 白名单）的读写**不在这里**，在 utils/pushRulesStore ——
 * 到达提醒（utils/notifySteps）也要读白名单，而本文件已经 import 了它，放这里会成环。
 */

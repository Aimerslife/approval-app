import pb from '@/pocketbase.ts'
import { APPROVAL_STATUS } from '@/types/approval'
import type { ApprovalModal, ApprovalChain, ApprovalOrder, ApprovalAttachment, ApprovalFlow, FlowGraph } from '@/types/approval'

export interface DocumentModel {
  collectionId: string
  collectionName: string
  content: string
  created: string
  id: string
  published: boolean
  updated: string
}

export async function register(email: string, password: string) {
    const body = {
        "email": email,
        "emailVisibility": true,
        "password": password,
        "passwordConfirm": password
    };
    try {
        const res = await pb.collection('users').create(body)
        // await pb.collection('users').authWithPassword(email, password)
        console.log('注册成功', res)
        return res
    } catch (err) {
        console.error('注册失败', err)
        return err
    }
}

// 获取文档
export async function getDocument(): Promise<DocumentModel | undefined> {
    try {
        const res = await pb.collection('document').getList<DocumentModel>(1, 1, {
            filter: ''
        });
        return res.items[0]
    } catch (err) {
        console.error(err)
        return undefined
    }
}

// 获取单条文档
export async function getDocumentByOne(id: string): Promise<DocumentModel | undefined> {
    try {
        const res = await pb.collection('document').getOne<DocumentModel>(id)
        return res
    } catch (err) {
        console.error(err)
        return undefined
    }
}


// 保存文档
export async function saveDocument(content: any, id: string, published: boolean) {
    console.log('saveDocument', content, id, published)
    try {
        const res = await pb.collection('document').update<DocumentModel>(id, {
            content,
            published
        })
        console.log('保存文档成功', res)
        return res
    } catch (err) {
        console.error('保存文档失败', err)
        return err
    }
}

// 更新文档
export async function updateDocument() {

}

// 删除文档
export async function deleteDocument() {
    
}


// 增加审批流
// chain.flow 为带条件分支的完整结构（可选）；chain.chain 为拍平后的线性链路，供旧页面兼容渲染；
// chain.graph 为 Vue Flow 画布快照（节点/连线/视口），用于编辑时原样还原画布
export async function addApproval(name:string,status:number,chain:{ chain: ApprovalChain; flow?: ApprovalFlow; graph?: FlowGraph }) {
    try{
        const res=await pb.collection('app_chain').create({
            name,
            status,
            chain
        })
        console.log('增加审批流成功', res)
        return res
    }catch(err: any){
        // err.data 是 PocketBase 返回的字段级校验详情（如必填、类型、唯一冲突）
        console.error('增加审批流失败:', err.response?.data ?? err.data ?? err)
        return err
    }
}

export async function createApprocalModel(
    data: NonNullable<ApprovalOrder['chain']>,
    opts: { relation?: string; syncKey?: string } = {},
) {
    const order_no=`${new Date().getTime()}`
    try{
        const res=await pb.collection('approval_chain').create<ApprovalOrder>({
            order_no,
            // 新单必然是「进行中」，终态由 rebuildChain 的 outcome 在办理时写入
            status: APPROVAL_STATUS.PENDING,
            chain:data,
            ...(opts.relation ? { relation: opts.relation } : {}),
            ...(opts.syncKey ? { sync_key: opts.syncKey } : {})
        })
        if (opts.syncKey && !res.sync_key) {
            console.warn(
                '[createApprocalModel] sync_key 没有落库：多半是 PB 还没应用 1789660200 迁移' +
                '（加 sync_key 那一版），重启 PB 后新建的单才会带上兜底键。',
            )
        }
        return res
    }catch(err: any){
        console.error('增加审批流失败:', err.response?.data ?? err.data ?? err)
        return err
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
export async function getOrdersByRow(biRowId: string, syncKey?: string): Promise<ApprovalOrder[]> {
    const conds = [pb.filter('relation = {:id}', { id: biRowId })]
    if (syncKey) conds.push(pb.filter('sync_key = {:key}', { key: syncKey }))
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
export async function getOrdersByRows(
    rows: Array<{ id: string; syncKey?: string }>,
): Promise<ApprovalOrder[]> {
    const conds: string[] = []
    for (const row of rows) {
        if (row.id) conds.push(pb.filter('relation = {:id}', { id: row.id }))
        if (row.syncKey) conds.push(pb.filter('sync_key = {:key}', { key: row.syncKey }))
    }
    if (!conds.length) return []

    const out: ApprovalOrder[] = []
    const seen = new Set<string>()
    for (let i = 0; i < conds.length; i += ORDER_FILTER_CHUNK) {
        const items = await pb.collection('approval_chain').getFullList<ApprovalOrder>({
            filter: conds.slice(i, i + ORDER_FILTER_CHUNK).join(' || '),
            sort: '-created',
        })
        // 分块之间可能重复命中（同一张单的 relation 在块 1、sync_key 在块 2），按单 id 去重
        for (const item of items) {
            if (seen.has(item.id)) continue
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
export async function getApproval(): Promise<ApprovalModal[]>{
    try{
        const res=await pb.collection('app_chain').getList<ApprovalModal>(1, 10, {
            filter: ''
        });
        return res.items
    }catch(err){
        console.error(err)
        return []
    }
}

//获取单条审批流数据（按 id）
export async function getApprovalOne(id: string): Promise<ApprovalModal | undefined> {
    try{
        const res = await pb.collection('app_chain').getOne<ApprovalModal>(id)
        console.log('获取单条审批流成功', res)
        return res
    }catch(err){
        console.error(err)
        return undefined
    }
}
// 更新审批流模板
export async function updateApprovalModel(id: string,data: Partial<ApprovalModal>): Promise<ApprovalModal | undefined> {
    try{
        const res = await pb.collection('app_chain').update<ApprovalModal>(id, data)
        return res
    }catch(err){
        console.error(err)
        return undefined
    }
}



// 获取单条审批流模板（按字段过滤，取第一条）
export async function getApprovalFirstByFilter(filter: string): Promise<ApprovalModal | undefined> {
    try {
        const res = await pb.collection('app_chain').getFirstListItem<ApprovalModal>(filter)
        console.log('获取单条审批流成功', res)
        return res
    } catch (err) {
        console.error(err)
        return undefined
    }
}

// 获取一条产品数据
export async function getProduct() {
    try {
        const res = await pb.collection('bi_rows').getList(1,1,{})
        console.log('获取单条产品成功', res)
        return res
    } catch (err) {
        console.error(err)
        return undefined
    }
}


// 删除审批流模板
export async function deleteApproval(id: string) {
    try{
        const res=await pb.collection('app_chain').delete(id)
        console.log('删除审批流模板成功', res)
        return {
            code: 0,
            message: '删除审批流模板成功'
        }
    }catch(err){
        console.error(err)
        return {
            code: -1,
            message: '删除审批流模板失败'
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
export async function getApprovalOrder(): Promise<ApprovalOrder[]> {
    try{
        // 取全量而不是前 10 条：首页表格是**前端分页**，分页器的页数要按总条数算，
        // 只取 10 条会让页数永远只有 1 页、第 2 页之后就看不到任何单。
        // 审批单的数量级很小（每条一行、json 里带流程快照），一次取回没有压力。
        return await pb.collection('approval_chain').getFullList<ApprovalOrder>({
            filter: '',
            expand: 'relation',
            sort: '-created'
        })
    }catch(err){
        console.error(err)
        return []
    }
}

/**
 * 按审批单号取一单 —— 首页「前往审批」跳转用。
 *
 * 为什么不能靠 getApprovalOrder 的第 N 条：跳转带的是 order_no，而列表顺序会随着
 * 新单插入而变，位置检索必然指错。查不到（单号不存在）时返回 undefined，交给调用方兜底。
 */
export async function getApprovalOrderByNo(orderNo: string): Promise<ApprovalOrder | undefined> {
    try{
        return await pb.collection('approval_chain').getFirstListItem<ApprovalOrder>(
            pb.filter('order_no = {:no}', { no: orderNo }),
            { expand: 'relation' }
        )
    }catch(err){
        console.error('按单号查审批单失败:', err)
        return undefined
    }
}

/**
 * 更新审批订单。
 * 主要用于把各环节的办理信息（结论、意见、附件）回填到 chain 字段。
 */
export async function updateApprovalOrder(id: string, data: Partial<ApprovalOrder>) {
    try{
        const res = await pb.collection('approval_chain').update<ApprovalOrder>(id, data)
        console.log('更新审批订单成功', id)
        return res
    }catch(err){
        console.error('更新审批订单失败:', err)
        throw err
    }
}

/**
 * 上传审批环节附件。
 *
 * approval_chain 集合没有 file 字段，附件单独存在 approval_files 集合，
 * chain 里只保存 { id, name, url } 引用，避免 json 字段被文件撑爆。
 */
export async function uploadApprovalFile(
    orderId: string,
    stepIndex: number,
    file: File
): Promise<ApprovalAttachment> {
    const form = new FormData()
    form.append('order_id', orderId)
    form.append('step_index', String(stepIndex))
    form.append('file', file, file.name)

    const record = await pb.collection('approval_files').create<{ id: string; file: string }>(form)
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
export async function getUserInfo(page = 1, perPage = 50): Promise<UserInfo[]> {
    try {
        const res = await pb.collection('users').getList<UserInfo>(page, perPage, {
            fields:'id,avatar_url,created,email,name,role,department,department_path,tenant_key'
        })
        console.log('获取用户信息成功', res.items.length, '条')
        return res.items
    } catch (err) {
        console.error('获取用户信息失败:', err)
        // 列表接口失败时返回空数组，保证调用方拿到的类型稳定为 UserInfo[]
        return []
    }
}
// 更新用户权限
export async function updateUserRole(id: string, role: string) {
     try {
        const res = await pb.collection('users').update(id,{
            role
        })
        return res
    } catch (err) {
        console.error('获取用户信息失败:', err)
        // 列表接口失败时返回空数组，保证调用方拿到的类型稳定为 UserInfo[]
        return []
    }
}

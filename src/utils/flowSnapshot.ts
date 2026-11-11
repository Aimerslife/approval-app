import type { ApprovalFlow, ApprovalOrder } from '@/types/approval'
import pb from '@/pocketbase.ts'
import { isFlowRef } from '@/types/approval'

/**
 * **流程快照层**（模板版本化瘦身）—— 单据不逐张固化 flow，改存引用：
 *
 *   写（引用化）：`chainFlowRefForStore` 在建单 / 写回前把 flow 存进 `flow_snapshots`
 *   集合（按 SHA-256 内容 hash 去重 —— 同模板同团队的多张单共享同一份），单据里只留
 *   `{ snap: 记录id }`。快照失败（集合没建 / 网络抖动）**退回内嵌 flow**：
 *   瘦身是优化，不能挡建单。
 *
 *   读（解包）：`materializeOrders` 在数据访问层出口（collection.ts 的四个读单函数）
 *   把引用批量拉回、**就地替换成数组** —— 下游 runtimeOf / 页面拿到的始终是数组，
 *   对引用无感（这是全案异步只收敛在数据层的做法：runtimeOf 是同步纯函数，20+ 处
 *   页面 computed 直调，签名一动就是大手术）。
 *
 * 快照按内容寻址、不可变（同 hash 永远同内容），所以两个进程内缓存都**永不过期**：
 *   · hashCache：hash → 快照 id（写回高频，免得每次办理都查库）
 *   · flowCache：快照 id → flow（解包缓存；跨页面复用同一份，内存里只有一份副本）
 *
 * 老单兼容：chain.flow 是数组 → 引用化原样透传 / 解包直接跳过，两端都无感。
 * 集合由 pocketbase/pb_migrations/1792000000_created_flow_snapshots.js 建立。
 */

const SNAPSHOT_COLLECTION = 'flow_snapshots'

/** 一个 filter 里最多拼多少个 id（引用是批量解包的，别把 URL 拼爆） */
const SNAPSHOT_CHUNK = 80

const hashCache = new Map<string, string>()
const flowCache = new Map<string, ApprovalFlow>()

/** flow 的内容摘要：SHA-256 前 16 位 hex（全文寻址，同内容必同 hash） */
async function flowHash (json: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  return Array.from(new Uint8Array(digest).slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 存储用 chain：把内嵌 flow 换成快照引用（浅拷贝，不动入参）。
 * 已是引用 / 没有 flow 时原样返回；快照失败时**原样降级**（flow 保持数组照常入库）。
 */
export async function chainFlowRefForStore<T extends { flow?: unknown }> (chain: T): Promise<T> {
  const flow = chain.flow
  if (!Array.isArray(flow)) {
    return chain
  }
  /*
   * 空数组**不引用化**：读侧快照缺失时 materializeOrders 会把 flow 兜底置空（见其说明），
   * 若此刻正好办理并写回，引用化会把「空流程」固化成快照引用 —— 单据的流程从此永久丢失
   * （读回来恒为 []，时间线/结论/后续环节全部消失，只能手工改库救）。
   * 这里原样透传：宁可库里留一个显眼的空数组（排查时一眼可见），也不做这种不可逆的固化成引用。
   */
  if (flow.length === 0) {
    console.warn('[flowSnapshot] 待写回的 flow 是空数组（多半是读侧快照解包失败），跳过引用化、原样写回')
    return chain
  }
  try {
    const snap = await upsertFlowSnapshot(flow as ApprovalFlow)
    return { ...chain, flow: { snap } } as T
  } catch (error) {
    console.warn('[flowSnapshot] 快照落库失败，本单退回内嵌 flow（不影响建单/写回）:', error)
    return chain
  }
}

/** flow 存进快照集合（按 hash 去重），返回快照记录 id */
async function upsertFlowSnapshot (flow: ApprovalFlow): Promise<string> {
  const json = JSON.stringify(flow)
  const hash = await flowHash(json)
  const cached = hashCache.get(hash)
  if (cached) {
    return cached
  }
  // 同一份 flow 很可能已经存过（另一张单 / 上一次写回）：先查后建
  const found = await pb.collection(SNAPSHOT_COLLECTION)
    .getFirstListItem<{ id: string }>(pb.filter('hash = {:h}', { h: hash }))
    .catch(() => null)
  if (found) {
    hashCache.set(hash, found.id)
    return found.id
  }
  // 并发建同一 hash 会撞唯一索引：撞了就重查一次（赢家已经建好了）
  const created = await pb.collection(SNAPSHOT_COLLECTION)
    .create<{ id: string }>({ hash, flow, size: json.length })
    .catch(async (error: unknown) => {
      const retry = await pb.collection(SNAPSHOT_COLLECTION)
        .getFirstListItem<{ id: string }>(pb.filter('hash = {:h}', { h: hash }))
        .catch(() => null)
      if (retry) {
        return retry
      }
      throw error
    })
  hashCache.set(hash, created.id)
  return created.id
}

/**
 * 把一批单据里的快照引用**就地解包**成 flow 数组（返回同一批对象，方便在出口处
 * `return materializeOrders(items)`）。快照缺失时把该单 flow 置空数组并告警 ——
 * 宁可这单显示空流程，也不要把引用对象漏给 runtimeOf（它会把非数组当流程遍历，直接崩）。
 */
export async function materializeOrders<T extends ApprovalOrder> (orders: T[]): Promise<T[]> {
  const snapIds = new Set<string>()
  for (const order of orders) {
    const ref = (order.chain as { flow?: unknown } | undefined)?.flow
    if (isFlowRef(ref)) {
      snapIds.add(ref.snap)
    }
  }
  if (snapIds.size > 0) {
    const missing = [...snapIds].filter(id => !flowCache.has(id))
    if (missing.length > 0) {
      await loadSnapshots(missing)
    }
  }
  for (const order of orders) {
    const chain = order.chain as { flow?: unknown } | undefined
    if (!chain || !isFlowRef(chain.flow)) {
      continue
    }
    const flow = flowCache.get(chain.flow.snap)
    if (flow) {
      chain.flow = flow
    } else {
      console.warn('[flowSnapshot] 流程快照缺失（检查 flow_snapshots 集合与迁移）:', chain.flow.snap)
      chain.flow = []
    }
  }
  return orders
}

/** 批量拉快照进缓存（按 id 分块拼 filter；快照不可变，进来就不过期） */
async function loadSnapshots (ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += SNAPSHOT_CHUNK) {
    const chunk = ids.slice(i, i + SNAPSHOT_CHUNK)
    // 占位符让 SDK 自己转义（id 里出现引号也不会把 filter 写坏，见 pb.filter 的口径）
    const params = Object.fromEntries(chunk.map((id, j) => [`f${j}`, id]))
    const cond = chunk.map((_, j) => `id = {:f${j}}`).join(' || ')
    // pb.filter 把占位符展开成已转义的字面量（id 里有引号也不会把 filter 写坏）
    const filter = pb.filter(cond, params)
    const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList<{ id: string, flow: unknown }>({ filter })
    for (const row of rows) {
      if (Array.isArray(row.flow)) {
        flowCache.set(row.id, row.flow as ApprovalFlow)
      }
    }
  }
}

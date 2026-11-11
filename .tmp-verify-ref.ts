/**
 * 临时验证 12（改）：模板版本化引用端到端（库里没有现成单据，用模板造数）。验证完删除。
 * ① 读模板 flow → 建单期展开 → 瘦身+压缩（同真实建单口径）
 * ② hash → upsert 快照 → 建引用单（chain.flow={snap}）
 * ③ 读回 → 解包 → runtimeOf 回放 vs 内嵌版（stepIds/结论一致）
 * ④ 体积对比；⑤ 清理
 */
import { runtimeOf } from './src/utils/approvalRuntime'
import { compactFlowSnapshot, renameBranchTerminalKeys, slimFlowMembers } from './src/types/approval'
import { adminToken } from './server/pbAdmin'
import { expandTemplateRefs } from './src/utils/templateRef'
import type { ApprovalFlow, ApprovalOrder } from './src/types/approval'

const PB = 'http://127.0.0.1:8091'
const TEST_NO = `9999${Date.now() % 10000000}`

async function pbFetch (path: string, init: RequestInit = {}, token?: string): Promise<Record<string, unknown>> {
  const res = await fetch(new URL(path, PB).toString(), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}), ...(init.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>
}

async function flowHash (json: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  return [...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function main () {
  const token = await adminToken()

  // ① 模板 → 展开 → 压缩（真实建单口径）
  const tpls = await pbFetch('/api/collections/app_chain/records?perPage=20', {}, token) as { items?: Array<Record<string, unknown>> }
  let picked: { name: string, chain: Record<string, unknown> } | undefined
  for (const t of tpls.items ?? []) {
    const chain = (typeof t.chain === 'string' ? JSON.parse(t.chain) : t.chain) as Record<string, unknown>
    if (Array.isArray(chain.flow) && (chain.flow as ApprovalFlow).length > 0) {
      const expanded = await expandTemplateRefs(chain.flow as ApprovalFlow, {})
      if (expanded.issues.length === 0) {
        picked = { name: String(t.name ?? t.id), chain }
        break
      }
    }
  }
  if (!picked) {
    throw new Error('没有可展开的模板')
  }
  const tplRow = await pbFetch(`/api/collections/app_chain/records?filter=${encodeURIComponent(`name='${picked.name.replace(/'/g, "\\'")}'`)}`, {}, token) as { items?: Array<Record<string, unknown>> }
  const rawTpl = (tplRow.items ?? [])[0] as unknown as ApprovalOrder
  const tChain = (typeof rawTpl.chain === 'string' ? JSON.parse(rawTpl.chain) : rawTpl.chain) as Record<string, unknown>
  const expanded = await expandTemplateRefs(tChain.flow as ApprovalFlow, {})
  const slim = slimFlowMembers(expanded.flow)
  const compact = compactFlowSnapshot(slim)
  const branchTerminal = renameBranchTerminalKeys((tChain.branchTerminal ?? {}) as Record<string, boolean>, compact.branchIdMap)
  console.log(`① 模板「${picked.name}」→ 展开+瘦身+压缩：${(JSON.stringify(slim).length / 1024).toFixed(0)}KB → ${(JSON.stringify(compact.flow).length / 1024).toFixed(0)}KB，出口表 ${Object.keys(branchTerminal).length} 键`)

  // ② 快照 upsert + 引用单
  const flowJson = JSON.stringify(compact.flow)
  const hash = await flowHash(flowJson)
  let snapId = ''
  const q = await pbFetch(`/api/collections/flow_snapshots/records?filter=${encodeURIComponent(`hash='${hash}'`)}`, {}, token) as { items?: Array<{ id?: string }> }
  const hit = (q.items ?? [])[0]
  if (hit?.id) {
    snapId = hit.id
    console.log('② 快照命中已有（去重生效）')
  } else {
    const created = await pbFetch('/api/collections/flow_snapshots/records', {
      method: 'POST',
      body: JSON.stringify({ hash, flow: compact.flow, size: flowJson.length }),
    }, token) as { id?: string }
    snapId = created.id ?? ''
  }
  // 内嵌版单据（对照组：与旧格式一致）
  const embeddedChain = { ...tChain, flow: compact.flow, branchTerminal, decisions: [] }
  const refChain = { ...tChain, flow: { snap: snapId }, branchTerminal, decisions: [] }
  const mk = (chain: unknown) => pbFetch('/api/collections/approval_chain/records', {
    method: 'POST',
    body: JSON.stringify({ order_no: TEST_NO, status: 0, chain }),
  }, token) as Promise<{ id?: string }>
  const ordA = await mk(embeddedChain)
  const ordB = await mk(refChain)
  console.log(`② 对照单（内嵌 ${(JSON.stringify(embeddedChain).length / 1024).toFixed(1)}KB）与引用单（${(JSON.stringify(refChain).length / 1024).toFixed(1)}KB）已建`)

  // ③ 读回引用单 → 解包 → 回放对比
  const back = await pbFetch(`/api/collections/approval_chain/records/${ordB.id}`, {}, token) as unknown as ApprovalOrder
  const chainBack = (typeof back.chain === 'string' ? JSON.parse(back.chain) : back.chain) as Record<string, unknown>
  const ref = chainBack.flow as { snap?: string }
  const snapRow = await pbFetch(`/api/collections/flow_snapshots/records/${ref.snap}`, {}, token) as { flow?: unknown }
  chainBack.flow = snapRow.flow
  const ordA2 = await pbFetch(`/api/collections/approval_chain/records/${ordA.id}`, {}, token) as unknown as ApprovalOrder
  const chainA = (typeof ordA2.chain === 'string' ? JSON.parse(ordA2.chain) : ordA2.chain) as Record<string, unknown>
  const r1 = runtimeOf({ ...ordA2, chain: chainA } as unknown as ApprovalOrder)
  const r2 = runtimeOf({ ...back, chain: chainBack } as unknown as ApprovalOrder)
  console.log('③ 回放一致：', JSON.stringify(r1.stepIds) === JSON.stringify(r2.stepIds),
    `(done=${r1.done}/${r2.done}, 环数=${r1.chain.length}/${r2.chain.length}, current=${r1.currentStep}/${r2.currentStep}, 待办人=${JSON.stringify(r1.chain[r1.currentStep]?.map(m => m.name))})`)
  console.log('④ 解包 flow ≡ 内嵌 flow：', JSON.stringify(chainBack.flow) === JSON.stringify(chainA.flow))

  // ⑤ 清理：本次与上次残留的测试单（order_no 9999 前缀）+ 全部测试快照
  const stray = await pbFetch(`/api/collections/approval_chain/records?perPage=200&filter=${encodeURIComponent("order_no~'9999'")}`, {}, token) as { items?: Array<{ id?: string }> }
  for (const s of stray.items ?? []) {
    await pbFetch(`/api/collections/approval_chain/records/${s.id}`, { method: 'DELETE' }, token)
  }
  const snaps = await pbFetch('/api/collections/flow_snapshots/records?perPage=200', {}, token) as { items?: Array<{ id?: string }> }
  for (const s of snaps.items ?? []) {
    await pbFetch(`/api/collections/flow_snapshots/records/${s.id}`, { method: 'DELETE' }, token)
  }
  console.log(`⑤ 测试数据已清理（${(stray.items ?? []).length} 张单 + ${(snaps.items ?? []).length} 份快照）`)
}

void main()

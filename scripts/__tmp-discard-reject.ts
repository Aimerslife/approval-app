/* 临时：看"回退上一级"之后弃置段被标到了哪些环节 —— 跑完即删 */
import Database from 'better-sqlite3'
import { discardIndexOf, discardNodeCount, discardSegmentStart, groupApproverSteps, runtimeOf, stepStartTimesOf } from '@/utils/approvalRuntime'
import { firstResultValueOf } from '@/types/approval'
import type { ApprovalOrder } from '@/types/approval'

const db = new Database('pocketbase/pb_data/data.db', { readonly: true, fileMustExist: true })
const rows = db.prepare('select id, order_no, status, created, chain from approval_chain order by created desc').all() as any[]
db.close()

/** 弃置入口结论的分支 → 它子树里的全部节点 id（诊断用，与 utils 里的口径一致） */
function discardSubtreeIds (flow: any[]): string[] {
  const out: string[] = []
  const idsIn = (steps: any[] | undefined) => {
    for (const s of steps ?? []) {
      out.push(String(s?.id ?? ''))
      for (const b of s?.branches ?? []) idsIn(b?.steps)
      idsIn(s?.steps)
    }
  }
  const walk = (nodes: any[] | undefined): boolean => {
    for (const n of nodes ?? []) {
      if (n?.type === 'branch') {
        for (const b of n.branches ?? []) {
          const code = String(firstResultValueOf(b) ?? '').trim()
          if (!b?.loopBackTo && !b?.exitTo && ['discard', 'lack_demand'].includes(code)) {
            idsIn(b.steps)
            return true
          }
          if (walk(b.steps)) return true
        }
        continue
      }
      if (walk(n?.steps)) return true
    }
    return false
  }
  walk(flow)
  return out.filter(Boolean)
}

console.log(`审批单 ${rows.length} 张\n`)
for (const r of rows) {
  const order = { id: r.id, order_no: r.order_no, status: r.status, created: r.created, chain: JSON.parse(r.chain) } as ApprovalOrder
  const rt = runtimeOf(order)
  const flow = order.chain?.flow ?? []
  const inside = new Set(discardSubtreeIds(flow as any[]))
  const start = discardSegmentStart({ chain: rt.chain, stepIds: rt.stepIds, flow: order.chain?.flow })
  const groups = groupApproverSteps(rt.chain, rt.stepIds, stepStartTimesOf(order, rt.chain))

  console.log(`=== ${r.order_no} status=${r.status} 环节=${rt.chain.length} currentStep=${rt.currentStep} 旧判定起点=${start} 段内节点=${discardNodeCount(groups, start)} ===`)
  rt.chain.forEach((step, i) => {
    const m = step.find(x => x.type === 'manager')
    const inSubtree = inside.has(String(rt.stepIds[i] ?? ''))
    const oldMark = start >= 0 && i >= start ? '★旧判定' : ''
    console.log(`  #${i} ${String(m?.name ?? '-').padEnd(6)} [${m?.department ?? ''}] result=${String(m?.result ?? '').padEnd(12)} 弃置子树内=${inSubtree ? 'Y' : 'n'} ${oldMark} ${i === rt.currentStep ? '← 当前待办' : ''}`)
  })
  console.log(`  弃置子树共 ${inside.size} 个环节；链路里落在子树内 ${rt.stepIds.filter(id => inside.has(String(id ?? ''))).length} 个`)
  console.log('')
}

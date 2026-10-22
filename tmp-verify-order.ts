import { readFileSync } from 'node:fs'
import { rebuildChain } from './src/types/approval'
import type { ApprovalFlow, NodeDecision, FlowContext } from './src/types/approval'

const data = JSON.parse(readFileSync('./tmp-order-flow.json', 'utf8'))
const flow = data.flow as ApprovalFlow
const decisions = data.decisions as NodeDecision[]
const context = data.context as FlowContext

/** 模拟"模板重新保存后新建的单"：三条脱线支路的起点带上 branchStart */
const marked: ApprovalFlow = flow.map((n, i) => (i >= 2 && n.type === 'notify' ? { ...n, branchStart: true } : n))

for (const [label, f] of [['旧单（无标记）', flow], ['新单（有标记）', marked]] as const) {
  const r = rebuildChain(f, decisions, {}, context)
  console.log(`${label}:`, r.chain.map(items => items[0]?.name).join(' → '))
  console.log('   done =', r.done, '| outcome =', r.outcome, '| end =', r.end?.message)
}

import { readFileSync } from 'node:fs'
import { graphToFlowFrom, ensureRejectLoopBack } from './src/utils/approvalFlow'
import { rebuildChain } from './src/types/approval'
import type { ApprovalFlow, NodeDecision } from './src/types/approval'

const graph = JSON.parse(readFileSync('./tmp-tpl-graph.json', 'utf8'))
const order = JSON.parse(readFileSync('./tmp-order-decisions.json', 'utf8'))

const r = graphToFlowFrom(graph.nodes, graph.edges, { allowEmptyMembers: true })
if (r.error) {
  console.log('GRAPH ERROR:', r.error)
  process.exit(0)
}
const raw = r.flow
const flow: ApprovalFlow = ensureRejectLoopBack(raw)
console.log('flow nodes:', flow.length)
flow.forEach((n, i) => {
  console.log(`  [${i}] ${n.type} ${(n as any).name ?? (n as any).id}${(n as any).branchStart ? '  <== branchStart' : ''}`)
})

const decisions: NodeDecision[] = order.decisions
const chain = rebuildChain(flow, decisions, {}, order.context)
console.log('\nchain:', chain.chain.map(items => items[0]?.name).join(' → '))
console.log('done =', chain.done, '| end =', JSON.stringify(chain.end))

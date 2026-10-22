import { rebuildChain } from './src/types/approval'
import type { ApprovalFlow, NodeDecision } from './src/types/approval'

const fan = { name: '范少玲', open_id: 'ou_fan' }

function flowOf (withMarker: boolean): ApprovalFlow {
  return [
    { type: 'approval', id: 'A', nodes: [{ name: '甲', open_id: 'ou_a' }] },
    {
      type: 'branch',
      id: 'A:result',
      branches: [
        { id: 'br-jump', name: '跳出', conditions: [], steps: [], exitTo: { stepId: 'N1' } },
      ],
    },
    { type: 'notify', id: 'N1', name: '提醒14', members: [fan] },
    { type: 'notify', id: 'N2', name: '提醒15', members: [fan], ...(withMarker ? { branchStart: true } : {}) },
    { type: 'notify', id: 'N3', name: '提醒3', members: [fan], ...(withMarker ? { branchStart: true } : {}) },
  ] as ApprovalFlow
}

const decisions: NodeDecision[] = [
  { stepId: 'A', result: 'pass', result_label: '通过', extra: {}, opinion: '' },
]

for (const marker of [false, true]) {
  const r = rebuildChain(flowOf(marker), decisions, {}, {})
  console.log(
    marker ? 'WITH branchStart  :' : 'WITHOUT branchStart:',
    r.chain.map(items => items[0]?.name).join(' → '),
    '| done =', r.done,
    '| end =', r.end?.message,
  )
}

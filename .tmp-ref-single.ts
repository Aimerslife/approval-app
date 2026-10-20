import { graphToFlowFrom } from './src/utils/approvalFlow'
import { expandTemplateRefs } from './src/utils/templateRef'

function build (opts: { withCondition: boolean, secondLine: boolean }) {
  const nodes = [
    { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'r1', type: 'ref', position: { x: 0, y: 0 }, data: { title: '弃置模板', refTemplateId: 'tpl-a', refTemplateName: '弃置模板-A' } },
    { id: 'a1', type: 'approval', position: { x: 0, y: 0 }, data: { members: [], title: '通知仓管' } },
    { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: {} },
  ]
  const edges: any[] = [
    { id: 'x1', source: 's', target: 'r1', data: {} },
    { id: 'x2', source: 'a1', target: 'e', data: {} },
  ]
  if (opts.withCondition) {
    edges.push({
      id: 'x3', source: 'r1', target: 'a1', label: '选择接收团队',
      data: { conditions: [{ field: 'result', op: 'eq', value: 'pick_team' }] },
    })
  } else {
    edges.push({ id: 'x3', source: 'r1', target: 'a1', data: {} })
  }
  if (opts.secondLine) {
    edges.push({
      id: 'x4', source: 'r1', target: 'e', label: '其它',
      data: { conditions: [{ field: 'result', op: 'eq', value: 'discard' }] },
    })
  }
  return graphToFlowFrom(nodes, edges, { allowEmptyMembers: true })
}

async function main () {
  const a: any = build({ withCondition: false, secondLine: false })
  console.log('① 单出线/无结论:', a.error ?? JSON.stringify(a.flow.map((n: any) => ({ type: n.type, branches: n.branches?.map((b: any) => `${b.name}:isEnd=${b.isEnd}`) }))))

  const b: any = build({ withCondition: true, secondLine: false })
  console.log('② 单出线/绑结论:', b.error ?? JSON.stringify(b.flow.map((n: any) => ({ type: n.type, branches: n.branches?.map((c: any) => `${c.name}:isEnd=${c.isEnd}:steps=${c.steps.length}`) })), null, 1))

  const c: any = build({ withCondition: true, secondLine: true })
  console.log('③ 两出线:', c.error ?? JSON.stringify(c.flow.map((n: any) => ({ type: n.type, branches: n.branches?.map((x: any) => `${x.name}:isEnd=${x.isEnd}`) }))))

  // 展开校验：段内容 + :exits 组
  if (!b.error) {
    const srcFlow = [
      { id: 'sa1', type: 'approval', name: '弃置环节', members: [{ name: '张三' }],
        branches: [
          { id: 'sb1', name: '选择接收团队', steps: [], isEnd: true, conditions: [{ field: 'result', op: 'eq', value: 'pick_team' }] },
          { id: 'sb2', name: '建议返工', steps: [], isEnd: true, conditions: [{ field: 'result', op: 'eq', value: 'rework' }] },
        ] },
    ]
    const refs = await expandTemplateRefs(b.flow, async () => ({ id: 'tpl-a', name: '弃置模板-A', flow: srcFlow as any }))
    console.log('④ 展开后 issues:', refs.issues, '顶层:', JSON.stringify(refs.flow.map((n: any) => `${n.type}(${String(n.id).slice(-18)})`)))
    const exits = (refs.flow as any[]).find(n => String(n.id).endsWith(':exits'))
    console.log('   :exits 分支:', exits?.branches?.map((x: any) => `${x.name}:isEnd=${x.isEnd}:steps=${x.steps.length}`))
  }
}

void main()

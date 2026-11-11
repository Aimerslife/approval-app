/**
 * 临时侦察：全量拉 approval_chain 单据，量化 flow 去重份数与 chain 字段构成。
 * 决定「模板版本化引用」方案的收益上限。验证完删除。
 */
interface Row { id: string, order_no?: string, chain?: string, created?: string }

function djb2 (s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36)
}

async function main () {
  const rows: Row[] = []
  let page = 1
  for (;;) {
    const url = `http://127.0.0.1:8091/api/collections/approval_chain/records?perPage=200&page=${page}&sort=-created`
    const j = await (await fetch(url)).json()
    rows.push(...(j.items as Row[]))
    if (page >= j.totalPages) {
      break
    }
    page++
  }
  console.log(`单据总数：${rows.length}`)

  // flow 去重
  const byHash = new Map<string, { ids: string[], size: number, sample: string }>()
  let flowTotal = 0
  let otherTotal = 0
  for (const r of rows) {
    if (!r.chain) {
      continue
    }
    const c = typeof r.chain === 'string' ? JSON.parse(r.chain) : r.chain
    const flowJson = JSON.stringify(c.flow ?? null)
    const otherJson = JSON.stringify({ ...c, flow: undefined })
    flowTotal += flowJson.length
    otherTotal += otherJson.length
    const h = djb2(flowJson)
    const entry = byHash.get(h)
    if (entry) {
      entry.ids.push(r.order_no ?? r.id)
    } else {
      byHash.set(h, { ids: [r.order_no ?? r.id], size: flowJson.length, sample: flowJson.slice(0, 60) })
    }
  }
  console.log(`flow 总计：${(flowTotal / 1024).toFixed(0)}KB；chain 其他字段总计：${(otherTotal / 1024).toFixed(0)}KB`)
  console.log(`flow 去重后份数：${byHash.size}（重复率 ${(100 * (1 - byHash.size / Math.max(rows.length, 1))).toFixed(0)}%）`)
  const sorted = [...byHash.values()].sort((a, b) => b.size * b.ids.length - a.size * a.ids.length)
  console.log('按「份数×大小」排序前 8 份：')
  for (const s of sorted.slice(0, 8)) {
    console.log(`  ${s.ids.length} 张 × ${(s.size / 1024).toFixed(1)}KB = ${(s.size * s.ids.length / 1024).toFixed(0)}KB  首=${s.ids[0]}`)
  }

  // 单张 chain 顶层字段构成（最新一张）
  const latest = rows[0]
  if (latest?.chain) {
    const c = typeof latest.chain === 'string' ? JSON.parse(latest.chain) : latest.chain
    console.log(`最新单 ${latest.order_no ?? latest.id} 顶层字段：`)
    for (const [k, v] of Object.entries(c)) {
      console.log(`  ${k} = ${(JSON.stringify(v).length / 1024).toFixed(1)}KB`)
    }
  }
}

void main()

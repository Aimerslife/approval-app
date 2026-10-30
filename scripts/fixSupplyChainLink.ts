// env 的加载由 server/config.ts 负责（它自己 import './env'），这里不必再引一次
import { adminToken, PB_URL } from '../server/pbAdmin'
import { config } from '../server/config'
import { normalizeOptionGroups } from '../src/types/approval'
import type { ApprovalOptionGroup } from '../src/types/approval'

/**
 * 一次性数据订正：把模板选项树里「实际链路」为空的一级项补上链路，
 * 并把编译产物 flow 里被丢掉的整组选项同步回来。
 *
 * ## 背景（为什么要它）
 *
 * 「美1组模板」的「美1组」环节在画布上配了「供应链」类别（3 个一级项），但三项的
 * **「实际链路」都是空的**。编译模板时 `normalizeOptionGroups` 会把 link 为空的项丢掉
 * （没有链路就无法决定走向，见 src/types/approval 的 normalizeOptionGroups），
 * 于是 flow（办理时真正用的那份）里整组消失 —— 表现是「办理选项」下拉里没有供应链，
 * 而画布上明明配了（graph 里有），**且不报任何错**。
 *
 * ## 本脚本做什么
 *
 *   · graph：把「供应链」组里 link 为空的一级项补成 `other_reason`（其他原因）——
 *     该环节的出线只有 产品侵权(cat_infringe) / 产品质量(cat_quality) / 其他原因(other_reason)，
 *     供应链没有专属出线，落「其他原因」与其它 4 组的配法一致；
 *   · flow：把 graph 里该节点的 optionGroups 经**应用自身同一套** `normalizeOptionGroups`
 *     规范化后，替换掉 flow 里的旧值（与"补完 link 重新保存模板"的编译结果一致）。
 *
 * 已建单据的快照（chain.flow）是建单时固化的，**不在本脚本范围** —— 要在旧单上看到
 * 供应链，删单后在工作台重新开启任务。
 *
 * ## 为什么用管理员接口而不是直接改 SQLite
 *
 * 同 scripts/backfillCompanyName.ts：PB 开着 WAL，直改 data.db 有覆盖写入的风险。
 *
 * ## 用法
 *
 *   yarn tsx scripts/fixSupplyChainLink.ts          # 只看会改什么，不落库（默认 dry-run）
 *   yarn tsx scripts/fixSupplyChainLink.ts --apply  # 真正修正
 *
 * 依赖 `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`（app_chain 的写规则对普通用户不开放）。
 */

import { normalizeOptionGroups } from '../src/types/approval'
import type { ApprovalOptionGroup } from '../src/types/approval'

/** 供应链原因走哪条线：该模板「美1组」环节的出线里没有供应链专属线，落「其他原因」 */
const SUPPLY_CHAIN_LINK = 'other_reason'

/** 只补这一个类别的空链路 —— 其它类别的空项不碰（那里留空可能是有意的，不该代选） */
const TARGET_GROUP = '供应链'

/** 模板一页拉多少：模板是几十条的量级，500 一次拿完 */
const PER_PAGE = 500

/** 模板记录里我们关心的形状（app_chain.chain = { chain, flow, graph }） */
interface TemplatePayload {
  graph?: {
    nodes?: Array<{ id?: string, data?: { optionGroups?: unknown } }>
  }
  flow?: Array<Record<string, any>>
}

/** graph 侧改了什么 / flow 侧同步了什么，都记下来给 dry-run 看 */
interface FixReport {
  template: string
  id: string
  filled: Array<{ text: string, link: string }>
  flowSynced: string[]
}

/** 分页拉全部模板 */
async function fetchTemplates (token: string): Promise<Array<{ id: string, name: string, chain: TemplatePayload | null }>> {
  const out: Array<{ id: string, name: string, chain: TemplatePayload | null }> = []
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ perPage: String(PER_PAGE), page: String(page) })
    const res = await fetch(
      new URL(`/api/collections/app_chain/records?${qs}`, PB_URL).toString(),
      { headers: { Authorization: token } },
    )
    if (!res.ok) {
      throw new Error(`读取 app_chain 失败：HTTP ${res.status}`)
    }
    const body: { items?: Array<{ id: string, name: string, chain?: TemplatePayload | null }> } = await res.json()
    const items = body?.items ?? []
    if (items.length === 0) {
      break
    }
    out.push(...items.map(it => ({ id: it.id, name: it.name, chain: it.chain ?? null })))
  }
  return out
}

/** 在 flow 里找出**所有**带 optionGroups 的节点（顶层 / 分支 steps / 嵌套 steps 都要认） */
function collectFlowOptionNodes (nodes: Array<Record<string, any>>, out: Array<Record<string, any>> = []): Array<Record<string, any>> {
  for (const n of nodes ?? []) {
    if (!n) {
      continue
    }
    if (Array.isArray(n.optionGroups)) {
      out.push(n)
    }
    for (const b of n.branches ?? []) {
      collectFlowOptionNodes(b?.steps ?? [], out)
    }
    collectFlowOptionNodes(n.steps ?? [], out)
  }
  return out
}

/** 递归找出 flow 里 id 匹配的节点（可能在任意一层分支里） */
function findFlowNode (nodes: Array<Record<string, any>>, id: string): Record<string, any> | undefined {
  for (const n of nodes ?? []) {
    if (!n) {
      continue
    }
    if (n.id === id) {
      return n
    }
    for (const b of n.branches ?? []) {
      const hit = findFlowNode(b?.steps ?? [], id)
      if (hit) {
        return hit
      }
    }
    const hit = findFlowNode(n.steps ?? [], id)
    if (hit) {
      return hit
    }
  }
  return undefined
}

/** 补 link 并返回报告；没有可补的就返回 undefined（不动这条模板） */
function fixTemplate (tpl: { id: string, name: string, chain: TemplatePayload | null }): FixReport | undefined {
  const graphNodes = tpl.chain?.graph?.nodes ?? []
  const report: FixReport = { template: tpl.name, id: tpl.id, filled: [], flowSynced: [] }

  // ① graph：供应链组里 link 为空的一级项补上链路
  let graphTouched = false
  for (const node of graphNodes) {
    const groups = (node?.data?.optionGroups ?? []) as Array<Partial<ApprovalOptionGroup>>
    for (const g of groups) {
      if (String(g?.title ?? '').trim() !== TARGET_GROUP) {
        continue
      }
      for (const it of g.items ?? []) {
        if (!String(it?.link ?? '').trim() && String(it?.text ?? '').trim()) {
          it.link = SUPPLY_CHAIN_LINK
          report.filled.push({ text: String(it.text), link: SUPPLY_CHAIN_LINK })
          graphTouched = true
        }
      }
    }
  }
  if (!graphTouched) {
    return undefined
  }

  // ② flow：graph 里有选项树的节点，按同一套规范化规则把 flow 的旧值替换掉 ——
  //    结果与"补完 link 后在画布上重新保存模板"完全一致（编译时也是这一个函数）
  const flow = tpl.chain?.flow ?? []
  for (const gnode of graphNodes) {
    const raw = gnode?.data?.optionGroups
    if (!Array.isArray(raw) || !gnode?.id) {
      continue
    }
    const normalized = normalizeOptionGroups(raw)
    if (normalized.length === 0) {
      continue
    }
    const fnode = findFlowNode(flow, gnode.id)
    if (fnode && JSON.stringify(fnode.optionGroups ?? []) !== JSON.stringify(normalized)) {
      fnode.optionGroups = normalized
      report.flowSynced.push(gnode.id)
    }
  }
  return report
}

async function main (): Promise<void> {
  const apply = process.argv.includes('--apply')
  const dryRun = !apply

  if (!config.pbAdminEmail || !config.pbAdminPassword) {
    console.error('❌ 未配置 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD，没法用管理员接口订正。')
    console.error('   替代路径：模板编辑页打开「美1组模板」→「美1组」环节任一结果分支 →「配置选项」')
    console.error('   → 给「供应链」3 个一级项的「实际链路」选「其他原因」→ 保存模板。')
    process.exitCode = 1
    return
  }

  const token = await adminToken()
  console.log(`拉取模板：${PB_URL}${dryRun ? '（默认 dry-run，加 --apply 才落库）' : '（--apply：将落库）'}`)
  const templates = await fetchTemplates(token)
  console.log(`共 ${templates.length} 张模板\n`)

  const reports = templates
    .map(fixTemplate)
    .filter((r): r is FixReport => !!r)

  if (reports.length === 0) {
    console.log('没有需要修正的模板（「供应链」组的链路都已配置）。')
    return
  }

  for (const r of reports) {
    console.log(`模板「${r.template}」（${r.id}）：`)
    for (const f of r.filled) {
      console.log(`  graph 补链路：${f.text} → ${f.link}`)
    }
    for (const id of r.flowSynced) {
      console.log(`  flow 同步选项树：节点 ${id}`)
    }
  }

  if (dryRun) {
    console.log('\ndry-run 结束：未落库。确认无误后加 --apply 重跑。')
    return
  }

  let ok = 0
  for (const r of reports) {
    const tpl = templates.find(t => t.id === r.id)
    if (!tpl?.chain) {
      continue
    }
    const res = await fetch(
      new URL(`/api/collections/app_chain/records/${encodeURIComponent(r.id)}`, PB_URL).toString(),
      {
        method: 'PATCH',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: tpl.chain }),
      },
    )
    if (res.ok) {
      ok++
    } else {
      console.error(`  ⚠️ 「${r.template}」写入失败：HTTP ${res.status}`)
    }
  }

  console.log(`\n✅ 已修正：${ok}/${reports.length} 张模板（之后**新建**的单才会带上供应链；在办的单删单重开）`)
  if (ok < reports.length) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('订正失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

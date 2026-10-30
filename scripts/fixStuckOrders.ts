// env 的加载由 server/config.ts 负责（它自己 import './env'），这里不必再引一次
import { adminToken, PB_URL } from '../server/pbAdmin'
import { config } from '../server/config'
import type {
  ApprovalFlow,
  ApprovalChainItem,
  BranchTerminalMap,
  FlowContext,
  FlowGraph,
  NodeDecision,
} from '../src/types/approval'
import { APPROVAL_STATUS, branchTerminalMapOf, mainOf, rebuildChain } from '../src/types/approval'
import { flowContextOfOrder } from '../src/utils/approvalFlow'

/**
 * 一次性数据订正：把**已经卡死**的存量审批单（status=0 但永远走不动）修正掉。
 *
 * ## 背景
 *
 * 建单侧的预演校验（pages/workStream 的 createTaskForRow）只拦**新单**；
 * 在那之前建出来的旧单里混着三种「永远动不了」的，一直挂在「进行中」：
 *   ① 流程建出来时就已经走完（rebuildChain 判 done，但 status 忘了写终态）；
 *   ② 当前环节没有任何审批人（模板配置问题）；
 *   ③ 流程卡住（结论没绑分支 / 疑似成环，rebuildChain 的 end.kind === 'stuck'）。
 *
 * ## 本脚本做什么、不做什么
 *
 *   · **自动修**：只有第 ① 类 —— 用应用自身同一套引擎（rebuildChain + 快照）重演一遍，
 *     引擎说「已走完」就按 outcome 把 status 补成 1（通过）/ 2（驳回）。
 *     走应用自己的引擎而不是手写规则，是为了与页面显示**同一个口径**，不会修出第二种漂移。
 *   · **只报告**：第 ② ③ 类不能靠改 status「假装办完」—— 那是在编造一个没人做过的审批决定。
 *     正确路径是修模板 → 删单（DeleteOrderButton / PB 后台）→ 重新开启任务。
 *
 * ## 为什么用管理员接口而不是直接改 SQLite
 *
 * 同 scripts/backfillCompanyName.ts：PB 开着 WAL，停服直改 data.db 有覆盖写入的风险；
 * 走 REST API 不停服、PATCH 局部更新只碰 status 一列。
 *
 * ## 用法
 *
 *   yarn tsx scripts/fixStuckOrders.ts          # 只出报告，不落库（默认 dry-run）
 *   yarn tsx scripts/fixStuckOrders.ts --apply  # 真正修正（只改第 ① 类）
 *
 * 依赖 `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`（approval_chain 的写规则对普通用户不开放）。
 */

/** 一页拉多少张：chain 快照可能几百 KB，别一口气要 500 张 */
const PER_PAGE = 50

/** 只拉进行中的单 —— 已办结的单（status 1/2）本来就是终态，没有订正一说 */
const FILTER = '(status=0)'

/** 逐条 PATCH 的并发 —— 量通常很小，10 够了 */
const CONCURRENCY = 10

/** PB 记录形状（只声明本脚本关心的字段） */
interface PbOrder {
  id: string
  order_no?: string
  status?: number
  created?: string
  chain?: {
    flow?: ApprovalFlow | null
    decisions?: NodeDecision[]
    context?: FlowContext
    chain?: ApprovalChainItem[][]
    extraMembers?: unknown
    branchTerminal?: BranchTerminalMap
    graph?: FlowGraph | null
  } | null
  expand?: { relation?: Record<string, unknown> | null } | null
}

/** 每张单的诊断结论 */
type Verdict =
  | { kind: 'fix', target: number, why: string }
  | { kind: 'keep', why: string }

/** 分页拉取全部进行中的单（不带 fields：chain 快照整个要拿回来重演流程） */
async function fetchPending (token: string): Promise<PbOrder[]> {
  const out: PbOrder[] = []
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({
      filter: FILTER,
      expand: 'relation',
      perPage: String(PER_PAGE),
      page: String(page),
    })
    const res = await fetch(
      new URL(`/api/collections/approval_chain/records?${qs}`, PB_URL).toString(),
      { headers: { Authorization: token } },
    )
    if (!res.ok) {
      throw new Error(`读取 approval_chain 失败：HTTP ${res.status}`)
    }
    const body: { items?: PbOrder[] } = await res.json()
    const items = body?.items ?? []
    if (items.length === 0) {
      break
    }
    out.push(...items)
    if (page > 200) {
      throw new Error('翻页超过 200 页还没拉完，数据量异常，中止（请人工检查）')
    }
  }
  return out
}

/** 只写 status 一列（PB 的 PATCH 是局部更新，不会碰快照等其它字段） */
async function patchStatus (id: string, status: number, token: string): Promise<boolean> {
  const res = await fetch(
    new URL(`/api/collections/approval_chain/records/${encodeURIComponent(id)}`, PB_URL).toString(),
    {
      method: 'PATCH',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    },
  )
  return res.ok
}

/** 用与页面同一套引擎重演这张单，得出「能不能修 / 该改成什么」 */
function verdictOf (rec: PbOrder): Verdict {
  const snapshot = rec.chain
  const flow = snapshot?.flow
  // 旧单只有 chain 没有 flow：引擎重演不了，乱改等于猜 —— 交人工核
  if (!flow?.length) {
    return { kind: 'keep', why: '旧单没有 flow 快照，引擎无法重演，需人工判断' }
  }
  let r: ReturnType<typeof rebuildChain>
  try {
    r = rebuildChain(
      flow,
      snapshot?.decisions ?? [],
      branchTerminalMapOf(snapshot),
      flowContextOfOrder(rec as Parameters<typeof flowContextOfOrder>[0]),
    )
  } catch (error) {
    // rebuildChain 对「数据查询/引用模板没展开」这类不完整数据是抛错的（见 types/approval 的 walkSteps）
    return { kind: 'keep', why: `重演失败（单据数据不完整）：${error instanceof Error ? error.message : String(error)}` }
  }

  if (r.done) {
    // 引擎说流程已走完 —— 这是唯一能放心自动修的一类：outcome 就是页面上本该显示的终态
    if (r.outcome === 'rejected') {
      return { kind: 'fix', target: APPROVAL_STATUS.REJECTED, why: '引擎判定流程已走完且走向驳回，status 却还是 0' }
    }
    if (r.outcome === 'approved') {
      return { kind: 'fix', target: APPROVAL_STATUS.APPROVED, why: '引擎判定流程已走完且走向通过，status 却还是 0' }
    }
    return { kind: 'keep', why: '引擎判定已结束但拿不到结论走向（罕见），需人工判断' }
  }

  // 没走完还停在半路：报出"卡在哪"，但不代做决定
  if (r.end?.kind === 'stuck') {
    return { kind: 'keep', why: `流程卡住：${r.end.reason}` }
  }
  const step = r.chain[r.currentStep]
  if (r.currentStep < 0 || !step) {
    return { kind: 'keep', why: '引擎没找到当前待办环节，需人工判断' }
  }
  if (!mainOf(step)) {
    return { kind: 'keep', why: `第 ${r.currentStep + 1} 环没有审批人（模板配置问题），应修模板后删单重开` }
  }
  return { kind: 'keep', why: '正常进行中（有当前环节也有审批人），不该动' }
}

function labelOf (rec: PbOrder): string {
  return `${rec.order_no || rec.id}（${rec.created ?? '?'} 建）`
}

async function main (): Promise<void> {
  const apply = process.argv.includes('--apply')
  const dryRun = !apply

  if (!config.pbAdminEmail || !config.pbAdminPassword) {
    console.error('❌ 未配置 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD，没法用管理员接口订正。')
    console.error('   替代路径：PocketBase 后台 /_/ → approval_chain 按 status = 0 筛选，')
    console.error('   逐张核对后手动把 status 改成 1（通过）/ 2（驳回）。')
    process.exitCode = 1
    return
  }

  const token = await adminToken()
  console.log(`拉取进行中的单：${PB_URL} ${FILTER}${dryRun ? '（默认 dry-run，加 --apply 才落库）' : '（--apply：将落库）'}`)
  const orders = await fetchPending(token)
  console.log(`共 ${orders.length} 张 status=0 的单\n`)

  const fixable: Array<{ rec: PbOrder, target: number, why: string }> = []
  const stuck: Array<{ rec: PbOrder, why: string }> = []
  let normal = 0

  for (const rec of orders) {
    const v = verdictOf(rec)
    if (v.kind === 'fix') {
      fixable.push({ rec, target: v.target, why: v.why })
    } else if (/卡住|没有审批人|无法重演|数据不完整|需人工/.test(v.why)) {
      stuck.push({ rec, why: v.why })
    } else {
      normal++
    }
  }

  if (fixable.length > 0) {
    console.log(`── 可自动修正（引擎判已走完）：${fixable.length} 张`)
    for (const f of fixable) {
      console.log(`  ${labelOf(f.rec)}：status → ${f.target}（${f.why}）`)
    }
  } else {
    console.log('── 可自动修正：0 张')
  }

  if (stuck.length > 0) {
    console.log(`\n── 不能自动修（改状态等于编造审批决定），需要人处理：${stuck.length} 张`)
    for (const s of stuck) {
      console.log(`  ${labelOf(s.rec)}：${s.why}`)
    }
    console.log('  处理路径：修正模板 → 删除这张单（审批页删除按钮 / PB 后台）→ 在工作台重新开启任务')
  }

  console.log(`\n── 正常进行中（不动）：${normal} 张`)
  if (orders.length === 0) {
    console.log('没有 status=0 的单，无事可做。')
    return
  }

  if (dryRun) {
    console.log('\ndry-run 结束：未落库。确认无误后加 --apply 重跑。')
    return
  }

  if (fixable.length === 0) {
    return
  }

  let ok = 0
  for (let i = 0; i < fixable.length; i += CONCURRENCY) {
    const chunk = fixable.slice(i, i + CONCURRENCY)
    const oks = await Promise.all(chunk.map(f =>
      patchStatus(f.rec.id, f.target, token).catch(() => false),
    ))
    ok += oks.filter(Boolean).length
  }

  console.log(`\n✅ 已修正：${ok}/${fixable.length} 张`)
  if (ok < fixable.length) {
    console.error(`⚠️ 有 ${fixable.length - ok} 条没改成，建议重跑一次本脚本（已成功的不会再处理）`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('订正失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

/**
 * gen-approval-template.ts
 *
 * 从飞书白板生成**审批流模板**，写入 PocketBase 的 `app_chain`（可直接在「审批模板」编辑器里打开继续改）。
 *
 * 用法：
 *   npx tsx scripts/gen-approval-template.ts                     # 按业务段生成多张模板并入库
 *   npx tsx scripts/gen-approval-template.ts --dry-run           # 只转换 + 体检，不写库
 *   npx tsx scripts/gen-approval-template.ts --segment=o7:54     # 只生成某一段
 *   npx tsx scripts/gen-approval-template.ts --whole             # 不分段，整张图当一张（默认不这样）
 *   npx tsx scripts/gen-approval-template.ts --name=xxx --dump=x.json
 *   npx tsx scripts/gen-approval-template.ts --wiki=<token> --board=<token>
 *
 * 为什么**按业务段**拆：白板是一张自由连线的流程图，而一张审批流模板只能表达
 * 「线性流 + 同一分支组的各走向汇聚到同一节点」。整张图直接转换会被迫丢掉大量
 * 不收敛的分支、把图切碎（实测只剩 7% 覆盖）。分区（判责 / 团队间流转 / 组别间流转 / 弃置）
 * 内部基本线性，且跨分区处本来就是业务上的交接点（判责结论「建议弃置」→ 进入弃置流程），
 * 所以一个分区 = 一张模板，段末交接在转换报告里列出来。
 *
 * 环境变量（.env.local，别提交）：FEISHU_APP_ID / FEISHU_APP_SECRET
 * 可选：PB_URL（默认 http://127.0.0.1:8091）
 *
 * 转换规则（业务方确认过的口径）：
 *   - 除「虚拟流程：重置原因」外，**所有环节都作审批环节**，审批人先用占位；
 *   - 菱形（「…？」）中**问题可直接由数据回答**的 → 条件节点 + 业务条件（见 CONDITION_RULES）；
 *     其余（侵权？、是否有回收商？…）→ 审批环节，由审批人在办理时判定；
 *   - 「是否属于呆滞库存」**不参与判定**（进来数据已经分好类），因此不生成该条件；
 *   - 矩形出线上的「接收 / 拒绝 / 建议返工 / 建议弃置 / 待定 …」→ 审批结果分支，
 *     取值对齐 APPROVAL_RESULTS（这套流程本来就是这个词汇）；
 *   - 按白板坐标落位，编辑器打开就是原图布局。
 *
 * ⚠️ 两条必须守住的规则（否则运行时选路是错的，而且不报错）：
 *   1) **带条件的出线必须排在默认出线之前** —— 运行时 matchBranch 取「第一个命中的分支」，
 *      默认分支（无条件）若排在前面会永远抢先，条件就白配了；
 *   2) 审批节点的多条出线里**必须恰好有一条不绑条件**（主线，审批通过/其余结论兜底走它），
 *      这是 graphToFlowFrom 的硬校验。
 */
import fs from 'node:fs'
import {
  argOf, fetchBoardNodes, labelOf, loadEnv, resolveBoard, tenantAuth, WIKI_TOKEN,
  type BoardNode,
} from './feishuBoard'
import { DERIVED_KEYS } from '../src/utils/biRowFields'
import { ensureRejectLoopBack, graphToFlowFrom } from '../src/utils/approvalFlow'
import { flowToChain, APPROVAL_RESULTS, type ApprovalChainItem, type ApprovalFlow, type ConditionExpr } from '../src/types/approval'

/* ==================== 参数与凭据 ==================== */

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
/** 覆盖同名模板（默认跳过，见 writeTemplate 的说明） */
const REPLACE = args.includes('--replace')
const WIKI = argOf('wiki', args) || WIKI_TOKEN
const EXPLICIT_BOARD = argOf('board', args) || ''
const NAME = argOf('name', args) || '库存管理流程 V2.0'
const PB_URL = process.env.PB_URL || process.env.VITE_PB_URL || 'http://127.0.0.1:8091'

const loadedFiles = loadEnv()
const APP_ID = process.env.FEISHU_APP_ID ?? ''
const APP_SECRET = process.env.FEISHU_APP_SECRET ?? ''

console.log(`[gen-approval-template] env 文件: ${loadedFiles.join(', ') || '（无）'}`)
console.log(`[gen-approval-template] 模式: ${DRY_RUN ? 'dry-run（不写库）' : '生成并写入 app_chain'}`)
console.log(`[gen-approval-template] 模板名: ${NAME}`)
console.log(`[gen-approval-template] PocketBase: ${PB_URL}`)
console.log('')

if (!APP_ID || !APP_SECRET) {
  console.error('❌ 缺少飞书应用凭据：请把 FEISHU_APP_ID / FEISHU_APP_SECRET 写进 .env.local')
  process.exit(1)
}

/* ==================== 业务口径 ==================== */

/** 不作为审批环节的节点（业务方指定：这是虚拟流程，不走审批） */
const SKIP_NODE_IDS = new Set(['o28:174'])

/**
 * 生成模板时**审批人一律置空**（业务方 2026-09 要求：先把环节与走向搭好，人后面配）。
 *
 * 空的代价：在编辑器里再保存会撞「请至少添加一个审批人」—— 那是保存校验，填一个即可；
 * 生成这一步走 graphToFlowFrom 的 allowEmptyMembers 豁免，否则连转换都过不去。
 */
const GENERATED_MEMBERS: ApprovalChainItem[] = []

/**
 * 「问题能由数据回答」的菱形 → 落在哪条出线上的什么条件。
 * 只登记**能落到真实字段**的；没登记的菱形一律作审批环节（由人判定），
 * 硬编一个假条件会让流程静默走错分支。
 */
interface ConditionRule {
  /** 命中出线标签 */
  match: RegExp
  /** 命中条件（可以是条件组嵌套，见 types/approval.ts 的 ConditionExpr） */
  conditions: ConditionExpr[]
  logic?: 'and' | 'or'
}
const CONDITION_RULES: Record<string, ConditionRule[]> = {
  // 近3个月平均毛利率大于0？
  'o12:111': [{ match: /是/, conditions: [{ field: DERIVED_KEYS.grossMargin, op: 'gt', value: 0 }] }],
  // 灯具产品：呆滞金额>5000元 或者 非灯具产品：>2000元（呆滞金额 = 总库存金额）
  // 这就是「分档阈值」：一组条件只有一个 logic 表达不了，用**条件组**一次写完 ——
  // (是否灯具=是 and 金额>5000) or (是否灯具=否 and 金额>2000)
  'o12:112': [{
    match: /是/,
    logic: 'or',
    conditions: [
      {
        logic: 'and',
        items: [
          { field: '是否属于灯具', op: 'eq', value: '是' },
          { field: '总库存金额', op: 'gt', value: 5000 },
        ],
      },
      {
        logic: 'and',
        items: [
          { field: '是否属于灯具', op: 'eq', value: '否' },
          { field: '总库存金额', op: 'gt', value: 2000 },
        ],
      },
    ],
  }],
  // 海外仓库存金额>=5000元 或者 本地仓库存金额>0？
  // ⚠️ 业务方口径（2026-09）：白板里的「海外仓库存金额」「呆滞金额」**就是总库存金额这一列**，
  //    不折算、不乘数量 —— 所以这两个条件直接用「总库存金额」。
  'o25:179': [{
    match: /是/,
    logic: 'or',
    conditions: [
      { field: '总库存金额', op: 'gte', value: 5000 },
      { field: '本地仓', op: 'gt', value: 0 },
    ],
  }],
  // ⚠️ 曾经把「弃置数量及金额确定」也登记成条件（想按 仓位 分本地仓/非本地仓），
  //    但它在白板上只有**一条**出线 —— condition 节点出度 < 2 会让 graphToFlowFrom 直接报错。
  //    这类"一个框里写了两个情况"的节点只能作审批环节，由人判定。
}

/** 出线标签 → 审批结论取值（对齐 APPROVAL_RESULTS） */
const RESULT_BY_LABEL: Array<[RegExp, string]> = [
  [/建议返工/, 'rework'],
  [/建议弃置/, 'discard'],
  [/部分接收/, 'part_receive'],
  [/报废清仓/, 'scrap'],
  // ⚠️ 必须排在「回收」**前面**：这条规则是"第一个匹配命中即用"，
  //    放后面的话「供应商回收」会被 /回收/ 抢先映射成 recycle（静默错，且不报错）
  [/供应商回收/, 'supplier_recycle'],
  [/回收/, 'recycle'],
  [/待定/, 'pending'],
  [/其他原因/, 'other_reason'],
  [/需求不足|市场需求/, 'lack_demand'],
  [/拒绝|驳回|不同意|否认|不通过/, 'reject'],
  // 原因分类：白板上这些分支的标签写在**目标节点标题**上（见 nameOfEdge）
  [/运营类/, 'cat_operation'],
  [/产品侵权类/, 'cat_infringe'],
  [/库存管理类/, 'cat_stock'],
  [/外部环境类/, 'cat_env'],
  [/开发类/, 'cat_dev'],
  [/供应链类/, 'cat_supply'],
]

/** 「正向」标签：作该审批节点的主线（无条件出线） */
const POSITIVE_LABEL = /^(是|同意|通过|接收|继续|确认|主线)$/

const VALID_RESULTS = new Set(APPROVAL_RESULTS.map(r => r.value))

/* ==================== 白板 → 画布 ==================== */

interface CanvasNode { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
interface CanvasEdge {
  id: string; source: string; target: string; label?: string
  data?: { conditions?: BranchCondition[]; logic?: 'and' | 'or' }
}

/** 大框（分区，内含 >= 2 个形状） */
function findZones(shapes: BoardNode[]): Set<string> {
  const zones = new Set<string>()
  for (const s of shapes) {
    if ((s.width ?? 0) < 260 || (s.height ?? 0) < 160) continue
    const inside = shapes.filter(o => o.id !== s.id
      && (o.x ?? 0) + (o.width ?? 0) / 2 > (s.x ?? 0)
      && (o.x ?? 0) + (o.width ?? 0) / 2 < (s.x ?? 0) + (s.width ?? 0)
      && (o.y ?? 0) + (o.height ?? 0) / 2 > (s.y ?? 0)
      && (o.y ?? 0) + (o.height ?? 0) / 2 < (s.y ?? 0) + (s.height ?? 0))
    if (inside.length >= 2) zones.add(s.id)
  }
  return zones
}

function build(all: BoardNode[]) {
  const shapes = all.filter(n => n.type === 'composite_shape')
  const notes = all.filter(n => n.type === 'sticky_note' || n.type === 'text_shape')
  const connectors = all.filter(n => n.type === 'connector')
  const zoneIds = findZones(shapes)
  /** 形状 → 所属分区（供"按版面补连线"用；画布节点只留了坐标，没有宽高，算不出归属） */
  const zoneOf = zoneMembership(shapes, zoneIds)
  const byId = new Map(all.map(n => [n.id, n]))
  const skipped: string[] = []

  /** 有出线的节点集合（判断是否"多条出线"） */
  const outCount = new Map<string, number>()
  for (const c of connectors) {
    const s = c.connector?.start_object?.id
    if (s) outCount.set(s, (outCount.get(s) ?? 0) + 1)
  }

  const nodes: CanvasNode[] = []
  const skippedIds = new Set<string>()
  const zones: string[] = []
  /** 需人工确认的地方（累积到最后一并打印，别在中间打断输出） */
  const manual: string[] = []

  const kindOf = (n: BoardNode): 'condition' | 'approval' => {
    // 菱形里"能由数据回答"的作条件节点，其余作审批环节（人判定）
    if (n.composite_shape?.type === 'diamond' && CONDITION_RULES[n.id]) return 'condition'
    return 'approval'
  }

  for (const n of shapes) {
    if (SKIP_NODE_IDS.has(n.id)) { skippedIds.add(n.id); skipped.push(`${n.id}(虚拟流程，不走审批)`); continue }
    const position = { x: Math.round(n.x ?? 0), y: Math.round(n.y ?? 0) }
    // 分区（判责流程/团队间流转…）本身也带连线，删掉会让后续环节接不上 —— 保留成环节，
    // 不想要的话在编辑器里删掉即可
    if (zoneIds.has(n.id)) zones.push(n.id)
    const kind = zoneIds.has(n.id) ? 'approval' : kindOf(n)
    if (kind === 'condition') {
      nodes.push({ id: n.id, type: 'condition', position, data: { title: labelOf(n) } })
    } else {
      nodes.push({ id: n.id, type: 'approval', position, data: { title: labelOf(n), members: [...GENERATED_MEMBERS] } })
    }
  }
  // ⚠️ 批注块不进流程：它们不是步骤，进来会变成"审批环节"（还要人工办一次），
  //    而且它们各自孤立、反而容易成为最大可达块、把主入口抢走。
  //    白板上的 a*/w* 文本框就是这类（如「需要转交审批功能」「超时提醒」）。
  for (const n of notes) {
    if (n.x === undefined || n.y === undefined) continue
    skipped.push(`${n.id}(批注块，不是审批环节)`)
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]))

  // 出线数 & 入线数（用于挑主线、找入口、判定死胡同）
  const inCount = new Map<string, number>()
  const rawEdges: { id: string; source: string; target: string; label: string }[] = []
  for (const c of connectors) {
    const s = c.connector?.start_object?.id
    const t = c.connector?.end_object?.id
    if (!s || !t || s === t) { skipped.push(`${c.id}(空端点/自环)`); continue }
    if (!nodeById.has(s) || !nodeById.has(t)) {
      const why = [s, t].filter(id => skippedIds.has(id)).length ? '端点已排除' : '端点不在图上'
      skipped.push(`${c.id}(${why})`)
      continue
    }
    inCount.set(t, (inCount.get(t) ?? 0) + 1)
    rawEdges.push({
      id: c.id, source: s, target: t,
      label: (c.connector?.captions?.data ?? []).map(d => d.text).filter(Boolean).join(' ').trim(),
    })
  }

  // 死胡同（没有出线）→ 作出口，否则分支的终点会被判成"非结束"、运行时停不对地方
  for (const n of nodes) {
    if (!outCount.get(n.id)) n.type = 'end'
  }

  // ⚠️ 条件节点必须有**至少两条**出边：graphToFlowFrom 对 condition 节点直接调 collectBranches，
  //    出度 < 2 会整体报「条件分支至少需要两条出边」而转换失败。
  //    白板上确实有"菱形但只有一条出线"的（如「弃置数量及金额确定」），这类退回审批环节。
  for (const n of nodes) {
    if (n.type === 'condition' && (outCount.get(n.id) ?? 0) < 2) {
      n.type = 'approval'
      n.data = { title: n.data.title, members: [...GENERATED_MEMBERS] }
      manual.push(`${n.id}「${String(n.data.title).slice(0, 20)}」只有一条出线 → 退回审批环节（菱形里写了两个情况，只能由人判定）`)
    }
  }

  /** 逐源节点整理出线：带条件的排前面，默认（无条件）排最后 */
  const edgeList: CanvasEdge[] = []
  const sources = [...new Set(rawEdges.map(e => e.source))]
  for (const src of sources) {
    const outs = rawEdges.filter(e => e.source === src)
    const srcNode = nodeById.get(src)!
    if (outs.length === 1) {
      const e = outs[0]
      edgeList.push({ id: e.id, source: e.source, target: e.target, ...(e.label ? { label: e.label } : {}) })
      continue
    }
    const conditioned: CanvasEdge[] = []
    let main: CanvasEdge | null = null
    const title = String(srcNode.data.title ?? src).slice(0, 18)

    /**
     * 分支名：白板标签优先；**没写标签时用目标节点的标题**。
     * 这张白板大量分支是靠"箭头的落点"表意的（如「筛选一级原因/二级原因 → 运营类 / 产品侵权类 …」，
     * 线上一个字都没有），目标标题才是真正的分支语义。
     */
    const nameOf = (e: { target: string; label: string }) =>
      e.label || String(nodeById.get(e.target)?.data.title ?? '').slice(0, 20) || `分支${e.id}`

    if (srcNode.type === 'condition') {
      const rules = CONDITION_RULES[src] ?? []
      for (const e of outs) {
        const name = nameOf(e)
        const rule = rules.find(r => r.match.test(name))
        if (rule) conditioned.push({
          id: e.id, source: e.source, target: e.target, label: name,
          data: { conditions: rule.conditions, ...(rule.logic ? { logic: rule.logic } : {}) },
        })
        else main = main ?? { id: e.id, source: e.source, target: e.target, label: name }
      }
      if (!conditioned.length) {
        manual.push(`${src}「${title}」未登记数据条件 → 已作审批判定（由人在办理时选走向）`)
      }
    } else {
      // 审批节点：正向标签作主线（不绑条件），其余绑审批结论
      const positive = outs.find(e => POSITIVE_LABEL.test(nameOf(e))) ?? outs.find(e => !nameOf(e)) ?? outs[0]
      const dropped: string[] = []
      for (const e of outs) {
        if (e.id === positive.id) {
          main = { id: e.id, source: e.source, target: e.target, label: nameOf(e) }
          continue
        }
        const name = nameOf(e)
        const hit = RESULT_BY_LABEL.find(([re]) => re.test(name))
        const value = hit?.[1]
        if (!value || !VALID_RESULTS.has(value)) {
          // 认不出的分支不能瞎绑结论（绑错运行时选路就走错支）；
          // 又因为审批节点**只能有一条**无条件出线（转换器硬校验），
          // 这类分支只能先丢掉并报出来，由人工在编辑器里补结论或补条件。
          dropped.push(name)
          continue
        }
        conditioned.push({
          id: e.id, source: e.source, target: e.target, label: name,
          data: { conditions: [{ field: 'result', op: 'eq', value }] },
        })
      }
      if (dropped.length) {
        manual.push(`${src}「${title}」有 ${dropped.length} 条出线对不上审批结论（${dropped.slice(0, 4).join('/')}${dropped.length > 4 ? '…' : ''}）→ 已暂不生成该分支，需人工补结论或条件`)
      }
    }

    edgeList.push(...conditioned)
    if (main) edgeList.push(main)
  }

  return { nodes, edges: edgeList, zoneIds: zones, zoneOf, skipped, manual, inCount }
}

/* ==================== 按版面补齐缺失的连线 ==================== */

/**
 * 白板是靠**版面**表意的：111 个框只有 86 条箭头，余下的顺序人一眼就懂、
 * 脚本只看到孤岛（「📅 每周定时处理库存数据」往后只能走到 4 个节点就是这个原因）。
 *
 * 做法：给每个「没有入线」的框，从**阅读顺序上紧挨着的前一个框**补一条箭头。
 * 这里补的是**合成箭头**（形状和飞书返回的连线一样），交给 build() 走后面的正规流程 ——
 * 这样「按目标标题当分支名 → 能对上审批结论就绑 → 归位主线」那套策略自动适用，
 * 不需要为推断出来的边再写一遍。
 *
 * ⚠️ 推断就是推断：
 *   - 原白板上的箭头一条都不动，只在"完全没入线"的框上补；
 *   - 补出来的每条都会打印出来，**请人工核对**（顺序不对就在白板上补真箭头，或加 --no-fill）；
 *   - 结束框不给补入线（它没出线是正常的），批注块（a 或 w 开头、text_shape / sticky_note）不参与。
 */
function inferConnectorsByLayout(
  shapes: BoardNode[], connectors: BoardNode[], zoneIds: Set<string>,
): { synthetic: BoardNode[]; inferred: string[] } {
  const meta = new Map(shapes.map(s => [s.id, { x: s.x ?? 0, y: s.y ?? 0, type: s.type, title: labelOf(s).replace(/\s+/g, ' ').slice(0, 24) }]))
  const hasIn = new Set<string>()
  for (const c of connectors) {
    const t = c.connector?.end_object?.id
    if (t && meta.has(t)) hasIn.add(t)
  }

  const isNote = (id: string, type: string) => /^[aw]\d/.test(id) || type === 'text_shape' || type === 'sticky_note'
  const isEndTitle = (id: string) => /结束|完成|归档|留存/.test(meta.get(id)?.title ?? '')

  const member = zoneMembership(shapes, zoneIds)
  const zoneSet = new Set(zoneIds)
  const groups = new Map<string, string[]>()
  for (const s of shapes) {
    if (isNote(s.id, s.type)) continue
    // 分区节点归进**它自己的分区**（zoneMembership 会跳过分区自身）。
    // 归到"分区外"的话，链永远接不进分区内部，每个分区都变成没入口的孤岛。
    const key = zoneSet.has(s.id) ? s.id : (member.get(s.id) ?? '__outside__')
    groups.set(key, [...(groups.get(key) ?? []), s.id])
  }

  const synthetic: BoardNode[] = []
  const inferred: string[] = []
  for (const [key, ids] of groups) {
    // 阅读顺序：先 y 后 x（这张白板自上而下走）
    const ordered = ids.sort((a, b) => (meta.get(a)!.y - meta.get(b)!.y) || (meta.get(a)!.x - meta.get(b)!.x))
    let prev = ''
    for (const id of ordered) {
      const m = meta.get(id)!
      if (isNote(id, m.type)) continue
      // 缺入线、且不是结束框 → 从阅读顺序上的前一个框接一条
      if (!hasIn.has(id) && prev && !isEndTitle(id)) {
        synthetic.push({
          id: `__fill__${prev}__${id}`, type: 'connector',
          connector: { start_object: { id: prev }, end_object: { id } },
        })
        hasIn.add(id)
        inferred.push(`${meta.get(prev)!.title} → ${m.title}（${key === '__outside__' ? '分区外' : '分区内'}按版面顺序推断）`)
      }
      prev = id
    }
  }
  return { synthetic, inferred }
}

/* ==================== 收敛修复 ==================== */

/**
 * 让转换器自己判定哪些分支留不下。
 *
 * ApprovalFlow 要求「同一分支组的各走向必须汇聚到同一个节点」，白板未必满足。
 *
 * ⚠️ 别用「模拟走一遍、按终点分组、保留最大组」那种做法（第一版就是它）：
 *    转换器判定汇聚的依据是「与本分支组的**兄弟分支**相遇」，而模拟里只能用「入度>1」当代理 ——
 *    两者不等价，会把本来能转换的分支也砍掉，整张图被切碎（实测只剩 7% 覆盖）。
 *
 * 这里改成试探：逐个多出线节点，试着删掉它的非主线分支，**能转换通过**才保留这个删法。
 * 累积进行，所以"需要同时删两处"的情况也能收敛。删掉的分支逐条报出，人工可在编辑器里补回。
 */
function repairConvergence(nodes: CanvasNode[], edges: CanvasEdge[]) {
  const titleOf = (id: string) => String(nodes.find(n => n.id === id)?.data.title ?? id)
  let kept = edges
  const repaired: string[] = []
  const multiSources = [...new Set(kept.map(e => e.source))]
    .map(src => ({ src, outs: kept.filter(e => e.source === src) }))
    .filter(x => x.outs.length >= 2)
    // 先试分支少的：改动小、影响面小
    .sort((a, b) => a.outs.length - b.outs.length || (a.src < b.src ? -1 : 1))

  // 同 finalizeSegment：试删时也要带草稿豁免，否则永远「有错」、一次也修不动
  const FIX_OPTS = { allowEmptyMembers: true }

  /*
   * ⚠️ 判据必须是「**当前仍然转换失败**，删掉这一条之后才通过」：
   *    只看"删掉后能通过"是错的 —— 之前已经修好时它同样"能通过"，
   *    于是会把**本来没问题的分支**也一条条砍掉（实测弃置流程 24 个框被砍到只剩 4 个）。
   * 因此：每轮先看整体是否已通过，通过就立刻停；否则一次只删一条，第一条见效即收手。
   */
  for (let pass = 0; pass < 8; pass++) {
    if (!graphToFlowFrom(nodes, kept, FIX_OPTS).error) break
    let changed = false
    for (const { src } of multiSources) {
      if (!graphToFlowFrom(nodes, kept, FIX_OPTS).error) break
      const now = kept.filter(e => e.source === src)
      if (now.length < 2) continue
      const mainEdge = now.find(e => !e.data?.conditions) ?? now[0]
      for (const extra of now.filter(e => e.id !== mainEdge.id)) {
        const trial = kept.filter(e => e.id !== extra.id)
        if (graphToFlowFrom(nodes, trial, FIX_OPTS).error) continue
        kept = trial
        changed = true
        repaired.push(
          `${src}「${titleOf(src).slice(0, 16)}」的分支「${String(extra.label)}」走向无法与主线汇聚 → 暂不生成`,
        )
        break   // 这一条修好就够了，别再动这个环节的其它分支
      }
    }
    if (!changed) break
  }
  return { edges: kept, repaired }
}

/* ==================== 分段 ==================== */

interface Segment {
  key: string
  /** 段标题（取分区名；入口段另起名） */
  title: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** 跨段出去的连线：本段的出口，也是下一段的入口 */
  handoff: string[]
}

/**
 * 按业务段切开画布。
 *
 * 段边界 = 白板上的**分区**（判责流程 / 团队间流转 / 组别间流转 / 弃置流程…）。
 * 为什么按分区分段：整张白板是自由连线的图，而一张审批模板只能表达
 * 「线性流 + 分支汇聚到同一节点」；分区内部基本是线性的，能忠实表达，
 * 而跨分区的地方正是业务上的交接点（判责结论「建议弃置」→ 进入弃置流程）。
 *
 * 分段规则：从入口出发走，走到分区节点就"翻页"——该分区及其后续归入该分区自己的段。
 * 入口走不到的分区也各自成段（它自己就是一条完整业务流）。
 * 分区节点**保留为段内第一个环节**（它带出线，删掉会丢分支），不想要可在编辑器里删。
 */
function splitSegments(
  nodes: CanvasNode[], edges: CanvasEdge[], zoneIds: string[], entry: string, whole: boolean,
  zoneOf: Map<string, string>,
): Segment[] {
  const titleOf = (id: string) => String(nodes.find(n => n.id === id)?.data.title ?? id)
  const out = new Map<string, string[]>()
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target])

  /** 归属：node → 段 key */
  const segOf = new Map<string, string>()
  if (whole) {
    const seen = new Set([entry])
    const queue = [entry]
    while (queue.length) {
      for (const next of out.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next) }
      }
    }
    for (const id of seen) segOf.set(id, 'entry')
  } else {
    /*
     * 段归属**按几何**（这个框落在哪个分区里），不按箭头可达性走。
     *
     * ⚠️ 之前按箭头走，结果是空的：白板上约 40 个框没有箭头进出，
     *    可达性一断，段里就只剩 1~3 个框（实测覆盖率 7%，生成出来是空壳）。
     *    几何归属和箭头无关，每个分区能拿到它的**全部**框。
     * 只出分区段：分区之外是主干（定时 → 评审 → 原因/处置）与说明块，不属于这几张模板。
     */
    for (const n of nodes) {
      const z = zoneOf.get(n.id)
      if (z) segOf.set(n.id, `zone:${z}`)
    }
  }

  const groups = new Map<string, CanvasNode[]>()
  for (const n of nodes) {
    const key = segOf.get(n.id)
    if (key) groups.set(key, [...(groups.get(key) ?? []), n])
  }

  const keys = [...groups.keys()].sort((a, b) => (a === 'entry' ? -1 : b === 'entry' ? 1 : a < b ? -1 : 1))
  return keys.map((key) => {
    const segNodes = groups.get(key)!
    const segIds = new Set(segNodes.map(n => n.id))
    const handoff = edges
      .filter(e => segIds.has(e.source) && !segIds.has(e.target))
      .map(e => `${titleOf(e.source).slice(0, 12)} → ${titleOf(e.target).slice(0, 12)}`)
    const zoneId = key.startsWith('zone:') ? key.slice(5) : ''
    return {
      key, title: zoneId ? titleOf(zoneId).replace(/^[^\p{L}\p{N}]+/u, '') : '入口段（判责前）',
      nodes: segNodes,
      edges: edges.filter(e => segIds.has(e.source) && segIds.has(e.target)),
      handoff,
    }
  })
}

/* ==================== 白板体检：待补连线清单 ==================== */

/** 形状 → 所属分区（取**最小**的包含它的分区，兼容分区嵌套）；不在任何分区则为空 */
function zoneMembership(shapes: BoardNode[], zoneIds: Set<string>): Map<string, string> {
  const zones = shapes.filter(s => zoneIds.has(s.id))
  const of = new Map<string, string>()
  for (const s of shapes) {
    if (zoneIds.has(s.id)) continue
    const cx = (s.x ?? 0) + (s.width ?? 0) / 2
    const cy = (s.y ?? 0) + (s.height ?? 0) / 2
    const hits = zones
      .filter(z => cx > (z.x ?? 0) && cx < (z.x ?? 0) + (z.width ?? 0)
        && cy > (z.y ?? 0) && cy < (z.y ?? 0) + (z.height ?? 0))
      .sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0))
    if (hits[0]) of.set(s.id, hits[0].id)
  }
  return of
}

/**
 * 打印「哪些框缺箭头」——白板是按版面表意的，脚本只能读箭头，
 * 缺箭头的地方人和机器看到的东西完全不同（人看到顺序，机器看到孤岛）。
 * 这里按分区、按阅读顺序（y 再 x）列出来，照着一处处补就行。
 */
function reportGaps(shapes: BoardNode[], connectors: BoardNode[], skippedIds: Set<string>) {
  const shapeIds = new Set(shapes.filter(s => !skippedIds.has(s.id)).map(s => s.id))
  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  for (const c of connectors) {
    const s = c.connector?.start_object?.id
    const t = c.connector?.end_object?.id
    if (!s || !t || s === t || !shapeIds.has(s) || !shapeIds.has(t)) continue
    outDeg.set(s, (outDeg.get(s) ?? 0) + 1)
    inDeg.set(t, (inDeg.get(t) ?? 0) + 1)
  }

  const zoneIds = findZones(shapes)
  const member = zoneMembership(shapes, zoneIds)
  const titleOf = (n: BoardNode) => labelOf(n).replace(/\s+/g, ' ').slice(0, 40) || '(无文字)'
  const isEndTitle = (n: BoardNode) => /结束|完成|归档|留存/.test(labelOf(n))

  const groups = new Map<string, BoardNode[]>()
  const push = (key: string, n: BoardNode) => groups.set(key, [...(groups.get(key) ?? []), n])
  for (const n of shapes) {
    if (skippedIds.has(n.id)) continue
    push(member.get(n.id) ?? '__outside__', n)
  }

  const order = [...groups.keys()].sort((a, b) => {
    if (a === '__outside__') return 1
    if (b === '__outside__') return -1
    const za = shapes.find(s => s.id === a)!, zb = shapes.find(s => s.id === b)!
    return (za.y ?? 0) - (zb.y ?? 0) || (za.x ?? 0) - (zb.x ?? 0)
  })

  let gaps = 0
  console.log('')
  console.log('==================== 待补连线清单（照着补箭头即可） ====================')
  for (const key of order) {
    const items = groups.get(key)!
    const zoneNode = shapes.find(s => s.id === key)
    const label = key === '__outside__' ? '分区之外' : `分区「${titleOf(zoneNode!)}」`
    const bad = items.filter(n => {
      const i = inDeg.get(n.id) ?? 0
      const o = outDeg.get(n.id) ?? 0
      if (isEndTitle(n)) return false          // 「流程结束」本来就没有出线，不算缺口
      return i === 0 || o === 0
    })
    console.log('')
    console.log(`── ${label}：${items.length} 个框，其中 ${bad.length} 个缺箭头`)
    for (const n of items.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))) {
      const i = inDeg.get(n.id) ?? 0
      const o = outDeg.get(n.id) ?? 0
      if (isEndTitle(n)) continue
      if (i && o) continue
      gaps++
      const why = !i && !o ? '❌ 孤立：无进无出' : !i ? '⚠️ 缺入线' : '⚠️ 缺出线'
      console.log(`   ${why}  ${n.id}  ${titleOf(n)}`)
    }
  }
  console.log('')
  console.log(`共 ${gaps} 个框缺箭头（分区/顺序见上）。补齐后重跑本脚本即可生成模板。`)
  console.log('======================================================================')
  return gaps
}

/* ==================== 段 → 模板 ==================== */

interface Finalized {
  ok: boolean
  reason?: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  flow?: unknown
  chain?: unknown[]
  manual: string[]
}

/** 递归数 flow 里的审批步骤数（空审批人时 flowToChain 会拍出空 chain，不能拿 chain 判） */
function countFlowSteps(nodes: ApprovalFlow): number {
  let n = 0
  const walkSteps = (steps: { type?: string; branches?: { steps: any[] }[] }[] | undefined) => {
    for (const s of steps ?? []) {
      if (s.type === 'branch') for (const b of s.branches ?? []) walkSteps(b.steps)
      else n++
    }
  }
  for (const node of nodes) {
    if (node.type === 'approval') n++
    else for (const b of node.branches) walkSteps(b.steps)
  }
  return n
}

/**
 * 把一段画布收尾成一张可直接保存的审批流。
 * 与编辑器保存走**同一套**转换（graphToFlowFrom → ensureRejectLoopBack → flowToChain），
 * 所以产物和手工在编辑器里保存出来的完全同构。
 */
function finalizeSegment(seg: Segment): Finalized {
  const expected = seg.nodes.length
  const manual: string[] = []
  const nodes = seg.nodes.map(n => ({ ...n, data: { ...n.data } }))
  let edges = seg.edges.map(e => ({ ...e }))

  // 段内出度：没出线的作出口；条件节点出度 <2 退回审批
  // （graphToFlowFrom 对 condition 节点直接调 collectBranches，出度 <2 会整体报错）
  const outDeg = new Map<string, number>()
  for (const e of edges) outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1)
  for (const n of nodes) {
    const deg = outDeg.get(n.id) ?? 0
    if (n.type === 'condition' && deg < 2) {
      n.type = 'approval'
      n.data = { title: n.data.title, members: [...GENERATED_MEMBERS] }
    } else if (deg === 0 && n.type !== 'end') {
      // 出线都跨到了别的段 → 本段出口。
      // 不作结束的话，转换器会把这条分支的终点标成"非结束"，运行时走到这里收不了尾。
      n.type = 'end'
    }
  }

  /*
   * 段内多个结束节点合并成一个。
   * 两个原因：① 转换器要求「同一分支组的各走向必须汇聚到同一终点」，
   *    各自接各自的"流程结束"框会被判成"多条分支必须汇聚到同一个节点"而保存失败
   *    （白板正是每个分支都有自己一个结束框）；
   * ② 一张审批流只有一个「结束」也更自然。
   */
  const endNodes = nodes.filter(n => n.type === 'end')
  if (endNodes.length > 1) {
    const keep = endNodes[0].id
    const dropIds = new Set(endNodes.slice(1).map(n => n.id))
    edges = edges.map(e => (dropIds.has(e.target) ? { ...e, target: keep } : e))
    for (let i = nodes.length - 1; i >= 0; i--) if (dropIds.has(nodes[i].id)) nodes.splice(i, 1)
    manual.push(`段内 ${endNodes.length} 个结束节点合并为 1 个（各分支汇聚到同一终点）`)
  }

  // start → 段内没有入线的第一个节点
  const hasIn = new Set(edges.map(e => e.target))
  const roots = nodes.filter(n => n.type !== 'end' && !hasIn.has(n.id)).map(n => n.id)
  if (!roots.length) return { ok: false, reason: '段内找不到入口节点（可能全是环）', nodes, edges, manual }
  if (roots.length > 1) {
    manual.push(`段内有 ${roots.length} 个起点，只从「${String(nodes.find(n => n.id === roots[0])?.data.title).slice(0, 14)}」接入`)
  }
  const startId = '__start__'
  nodes.unshift({
    id: startId, type: 'start',
    position: {
      x: nodes.find(n => n.id === roots[0])!.position.x,
      y: Math.min(...nodes.map(n => n.position.y)) - 90,
    },
    data: { title: '开始' },
  })
  edges = [{ id: '__e_start__', source: startId, target: roots[0] }, ...edges]

  // 只保留从 start 可达的部分（段内也可能有接不上的小块）
  const outMap = new Map<string, string[]>()
  for (const e of edges) outMap.set(e.source, [...(outMap.get(e.source) ?? []), e.target])
  const seen = new Set([startId])
  const queue = [startId]
  while (queue.length) {
    for (const t of outMap.get(queue.shift()!) ?? []) if (!seen.has(t)) { seen.add(t); queue.push(t) }
  }
  const keptNodes = nodes.filter(n => seen.has(n.id))
  const keptEdges = edges.filter(e => seen.has(e.source) && seen.has(e.target))
  const missing = nodes.length - keptNodes.length
  if (missing) manual.push(`段内有 ${missing} 个节点接不到主线 → 未纳入`)

  const fixed = repairConvergence(keptNodes, keptEdges)
  manual.push(...fixed.repaired)

  // 草稿豁免：生成的模板审批人为空（人后配），不豁免的话这里一律卡在「请至少添加一个审批人」
  const { flow: rawFlow, error } = graphToFlowFrom(keptNodes, fixed.edges, { allowEmptyMembers: true })
  if (error) return { ok: false, reason: error, nodes: keptNodes, edges: fixed.edges, manual }

  const flow = ensureRejectLoopBack(rawFlow)
  const chain = flowToChain(flow)

  /*
   * 安全闸：转换"成功"不等于"结果可用" —— 上面可能删掉了不收敛的分支、
   * 也可能有节点接不到主线。覆盖率不达标就不写库，宁可不生成，也不要一张漏环节的模板。
   * （分段后每段内部基本线性，这个闸主要是兜底，正常段都能过。）
   */
  const ratio = (keptNodes.length - 1) / (expected || 1)
  // ⚠️ 不能用 chain.length 判：生成的模板审批人是空的，flowToChain 会跳过空成员的环节
  //    （pushMembers 里 `if (members && members.length)`），于是 chain 恒为空数组。
  //    按 flow 里真实的审批步骤数判才准。
  const steps = countFlowSteps(flow)
  if (steps < 2 || ratio < 0.7) {
    return {
      ok: false,
      reason: `覆盖率不足（纳入 ${keptNodes.length - 1}/${expected} = ${(ratio * 100).toFixed(0)}%，链路 ${steps} 个环节）`,
      nodes: keptNodes, edges: fixed.edges, manual,
    }
  }
  return { ok: true, nodes: keptNodes, edges: fixed.edges, flow, chain, manual }
}

interface WriteResult { id: string; action: 'created' | 'replaced' | 'skipped' }

/**
 * 写模板。
 *
 * ⚠️ 默认**同名就跳过**，不覆盖：生成出来的模板是要人接着改的（替换审批人、调结构），
 *    重跑时把改动冲掉是最糟的。要拿新版就先删旧模板，或加 --replace。
 *    （白板补箭头后一定会重跑，所以这一步必须挡重名，否则每跑一次多一张同名模板。）
 */
async function writeTemplate(name: string, payload: unknown): Promise<WriteResult> {
  const q = `${PB_URL}/api/collections/app_chain/records?perPage=1&filter=${encodeURIComponent(`name="${name}"`)}`
  const found = await (await fetch(q)).json().catch(() => null) as any
  const existing = found?.items?.[0]
  if (existing && !REPLACE) return { id: existing.id, action: 'skipped' }

  const res = await fetch(
    existing
      ? `${PB_URL}/api/collections/app_chain/records/${existing.id}`
      : `${PB_URL}/api/collections/app_chain/records`,
    {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, status: 1, chain: payload }),
    },
  )
  const saved = await res.json().catch(() => null) as any
  if (!res.ok) throw new Error(`写入 app_chain 失败：HTTP ${res.status} ${saved?.message ?? ''}`)
  return { id: saved?.id, action: existing ? 'replaced' : 'created' }
}

/* ==================== 主流程 ==================== */

async function main() {
  const auth = await tenantAuth(APP_ID, APP_SECRET)
  const { board, from } = await resolveBoard(auth, WIKI, EXPLICIT_BOARD)
  console.log(`[gen] 白板 ${board}（${from}）`)

  /*
   * ⚠️ 必须自己排一遍序：飞书返回的节点顺序**不稳定**，同一份白板两次可能不同。
   * 顺序会一路影响到"按版面补连线"的分组遍历、以及主入口的挑选（实测同一天跑两次，
   * 入口候选在 10~26 之间浮动、连线 88~91 条），结果无法复现。
   * 按 z_index、再按 id，保证"同一份白板 → 同一份产物"。
   */
  const all = [...(await fetchBoardNodes(auth, board))].sort(
    (a, b) => (a.z_index ?? 0) - (b.z_index ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const shapes = all.filter(n => n.type === 'composite_shape' || n.type === 'sticky_note' || n.type === 'text_shape')
  const connectors = all.filter(n => n.type === 'connector')
  const allShapesCount = shapes.length

  // 白板有约 40 个框没箭头 —— 先按版面补出**合成箭头**，再走正规转换流程
  // （不补的话每段里只有 1-3 个框，生成出来是空壳）。不想要加 --no-fill。
  const filled = args.includes('--no-fill')
    ? { synthetic: [] as BoardNode[], inferred: [] as string[] }
    : inferConnectorsByLayout(shapes, connectors, findZones(shapes))
  if (filled.inferred.length) {
    console.log(`[gen] 按版面推断补了 ${filled.inferred.length} 条连线（**需人工核对**）：`)
    for (const s of filled.inferred) console.log(`     + ${s}`)
    console.log('')
  }

  const { nodes, edges, zoneIds, zoneOf, skipped, manual } = build([...all, ...filled.synthetic])
  const titleOf = (id: string) => String(nodes.find(n => n.id === id)?.data.title ?? id).replace(/\s+/g, ' ')
  const inCount = new Map<string, number>()
  for (const e of edges) inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1)
  console.log(`[gen] 画布 ${nodes.length} 节点 / ${edges.length} 连线（白板原始 ${connectors.length} 条箭头 + 推断 ${filled.synthetic.length} 条）`)

  // 入口：没有入线、可达节点最多的那个（白板上有多个独立起点）
  const out = new Map<string, string[]>()
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target])
  const bfs = (root: string) => {
    const seen = new Set([root])
    const queue = [root]
    while (queue.length) {
      for (const t of out.get(queue.shift()!) ?? []) if (!seen.has(t)) { seen.add(t); queue.push(t) }
    }
    return seen
  }
  const rootIds = nodes.filter(n => n.type !== 'end' && !(inCount.get(n.id) ?? 0)).map(n => n.id)
  if (!rootIds.length) throw new Error('找不到入口节点（所有节点都有入线，疑似有环）')
  const comps = rootIds.map(id => ({ id, size: bfs(id).size }))
    .sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1))

  // 缺箭头清单：白板按版面表意，缺箭头处人和机器看到的东西完全不同。
  // 每次都打（补箭头阶段这是最需要的信息），--check 时打完就退出。
  // 用**白板原始形状/连线**统计（不能用画布：画布已经把孤立点也算成节点了）
  reportGaps(
    all.filter(n => n.type === 'composite_shape' || n.type === 'sticky_note' || n.type === 'text_shape'),
    all.filter(n => n.type === 'connector'),
    new Set(SKIP_NODE_IDS),
  )
  if (args.includes('--check')) {
    console.log('（--check：只体检，不生成）')
    return
  }

  // 入口：默认取可达节点最多的那个；--entry=<id> 可钉住（补箭头过程中很常用）
  const pinned = argOf('entry', args) || ''
  if (pinned && !nodes.some(n => n.id === pinned)) {
    throw new Error(`--entry=${pinned} 在画布上不存在（可用入口：${comps.slice(0, 8).map(c => c.id).join(', ')}）`)
  }
  const entry = pinned || comps[0].id
  console.log(`[gen] 独立入口 ${comps.length} 个，主入口取 ${entry}「${titleOf(entry).slice(0, 20)}」（可达 ${pinned ? bfs(pinned).size : comps[0].size} 节点）`)
  if (!pinned && !/定时|开始|发起|入口/.test(titleOf(entry))) {
    manual.push(`主入口「${titleOf(entry)}」看着不像流程起点 → 若不对，用 --entry=<节点id> 钉住（如 o1:43）`)
  }
  if (comps.length > 1) {
    manual.push(`另有 ${comps.length - 1} 个独立起点：${comps.slice(1, 6).map(c => `${c.id}(${c.size})`).join('、')}${comps.length > 6 ? ' …' : ''}`)
  }

  const only = argOf('segment', args) || ''
  let segments = splitSegments(nodes, edges, zoneIds, entry, args.includes('--whole'), zoneOf)
  if (only) segments = segments.filter(s => s.key === only || s.key === `zone:${only}`)
  if (!segments.length) {
    const available = splitSegments(nodes, edges, zoneIds, entry, false, zoneOf).map(s => s.key)
    throw new Error(`没匹配到分段「${only}」；可用：${available.join(', ')}`)
  }
  console.log(`[gen] 分成 ${segments.length} 段：${segments.map(s => `${s.title}(${s.nodes.length})`).join('、')}`)
  console.log('')

  const failed: string[] = []
  let created = 0
  for (const seg of segments) {
    const r = finalizeSegment(seg)
    // 环节数按 flow 数（chain 会跳过空审批人的环节，生成的模板里它恒为空）
    const steps = r.ok ? countFlowSteps((r.flow ?? []) as ApprovalFlow) : 0
    console.log(`${r.ok ? '✅' : '❌'} ${seg.title}：纳入 ${r.nodes.length - 1} 节点 → ${steps} 个环节${r.ok ? '' : `，${r.reason}`}`)
    if (seg.handoff.length) {
      console.log(`     段末交接：${seg.handoff.slice(0, 4).join('、')}${seg.handoff.length > 4 ? ` …（共 ${seg.handoff.length} 条）` : ''}`)
    }
    for (const m of r.manual) console.log(`     ⚠️ ${m}`)
    if (!r.ok) { failed.push(seg.title); console.log(''); continue }

    const name = `${NAME} · ${seg.title}`
    if (DRY_RUN) {
      console.log(`     （dry-run 未写库，模板名应为「${name}」）`)
      console.log('')
      continue
    }
    const payload = {
      chain: r.chain, flow: r.flow,
      graph: { nodes: r.nodes, edges: r.edges, viewport: { x: 0, y: 0, zoom: 0.6 } },
    }
    const w = await writeTemplate(name, payload)
    if (w.action === 'skipped') {
      console.log(`     已存在同名模板（id=${w.id}）→ **跳过不覆盖**；要覆盖加 --replace，想并存就换 --name=`)
    } else {
      created++
      console.log(`     ${w.action === 'replaced' ? '已覆盖' : '已写入'}模板「${name}」 id=${w.id}`)
    }
    console.log('')
  }

  if (skipped.length) {
    console.log(`[gen] 跳过连线 ${skipped.length} 条：${skipped.slice(0, 8).join('、')}${skipped.length > 8 ? ' …' : ''}`)
  }
  if (manual.length) {
    console.log(`[gen] ⚠️ 白板层面待确认 ${manual.length} 条：`)
    for (const m of manual) console.log(`     - ${m}`)
  }
  console.log('')
  const okCount = segments.length - failed.length
  if (DRY_RUN) {
    console.log(`✅ dry-run 结束：${okCount}/${segments.length} 段可生成（去掉 --dry-run 才会写库）`)
  } else {
    console.log(`✅ 完成：写入 ${created} 张模板；未通过 ${failed.length} 段${failed.length ? '：' + failed.join('、') : '（无）'}`)
  }
  if (!okCount) process.exit(1)
  if (failed.length) process.exit(2)
}

try {
  await main()
} catch (err: any) {
  console.error('')
  console.error('❌ 生成失败: ' + (err?.message ?? err))
  process.exit(1)
}

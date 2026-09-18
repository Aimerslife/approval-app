/**
 * gen-inventory-flow.ts
 *
 * 从飞书白板生成 StreamPanel 的流程数据：src/data/inventoryFlow.ts
 *
 * 用法：
 *   npx tsx scripts/gen-inventory-flow.ts                  # 重新生成（覆盖 src/data/inventoryFlow.ts）
 *   npx tsx scripts/gen-inventory-flow.ts --dry-run        # 只拉取并对比，不写文件
 *   npx tsx scripts/gen-inventory-flow.ts --wiki=<token>   # 换一份文档（默认用下面 WIKI_TOKEN）
 *   npx tsx scripts/gen-inventory-flow.ts --board=<token>  # 直接指定白板，跳过 wiki/blocks 解析
 *   npx tsx scripts/gen-inventory-flow.ts --out=<path>     # 换输出文件
 *
 * 环境变量（写在 .env.local，**不要提交**）：
 *   FEISHU_APP_ID / FEISHU_APP_SECRET
 * 该应用需要能**只读**访问这份文档/白板（否则接口会返回权限错误码）。
 *
 * 为什么用生成而不是手写：白板上有 100+ 形状 / 120 条连线，手抄必漏；
 * 而且坐标、尺寸、配色、连线两端都是原图信息，手改一次就和原图对不上了。
 * 流程要改的正确顺序：**改飞书白板 → 重跑本脚本**。
 *
 * ⚠️ 输出里**不含时间戳**（故意）：带了的话每次跑都会产生 diff，
 * 「跑两次结果一致」这个性质就没了，也没法用 --dry-run 判断"有没有真变化"。
 * 顺序也是**确定**的（节点按白板 z_index、连线按 id），保证同一份白板必得同一份文件。
 */
import fs from 'node:fs'
import path from 'node:path'

/* ==================== 参数与凭据 ==================== */

/** 默认文档：飞书 wiki「库存管理流程规范 V2.0」（管理部门：财务BP） */
const WIKI_TOKEN = 'L7Kswh8ZSivLB3kXrj1cacQHnUe'
/** 输出文件 */
const DEFAULT_OUT = path.join('src', 'data', 'inventoryFlow.ts')

const args = process.argv.slice(2)
function argOf (name: string) {
  const hit = args.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) {
    return undefined
  }
  const eq = hit.indexOf('=')
  return eq === -1 ? '' : hit.slice(eq + 1)
}
const DRY_RUN = args.includes('--dry-run')
const WIKI = argOf('wiki') || WIKI_TOKEN
const EXPLICIT_BOARD = argOf('board') || ''
const OUT = argOf('out') || DEFAULT_OUT

/**
 * 把 .env.local / .env 读进 process.env（与 scripts/run-bi-sync.ts 同一套做法）。
 * 已存在的环境变量不覆盖，方便命令行临时指定覆盖。
 */
function loadEnv (files = ['.env.local', '.env']): string[] {
  const loaded: string[] = []
  for (const file of files) {
    if (!fs.existsSync(file)) {
      continue
    }
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][\w.]*)\s*=\s*(.*?)\s*$/i)
      if (!m || line.trim().startsWith('#')) {
        continue
      }
      const value = m[2].replace(/^["']|["']$/g, '')
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = value
      }
    }
    loaded.push(file)
  }
  return loaded
}

const loadedFiles = loadEnv()
const APP_ID = process.env.FEISHU_APP_ID ?? ''
const APP_SECRET = process.env.FEISHU_APP_SECRET ?? ''

console.log(`[gen-inventory-flow] env 文件: ${loadedFiles.join(', ') || '（无）'}`)
console.log(`[gen-inventory-flow] 模式: ${DRY_RUN ? 'dry-run（只对比，不写文件）' : '生成'} → ${OUT}`)
console.log(`[gen-inventory-flow] 输出顺序: 节点按 z_index / 连线按 id（确定性输出）`)
console.log('')

if (!APP_ID || !APP_SECRET) {
  console.error('❌ 缺少飞书应用凭据：请把 FEISHU_APP_ID / FEISHU_APP_SECRET 写进 .env.local')
  console.error('   （应用需要能只读访问目标文档；不要把这些值写进代码提交）')
  process.exit(1)
}

/* ==================== 飞书接口 ==================== */

const BASE = 'https://open.feishu.cn/open-apis'

async function call (pathname: string, init: RequestInit = {}) {
  const res = await fetch(BASE + pathname, {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...init.headers },
  })
  let body: any = null
  try {
    body = await res.json()
  } catch {
    body = await res.text()
  }
  if (res.status !== 200 || (body && typeof body === 'object' && body.code !== 0 && body.code !== undefined)) {
    const msg = body?.msg ?? body?.error ?? String(body)
    throw new Error(`${init.method ?? 'GET'} ${pathname} → HTTP ${res.status} code=${body?.code} ${msg}`)
  }
  return body
}

async function tenantToken (): Promise<string> {
  const body = await call('/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  })
  const token = body?.tenant_access_token
  if (!token) {
    throw new Error('拿不到 tenant_access_token')
  }
  return token
}

/** 分页拉全（飞书列表接口统一是 data.<field> + has_more + page_token） */
async function fetchAll (
  pathname: string,
  field: string,
  auth: Record<string, string>,
  extraQuery = '',
): Promise<any[]> {
  const out: any[] = []
  let pageToken = ''
  for (let page = 1; page <= 50; page++) {
    const q = `${extraQuery ? extraQuery + '&' : ''}page_size=500${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`
    const body = await call(`${pathname}?${q}`, { headers: auth })
    const items = body?.data?.[field] ?? []
    out.push(...items)
    if (!body?.data?.has_more) {
      // 取到的条数正好等于单页上限时提示一句：万一分页标记名字和预期不符，这里能看出来
      if (items.length === 500) {
        console.warn(`⚠️ ${pathname} 单页返回 500 条但没有 has_more 标记，可能被截断，请人工确认`)
      }
      return out
    }
    pageToken = body?.data?.page_token ?? ''
    if (!pageToken) {
      return out
    }
  }
  throw new Error(`${pathname} 分页超过 50 页，疑似异常`)
}

/** 解析出白板 token：优先用 --board，否则从 wiki → docx blocks 里找画板块 */
async function resolveBoard (auth: Record<string, string>) {
  if (EXPLICIT_BOARD) {
    return { board: EXPLICIT_BOARD, from: '--board 参数', title: '' }
  }

  const nodeBody = await call(`/wiki/v2/spaces/get_node?token=${encodeURIComponent(WIKI)}&obj_type=wiki`, { headers: auth })
  const node = nodeBody?.data?.node
  if (!node) {
    throw new Error(`wiki 节点解析失败：token=${WIKI}`)
  }
  if (node.obj_type !== 'docx') {
    throw new Error(`文档类型是 ${node.obj_type}，本脚本只认 docx。请用 --board=<白板 token> 直接指定`)
  }
  const blocks = await fetchAll(`/docx/v1/documents/${node.obj_token}/blocks`, 'items', auth, 'document_revision_id=-1')
  const boardBlock = blocks.find((b: any) => b?.board?.token)
  if (!boardBlock) {
    throw new Error(`文档「${node.title}」里没有找到画板（board）块`)
  }
  return { board: boardBlock.board.token, from: `wiki「${node.title}」`, title: node.title ?? '' }
}

/* ==================== 转换 ==================== */

/** 去掉飞书 [mentionDoc] 与链接，保留文档标题作为第二行 */
function cleanText (t = '') {
  return String(t)
    .replace(/\[mentionDoc\]/g, '\n')
    .replace(/\(https?:\/\/[^)]*\)/g, '')
    .trim()
}

/** 按填充色亮度选文字色（浅底深字、深底白字），保证深浅主题都读得清 */
function lum (hex: string) {
  const h = String(hex ?? '').replace('#', '')
  if (h.length < 6) {
    return 1
  }
  const [r, g, b] = [0, 2, 4].map(i => Number.parseInt(h.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}
const textColorFor = (fill: string) => (lum(fill) > 0.6 ? '#1f2329' : '#ffffff')

/** 白板分区填充不透明，降到半透明当底色 */
function hexToRgba (hex: string, a: number) {
  const h = String(hex ?? '').replace('#', '')
  if (h.length < 6) {
    return `rgba(148, 163, 184, ${a})`
  }
  const [r, g, b] = [0, 2, 4].map(i => Number.parseInt(h.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** 流程入口（📅 每周定时处理库存数据）：白板里它是普通药丸，这里当 start */
const START_ID = 'o1:43'

interface BoardNode {
  id: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  z_index?: number
  style?: { fill_color?: string, border_color?: string }
  text?: { text?: string }
  composite_shape?: { type?: string }
  connector?: {
    start_object?: { id?: string }
    end_object?: { id?: string }
    captions?: { data?: Array<{ text?: string }> }
  }
}

function convert (all: BoardNode[]) {
  const shapes = all.filter(n => n.type === 'composite_shape')
  const stickers = all.filter(n => n.type === 'sticky_note' || n.type === 'text_shape')
  const connectors = all.filter(n => n.type === 'connector')
  const skipped: string[] = []

  // 分区 = 内含 >= 2 个其它形状的大框（白板里就是几个大色块）
  const zoneIds = new Set<string>()
  const zones = shapes.filter(s => {
    if ((s.width ?? 0) < 260 || (s.height ?? 0) < 160) {
      return false
    }
    const inside = shapes.filter(o => o.id !== s.id
      && (o.x ?? 0) + (o.width ?? 0) / 2 > (s.x ?? 0)
      && (o.x ?? 0) + (o.width ?? 0) / 2 < (s.x ?? 0) + (s.width ?? 0)
      && (o.y ?? 0) + (o.height ?? 0) / 2 > (s.y ?? 0)
      && (o.y ?? 0) + (o.height ?? 0) / 2 < (s.y ?? 0) + (s.height ?? 0))
    if (inside.length < 2) {
      return false
    }
    zoneIds.add(s.id)
    return true
  })

  type OutNode = Record<string, any>
  const nodes: OutNode[] = []
  const round = (v: number) => Math.round(v)

  for (const z of zones) {
    nodes.push({
      id: z.id,
      type: 'zone',
      z: z.z_index ?? 0,
      position: { x: round(z.x ?? 0), y: round(z.y ?? 0) },
      data: {
        label: cleanText(z.text?.text).replace(/\n/g, ' '),
        color: hexToRgba(z.style?.fill_color ?? '', 0.32),
        border: (z.style?.border_color && z.style.border_color !== '#000000') ? z.style.border_color : '#94a3b8',
        width: round(z.width ?? 0),
        height: round(z.height ?? 0),
      },
      zIndex: -1,
    })
  }

  for (const s of shapes) {
    if (zoneIds.has(s.id)) {
      continue
    }
    const kind = s.composite_shape?.type ?? 'round_rect'
    const label = cleanText(s.text?.text)
    const fill = s.style?.fill_color ?? ''
    const stroke = s.style?.border_color ?? ''
    const data: Record<string, any> = {
      label,
      fill: fill || undefined,
      stroke: stroke && stroke !== '#000000' ? stroke : undefined,
      textColor: fill ? textColorFor(fill) : undefined,
      width: round(s.width ?? 0),
      height: round(s.height ?? 0),
    }
    let type = 'process'
    switch (kind) {
      case 'diamond': {
        type = 'decision'
        break
      }
      case 'ellipse': { type = 'process'; data.shape = 'ellipse'
        break
      }
      case 'rect': { type = 'process'; data.shape = 'rect'
        break
      }
      case 'round_rect2': {
        if (/结束/.test(label)) {
          type = 'end'
        } else if (s.id === START_ID) {
          type = 'start'
        }
        // 其余「药丸」：流程结束、财务BP终判、自产/外购、待定…
        else {
          type = 'io'; data.shape = 'stadium'
        }

        break
      }
    // No default
    }
    nodes.push({ id: s.id, type, z: s.z_index ?? 0, position: { x: round(s.x ?? 0), y: round(s.y ?? 0) }, data })
  }

  // 便签 / 文本备注：有连线指向它们，一起画上
  for (const t of stickers) {
    if (t.x === undefined || t.y === undefined) {
      continue
    }
    nodes.push({
      id: t.id,
      type: 'process',
      z: t.z_index ?? 0,
      position: { x: round(t.x), y: round(t.y) },
      data: {
        label: cleanText(t.text?.text),
        fill: '#fff7d6',
        stroke: '#d4b45b',
        textColor: '#1f2329',
        width: t.width ? round(t.width) : undefined,
        height: t.height ? round(t.height) : undefined,
        shape: 'rect',
        dashed: true,
      },
    })
  }

  const byId = new Map(nodes.map(n => [n.id, n]))
  const edges: Record<string, any>[] = []
  for (const c of connectors) {
    const s = c.connector?.start_object?.id
    const e = c.connector?.end_object?.id
    if (!s || !e) {
      skipped.push(`${c.id}(空端点)`); continue
    }
    if (s === e) {
      skipped.push(`${c.id}(自环)`); continue
    } // 自环是贴在节点上的注解，文案已在节点里
    const a = byId.get(s)
    const b = byId.get(e)
    if (!a || !b) {
      skipped.push(`${c.id}(端点不在图上)`); continue
    }
    const cap = c.connector?.captions?.data?.map(d => d.text).filter(Boolean).join(' ') ?? ''
    // 按相对方位选连接点：横向差大走左右，否则走上下（否则横向连线会被绕成 U 形）
    const dx = (b.position.x + (b.data.width ?? 120) / 2) - (a.position.x + (a.data.width ?? 120) / 2)
    const dy = (b.position.y + (b.data.height ?? 60) / 2) - (a.position.y + (a.data.height ?? 60) / 2)
    const horiz = Math.abs(dx) > Math.abs(dy) * 1.2
    edges.push({
      id: c.id,
      source: s,
      target: e,
      sourceHandle: horiz ? (dx > 0 ? 'r-s' : 'l-s') : (dy > 0 ? 'b-s' : 't-s'),
      targetHandle: horiz ? (dx > 0 ? 'l-t' : 'r-t') : (dy > 0 ? 't-t' : 'b-t'),
      label: cap || undefined,
    })
  }

  // 确定性顺序：节点按 z_index（白板层序）再按 id；连线按 id
  nodes.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)))
  edges.sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)))
  // ⚠️ skipped 也要排序：它会被写进文件头的注释里，而白板接口**每次返回的连线顺序并不固定** ——
  //    不排的话同一份白板每次生成的文件都不同，"跑两次结果一致"就没了（第一版就栽在这里，
  //    表现为 --dry-run 永远报"有变化"）。
  skipped.sort()

  return { nodes, edges, zones, shapes, stickers, connectors, skipped }
}

/* ==================== 产出 TS ==================== */

const q = (v: unknown) => JSON.stringify(v)

function emit (
  nodes: Record<string, any>[],
  edges: Record<string, any>[],
  meta: { shapes: number, connectors: number, zones: number, skipped: string[], title: string, board: string, from: string },
): string {
  const lines: string[] = [`import type { Edge, Node } from '@vue-flow/core'`, '', '/**', ' * 库存管理流程（呆滞库存）—— 由飞书白板生成，**别手改这个文件**。', ' *', ` * 来源：飞书 wiki「${meta.title || '库存管理流程规范 V2.0'}」（管理部门：财务BP）`, ` *   文档 https://u06eufr5jfy.feishu.cn/wiki/${WIKI}`, ` *   白板 ${meta.board}（解析自 ${meta.from}）`, ' *', ' * 重新生成：`npx tsx scripts/gen-inventory-flow.ts`', ' *   （流程要改就改飞书白板，然后重跑；手改这里下次生成就丢了）', ' *   --dry-run 只看有没有变化；--wiki= / --board= 可换目标。', ' *', ' * 转换规则：composite_shape.type → 节点类型（diamond→decision / ellipse→process(椭圆) /', ' *   round_rect2「…结束」→end、流程入口→start、其余→io(药丸) / 其余→process）；', ` *   坐标与尺寸取白板原值（含 x 负值）；「内含 >= 2 个形状」的大框作分区（zone），画在最底层。`, ' *   连接点按两节点相对方位分配（横向走左右），见 flowNodes/FlowHandles.vue。', ' *', ` * 规模：${nodes.length} 节点（含 ${meta.zones} 分区）+ ${edges.length} 连线`]
  lines.push(` *   （白板原始 ${meta.shapes} 形状 / ${meta.connectors} 连线，另有装饰性 svg 未收录`
    + (meta.skipped.length > 0 ? `；跳过的连线：${meta.skipped.join('、')}` : '') + '）', ' */', '', 'export const inventoryNodes: Node[] = [')
  for (const n of nodes) {
    const parts = [`id: ${q(n.id)}`, `type: ${q(n.type)}`, `position: { x: ${n.position.x}, y: ${n.position.y} }`]
    const d = n.data
    const dparts = [`label: ${q(d.label)}`]
    for (const k of ['fill', 'stroke', 'textColor', 'shape', 'color', 'border']) {
      if (d[k] !== undefined) {
        dparts.push(`${k}: ${q(d[k])}`)
      }
    }
    for (const k of ['width', 'height']) {
      if (d[k] !== undefined) {
        dparts.push(`${k}: ${d[k]}`)
      }
    }
    if (d.dashed) {
      dparts.push('dashed: true')
    }
    parts.push(`data: { ${dparts.join(', ')} }`)
    if (n.zIndex !== undefined) {
      parts.push(`zIndex: ${n.zIndex}`)
    }
    for (const k of ['draggable', 'selectable', 'connectable']) {
      parts.push(`${k}: false`)
    }
    lines.push(`  { ${parts.join(', ')} },`)
  }
  lines.push(']', '', 'export const inventoryEdges: Edge[] = [')
  for (const e of edges) {
    const parts = [`id: ${q(e.id)}`, `source: ${q(e.source)}`, `target: ${q(e.target)}`,
      `sourceHandle: ${q(e.sourceHandle)}`, `targetHandle: ${q(e.targetHandle)}`, `type: 'smoothstep'`]
    if (e.label) {
      parts.push(`label: ${q(e.label)}`)
    }
    lines.push(`  { ${parts.join(', ')} },`)
  }
  lines.push(']', '')
  return lines.join('\n')
}

/* ==================== 主流程 ==================== */

async function main () {
  const auth = { Authorization: `Bearer ${await tenantToken()}` }
  const { board, from, title } = await resolveBoard(auth)
  console.log(`[gen-inventory-flow] 白板 ${board}（${from}）`)

  const raw = (await fetchAll(`/board/v1/whiteboards/${board}/nodes`, 'nodes', auth)) as BoardNode[]
  console.log(`[gen-inventory-flow] 拉到 ${raw.length} 个白板节点`)

  const { nodes, edges, zones, shapes, connectors, skipped } = convert(raw)
  console.log(`[gen-inventory-flow] 转换：${nodes.length} 节点（含 ${zones.length} 分区）+ ${edges.length} 连线`)
  const byType = nodes.reduce<Record<string, number>>((m, n) => ((m[n.type] = (m[n.type] ?? 0) + 1), m), {})
  console.log(`[gen-inventory-flow] 类型分布 ${JSON.stringify(byType)}`)
  if (skipped.length > 0) {
    console.log(`[gen-inventory-flow] 跳过连线 ${skipped.length} 条：${skipped.join('、')}`)
  }

  // 合理性问题早失败：宁可报错，也不要生成一份和 StreamPanel 对不上的数据
  if (nodes.length === 0 || edges.length === 0) {
    throw new Error('转换结果为空，疑似白板 token 不对或权限不足')
  }
  const ids = new Set(nodes.map(n => n.id))
  const dangling = edges.filter(e => !ids.has(e.source) || !ids.has(e.target))
  if (dangling.length > 0) {
    throw new Error(`有 ${dangling.length} 条连线端点不存在，拒绝生成`)
  }
  const noSize = nodes.filter(n => n.type !== 'zone' && !(n.data.width > 0 && n.data.height > 0))
  if (noSize.length > 0) {
    throw new Error(`有 ${noSize.length} 个节点缺宽高（会造成密集区重叠），拒绝生成`)
  }

  const text = emit(nodes, edges, { shapes: shapes.length, connectors: connectors.length, zones: zones.length, skipped, title, board, from })
  const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  const changed = before !== text

  if (DRY_RUN) {
    console.log('')
    console.log(changed ? `⚠️ 有变化（文件未改动，去掉 --dry-run 才会写入）` : '✅ 与现有文件完全一致，无需重新生成')
    return
  }
  // 全部校验通过后才落盘：中途失败不会留下半个文件
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, text, 'utf8')
  console.log('')
  console.log(`✅ 已生成 ${OUT}${changed ? '' : '（内容与原来一致）'}`)
  console.log(`   节点 ${nodes.length}（分区 ${zones.length}）/ 连线 ${edges.length}`)
}

try {
  await main()
} catch (error: any) {
  console.error('')
  console.error('❌ 生成失败: ' + (error?.message ?? error))
  process.exit(1)
}

/**
 * feishuBoard.ts
 *
 * 飞书白板的**只读**拉取：凭据加载、tenant_access_token、分页、wiki→docx→画板 token 解析。
 * 供 scripts/ 下的生成脚本共用（gen-inventory-flow.ts / gen-approval-template.ts）。
 *
 * 环境变量（写在 .env.local，**不要提交**）：
 *   FEISHU_APP_ID / FEISHU_APP_SECRET
 * 该应用需要能**只读**访问目标文档/白板，否则接口返回权限错误码。
 */
import fs from 'node:fs'

/** 默认文档：飞书 wiki「库存管理流程规范 V2.0」（管理部门：财务BP） */
export const WIKI_TOKEN = 'L7Kswh8ZSivLB3kXrj1cacQHnUe'

const BASE = 'https://open.feishu.cn/open-apis'

/**
 * 把 .env.local / .env 读进 process.env（与 scripts/run-bi-sync.ts 同一套做法）。
 * 已存在的环境变量不覆盖，方便命令行临时指定覆盖 .env。
 */
export function loadEnv(files = ['.env.local', '.env']): string[] {
  const loaded: string[] = []
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][\w.]*)\s*=\s*(.*?)\s*$/)
      if (!m || line.trim().startsWith('#')) continue
      const value = m[2].replace(/^["']|["']$/g, '')
      if (process.env[m[1]] === undefined) process.env[m[1]] = value
    }
    loaded.push(file)
  }
  return loaded
}

/** 取 `--name=value` 形式的参数（不带 = 时返回空串，表示"这一步打开用默认值"） */
export function argOf(name: string, args = process.argv.slice(2)): string | undefined {
  const hit = args.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  const eq = hit.indexOf('=')
  return eq < 0 ? '' : hit.slice(eq + 1)
}

export interface FeishuAuth {
  headers: Record<string, string>
}

/** 飞书接口统一返回体：code !== 0 即失败，HTTP 200 也可能是失败 */
async function call(pathname: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(BASE + pathname, {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
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

/** 拿 tenant_access_token（应用身份） */
export async function tenantAuth(appId: string, appSecret: string): Promise<FeishuAuth> {
  const body = await call('/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const token = body?.tenant_access_token
  if (!token) throw new Error('拿不到 tenant_access_token')
  return { headers: { Authorization: `Bearer ${token}` } }
}

/** 分页拉全（飞书列表接口统一是 data.<field> + has_more + page_token） */
export async function fetchAll(
  pathname: string,
  field: string,
  auth: FeishuAuth,
  extraQuery = '',
): Promise<any[]> {
  const out: any[] = []
  let pageToken = ''
  for (let page = 1; page <= 50; page++) {
    const q = `${extraQuery ? extraQuery + '&' : ''}page_size=500${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`
    const body = await call(`${pathname}?${q}`, { headers: auth.headers })
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
    if (!pageToken) return out
  }
  throw new Error(`${pathname} 分页超过 50 页，疑似异常`)
}

/** 解析出白板 token：优先用显式指定，否则从 wiki → docx blocks 里找画板块 */
export async function resolveBoard(
  auth: FeishuAuth,
  wikiToken: string,
  explicitBoard = '',
): Promise<{ board: string; from: string; title: string }> {
  if (explicitBoard) return { board: explicitBoard, from: '--board 参数', title: '' }

  const nodeBody = await call(
    `/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}&obj_type=wiki`,
    { headers: auth.headers },
  )
  const node = nodeBody?.data?.node
  if (!node) throw new Error(`wiki 节点解析失败：token=${wikiToken}`)
  if (node.obj_type !== 'docx') {
    throw new Error(`文档类型是 ${node.obj_type}，本脚本只认 docx。请用 --board=<白板 token> 直接指定`)
  }
  const blocks = await fetchAll(
    `/docx/v1/documents/${node.obj_token}/blocks`,
    'items',
    auth,
    'document_revision_id=-1',
  )
  const boardBlock = blocks.find((b: any) => b?.board?.token)
  if (!boardBlock) throw new Error(`文档「${node.title}」里没有找到画板（board）块`)
  return { board: boardBlock.board.token, from: `wiki「${node.title}」`, title: node.title ?? '' }
}

/** 一个白板节点（只列我们用得到的字段） */
export interface BoardNode {
  id: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  z_index?: number
  style?: { fill_color?: string; border_color?: string }
  text?: { text?: string }
  composite_shape?: { type?: string }
  connector?: {
    start_object?: { id?: string }
    end_object?: { id?: string }
    captions?: { data?: Array<{ text?: string }> }
  }
}

/** 拉取整块白板的节点（形状 + 连线 + 便签） */
export async function fetchBoardNodes(auth: FeishuAuth, board: string): Promise<BoardNode[]> {
  return (await fetchAll(`/board/v1/whiteboards/${board}/nodes`, 'nodes', auth)) as BoardNode[]
}

/**
 * 去掉飞书特有的引用标记，保留文档标题作为第二行。
 * `⚖️ 判责流程[mentionDoc]全渠道呆滞库存管理制度(https://…)` → `⚖️ 判责流程\n全渠道呆滞库存管理制度`
 */
export function cleanText(t = ''): string {
  return String(t)
    .replace(/\[mentionDoc\]/g, '\n')
    .replace(/\(https?:\/\/[^)]*\)/g, '')
    .trim()
}

/** 取节点文案（已清洗），单行化（用于标题） */
export function labelOf(n: BoardNode): string {
  return cleanText(n.text?.text).replace(/\s*\n\s*/g, ' ')
}

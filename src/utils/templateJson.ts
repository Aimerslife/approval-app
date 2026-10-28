/*
 * 审批模板的 **JSON 导出 / 导入** —— 文件格式、序列化与解析都收在这里，页面只负责按钮与提示。
 *
 * ## 导出的是什么
 *
 * 只导出**可搬运的部分**：名字 + 启停状态 + 三要素（chain / flow / graph）。
 * `id` / `created` / `updated` 这些源记录元数据**一律不带** —— 它们是这台服务器上那条记录的身份证，
 * 带过去只会造成"导入后两条记录抢同一个 id"。这与页面上的「复制」同一口径（见 approvalModel 的 copyNode）。
 *
 * ## 为什么带 format / version
 *
 * 以后结构真要变（比如加字段、改 chain 的形状），靠这两个字段能认出"这是哪一版的文件"，
 * 老文件也不至于被静默解析成半个模板。解析端对未知版本**不拦**（只当提示），
 * 因为多出来的字段对导入没有坏处。
 *
 * ## 导入为什么这么宽容
 *
 * 拿到手的 JSON 可能来自：本模块导出的文件、手工拼的"只有三要素"的对象、
 * 甚至是 `addApproval(name, status, chain)` 的入参形状（`chain` 本身就是链路数组）。
 * 这几种都认 —— 用户不该为了导入去猜文件该长什么样；结构不对时抛出**能看懂的中文原因**
 * （页面直接显示，不是 "Unexpected token" 那种）。
 *
 * 导出文件长这样（缩进 2 空格，方便人看 / 进版本库 diff）：
 * ```json
 * {
 *   "format": "approval-template",
 *   "version": 1,
 *   "exportedAt": "2026-10-22T08:00:00.000Z",
 *   "name": "美2组模板",
 *   "status": 1,
 *   "chain": { "chain": [...], "flow": [...], "graph": {...} }
 * }
 * ```
 */

import type { ApprovalChain, ApprovalFlow, FlowGraph } from '@/types/approval'

/** 导出文件的标识（认文件用；和别的 JSON 混在下载目录里也能一眼分辨） */
export const TEMPLATE_JSON_FORMAT = 'approval-template'

/** 当前导出版本：结构变化时 +1（解析端只用来提示，不拦） */
export const TEMPLATE_JSON_VERSION = 1

/** 一张模板里**能搬运**的部分（= 导入时真正写库的东西） */
export interface TemplatePayload {
  name: string
  /** 0 = 未启用，1 = 启用（与 app_chain.status 同口径） */
  status: number
  chain: { chain: ApprovalChain, flow?: ApprovalFlow, graph?: FlowGraph }
}

/** 导出文件的完整形状 */
export interface TemplateJsonFile extends TemplatePayload {
  format: typeof TEMPLATE_JSON_FORMAT
  version: number
  /** 导出时间（ISO），给人看的，导回去时不用 */
  exportedAt: string
}

/** 导出用的形状：模板记录 → 文件内容（缺字段一律给安全默认，别把 undefined 写进 JSON） */
export function buildTemplateJson (
  item: { name?: string | null, status?: number | null, chain?: { chain?: ApprovalChain, flow?: ApprovalFlow, graph?: FlowGraph } | null },
): TemplateJsonFile {
  const flow = item.chain?.flow
  const graph = item.chain?.graph
  return {
    format: TEMPLATE_JSON_FORMAT,
    version: TEMPLATE_JSON_VERSION,
    exportedAt: new Date().toISOString(),
    name: String(item.name ?? '').trim() || '未命名模板',
    status: Number(item.status) === 0 ? 0 : 1,
    chain: {
      chain: (item.chain?.chain ?? []) as ApprovalChain,
      // 旧模板没有 flow / graph（只有 chain）：空数组 / 空对象不写，文件里少一行噪音
      ...(Array.isArray(flow) && flow.length > 0 ? { flow } : {}),
      ...(graph ? { graph } : {}),
    },
  }
}

/**
 * 导出用的文件名：`<模板名>.json`。
 * 去掉 Windows / macOS 都不认的字符（`/ \ : * ? " < > |`），否则下载会被浏览器静默改名。
 */
export function templateFileName (name?: string | null): string {
  const base = String(name ?? '').trim() || '审批模板'
  return `${base.replace(/[\\/:*?"<>|]/g, '_')}.json`
}

/**
 * 把一张模板下载成 JSON 文件。
 *
 * 走 `<a download>` + Blob URL（不引第三方库）：只下载一个文件，没必要为它装 file-saver。
 * `revokeObjectURL` 刻意延后一拍 —— 部分浏览器（Safari / Firefox）在 click 之后立刻释放会把下载掐掉。
 */
export function downloadTemplateJson (
  item: { name?: string | null, status?: number | null, chain?: { chain?: ApprovalChain, flow?: ApprovalFlow, graph?: FlowGraph } | null },
): TemplateJsonFile {
  const json = buildTemplateJson(item)
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = templateFileName(json.name)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return json
}

/** 只认"真正的对象"（数组、null、字符串都不算） */
function asRecord (value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * 解析导入文件 → 可写库的模板载荷。结构不对时抛错，消息直接给用户看。
 *
 * 认三种形状：
 *   ① `{ format, version, name, status, chain: { chain, flow, graph } }`（本模块导出的）
 *   ② `{ name, status, chain: [...], flow: [...], graph: {...} }`（addApproval 的入参形状）
 *   ③ 上面两种外面再套一层 `template`（手工整理的文件常见这么包），一并认
 */
export function parseTemplateJson (raw: string): TemplatePayload {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('文件不是有效的 JSON（可能选错了文件，或内容被截断）')
  }

  const root = asRecord(data)
  if (!root) {
    throw new Error('JSON 顶层必须是一个对象（导出的模板文件就是这个形状）')
  }

  // ① 有 template 就用它，否则当成 ②/③ 直接在根上取
  const box = asRecord(root.template) ?? root

  const rawName = String(root.name ?? box.name ?? '').trim()
  // 启停：只认 0；没写 / 写错都按「启用」（导入一张模板的默认意图就是拿来用）
  const status = Number(root.status ?? box.status) === 0 ? 0 : 1

  let chain: unknown
  let flow: unknown
  let graph: unknown
  if (Array.isArray(box.chain)) {
    // ③ chain 直接就是链路数组，flow / graph 与它平级
    chain = box.chain
    flow = box.flow
    graph = box.graph
  } else {
    const inner = asRecord(box.chain)
    if (!inner) {
      throw new Error('缺少流程数据（chain）：这个文件不是审批模板')
    }
    chain = inner.chain
    flow = inner.flow
    graph = inner.graph
  }

  if (!Array.isArray(chain)) {
    throw new Error('流程数据（chain）格式不对：应为数组')
  }
  if (chain.length === 0) {
    throw new Error('流程是空的：这个文件里没有可导入的审批环节')
  }
  if (flow !== undefined && flow !== null && !Array.isArray(flow)) {
    throw new Error('流程结构（flow）格式不对：应为数组')
  }
  const graphBox = graph === undefined || graph === null ? null : asRecord(graph)
  if (graph !== undefined && graph !== null && !graphBox) {
    throw new Error('画布快照（graph）格式不对：应为对象')
  }

  return {
    name: rawName || '导入模板',
    status,
    chain: {
      chain: chain as ApprovalChain,
      ...(Array.isArray(flow) && flow.length > 0 ? { flow: flow as ApprovalFlow } : {}),
      // asRecord 给的是 Record<string, unknown>，与 FlowGraph 没有结构重叠 —— 先过 unknown 再断言
      ...(graphBox ? { graph: graphBox as unknown as FlowGraph } : {}),
    },
  }
}

/**
 * 导入时的重名处理：模板是**按名字**查的（建单按 `<团队>模板` 精确匹配，
 * 见 pages/workStream 的 taskTemplateNameOf），重名之后"这一行取到哪张"就不确定了。
 * 所以撞名就自动接一个「（导入）」后缀，用户还能在弹窗里自己改名。
 */
export function uniqueTemplateName (name: string | null | undefined, taken: Iterable<string>): string {
  const base = String(name ?? '').trim() || '导入模板'
  const used = new Set([...taken].map(n => String(n ?? '').trim()))
  if (!used.has(base)) {
    return base
  }
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? `${base}（导入）` : `${base}（导入 ${i}）`
    if (!used.has(candidate)) {
      return candidate
    }
  }
  return `${base}（导入 ${Date.now()}）`
}

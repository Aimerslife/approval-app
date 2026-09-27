import type {
  ApprovalBranch,
  ApprovalFlow,
  ApprovalFlowNode,
  ApprovalFlowStep,
  ProbeSpec,
} from '@/types/approval'
import { PROBE_EMPTY_BRANCH, PROBE_EXISTS_BRANCH } from '@/types/approval'
import { extractFilterParams } from '@/utils/rotationQuery'

/*
 * ⚠️ 本模块刻意保持**纯**（不 import pocketbase），所以能被 tsx 直接断言 ——
 * 与本项目既有做法一致（见 utils/notifyText.ts / groupApprovers.ts 的文件头说明）。
 * 真正打库的那一步在 utils/probeQuery.ts（`resolveProbes`）。
 */

/**
 * 「数据查询」节点（`ProbeSpec`）的**建单期求值**。
 *
 * 口径与「按组轮询」完全同源（见 utils/approvalRotation 的文件头）：
 *   · 查询发生在**建单那一刻**（那时数据被冻结成 context）；
 *   · 结果**只保留命中的那条分支**，另一条整枝丢弃，写进本单的 flow 快照；
 *   · 之后 `rebuildChain` 一行都不用改 —— 分支选路、时间线、催办、驳回重审照旧可用。
 *
 * ⚠️ 顺序要求：**本函数必须在 `expandRotations` 之前调用**（见 pages/workStream.vue）。
 *   否则"没走的那条分支"里配的轮询也会被查一遍 —— 白查一次库，更糟的是
 *   那次查询失败会把这条本来正常的建单判成失败。
 */

/**
 * 允许查询的集合白名单。
 *
 * 为什么要有白名单：配置是人工填的，写错一个字母的后果是**建单失败**（PB 会 400）；
 * 而且前端是以**登录用户**的身份查库（PB 的 collection rules 生效），
 * 把 `users` 这类表列进来只会让人误以为能查。
 */
export const PROBE_COLLECTIONS = [
  'bi_rows',
  'approval_chain',
  'app_chain',
  'approval_files',
  'approval_rules',
  'group_approvers',
  'bi_data_cache',
] as const

/** 可读描述（报错、日志、时间线用） */
export function probeLabel (spec: ProbeSpec): string {
  const c = (spec.collection ?? '').trim() || '(未填集合)'
  const f = (spec.filter ?? '').trim()
  return `数据查询（${c}${f ? `：${f}` : ''}）`
}

/**
 * 收集流程里的数据查询节点 —— **顶层与分支里的都要**。
 *
 * 分支里的查询同样在建单期求值（与轮转一致）：它只影响"命中那条分支内部怎么走"，
 * 与"父分支走没走到"无关，所以展开后结构是确定的。
 */
export function collectProbes (flow: ApprovalFlow): Array<{ id: string, label: string, spec: ProbeSpec }> {
  const out: Array<{ id: string, label: string, spec: ProbeSpec }> = []
  const note = (id: string, spec: ProbeSpec) => out.push({ id, label: probeLabel(spec), spec })

  const walkSteps = (steps?: ApprovalFlowStep[]) => {
    for (const s of steps ?? []) {
      if (s.type === 'branch') {
        for (const b of s.branches ?? []) {
          walkSteps(b.steps)
        }
        continue
      }
      if (s.type === 'probe' && s.probe) {
        note(s.id, s.probe)
      }
      walkSteps(s.steps)
    }
  }

  for (const node of flow) {
    if (node.type === 'probe') {
      note(node.id, node.spec)
      continue
    }
    if (node.type === 'branch') {
      for (const b of node.branches ?? []) {
        walkSteps(b.steps)
      }
    }
  }
  return out
}

/** 流程里有没有数据查询节点（没有就不必去打库） */
export function flowHasProbe (flow: ApprovalFlow): boolean {
  return collectProbes(flow).length > 0
}

export interface ProbeExpansion {
  /** 展开后的流程（原对象不改） */
  flow: ApprovalFlow
  /** 节点 id → 走了哪条分支（排查用） */
  taken: Record<string, string>
  /** 展开不了的地方。**非空即应判该条建单失败** */
  issues: string[]
}

/**
 * 把每个数据查询节点替换成**命中那条分支**（保留成单分支的分支节点）。
 *
 * 为什么保留成"分支节点"而不是把 steps 摊平成顶层节点：
 *   · 分支节点已有的语义（`isEnd` 出口、`loopBackTo` 回退、`terminalMap`）全部照旧生效，
 *     不必新写一套 steps→nodes 的转换（那种转换最容易在出口/回退上出错）；
 *   · `rebuildChain` 对单分支的分支节点处理是现成的。
 */
export function expandProbes (
  flow: ApprovalFlow,
  answers: Record<string, boolean>,
): ProbeExpansion {
  const issues: string[] = []
  const taken: Record<string, string> = {}

  /**
   * 命中哪条分支。缺出边属于**配置错误** → 记 issue 并返回 null（调用方原样保留，
   * 建单会失败），不要静默走另一条 —— 那会让"配错了"看起来像"业务上就该走这边"。
   */
  function pick (id: string, spec: ProbeSpec, branches: ApprovalBranch[]): ApprovalBranch[] | null {
    const wantName = answers[id] === true ? PROBE_EXISTS_BRANCH : PROBE_EMPTY_BRANCH
    const hit = (branches ?? []).find(b => String(b.name ?? '').trim() === wantName)
    if (!hit) {
      issues.push(`${probeLabel(spec)}：没有名为「${wantName}」的分支（该节点必须有「${PROBE_EXISTS_BRANCH}」和「${PROBE_EMPTY_BRANCH}」两条出边）`)
      return null
    }
    taken[id] = wantName
    return [hit]
  }

  /** 分支内的步骤：递归把查询步骤换成"命中那条分支"（分支里的查询也要展开） */
  const mapSteps = (steps?: ApprovalFlowStep[]): ApprovalFlowStep[] =>
    (steps ?? []).map(s => {
      if (s.type === 'branch') {
        return { ...s, branches: (s.branches ?? []).map(b => ({ ...b, steps: mapSteps(b.steps) })) }
      }
      if (s.type === 'probe' && s.probe) {
        const hit = pick(s.id, s.probe, s.branches ?? [])
        // 展开不了就原样保留（issues 非空 → 该条建单失败）
        return hit ? { id: s.id, name: s.name, type: 'branch' as const, branches: hit } : s
      }
      return { ...s, steps: mapSteps(s.steps) }
    })

  const nodes: ApprovalFlowNode[] = []
  for (const node of flow) {
    if (node.type === 'probe') {
      const hit = pick(node.id, node.spec, node.branches ?? [])
      nodes.push(hit ? { id: node.id, type: 'branch', branches: hit } : node)
      continue
    }
    if (node.type === 'branch') {
      nodes.push({ ...node, branches: (node.branches ?? []).map(b => ({ ...b, steps: mapSteps(b.steps) })) })
      continue
    }
    nodes.push(node)
  }

  return { flow: nodes, taken, issues }
}

/**
 * 保存期校验。返回错误文案，null = 没问题。
 *
 * 只查"不看数据就能判定"的：集合名、两条出边的名字。
 * 数据相关的（列名写错、该列没值）只能等建单时由 PB 报出来 —— 前端无权读集合 schema。
 */
export function findBadProbe (spec: ProbeSpec, branchNames: string[]): string | null {
  const collection = (spec.collection ?? '').trim()
  if (!collection) {
    return '数据查询节点没填集合名'
  }
  if (!(PROBE_COLLECTIONS as readonly string[]).includes(collection)) {
    return `数据查询节点里的集合「${collection}」不在允许范围内（可选：${PROBE_COLLECTIONS.join(' / ')}）`
  }
  const raw = (spec.filter ?? '').trim()
  // 只写了「{:」没写字段名 → 占位符不会被解析，会被原样交给 PB 而报错，这里先拦下
  if (raw.includes('{:') && extractFilterParams(raw).length === 0) {
    return '数据查询节点的行条件里写了「{:」但没写字段名'
  }
  const names = new Set(branchNames.map(n => String(n ?? '').trim()))
  if (!names.has(PROBE_EXISTS_BRANCH) || !names.has(PROBE_EMPTY_BRANCH)) {
    return `数据查询节点必须有「${PROBE_EXISTS_BRANCH}」和「${PROBE_EMPTY_BRANCH}」两条出边（当前：${branchNames.join(' / ') || '无'}）`
  }
  return null
}

/* 注：分支里的数据查询现在是**支持**的，所以原先那个"嵌套即报错"的检测已删除 ——
   收集（collectProbes）与展开（expandProbes）都会递归进分支 steps。 */

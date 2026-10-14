import { APPROVAL_STATUS, CLOSE_FLOW_RESULTS, PENDING_RESULT, type FlowEndInfo } from '@/types/approval'

/** 行里**可被筛选**的字段（页面的 ApprovalRow 是它的超集） */
export interface FilterableRow {
  order_no: string
  status: number
  statusText: string
  sku: string
  主MODEL: string
  部门: string
  approver: string
  created: string
  /** 来自**建单时的数据快照**（`chain.context`），没有快照的旧单是 '—' */
  平台: string
}

/** 缺失值的展示口径（与表格里一致）：筛选选项会把它们排除掉 */
export const MISSING = '—'

/** 任意值 → 单元格文本；空值统一成 '—' */
export function toCellText (v: unknown): string {
  if (v === undefined || v === null || v === '') {
    return MISSING
  }
  return typeof v === 'object' ? MISSING : String(v)
}

export const APPROVAL_STAGE = {
  /** 建单后还没人办过 */
  UNREVIEWED: 0,
  /** 办过，还在流转 */
  REVIEWING: 1,
  /** 走完流程，最后一条结论是「待定」 */
  HELD: 2,
  /** 走完流程，非驳回、非终结类结论 */
  APPROVED: 3,
  /** 走完流程且落入驳回走向 */
  REJECTED: 4,
  /** 命中「选择接收组别 / 团队」这类终结类结论（货有人接了） */
  RECEIVED: 5,
  /** 流程卡住（模板缺兜底分支 / 疑似成环），要人去查模板 */
  STUCK: 6,
} as const

export type ApprovalStage = typeof APPROVAL_STAGE[keyof typeof APPROVAL_STAGE]

export const APPROVAL_STAGE_META: Record<ApprovalStage, { text: string, color: string }> = {
  [APPROVAL_STAGE.UNREVIEWED]: { text: '未审批', color: 'secondary' },
  [APPROVAL_STAGE.REVIEWING]: { text: '审批中', color: 'primary' },
  [APPROVAL_STAGE.HELD]: { text: '待定', color: 'warning' },
  [APPROVAL_STAGE.APPROVED]: { text: '通过', color: 'success' },
  [APPROVAL_STAGE.REJECTED]: { text: '驳回', color: 'error' },
  [APPROVAL_STAGE.RECEIVED]: { text: '已接收', color: 'teal' },
  [APPROVAL_STAGE.STUCK]: { text: '异常', color: 'deep-orange' },
}

/** 全部取值，按展示顺序（未审批 → 审批中 → 待定 → 通过 → 驳回 → 已接收 → 异常） */
export const APPROVAL_STAGE_LIST: readonly ApprovalStage[] = [
  APPROVAL_STAGE.UNREVIEWED,
  APPROVAL_STAGE.REVIEWING,
  APPROVAL_STAGE.HELD,
  APPROVAL_STAGE.APPROVED,
  APPROVAL_STAGE.REJECTED,
  APPROVAL_STAGE.RECEIVED,
  APPROVAL_STAGE.STUCK,
]

/** 「状态」筛选选项的固定顺序（文案；筛选比的是文案，见 filterValueOf） */
export const APPROVAL_STAGE_ORDER: readonly string[] = APPROVAL_STAGE_LIST.map(s => APPROVAL_STAGE_META[s].text)

/**
 * 由 `status` + 办理流水（+ 流程为什么停下）派生展示状态。
 *
 * @param status    approval_chain.status（0 未结束 / 1 通过 / 2 驳回）
 * @param decisions 办理流水（按办理顺序；同一个 stepId 驳回重审会出现多条）
 * @param endKind   流程停下的类型（rebuildChain 的 `end.kind`）—— 只有 `'stuck'` 有用：
 *                  卡住的单仍然是"进行中"，但**谁也办不了**，得单独报出来让人去查模板
 */
export function approvalStageOf (
  status: unknown,
  decisions?: ReadonlyArray<{ result?: string }>,
  endKind?: FlowEndInfo['kind'],
): ApprovalStage {
  // 卡住优先判：它虽然还是"进行中"，但卡住这件事比"审批中"重要得多
  if (endKind === 'stuck') {
    return APPROVAL_STAGE.STUCK
  }
  const s = Number(status ?? APPROVAL_STATUS.PENDING)
  const list = decisions ?? []
  const last = [...list].reverse().find(d => d?.result)
  if (s === APPROVAL_STATUS.PENDING) {
    // 还没结束：一次都没人办过 → 未审批；办过但还在流转 → 审批中
    return list.some(d => d?.result) ? APPROVAL_STAGE.REVIEWING : APPROVAL_STAGE.UNREVIEWED
  }
  if (s === APPROVAL_STATUS.REJECTED) {
    return APPROVAL_STAGE.REJECTED
  }
  // 已结束且不是驳回：先看最后一条结论是不是"终结类"（接收组别 / 团队），再看「待定」
  if (last?.result && CLOSE_FLOW_RESULTS.includes(last.result)) {
    return APPROVAL_STAGE.RECEIVED
  }
  return last?.result === PENDING_RESULT ? APPROVAL_STAGE.HELD : APPROVAL_STAGE.APPROVED
}

/** 下拉型筛选的键 */
export type SelectFilterKey =
  | 'statusText'
  | '主MODEL'
  | '部门'
  | 'approver'
  | '平台'

export interface SelectFilterDef {
  key: SelectFilterKey
  label: string
}

/**
 * 下拉筛选定义表：**控件长什么样、按哪个字段取值**都写在这里，页面只负责 `v-for` 渲染。
 * 以后再加一个筛选条件是"加一行"的事，不用同时改模板与过滤逻辑
 * （与 setDatas / workStream 的 SELECT_CONFIGS 同一套思路）。
 *
 * 现为：状态 / 主MODEL / 部门 / 审批人 / 平台。
 * 「主MODEL」是核对呆滞单最常用的那一维（同一个型号的单一眼聚在一起）；
 * 原先的「一级品类」已按需求去掉，关键字搜索也不再覆盖它（见 SEARCH_FIELDS）。
 */
export const SELECT_FILTERS: readonly SelectFilterDef[] = [
  { key: 'statusText', label: '状态' },
  { key: '主MODEL', label: '主MODEL' },
  { key: '部门', label: '部门' },
  { key: 'approver', label: '审批人' },
  { key: '平台', label: '平台' },
]

export interface ApprovalFilters {
  search: string
  /** 每个下拉筛选选中的值；null = 不限 */
  selects: Record<SelectFilterKey, string | null>
  /** 建单日期范围（v-date-input 的 range 模型：Date 或 'YYYY-MM-DD...' 都可能给） */
  dateRange: (Date | string)[]
}

export function createApprovalFilters (): ApprovalFilters {
  return {
    search: '',
    selects: {
      statusText: null,
      主MODEL: null,
      部门: null,
      approver: null,
      平台: null,
    },
    dateRange: [],
  }
}

/**
 * 清空筛选（**就地**重置）。
 * 就地而不是换一个新对象：页面里 v-model 绑的是同一个 reactive 对象，换对象会断开绑定。
 */
export function resetApprovalFilters (f: ApprovalFilters): void {
  f.search = ''
  for (const key of Object.keys(f.selects) as SelectFilterKey[]) {
    f.selects[key] = null
  }
  f.dateRange = []
}

/**
 * 筛选条上的**局部**改动：子组件只回传"变了的那几个字段"，而不是整个对象。
 *
 * 为什么不让子组件直接改传进来的 filters：那是"子组件改父组件的数据"，
 * eslint 的 `vue/no-mutating-props` 会拦（而且它会让"谁在改筛选条件"变得难追）。
 * 统一走 patch，改动路径只有一条。
 */
export interface FilterPatch {
  search?: string
  dateRange?: (Date | string)[]
  selects?: Partial<Record<SelectFilterKey, string | null>>
}

/** 应用局部改动（就地改 filters；没带上来的字段保持原样） */
export function applyFilterPatch (f: ApprovalFilters, patch: FilterPatch): void {
  if (patch.search !== undefined) {
    f.search = patch.search
  }
  if (patch.dateRange !== undefined) {
    // 复制一份，避免与子组件的数组共享引用（后续任何一边 push 都会互相影响）
    f.dateRange = [...patch.dateRange]
  }
  if (patch.selects) {
    Object.assign(f.selects, patch.selects)
  }
}

/** Date 或 'YYYY-MM-DD...' 都取出日期部分 */
export function isoDay (v: Date | string): string {
  return typeof v === 'string'
    ? v.slice(0, 10)
    : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
}

/**
 * 两份条件是否**等价**（逐字段比，不看对象引用）。
 *
 * 用途：「确认」按钮的"有改动没生效"提示 —— 草稿与生效两份条件不再相等就说明有人动过控件。
 * 日期按 `isoDay` 归一后比：v-date-input 给的可能是 Date、也可能是 'YYYY-MM-DD…' 字符串，
 * 同一份条件走一轮控件回来往往两种形态都出现过，直接比对象会把"没改"误报成"改过"。
 */
export function filtersEqual (a: ApprovalFilters, b: ApprovalFilters): boolean {
  if (a.search !== b.search) {
    return false
  }
  for (const key of Object.keys(a.selects) as SelectFilterKey[]) {
    if ((a.selects[key] ?? null) !== (b.selects[key] ?? null)) {
      return false
    }
  }
  return a.dateRange.map(d => isoDay(d)).join('~') === b.dateRange.map(d => isoDay(d)).join('~')
}

/** 该行在某个下拉筛选下的可比较文本（状态是特例：要比的是**展示文案**，不是数字） */
export function filterValueOf (row: FilterableRow, key: SelectFilterKey): string {
  return key === 'statusText' ? String(row.statusText ?? '') : String(row[key] ?? '')
}

/**
 * 选项列表：**从数据本身推导**，不写死。
 *
 * 三条口径：
 *  1. 排除缺失值（'—'）与空串 —— 选中它们没有意义（那不代表"不限"，而是"这条数据没这列"）；
 *  2. 状态按固定顺序（待审批 → 通过 → 驳回），其余按中文拼音序：
 *     否则选项顺序会随数据顺序变，同一个下拉每次点开位置都不一样；
 *  3. 用**全部**行推导，而不是用过滤后的行 —— 否则选了「部门=A」之后别的部门选项就消失了，
 *     用户没法改选。这是筛选器最常见的实现错误。
 */
export function filterOptions (rows: FilterableRow[], key: SelectFilterKey): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    const v = filterValueOf(row, key)
    if (v && v !== MISSING) {
      seen.add(v)
    }
  }
  const list = [...seen]
  return key === 'statusText'
    ? list.sort((a, b) => APPROVAL_STAGE_ORDER.indexOf(a) - APPROVAL_STAGE_ORDER.indexOf(b))
    : list.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/**
 * 关键字搜索覆盖的字段：单号 / SKU / 主MODEL / 部门 / 审批人 / 平台。
 * 「销售状态」「一级品类」已按需求移出（既有下拉、也不在搜索范围内）。
 */
const SEARCH_FIELDS: (keyof FilterableRow)[] = [
  'order_no', 'sku', '主MODEL', '部门', 'approver', '平台',
]

/**
 * 应用筛选。各条件之间是 **and**（与界面上并排的多个下拉一致）。
 *
 * 日期按 `created` 的**前 10 位**做字典序比较 —— created 是
 * '2026-09-17 02:05:41.542Z'，前 10 位就是日期，比解析成 Date 再比更直接
 * （也避免时区把"当天"算到前一天）。只选了一个端点时视为"那一天"。
 */
export function applyApprovalFilters<T extends FilterableRow> (
  rows: T[],
  f: ApprovalFilters,
): T[] {
  const kw = f.search.trim().toLowerCase()
  const first = f.dateRange[0]
  const last = f.dateRange.at(-1)
  const from = first ? isoDay(first) : ''
  const to = last ? isoDay(last) : from

  return rows.filter(row => {
    if (from) {
      const day = row.created.slice(0, 10)
      if (!day || day < from || day > to) {
        return false
      }
    }
    for (const key of Object.keys(f.selects) as SelectFilterKey[]) {
      const want = f.selects[key]
      if (want && filterValueOf(row, key) !== want) {
        return false
      }
    }
    if (kw && !SEARCH_FIELDS.map(k => String(row[k] ?? '')).join(' ').toLowerCase().includes(kw)) {
      return false
    }
    return true
  })
}

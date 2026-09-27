import { APPROVAL_STATUS } from '@/types/approval'

/**
 * approvalFilters.ts —— 审批单表格的**本地筛选**（纯逻辑，不依赖 PocketBase 客户端）
 *
 * 为什么抽出来：home.vue（所有审批单，两个 tab）与 mine.vue（我的审批单）此前**各自复制**了一份
 * 筛选状态、选项推导与过滤函数，于是已经漂了 ——
 *   · mine.vue 的「状态」下拉错绑到 `deptFilter`（选项还是部门）；
 *   · 它的部门选项从**历史**行推导，而它只展示待审批单 → 选项可能是空的；
 *   · 三个表格的 `:items` 全都绑的是**未过滤**数组 → 筛选条点了没反应。
 * 共用一份实现，这类漂移不会再发生；纯函数也能用 tsx 直接断言。
 *
 * ⚠️ 这里是**客户端本地筛选**（两个页面都用 v-data-table，一次全量拉取后本地过滤）。
 *    与 setDatas / workStream 那套「服务端 BiRowQuery」是两回事，别混用 ——
 *    那边数据量大（bi_rows 三千多行）必须服务端筛，这边一次只拉审批单。
 */

/** 行里**可被筛选**的字段（页面的 ApprovalRow 是它的超集） */
export interface FilterableRow {
  order_no: string
  status: number
  sku: string
  主MODEL: string
  部门: string
  approver: string
  created: string
  /** 以下三项来自**建单时的数据快照**（`chain.context`），没有快照的旧单是 '—' */
  平台: string
  销售状态: string
  一级品类: string
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

/**
 * 状态 → 文案 + 颜色。
 *
 * 此前 home.vue / mine.vue 各写一份（home 的注释还写着"原来这里被复制了 5 份"），
 * 现在只留这一份；两个页面的 chip 渲染与「状态」筛选选项都从这里取。
 */
export const APPROVAL_STATUS_META: Record<number, { text: string, color: string }> = {
  [APPROVAL_STATUS.PENDING]: { text: '待审批', color: 'primary' },
  [APPROVAL_STATUS.APPROVED]: { text: '通过', color: 'success' },
  [APPROVAL_STATUS.REJECTED]: { text: '驳回', color: 'error' },
}

/** 状态选项的固定顺序（待审批 → 通过 → 驳回）；未知状态兜底成待审批 */
export function approvalStatusMeta (v: unknown): { text: string, color: string } {
  return APPROVAL_STATUS_META[Number(v)] ?? APPROVAL_STATUS_META[APPROVAL_STATUS.PENDING]
}

const STATUS_ORDER = [
  APPROVAL_STATUS.PENDING,
  APPROVAL_STATUS.APPROVED,
  APPROVAL_STATUS.REJECTED,
].map(s => APPROVAL_STATUS_META[s].text)

/** 下拉型筛选的键 */
export type SelectFilterKey =
  | 'statusText'
  | '部门'
  | 'approver'
  | '平台'
  | '销售状态'
  | '一级品类'

export interface SelectFilterDef {
  key: SelectFilterKey
  label: string
}

/**
 * 下拉筛选定义表：**控件长什么样、按哪个字段取值**都写在这里，页面只负责 `v-for` 渲染。
 * 以后再加一个筛选条件是"加一行"的事，不用同时改模板与过滤逻辑
 * （与 setDatas / workStream 的 SELECT_CONFIGS 同一套思路）。
 */
export const SELECT_FILTERS: readonly SelectFilterDef[] = [
  { key: 'statusText', label: '状态' },
  { key: '部门', label: '部门' },
  { key: 'approver', label: '审批人' },
  { key: '平台', label: '平台' },
  { key: '销售状态', label: '销售状态' },
  { key: '一级品类', label: '一级品类' },
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
      部门: null,
      approver: null,
      平台: null,
      销售状态: null,
      一级品类: null,
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

/** 该行在某个下拉筛选下的可比较文本（状态是特例：要比的是文案，不是数字） */
export function filterValueOf (row: FilterableRow, key: SelectFilterKey): string {
  return key === 'statusText' ? approvalStatusMeta(row.status).text : String(row[key] ?? '')
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
    ? list.sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b))
    : list.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/** 关键字搜索覆盖的字段（比原来多了审批人与两个业务列） */
const SEARCH_FIELDS: (keyof FilterableRow)[] = [
  'order_no', 'sku', '主MODEL', '部门', 'approver', '平台', '销售状态',
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

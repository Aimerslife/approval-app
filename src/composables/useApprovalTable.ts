import type { ApprovalOrder } from '@/types/approval'
import { APPROVAL_STATUS } from '@/types/approval'
import { computed, markRaw, reactive, shallowRef } from 'vue'
import {
  applyApprovalFilters,
  applyFilterPatch,
  createApprovalFilters,
  filterOptions,
  filtersEqual,
  resetApprovalFilters,
  SELECT_FILTERS,
  type FilterPatch,
  type SelectFilterKey,
} from '@/utils/approvalFilters'
import { toApprovalRow, type ApprovalRow } from '@/utils/approvalRows'
import { getApprovalOrder } from '@/utils/collection'

/**
 * 「审批单表格」的共用部分：取数 → 组装行 → 筛选。
 *
 * home.vue（所有审批单，当前/历史两个 tab）与 mine.vue（我的审批单，只有当前一张表）
 * 此前各自复制了一份，这次合成一份 —— 加一列、加一个筛选条件都只改这里。
 *
 * 两个页面保留各自的差异部分，**不**抽进来：
 *   · 分页状态与每页条数（15 / 17 不同）；
 *   · 抽屉（选中行、时间线、办理提交），两页布局与跳转行为不同。
 *
 * ⚠️ 本模块 import 了 PocketBase 客户端（经 utils/collection），所以不能用 tsx 断言；
 * 纯逻辑（筛选、重算）在 utils/approvalFilters 与 utils/approvalRuntime 里，那些可以。
 */
export function useApprovalTable () {
  /**
   * 全部审批单（approval_chain），已按创建时间倒序 —— 见 getApprovalOrder。
   *
   * ⚠️ 用 shallowRef（元素再 markRaw），**不要**换回 ref：
   * ref 对数组是**深度**响应式 —— 赋值那一刻 Vue 会递归遍历整棵对象图逐个建代理，
   * 而每条 ApprovalOrder 里都内嵌着整份流程快照（flow 树 + 画布 graph + decisions + 整行业务快照）。
   * 列表几百上千条时，这一步是**同步**的，正是切页时"卡一下"的来源之一。
   *
   * 语义上也不需要深度：orders 里的对象是**不可变快照**，从不原地改字段，
   * 改数据一律走"整体替换"（见 load / applyUpdated），浅层替换就足以触发 rows 重算。
   */
  const orders = shallowRef<ApprovalOrder[]>([])
  const rows = computed<ApprovalRow[]>(() => orders.value.map(toApprovalRow))

  /** 当前审批单 = 未结束；历史审批单 = 已结束 */
  const pendingRows = computed(() => rows.value.filter(r => r.status === APPROVAL_STATUS.PENDING))
  const historyRows = computed(() => rows.value.filter(r => r.status !== APPROVAL_STATUS.PENDING))

  /**
   * 筛选条件。
   *
   * 分成「草稿」与「生效」两份，是为了让**搜索框**不每敲一个字就重筛一次表格
   * （表格几百行时每次按键都重排一次，输入会发涩）：
   *   · `filters` = 草稿：控件改的是它，也就是界面上看到的值；
   *   · `applied` = 生效：表格按它筛。
   * 下拉与日期**即点即生效**（沿用改动前的行为），只有搜索框等按「搜索」提交 ——
   * 见 patchFilters。这样那个按钮是真有用的，不是摆着好看。
   */
  const filters = reactive(createApprovalFilters())
  const applied = reactive(createApprovalFilters())

  /**
   * 有条件改了还没提交（界面据此提示"点了才生效"）。
   * 比的是**整组条件**而不只是搜索词：下拉与日期虽然即点即生效、当场就相等，
   * 但一旦以后有人把某个控件改成"等确认"，这里不用跟着改（见 filtersEqual）。
   */
  const filtersDirty = computed(() => !filtersEqual(filters, applied))

  /** 「搜索」：把草稿里的搜索词提交为生效条件 */
  function applyFilters () {
    applyFilterPatch(applied, { search: filters.search })
  }

  function resetFilters () {
    resetApprovalFilters(filters)
    // 重置**立即生效**：让人点完就看到表格恢复，不用再按一次搜索
    resetApprovalFilters(applied)
  }

  function patchFilters (patch: FilterPatch) {
    applyFilterPatch(filters, patch)
    // 搜索框只改草稿（等「搜索」）；其余条件改完立刻生效
    if (!('search' in patch)) {
      applyFilterPatch(applied, patch)
    }
  }

  /**
   * 下拉选项表。用**全部**行推导，不能用过滤后的行 ——
   * 否则选了「部门=A」之后，别的部门选项就从下拉里消失了，用户没法改选。
   */
  const filterOptionsMap = computed(() => {
    const map = {} as Record<SelectFilterKey, string[]>
    for (const def of SELECT_FILTERS) {
      map[def.key] = filterOptions(rows.value, def.key)
    }
    return map
  })

  /** 筛过的两个切面（两个页面按自己的 tab 结构取用）—— 按**生效**条件筛，不是草稿 */
  const pendingList = computed(() => applyApprovalFilters(pendingRows.value, applied))
  const historyList = computed(() => applyApprovalFilters(historyRows.value, applied))

  /** 取数：全量拉一次 —— 与 v-data-table 的客户端分页/排序配套，筛选在本地做 */
  async function load () {
    // markRaw：连元素这层也不建代理（这些快照是只读的，不需要响应式）
    orders.value = (await getApprovalOrder()).map(o => markRaw(o))
  }

  /**
   * 抽屉里办完之后合并那一条。
   *
   * 必须更新**列表里**那条：时间线（selectedOrder → selectedChain）由它派生，
   * 只改 selectedNode 的话时间线不会动。
   */
  function applyUpdated (updated: ApprovalOrder) {
    // 合并出来的新对象同样是不需要响应式的快照（浅层替换数组本身即可触发重算）
    orders.value = orders.value.map(o => (o.id === updated.id ? markRaw({ ...o, ...updated }) : o))
  }

  return {
    orders,
    rows,
    pendingRows,
    historyRows,
    filters,
    filtersDirty,
    applyFilters,
    resetFilters,
    patchFilters,
    filterOptionsMap,
    pendingList,
    historyList,
    load,
    applyUpdated,
  }
}

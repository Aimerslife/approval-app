<template>
  <v-container fluid :class="fullSceen ? 'screen-full' : 'pa-3'" @pointerdown="onPointerDown" @dblclick="onDblClick">
    <v-sheet border rounded="5px" class="filter-bar p-3 d-flex flex-wrap align-center ga-3">
      <v-text-field v-model="draft.search" density="compact" label="搜索" prepend-inner-icon="mdi-magnify"
        variant="solo-filled" flat hide-details single-line class="filter-input" @keyup.enter="applyFilters">
      </v-text-field>
      <v-select v-for="ctl in selectControls" :key="ctl.key" v-model="draft[ctl.key]" clearable density="compact"
        variant="outlined" hide-details flat single-line class="filter-select" :label="ctl.label" :items="ctl.items"
        :menu-props="{ contentClass: 'filter-menu' }">
      </v-select>
      <!--
        「任务状态」不能像上面那样由 SELECT_CONFIGS 驱动：选项是固定的四个（TASK_STATUS_FILTER_ITEMS），
        而且它不是 bi_rows 的列 —— 条件是反查关联单拼出来的（见 taskStatusQuery）。
      -->
      <v-select v-model="draft.taskStatus" clearable density="compact" variant="outlined" hide-details flat
        single-line class="filter-select" label="任务状态" :items="TASK_STATUS_FILTER_ITEMS"
        :menu-props="{ contentClass: 'filter-menu' }">
      </v-select>
      <div class="d-flex align-center ga-2">
        <v-btn color="surface-variant" variant="flat" size="small" @click="resetFilters">
          <span>重置</span>
        </v-btn>
        <v-btn color="#0052D9" variant="flat" size="small" @click="applyFilters">确认</v-btn>
      </div>
      <div class="ms-auto d-flex align-center ga-2">
        <span v-if="selectedIds.length" class="text-[12px] text-medium-emphasis">已选 {{ selectedIds.length }} 条</span>
        <v-btn color="#0052D9" variant="flat" size="small" prepend-icon="mdi-flash" :loading="starting"
          @click="startTasks"><span class="mb-1">{{ starting ? batchText : '开启任务' }}</span></v-btn>
        <v-icon-btn icon="mdi-bug" size="30" @click=""></v-icon-btn>
      </div>
    </v-sheet>
    <div class="d-flex align-center justify-space-between">
      <div class="d-flex align-center ga-2">
        <div class="text-caption pl-1 py-1">
          <span class="text-[12px] text-medium-emphasis">读取时间：{{ fetchedAt || '—' }}</span>
          <span class="text-[12px] text-medium-emphasis"> · 按当前条件共 {{ totalItems }} 行</span>
          <span v-if="activeFilterCount" class="text-primary text-[12px]"> · 已启用 {{ activeFilterCount }} 项筛选</span>
          <span v-if="pendingRows.length && (dedupePreview.duplicated || dedupePreview.missingKey)"
            class="text-[12px] text-warning">（唯一键去重后 {{ dedupePreview.unique }} 行<template
              v-if="dedupePreview.duplicated">，{{ dedupePreview.duplicated }} 行重复</template><template
              v-if="dedupePreview.missingKey">，{{ dedupePreview.missingKey }} 行无 SKU 会被跳过</template>）</span>
          <span v-if="fetchError" class="text-error text-[12px]"> · {{ fetchError }}</span>
          <v-btn class="ml-3" size="x-small" @click="exportToExcel" variant="flat" color="#0052D9"
            :disabled="loading">导出</v-btn>
        </div>
      </div>
      <div>
        <v-icon-btn size="small" icon="mdi-refresh" :loading="loading" @click="reload(true)" color="#7A7A7A"
          variant="text" title="从数据库重新读取"></v-icon-btn>
        <v-icon-btn icon="mdi-cog-outline" size="small" color="#7A7A7A" variant="text" title="列设置"
          @click="settingsOpen = true"></v-icon-btn>
        <v-icon-btn :title="fullSceen ? '退出全屏' : '全屏'"
          :icon="fullSceen ? 'mdi-arrow-collapse-all' : 'mdi-arrow-expand-all'" size="small" color="#7A7A7A"
          variant="text" @click="setFullScreen"></v-icon-btn>
      </div>
    </div>
    <v-data-table-server v-model:page="page" v-model:items-per-page="itemsPerPage" :headers="tableHeaders" :items="rows"
      v-model="selectedIds" item-value="id" show-select :item-selectable="isRowSelectable"
      :items-length="totalItems" :loading="loading" :no-data-text="noDataText" items-per-page-text="每页条数"
       border striped="odd" hover density="compact" fixed-header
      :items-per-page-options="[20, 50, 100, 200]"  @update:options="onTableOptions"
      fixed-footer :height="tableHeight" class="text-[12px]">
      <template v-slot:item.图片链接="{ value }">
        <v-img v-if="value" :src="String(value)" width="48" height="48" cover class="rounded mx-auto"></v-img>
        <span v-else>—</span>
      </template>
      <template v-slot:item.是否属于灯具="{ value }">
        <v-chip :color="value == '是' ? 'primary' : 'success'" size="x-small">
          <span>{{ value == '是' ? '灯具' : '非灯具' }}</span></v-chip>
      </template>
      <template v-slot:item.__task_status__="{ item }">
        <v-chip v-bind="taskChip(item.id)" size="x-small" class="text-[11px]">{{ taskOf(item.id).text }}</v-chip>
      </template>
    </v-data-table-server>
    <v-dialog v-model="settingsOpen" max-width="520" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center ga-3 text-[15px]">
          <span>列设置</span>
          <v-chip size="x-small" variant="tonal" color="success" label>
            显示 {{ visibleFields.length }} / {{ orderedFields.length }}
          </v-chip>
          <v-spacer />
          <v-btn variant="text" size="small" @click="resetColumnSettings">恢复默认</v-btn>
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-2">
          <div v-for="(item, index) in orderedFields" :key="item.key" class="col-item"
            :class="{ 'col-item--drag': dragIndex === index, 'col-item--over': overIndex === index }" draggable="true"
            @dragstart="onDragStart(index)" @dragover.prevent="onDragOver(index)" @drop.prevent="onDrop(index)"
            @dragend="onDragEnd">
            <v-icon icon="mdi-drag-vertical" size="16" class="col-item__handle" />
            <span class="col-item__title" :title="item.title">{{ item.title }}</span>
            <span v-if="HIDDEN_COLUMN_KEYS.has(item.key)" class="col-item__note">本页固定只看呆滞</span>
            <v-switch v-else :model-value="isVisible(item.key)" color="primary" density="compact" hide-details
              class="col-item__switch" @update:model-value="toggleVisible(item.key)" true-icon="mdi-check"
              false-icon="mdi-close"></v-switch>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4">
          <span class="text-caption text-medium-emphasis text-[13px]">拖动左侧手柄调整顺序，改动自动保存</span>
          <v-spacer />
          <v-btn color="#0052D9" variant="flat" size="small" @click="settingsOpen = false">完成</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="6000" variant="tonal">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
import { PRODUCT_FIELDS, type ProductField } from '@/utils/productFields'
// 与服务端**同一个**唯一键实现，用来预告「这份文件入库后是多少行」
import { makeSyncKey } from '@/utils/biRowFields'
import { formatDatas, exportExcel, type ExportColumn } from '@/utils/utils'
// Excel 解析放在独立模块里（纯函数，能被 tsx 直接跑单测），页面只负责接线
import {
  biColumnOf, fetchAllBiRows, fetchBiFacets, fetchBiRows,
  type BiRowQuery,
} from '@/api/api'
import { useUserStore } from '@/stores/user'
import { isEditorFullscreen } from '@/composables/useEditorFullscreen'
// 建审批单的 PB 调用都在 collection.ts 里，页面只负责接线
// 「任务状态」筛选要反查关联单（状态不在 bi_rows 里，见 taskStatusQuery）
import {
  createApprocalModel, getApprovalFirstByFilter, getOrderRowKeys, getOrdersByRow, getOrdersByRows,
  MAX_STATUS_FILTER_VALUES, orderKeyGroupCount, orderKeyGroups,
} from '@/utils/collection'
// 建单时把行数据转成条件求值用的业务上下文（去千分位、摊平 data 快照）
import { toFlowContext } from '@/utils/approvalFlow'
/*
 * 建单期把「数据查询」「组间轮询」展开掉（见 utils/expandFlowForOrder）。
 * ⚠️ 少了这一步，快照里会留下没展开的 probe/loop 节点 —— 单子建得出来、前面几环也能办，
 *    办到那一环时提交会报「没有在建单时展开，单据数据不完整」。
 */
import { expandFlowForOrder } from '@/utils/expandFlowForOrder'
// 动态审批人（角色）：模板里配「部门负责人」，建单时按组织架构解析成真人（见 utils/approvalRoles）
import { flowHasRoles, resolveFlowRoles } from '@/utils/approvalRoles'
// 通讯录索引：建单期给"只有邮箱/姓名"的老成员补 open_id（发通知 / 查头像都优先用它）
import { buildOrgDirectory, memberOpenId } from '@/utils/orgDirectory'
import { fetchOrgTreeCache, type OrgTreeData } from '@/api/api'
import { APPROVAL_STATUS, branchTerminalMapOf, compactBranchTerminal, flowToChain, slimFlowMembers, type ApprovalFlow, type ApprovalOrder } from '@/types/approval'

/** BI 组件 id */
const COMPONENT_ID = '0c356d17-3c48-4c3b-b133-e6406a88c5fe'

const page = ref(1)
const itemsPerPage = ref(20)
const fullSceen = ref(false)
const rows = ref<Record<string, unknown>[]>([])

const rawRows = ref<Record<string, Record<string, unknown>>>({})
/** 满足当前筛选条件的总行数（PB 返回，分页器用它） */
const totalItems = ref(0)
/** 本次读取完成的时间 */
const fetchedAt = ref('')
/** 排序：PB 的 sort 串（'qty_total' 升序 / '-qty_total' 降序） */
const sortBy = ref('')

const facets = ref<Record<string, string[]>>({})
/** 读取 / 解析过程中的提示 */
const fetchError = ref('')
const loading = ref(false)
const pendingRows = ref<Record<string, unknown>[]>([])
const dedupePreview = computed(() => {
  const seen = new Set<string>()
  let missingKey = 0
  for (const row of pendingRows.value) {
    const key = makeSyncKey(row)
    if (!key) {
      missingKey++
      continue
    }
    seen.add(key)
  }
  return {
    unique: seen.size,
    missingKey,
    duplicated: pendingRows.value.length - seen.size - missingKey,
  }
})
const CELL_PADDING = 44

/** 各列的默认宽度（内容宽度 + 单元格内边距），也是「双击恢复默认」的依据 */
const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  PRODUCT_FIELDS.map(f => [f.key, f.width + CELL_PADDING]),
)

const RESIZE_ZONE = 8
/** 列宽下限，防止拖到抓不回来 */
const MIN_COL_WIDTH = 48

const colLayout = ref<Array<{ field: string; width?: number }>>([])
const colVisible = ref<Record<string, boolean>>({})

const userStore = useUserStore()

const HIDDEN_COLUMN_KEYS = new Set(['是否属于呆滞库存'])

/** 字段清单里该列的默认显隐 */
function defaultVisible(key: string): boolean {
  if (HIDDEN_COLUMN_KEYS.has(key)) return false
  return PRODUCT_FIELDS.find(f => f.key === key)?.visualable ?? true
}

/** 该列当前是否显示 */
function isVisible(key: string): boolean {
  // 强制隐藏的列无视用户偏好（见 HIDDEN_COLUMN_KEYS）
  if (HIDDEN_COLUMN_KEYS.has(key)) return false
  return colVisible.value[key] ?? defaultVisible(key)
}

/** 该列当前宽度：用户调过用调过的，否则用字段清单的默认值（内容宽 + 内边距） */
function widthOf(key: string): number {
  const saved = colLayout.value.find(item => item.field === key)?.width
  return typeof saved === 'number' && saved >= MIN_COL_WIDTH ? saved : DEFAULT_WIDTHS[key]
}

function exportColumns(): ExportColumn[] {
  return [
    ...visibleFields.value.map(f => ({ key: f.key, title: f.title, width: widthOf(f.key) })),
    // 表格右侧的固定列「任务状态」：页面上有它，导出也带上（取值是算出来的，不是 bi_rows 的字段）
    { title: '任务状态', value: row => taskOf(row.id).text, width: 100 },
  ]
}

async function exportToExcel() {
  loading.value = true
  try {
    // 导出同样遵守「任务状态」筛选 —— 否则"界面筛过的"和"导出出去的"两处口径不一致，
    // 而且没人会去核对导出的行数和表格上的总数
    const all = await fetchAllBiRows(currentQuery({
      page: undefined,
      perPage: undefined,
      ...(await taskStatusQuery()),
    }))
    /*
     * 任务状态是按行关联单据算出来的，页面上只算过**当前页**这一批；
     * 导出是全量，先把全量状态补齐 —— 否则导出里除当前页外都会显示成「未开启任务」（假数据）。
     */
    await loadTaskStatus(all)
    await exportExcel(all.map(formatDatas), '导出数据', exportColumns())
  } catch (e) {
    console.error('[workStream] 导出失败:', e)
    showMsg(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    loading.value = false
  }
}

function ensureFullOrder(): Array<{ field: string; width?: number }> {
  const byKey = new Map(PRODUCT_FIELDS.map(f => [f.key, f]))
  const order: string[] = []
  for (const item of colLayout.value) {
    if (byKey.delete(item.field)) order.push(item.field)
  }
  order.push(...byKey.keys())
  const widthByKey = new Map(colLayout.value.map(i => [i.field, i.width]))
  return order.map((field) => {
    const w = widthByKey.get(field)
    return typeof w === 'number' ? { field, width: w } : { field }
  })
}

/** 按当前顺序排好、含隐藏列的全部字段。面板用它，下标与 colLayout 一一对应 */
const orderedFields = computed(() => {
  const byKey = new Map(PRODUCT_FIELDS.map(f => [f.key, f]))
  const out: ProductField[] = []
  for (const item of colLayout.value) {
    const f = byKey.get(item.field)
    // 过滤掉已经不在字段清单里的（BI 删了字段）
    if (f) { out.push(f); byKey.delete(item.field) }
  }
  // 剩下的 = BI 新增、偏好里还没有的，按默认顺序追加到末尾，保证老用户看得到新字段
  out.push(...byKey.values())
  return out
})

/** 表格实际渲染的字段 */
const visibleFields = computed(() => orderedFields.value.filter(f => isVisible(f.key)))

/** 字段清单的默认顺序，用于判定「顺序有没有被改过」以及补齐缺失字段 */
const DEFAULT_ORDER = PRODUCT_FIELDS.map(f => f.key)

function mergeWidths(
  order: Array<{ field: string; width?: number }>,
  widths: Record<string, number> | undefined,
): Array<{ field: string; width?: number }> {
  const byField = new Map(order.map(i => [i.field, i]))
  for (const f of PRODUCT_FIELDS) {
    if (byField.has(f.key)) continue
    const item: { field: string; width?: number } = { field: f.key }
    order.push(item)
    byField.set(f.key, item)
  }
  if (widths && typeof widths === 'object') {
    for (const [field, w] of Object.entries(widths)) {
      if (typeof w !== 'number' || w < MIN_COL_WIDTH) continue
      byField.get(field)!.width = w
    }
  }
  return order
}

/** 用 PB 偏好覆盖默认值；数据异常（非布尔 / 非数字 / 太小）时忽略，回落字段清单的默认值 */
function applyLayoutPrefs() {
  const prefs = userStore.preferences

  const layout = Array.isArray(prefs?.columnLayout) ? prefs.columnLayout : []
  colLayout.value = mergeWidths(
    layout
      .filter(item => item && typeof item.field === 'string')
      .map(item =>
        typeof item.width === 'number' && item.width >= MIN_COL_WIDTH
          ? { field: item.field, width: item.width }
          : { field: item.field },
      ),
    prefs?.columnWidths,
  )

  const vis = prefs?.columnVisibility
  if (vis && typeof vis === 'object') {
    const next: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(vis)) {
      if (typeof value === 'boolean') next[key] = value
    }
    colVisible.value = next
  }
}
applyLayoutPrefs()
// 登录态是异步恢复的（authStore 初始化 / 重新登录），偏好到位后再覆盖一次
watch(() => userStore.preferences, applyLayoutPrefs, { deep: true })

let layoutSaveTimer: ReturnType<typeof setTimeout> | undefined

/** 把当前顺序 + 调过的列宽 + 显隐差异写回 PB */
function persistLayout() {
  const full = ensureFullOrder()
  const order = full.map(i => i.field)

  // 列宽：稀疏存，只存与默认不同的
  const widths: Record<string, number> = {}
  for (const item of full) {
    if (typeof item.width === 'number' && item.width !== DEFAULT_WIDTHS[item.field]) {
      widths[item.field] = item.width
    }
  }

  const reordered =
    order.length !== DEFAULT_ORDER.length || order.some((k, i) => k !== DEFAULT_ORDER[i])

  const visibilityDiff: Record<string, boolean> = {}
  for (const f of PRODUCT_FIELDS) {
    const v = colVisible.value[f.key]
    if (typeof v === 'boolean' && v !== defaultVisible(f.key)) visibilityDiff[f.key] = v
  }

  userStore
    .savePreferences({
      columnWidths: widths,
      columnLayout: reordered
        ? full.map(({ field, width }) => (typeof width === 'number' ? { field, width } : { field }))
        : [],
      columnVisibility: visibilityDiff,
    })
    .catch((err) => {
      console.error('[setDatas] 保存列设置失败:', err)
    })
}

/** 拖拽调宽 / 连点开关都会高频触发，防抖后落库一次 */
function scheduleLayoutSave() {
  clearTimeout(layoutSaveTimer)
  layoutSaveTimer = setTimeout(persistLayout, 400)
}

/** 改某一列的宽度（不动它的位置） */
function setColumnWidth(key: string, width: number) {
  colLayout.value = ensureFullOrder().map(item =>
    item.field === key ? { field: key, width } : item,
  )
}

/** 去掉某列的宽度，回落默认 */
function resetColumnWidth(key: string) {
  colLayout.value = ensureFullOrder().map(item =>
    item.field === key ? { field: key } : item,
  )
}

// ==================== 列设置面板 ====================

const settingsOpen = ref(false)

/** 面板里正在拖的项 / 拖到哪一项上面（只用于显示落点提示） */
const dragIndex = ref(-1)
const overIndex = ref(-1)

function onDragStart(index: number) {
  dragIndex.value = index
}

function onDragOver(index: number) {
  overIndex.value = index
}

function onDragEnd() {
  dragIndex.value = -1
  overIndex.value = -1
}
function onDrop(index: number) {
  const from = dragIndex.value
  onDragEnd()
  if (from < 0 || from === index) return
  const layout = ensureFullOrder()
  const [moved] = layout.splice(from, 1)
  layout.splice(index, 0, moved)
  colLayout.value = layout
  scheduleLayoutSave()
}

/** 切换某一列的显隐 */
function toggleVisible(key: string) {
  // 强制隐藏的列没有开关（模板里也不渲染），这里再兜一道
  if (HIDDEN_COLUMN_KEYS.has(key)) return
  colVisible.value = { ...colVisible.value, [key]: !isVisible(key) }
  scheduleLayoutSave()
}

/** 恢复全部默认（顺序 + 宽度 + 显隐） */
function resetColumnSettings() {
  colLayout.value = []
  colVisible.value = {}
  scheduleLayoutSave()
}

function setFullScreen() {
  fullSceen.value = !fullSceen.value
  isEditorFullscreen.value = fullSceen.value
}

/** 表格高度：全屏时顶部系统栏（.app-titlebar 的 36px）不再占位，可用高度多 36px */
const tableHeight = computed(() => (fullSceen.value ? 'calc(100vh - 162px)' : 'calc(100vh - 198px)'))
const TASK_STATUS_KEY = '__task_status__'

interface TaskView {
    text: string
    color: string
    variant: 'flat' | 'tonal'
    title: string
    /**
     * 这一行**有没有单**（在流程中 / 已通过 / 已驳回都算）。
     *
     * 为什么要单独一个字段、而不是拿 `taskOf(...) === NO_TASK` 判断：
     * `taskByRowId` 是 ref，取出来的对象是 Vue 的**响应式代理**，与 `NO_TASK` 常量
     * **不是同一个引用** —— 那样写会让所有行都被判成"已有单"（实测：全表都勾不上）。
     */
    hasOrder: boolean
}

/** 没有单 = 未开启任务。共用一个常量：一页最多 200 行，不要每行都新建对象 */
const NO_TASK: TaskView = {
    text: '未开启任务', color: 'secondary', variant: 'tonal', title: '该行还没有审批单', hasOrder: false,
}

/** approval_chain.status → 展示文案。缺值/未知值都兜住，库里出现新状态时不会渲染成空白 */
function statusView(status: number | undefined, orderNo?: string): TaskView {
    /*
     * 提示里点明"不能重新开启"：这一行的勾选框是灰的，光给个单号不足以说明为什么点不动。
     * 能走到这里的行都是**已经有单**的（没有单的行用 NO_TASK），所以这句话恒成立。
     */
    const title = `${orderNo ? `单号 ${orderNo} · ` : ''}已有单，不能重新开启任务`
    // 走到这里的行都**已经有单**（没有单的行用 NO_TASK），所以 hasOrder 恒为 true
    const base = { title, hasOrder: true }
    if (status === APPROVAL_STATUS.PENDING) return { text: '进行中', color: 'primary', variant: 'flat', ...base }
    if (status === APPROVAL_STATUS.APPROVED) return { text: '已通过', color: 'success', variant: 'flat', ...base }
    if (status === APPROVAL_STATUS.REJECTED) return { text: '已驳回', color: 'error', variant: 'flat', ...base }
    return { text: status === undefined ? '状态未知' : `状态 ${status}`, color: 'secondary', variant: 'tonal', ...base }
}

/** 行 id → 该行当前单的展示信息（没有单的行也会写进去 = 未开启任务） */
const taskByRowId = ref<Record<string, TaskView>>({})

function taskOf(rowId: unknown): TaskView {
    return taskByRowId.value[String(rowId ?? '')] ?? NO_TASK
}

/**
 * 这一行现在**还能不能开启任务**。
 *
 * 口径（需求）：**在流程中**或**已经结束**的单都不允许重新开启 —— 也就是"一行数据只对应一张单"。
 * 实现上就一句：**只要这一行已经有单就锁住**（看 `hasOrder`，理由见 TaskView 的注释）。
 *
 * 为什么不能只拦"进行中"：已通过 / 已驳回同样是**结束状态**，放过去就会给同一条数据
 * 再开一张新单，两张单各跑各的流程 —— 业务上说不清哪张算数、审批人也可能收到两份待办。
 *
 * ⚠️ 若以后要让"已驳回"的行能重新提：**必须同时改两处**，否则界面能勾、建单却跳过：
 *    ① 这里（`hasOrder` 的来源 `statusView`）；② 建单闸门 `findBlockingOrder`。
 *
 * ⚠️ 页面上的状态来自一次批量查询，读失败时会空掉（那时这里一律返回 true = 放行）——
 *    所以它只是**界面提示**；真正的闸门在建单时按库里的单判断（见 findBlockingOrder）。
 */
function canStartTask(rowId: unknown): boolean {
    return !taskOf(rowId).hasOrder
}

/** 给 v-data-table 的 `item-selectable` 用：已有单的行连勾都勾不上（含全选 / Shift 连选） */
function isRowSelectable(row: Record<string, unknown> | undefined): boolean {
    return canStartTask(row?.id)
}

/** 给 v-chip 用的属性（不含 text，否则它会被当成 DOM 属性写到元素上） */
function taskChip(rowId: unknown) {
    const { color, variant, title } = taskOf(rowId)
    return { color, variant, title }
}


function currentOrderOf(list: ApprovalOrder[]): ApprovalOrder | undefined {
    return list.find(o => o.status === APPROVAL_STATUS.PENDING) ?? list[0]
}

async function loadTaskStatus(list: Record<string, unknown>[]) {
    const keys = list.map(row => ({ id: String(row.id ?? ''), syncKey: makeSyncKey(row) }))
    try {
        const orders = await getOrdersByRows(keys.filter(k => k.id))
        // 按行归并：relation 与 sync_key 两个口径可能都命中同一张单，按单 id 去重
        const byId = new Map<string, ApprovalOrder[]>()
        const byKey = new Map<string, ApprovalOrder[]>()
        const add = (map: Map<string, ApprovalOrder[]>, key: string, order: ApprovalOrder) => {
            if (!key) return
            const arr = map.get(key) ?? []
            if (!arr.some(x => x.id === order.id)) arr.push(order)
            map.set(key, arr)
        }
        for (const o of orders) {
            add(byId, o.relation ?? '', o)
            add(byKey, o.sync_key ?? '', o)
        }
        const next: Record<string, TaskView> = {}
        for (const k of keys) {
            if (!k.id) continue
            const merged = [...(byId.get(k.id) ?? []), ...(byKey.get(k.syncKey) ?? [])]
                .filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i)
            const current = currentOrderOf(merged)
            next[k.id] = current ? statusView(current.status, current.order_no) : NO_TASK
        }
        taskByRowId.value = next
    } catch (e) {
        console.warn('[workStream] 读取任务状态失败，本页按「未开启任务」显示:', e)
        taskByRowId.value = {}
    }
}

/** 建单后重新拉一次，让新建的单立刻显示成「进行中」 */
function refreshTaskStatus() {
    return loadTaskStatus(Object.values(rawRows.value))
}

const headers = computed(() => [
  ...visibleFields.value.map(({ title, key, sortable, fixed }) => {
    const w = widthOf(key)
    /*
     * 普通列：只有「用户调过宽度」的列才给 width，没调过的只给 minWidth（原因见上方注释）。
     * **固定列例外**：Vuetify 是按 `width` 累加 `fixedOffset` 的（多列固定时没静态宽度
     * 会报 “Multiple fixed columns should have a static width”，偏移也会错位）——
     * 所以图片列（productFields 里 fixed: true）必须给死宽度。
     */
    const resized = colLayout.value.some(i => i.field === key && typeof i.width === 'number')
    return {
      title,
      key,
      sortable: sortable ?? false,
      align: 'center' as const,
      fixed,
      ...(resized || fixed ? { width: w, minWidth: w } : { minWidth: w }),
    }
  }),
  // 任务状态：永远排在最后、固定在右侧。
  // Vuetify 4 的 fixed: 'end' 自带 position: sticky / right: 0 / 背景色 / 左分隔线，不用另写样式。
  {
    title: '任务状态',
    key: TASK_STATUS_KEY,
    sortable: false,
    align: 'center' as const,
    fixed: 'end' as const,
    width: 100,
    minWidth: 100,
  },
])

/**
 * 左侧「复选框 + 产品图片」两列要**一起**钉住。
 *
 * 复选框列是 Vuetify 为 `show-select` 内部 `unshift` 进来的（key = data-table-select），
 * 它**不带 fixed** —— 而图片列是 `fixed: true`（fixedOffset 从 0 起算），
 * 于是横向滚动时图片会滑到复选框上面，把多选框盖掉一半、看着像"复选框没固定"。
 *
 * 这里自己声明同一 key 的表头并 `fixed: 'start'`：Vuetify 见到该 key 就不再注入它那份
 * （见 node_modules/vuetify 的 createHeaders：`keys.has('data-table-select')` 就不 unshift），
 * 两列偏移按 48 + 图片宽依次累加 —— 一起固定在左侧，且顺序不变。
 */
const SELECT_HEADER = {
  title: '',
  key: 'data-table-select',
  sortable: false,
  width: 48,
  minWidth: 48,
  fixed: 'start' as const,
}

/**
 * 表格实际用的表头 = 复选框列 + 字段列。
 *
 * ⚠️ 不能把它并进 `headers`：列宽拖拽靠 `LEADING_COLUMNS` 把 th 下标减 1 映射回
 * **字段列**（见 resizeTargetOf），多一列会让映射整体错位一格。
 */
const tableHeaders = computed(() => [SELECT_HEADER, ...headers.value])

let resizing: { key: string; startX: number; startWidth: number } | null = null

const LEADING_COLUMNS = 1

function resizeTargetOf(e: { target: EventTarget | null; offsetX: number }) {
  const th = (e.target as HTMLElement | null)?.closest?.('th')
  if (!th) return null
  if (th.clientWidth - e.offsetX > RESIZE_ZONE) return null
  const row = th.parentElement
  const index = row ? Array.from(row.children).indexOf(th) - LEADING_COLUMNS : -1
  const header = headers.value[index]
  if (!header) return null
  return { key: String(header.key), width: th.clientWidth }
}

function endResize() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  if (!resizing) return
  resizing = null
  // 拖拽中每帧都写 PB 显然不行，松手后防抖落库一次
  scheduleLayoutSave()
}

function onPointerUp() {
  endResize()
}

function onPointerMove(e: PointerEvent) {
  if (!resizing) return
  const next = Math.max(
    MIN_COL_WIDTH,
    Math.round(resizing.startWidth + (e.clientX - resizing.startX)),
  )
  setColumnWidth(resizing.key, next)
}

function onPointerDown(e: PointerEvent) {
  const hit = resizeTargetOf(e)
  if (!hit) return
  // 阻止默认行为，否则拖动时会把表头文字选中；触屏上还会把页面滚走
  e.preventDefault()
  resizing = { key: hit.key, startX: e.clientX, startWidth: hit.width }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}

/** 双击热区 = 该列恢复默认宽度 */
function onDblClick(e: MouseEvent) {
  const hit = resizeTargetOf(e)
  if (!hit) return
  resetColumnWidth(hit.key)
  scheduleLayoutSave()
}

const SEARCH_FIELDS = ['SKU', 'SPU', '主MODEL', '产品名称']

/** 日期范围按哪一列过滤。BI 返回 'YYYY-MM-DD' 字符串，可直接按字典序比大小 */
const DATE_FILTER_FIELD = '最早开售日期-SKU'

type FilterKey =
  | 'type' | 'sale' | 'model' | 'manager' | 'department'
  | 'category1' | 'category2' | 'lamp'
  | 'group' | 'platform' | 'warehouse'
  // 「任务状态」不在 SELECT_CONFIGS 里 —— 它不是 bi_rows 的列，是关联单据算出来的（见 taskStatusQuery）
  | 'taskStatus'

const DEAD_COLUMN = biColumnOf('是否属于呆滞库存') ?? 'is_dead'
const FIXED_EQUALS: Record<string, string> = { [DEAD_COLUMN]: '0' }

const SELECT_CONFIGS: { key: FilterKey; field: string; mode: 'eq' | 'includes' }[] = [
  { key: 'sale', field: '供应商', mode: 'eq' },
  // { key: 'model', field: '主MODEL', mode: 'eq' },
  { key: 'manager', field: '组长', mode: 'eq' },
  { key: 'department', field: '部门', mode: 'eq' },
  // { key: 'lamp', field: '是否属于灯具', mode: 'eq' },
  { key: 'group', field: '组别', mode: 'eq' },
  { key: 'platform', field: '平台', mode: 'eq' },
  { key: 'warehouse', field: '仓位', mode: 'eq' },
]

const FACET_COLUMNS = [...new Set(
  SELECT_CONFIGS.map(c => biColumnOf(c.field)).filter((c): c is string => !!c),
)]


function currentQuery(extra: Partial<BiRowQuery> = {}): BiRowQuery {
  const f = applied.value
  const equals: Record<string, string> = { ...FIXED_EQUALS }
  const contains: Record<string, string> = {}
  for (const cfg of SELECT_CONFIGS) {
    const v = f[cfg.key]
    if (!v) continue
    const col = biColumnOf(cfg.field)
    if (!col) continue
    if (cfg.mode === 'includes') contains[col] = v
    else equals[col] = v
  }
  const searchColumns = SEARCH_FIELDS.map(biColumnOf).filter((c): c is string => !!c)
  const from = f.dateRange[0]
  const to = f.dateRange[f.dateRange.length - 1]
  return {
    componentId: COMPONENT_ID,
    page: page.value,
    perPage: itemsPerPage.value,
    ...(sortBy.value ? { sort: sortBy.value } : {}),
    equals,
    contains,
    search: { columns: searchColumns, value: f.search },
    range: {
      column: biColumnOf(DATE_FILTER_FIELD) ?? 'first_sale_date',
      from: from ? toISO(from) : undefined,
      to: to ? toISO(to) : undefined,
    },
    ...extra,
  }
}

/**
 * 「任务状态」下拉的选项。
 *
 * ⚠️ 必须与 statusView() 的文案**逐字一致**：不一致的话，用户在下拉里选一个界面上
 *    根本看不到的词，只会以为筛选坏了。「全部」不放进选项 —— 清空（clearable）就是全部。
 *
 * 类型是 string[] 而不是字面量元组：draft.taskStatus 的类型来自 FilterKey 那套
 * `Record<FilterKey, string | null>`，收窄成字面量会让 v-model 对不上。
 * （代价是改了 statusView 的文案这里不会编译报错，所以上面那句提醒要当真。）
 *
 * 没收录 statusView 的「状态未知 / 状态 N」：那是库里出现未知 status 时的兜底文案，
 * 属于脏数据 —— 那种行四个选项都筛不到（它有关联单，所以不算"未开启任务"），
 * 总行数看起来会"少几个人"。真遇到了应该去修数据，不是在这儿加个筛选项把它藏起来。
 */
const TASK_STATUS_FILTER_ITEMS: string[] = ['未开启任务', '进行中', '已通过', '已驳回']

/**
 * 「任务状态」筛选 → 查询条件片段。
 *
 * ## 为什么要异步
 *
 * 任务状态存在 `approval_chain`，`bi_rows` 里**没有这一列** —— 它是页面上按行关联算出来的
 * （见 loadTaskStatus）。所以只能先反查关联单拿到键，再拼成 bi_rows 的条件
 * （utils/biQuery 的 matchAny / matchNone）。
 *
 * ## 口径必须与状态列一致
 *
 * 状态列取的是 `currentOrderOf()`：**进行中优先**，否则最新那张。于是：
 *   · 进行中 = 关联到 status=0 的单；
 *   · 已通过 = 关联到 status=1 的单，且**没有** status=0 的单；
 *   · 已驳回 = 同理，基于 status=2；
 *   · 未开启 = 与任何单都不关联。
 * 少了"排除进行中"这一步，一行既有历史已通过的单、又有当前进行中的单时，
 * 按「已通过」和「进行中」都能筛出来 —— 而列上只显示「进行中」。
 */
async function taskStatusQuery(): Promise<Partial<BiRowQuery>> {
  const wanted = applied.value.taskStatus
  if (!wanted) {
    return {}
  }

  const orders = await getOrderRowKeys()
  const pending = orders.filter(o => o.status === APPROVAL_STATUS.PENDING)

  if (wanted === '未开启任务') {
    const groups = orderKeyGroups(orders)
    guardTaskFilterSize(groups, orders.length)
    return { matchNone: groups }
  }

  const target = wanted === '进行中'
    ? pending
    : orders.filter(o => o.status === (wanted === '已通过' ? APPROVAL_STATUS.APPROVED : APPROVAL_STATUS.REJECTED))
  const groups = orderKeyGroups(target)
  guardTaskFilterSize(groups, target.length)

  const extra: Partial<BiRowQuery> = { matchAny: groups }
  if (wanted !== '进行中' && pending.length > 0) {
    extra.matchNone = orderKeyGroups(pending)
  }
  return extra
}

/**
 * 条件值太多就**明确报错**，不静默截断。
 *
 * 两种坏表现都指向同一件事：条件塞不下。截断是"筛出来的行莫名少了一批"；
 * URL 太长是 PB 或反向代理直接拒掉，看起来像"一筛选就没数据"。两种都很难往这里想。
 */
function guardTaskFilterSize(groups: Array<{ column: string, values: string[] }>, orders: number) {
  const n = orderKeyGroupCount(groups)
  if (n > MAX_STATUS_FILTER_VALUES) {
    throw new Error(
      `「${applied.value.taskStatus}」涉及 ${orders} 张单，需要 ${n} 个查询条件`
      + `（上限 ${MAX_STATUS_FILTER_VALUES}），无法按任务状态筛选。请先用其它条件收窄范围。`,
    )
  }
}

let lastQueryKey = ''

/** 读当前页。库里存的是数字（供排序 / 比较），千分位只在显示时加 */
async function loadPage(force = false) {
  loading.value = true
  fetchError.value = ''
  try {
    /*
     * query 挪进 try 里构造：任务状态筛选要先反查关联单（异步），
     * 反查失败 / 条件值超限时走下面同一个 catch —— 把原因显示在页头，而不是静默不筛
     * （静默不筛最坑：用户以为筛过了，看到的其实是全部数据）。
     */
    const query = currentQuery(await taskStatusQuery())
    const key = JSON.stringify(query)
    if (!force && key === lastQueryKey) {
      return
    }
    lastQueryKey = key

    const res = await fetchBiRows(query)
    rows.value = res.rows.map(formatDatas)
    // 原始行留一份（见 rawRows 的说明）：建单时快照进单据，供分支条件按业务数据选路
    rawRows.value = Object.fromEntries(
      (res.rows as unknown as Record<string, unknown>[]).map(r => [String(r.id ?? ''), r]),
    )
    totalItems.value = res.totalItems
    fetchedAt.value = new Date().toLocaleString('zh-CN')
    // 任务状态是另外关联查出来的（approval_chain），不阻塞表格渲染
    void loadTaskStatus(res.rows as unknown as Record<string, unknown>[])
  } catch (e) {
    console.error('[setDatas] 从 PB 读取失败:', e)
    rows.value = []
    totalItems.value = 0
    const raw = e instanceof Error ? e.message : String(e)

    fetchError.value = /aborted|Failed to fetch|NetworkError|network/i.test(raw)
      ? `连接被中断（${raw}）—— 多为页面刷新/热更新打断，点右上角刷新重试`
      : raw
    // 失败时清掉签名，下次（比如点刷新）能原样重试
    lastQueryKey = ''
  } finally {
    loading.value = false
  }
}

let facetsLoaded = false

async function loadFacets(force = false) {
  if (facetsLoaded && !force) return
  try {
    facets.value = await fetchBiFacets(COMPONENT_ID, FACET_COLUMNS)
    facetsLoaded = true
  } catch (e) {
    // 失败不置标志，下次进来会重试
    console.error('[setDatas] 读取筛选选项失败:', e)
  }
}

async function reload(force = false) {
  await Promise.all([loadFacets(force), loadPage(force)])
}

const draft = reactive<{ search: string; dateRange: Date[] } & Record<FilterKey, string | null>>({
  search: '',
  dateRange: [],
  type: null,
  sale: null,
  model: null,
  manager: null,
  department: null,
  category1: null,
  category2: null,
  lamp: null,
  group: null,
  platform: null,
  warehouse: null,
  // 不在 SELECT_CONFIGS 里：它的选项是固定四个（见 TASK_STATUS_FILTER_ITEMS），且要反查关联单
  taskStatus: null,
})

/** 快照草稿。dateRange 必须复制：直接展开会与 draft 共享同一个数组引用 */
function snapshotFilters() {
  return { ...draft, dateRange: [...draft.dateRange] }
}

/** 已生效的筛选条件，点「确认」时快照 */
const applied = ref(snapshotFilters())

const activeFilterCount = computed(() => {
  const f = applied.value
  let n = 0
  if (f.search.trim()) n++
  for (const c of SELECT_CONFIGS) if (f[c.key]) n++
  // 任务状态不在 SELECT_CONFIGS 里（它不是 bi_rows 的列），单独算 —— 漏了它的话，
  // 页头不会显示"已启用 N 项筛选"，用户会以为筛选没生效
  if (f.taskStatus) n++
  if (f.dateRange.length) n++
  return n
})

/** 空表文案：有筛选条件时必须说清是「筛没的」，否则会被当成数据没入库 */
const noDataText = computed(() =>
  activeFilterCount.value > 0 ? '没有符合筛选条件的数据，试试放宽条件' : '暂无数据',
)

function toISO(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${m}-${day}`
}

function distinctValues(field: string): string[] {
  const col = biColumnOf(field)
  return col ? (facets.value[col] ?? []) : []
}

const filterOptions = computed(() => {
  const map = {} as Record<FilterKey, string[]>
  for (const cfg of SELECT_CONFIGS) map[cfg.key] = distinctValues(cfg.field)
  return map
})

/** 列 key → 界面标题。取自字段清单，标题不再抄第二份 */
const TITLE_BY_KEY: Record<string, string> = Object.fromEntries(
  PRODUCT_FIELDS.map(f => [f.key, f.title]),
)

const selectControls = computed(() =>
  SELECT_CONFIGS.map(cfg => {
    const values = filterOptions.value[cfg.key]
    return {
      key: cfg.key,
      label: TITLE_BY_KEY[cfg.field] ?? cfg.field,
      items: values,
    }
  }),
)

/** 「确认」：草稿转生效条件，回到第 1 页并重新查（否则筛选后会停在越界的空白页） */
function applyFilters() {
  applied.value = snapshotFilters()
  page.value = 1
  void loadPage()
}

/** 「重置」：清空全部条件 */
function resetFilters() {
  draft.search = ''
  draft.dateRange = []
  // 用 SELECT_CONFIGS 驱动，以后加筛选项不会再漏清
  for (const cfg of SELECT_CONFIGS) draft[cfg.key] = null
  // 任务状态不在 SELECT_CONFIGS 里，得单独清（漏了它就是"重置之后还筛着"）
  draft.taskStatus = null
  applyFilters()
}

function onTableOptions(opts: {
  page: number
  itemsPerPage: number
  sortBy: { key: string; order: 'asc' | 'desc' }[]
}) {
  page.value = opts.page
  itemsPerPage.value = opts.itemsPerPage
  const first = opts.sortBy[0]
  const col = first ? biColumnOf(String(first.key)) : undefined
  sortBy.value = first && col ? `${first.order === 'desc' ? '-' : ''}${col}` : ''
  void loadPage()
}
/** 上传结果反馈。用 snackbar 而不是顶部那条 fetchError 文案：后者是 text-error（红字），
 *  成功也显示成红的会被当成失败。 */
const snackbar = ref<{ show: boolean; text: string; color: 'success' | 'warning' | 'error' }>({
  show: false,
  text: '',
  color: 'success',
})
function showMsg(text: string, color: 'success' | 'warning' | 'error' = 'success') {
  snackbar.value = { show: true, text, color }
}
/* ==================== 开启任务（对当前页第一条数据建审批单） ==================== */

/**
 * 模板名的后半段：**就是「模板」这两个字**，写死在代码里。
 *
 * 完整名字 = 这一行的**组别** + `模板`（直接拼，中间不加连字符、也不加别的字样）。
 * 例：组别 `美2组` → 去审批模板里找那张叫 `美2组模板` 的模板。
 *
 * ✅ 一张模板对应一个组别，所以"用哪张模板"是**按行**算的 —— 一批里混着不同组别也各用各的
 *    （以前写死一张模板，选到别的组别的行会全部建不出来）。
 */
const TASK_TEMPLATE_WORD = '模板'

/**
 * 这一行该用哪张审批模板：`<组别>模板`。
 *
 * 组别取的是行数据里的 `组别` 列（bi_rows 的中文列名，见 utils/biRowFields 的字段表）。
 * 拿不到组别 → 返回 `''`，由调用方按"这一行用不了模板"报出来（不猜、也不静默换个模板）。
 */
function taskTemplateNameOf(row: Record<string, unknown>): string {
    const group = String(row['组别'] ?? '').trim()
    return group ? `${group}${TASK_TEMPLATE_WORD}` : ''
}

/** 行的展示标识（与 createTaskForRow 里报错/汇总用的 label 同口径，别再各写一份） */
function rowLabelOf(row: Record<string, unknown>): string {
    return String(row.SKU ?? row['库存SKU'] ?? row.id ?? '—')
}

/**
 * 取某张模板的建单快照（流程 + 画布 + 拍平的 chain，作为单据快照的底子）。
 *
 * `flow` 是唯一事实源：**没配流程的模板不给建单**（与 utils/utils 的 generateApprovalChain 同口径），
 * 找不到 / 没配置 → 返回 null，由调用方把原因归到**那一行**上（不再整批中断，
 * 因为不同组别的行用的是不同模板）。
 */
async function taskPayloadOf(templateName: string): Promise<NonNullable<ApprovalOrder['chain']> | null> {
    // 组别是数据里的值：用 JSON.stringify 生成带引号的字面量（顺带把引号 / 反斜杠转义好）
    const template = await getApprovalFirstByFilter(`name=${JSON.stringify(templateName)}`)
    const flow = template?.chain?.flow
    if (!flow?.length) return null
    /*
     * 快照只带**运行期真正要用**的东西：flow（执行）+ branchTerminal（分支出口表）。
     *
     * **不再带模板的 `graph`**：那是编辑器的画布（节点坐标、连线弯曲点、卡片内嵌的小画布、
     * 连线上的条件对象…），实测一份单里它占了整份快照的 47%（120 KB / 252 KB），
     * 而单据这一侧从来不画图 —— 运行期只从里面取"这条分支线是不是直达结束节点"。
     * 出口表就在建单这一刻算好带走（口径见 types/approval 的 branchTerminalMapOf），
     * 模板之后怎么改都不影响已建的单（与 flow 同一承诺）。
     */
    return {
        chain: flowToChain(flow),
        flow,
        branchTerminal: compactBranchTerminal(branchTerminalMapOf(template?.chain)),
        decisions: [],
    }
}

const PB_RECORD_ID_RE = /^[a-z0-9]{15}$/

/** 建单进行中：防止连点建出多张单 */
const starting = ref(false)
/** 表格勾选的行 id（服务端分页：勾选只在当前页内累积，翻页不会跨页保留） */
const selectedIds = ref<string[]>([])
/** 批量建单的进度文案，挂在按钮上（如「处理中 3/20」） */
const batchText = ref('')

/**
 * 查这一行**已有的单**里，有没有"挡住重新开启"的那张（建单闸门，按库里的单判断）。
 *
 * 口径与 `canStartTask` 必须一致：**只要有单就挡**（在流程中 / 已通过 / 已驳回）。
 * 之前这里只找 `PENDING` —— 于是已通过、已驳回的行会被**重新开启**，建出第二张单。
 *
 * 读失败时**只告警、不阻断**（保持原样）：这是防重复的安全网，不该因为一次读失败
 * 就让功能完全不可用；代价是极端情况下可能多建一张 —— 相比"所有人都开不了单"，
 * 那一边更可接受。
 */
async function findBlockingOrder(biRowId: string, syncKey: string) {
    try {
        const list = await getOrdersByRow(biRowId, syncKey)
        // 优先报"进行中"那张（它对用户最要紧），否则报最新那张（getOrdersByRow 按新到旧给）
        return list.find(o => o.status === APPROVAL_STATUS.PENDING) ?? list[0]
    } catch (e) {
        console.warn('[workStream] 查该数据已有审批单失败，继续建单:', e)
        return undefined
    }
}

/** 被挡下的原因，写成给用户看的一句话（点名单号与状态，别只说"已有单"） */
function blockReasonOf(order: ApprovalOrder): string {
    const no = order.order_no ?? order.id ?? '—'
    if (order.status === APPROVAL_STATUS.PENDING) return `已有进行中的单 ${no}`
    if (order.status === APPROVAL_STATUS.APPROVED) return `已有已通过的单 ${no}，已结束不能再开启`
    if (order.status === APPROVAL_STATUS.REJECTED) return `已有已驳回的单 ${no}，已结束不能再开启`
    return `已有单 ${no}（状态 ${order.status}），不能再开启`
}
/**
 * 组织架构缓存（一次会话取一次就够；建单时用它解析动态审批人）。
 * undefined = 还没取过；null = 取失败（后面按"解析不出来"处理）。
 */
let orgCache: OrgTreeData | null | undefined
async function orgTree(): Promise<OrgTreeData | null> {
    if (orgCache !== undefined) return orgCache
    try {
        const res = await fetchOrgTreeCache()
        orgCache = res?.data ?? null
        if (!orgCache) console.warn('[workStream] 组织架构缓存为空，动态审批人无法解析')
    } catch (e) {
        console.warn('[workStream] 组织架构缓存取不到，动态审批人无法解析:', e)
        orgCache = null
    }
    return orgCache
}

/** 单条的处理结果 */
interface TaskResult {
    kind: 'created' | 'skipped' | 'failed'
    /** 展示用的行标识（SKU） */
    label: string
    /** 成功时是单号；跳过/失败时是原因 */
    detail?: string
}

async function startTasks() {
    if (starting.value) return
    const picked = rows.value.filter(r => selectedIds.value.includes(String(r.id ?? '')))
    if (!picked.length) {
        showMsg('请先勾选要开启任务的数据（表头复选框可全选当前页）', 'error')
        return
    }
    const targets = picked.filter(r => canStartTask(r.id))
    const lockedCount = picked.length - targets.length
    if (!targets.length) {
        showMsg(`选中的 ${picked.length} 条都已有单（在流程中或已结束），不能重新开启任务`, 'warning')
        return
    }

    starting.value = true
    const results: TaskResult[] = []
    try {
        /*
         * 模板**按行**取：模板名 = 「组别」+「模板」（见 taskTemplateNameOf），
         * 一批里不同组别各用各的模板。
         * 同名只查一次（cache 里存"快照 or null"），同一组别的几十行不会重复打库。
         */
        const cache = new Map<string, NonNullable<ApprovalOrder['chain']> | null>()

        // 批内去重：同一个业务键在一次批量里只处理一次
        const seen = new Set<string>()
        for (let i = 0; i < targets.length; i++) {
            batchText.value = `处理中 ${i + 1}/${targets.length}`
            const row = targets[i]
            const templateName = taskTemplateNameOf(row)
            if (!templateName) {
                // 没有组别就没法确定模板：报在这一行上，继续处理别的行
                results.push({ kind: 'failed', label: rowLabelOf(row), detail: '这一行没有「组别」，无法确定用哪张审批模板' })
                continue
            }
            if (!cache.has(templateName)) {
                cache.set(templateName, await taskPayloadOf(templateName))
            }
            const payload = cache.get(templateName)
            if (!payload) {
                results.push({
                    kind: 'failed', label: rowLabelOf(row),
                    detail: `找不到审批模板「${templateName}」，或该模板没有配置流程`,
                })
                continue
            }
            results.push(await createTaskForRow(row, payload, seen))
        }
        selectedIds.value = []
        // 建完单立刻把状态刷成「进行中」，否则用户会以为没成功
        await refreshTaskStatus()
        reportTaskResults(results, lockedCount)
    } catch (e) {
        console.error('[workStream] 批量开启任务失败:', e)
        showMsg(`开启任务失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
        starting.value = false
        batchText.value = ''
    }
}


/**
 * 对**一行**建单。
 *
 * `payload` 是**这张模板**的建单快照 —— 由调用方按该行的组别取好（见 taskPayloadOf）：
 * 同一个批次里不同组别的行，`payload` 是不同的那张模板。
 */
async function createTaskForRow(
    row: Record<string, unknown>,
    payload: NonNullable<ApprovalOrder['chain']>,
    seen: Set<string>,
): Promise<TaskResult> {
    const label = rowLabelOf(row)
    // 只认 PB 记录 id（形如 15 位 [a-z0-9]）：relation 必须是真实记录 id，否则 PB 会拒
    const biRowId = String(row.id ?? '')
    if (!PB_RECORD_ID_RE.test(biRowId)) {
        return { kind: 'failed', label, detail: '拿不到记录 id' }
    }
    // 业务的兜底键，与服务端同步用的是同一个 makeSyncKey（第一段 SKU 为空时返回 ''）
    const syncKey = makeSyncKey(row)
    if (syncKey && seen.has(syncKey)) {
        return { kind: 'skipped', label, detail: '本批重复' }
    }
    if (syncKey) seen.add(syncKey)

    try {
        /*
         * 同一条数据只允许一张单：**在流程中**或**已经结束**（已通过 / 已驳回）都不再重开。
         * 页面上的勾选已经被 `isRowSelectable` 挡住了，这里再按库里的单判一次 ——
         * 页面那份状态是批量查出来缓存的，可能过期（或那次查询失败），不能当成唯一依据。
         */
        const blocker = await findBlockingOrder(biRowId, syncKey)
        if (blocker) {
            return { kind: 'skipped', label, detail: blockReasonOf(blocker) }
        }
        const context = toFlowContext(rawRows.value[biRowId] ?? row)
        const templateFlow = payload.flow as ApprovalFlow | undefined
        let flow = templateFlow
        if (templateFlow) {
            /*
             * ⓪①② 建单期展开：先展开「引用模板」（把源模板的流程搬进来），
             * 再把「数据查询」求值（只留命中那条分支），最后按组展开「组间轮询」。
             * 见 utils/expandFlowForOrder —— flow 是**静态快照**，运行期不再求值，
             * 漏掉这一步会留下没展开的 ref/probe/loop，办到那一环时提交直接报错。
             * 引用在这一步被"拍平"进本单快照：源模板以后改了，**已建的单不受影响**。
             */
            const expanded = await expandFlowForOrder(templateFlow, context)
            if (expanded.issues.length > 0) {
                return { kind: 'failed', label, detail: `流程展开失败 —— ${expanded.issues.join('；')}` }
            }
            flow = expanded.flow
            /*
             * ③ 动态审批人（角色）在**建单时**解析成真人，并写进本单的 flow 快照。
             * 必须**按行**解析：部门可能来自这一行的数据（deptFrom，如「组别」），批内每行都不同；
             * 所以不能像流水线那样用一份共用 payload。
             * 也必须排在展开**之后**：轮询展开出来的那一环，成员是「该组负责人（role.dept = 组名）」，
             * 得让角色解析去填人（见 utils/approvalRotation 的文件头）。
             * 解析不出来就判这一条失败 —— 没人办的环节会让单子永远停住，当场报出来比事后追查好。
             */
            if (flowHasRoles(flow)) {
                const resolved = resolveFlowRoles(flow, await orgTree(), context)
                if (resolved.unresolved.length) {
                    const why = resolved.unresolved.map(u => `${u.where}：${u.reason}`).join('；')
                    return { kind: 'failed', label, detail: `动态审批人没解析出来 —— ${why}` }
                }
                flow = resolved.flow
            }
        }
        /*
         * ④ 成员瘦身 + **补 open_id**（见 types/approval 的 slimFlowMembers）：
         *    · 快照只留"身份 + 展示"要用的字段；
         *    · 老模板画布里的成员只有邮箱/姓名（那时还没存 open_id），按通讯录补上 ——
         *      发飞书通知与查头像都优先用 open_id，没有邮箱的人也能收到。
         * 必须排在**展开与角色解析之后** —— 角色解析会新增成员（把「部门负责人」换成真人），
         * 提前做就管不到它们了。
         */
        const dir = buildOrgDirectory((await orgTree())?.tree)
        const slim = flow ? slimFlowMembers(flow, m => memberOpenId(dir, m)) : undefined
        const order = await createApprocalModel(
            {
                ...payload,
                ...(slim ? { flow: slim, chain: flowToChain(slim) } : {}),
                context,
            },
            { relation: biRowId, syncKey },
        ) as { id?: string; order_no?: string } | undefined
        if (!order?.id) {
            return { kind: 'failed', label, detail: '创建被拒（字段级报错见控制台）' }
        }
        return { kind: 'created', label, detail: order.order_no ?? order.id }
    } catch (e) {
        console.error('[workStream] 建单失败:', label, e)
        return { kind: 'failed', label, detail: e instanceof Error ? e.message : String(e) }
    }
}

/**
 * 把一批结果汇总成一条提示（snackbar 装不下的时候就举例，不逐条列）。
 *
 * @param lockedCount 因为"已有单（在流程中 / 已结束）"被剔掉的条数（见 startTasks）
 */
function reportTaskResults(results: TaskResult[], lockedCount = 0) {
    const created = results.filter(r => r.kind === 'created')
    const skipped = results.filter(r => r.kind === 'skipped')
    const failed = results.filter(r => r.kind === 'failed')
    const head = [`共 ${results.length} 条`, `成功 ${created.length}`]
    if (skipped.length) head.push(`跳过 ${skipped.length}`)
    if (failed.length) head.push(`失败 ${failed.length}`)
    if (lockedCount) head.push(`已有单不可重开 ${lockedCount}`)
    const rest = [...skipped, ...failed]
    const detail = rest.slice(0, 3).map(r => `${r.label}：${r.detail ?? r.kind}`).join('；')
    const text = head.join('、') + (detail ? `（${detail}${rest.length > 3 ? ` 等 ${rest.length} 条` : ''}）` : '')
    // 全成功=success；只是「跳过」=warning（没出错，但什么也没做）；有失败=error
    showMsg(text, created.length ? 'success' : failed.length ? 'error' : 'warning')
}

onMounted(() => {
    reload()
    document.body.classList.add('data-table-page')
})
onBeforeUnmount(() => {
    endResize()
    clearTimeout(layoutSaveTimer)
    isEditorFullscreen.value = false
    document.body.classList.remove('data-table-page')
})
</script>
<style scoped lang="scss">
/* —— 列设置面板 —— */
.col-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: grab;
}

.col-item:hover {
  background: rgba(var(--v-border-color), calc(var(--v-hover-opacity) * 0.5));
}

/* 拖动中：原位置变淡、落点画一条上边线 —— 不然完全看不出会插到哪 */
.col-item--drag {
  opacity: 0.4;
}

.col-item--over {
  box-shadow: inset 0 2px 0 rgb(var(--v-theme-primary));
}

.col-item__handle {
  flex: 0 0 auto;
  color: rgba(var(--v-theme-on-surface), 0.35);
}

/* 标题占满剩余宽度把开关顶到右边；超长省略，否则 65 行宽度参差 */
.col-item__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 强制隐藏的列（本页当筛选用）不给开关，用一句说明代替，见 HIDDEN_COLUMN_KEYS */
.col-item__note {
  flex: 0 0 auto;
  font-size: 12px;
}

.col-item__switch {
  flex: 0 0 auto;

  /* v-switch 默认上下留白很大，65 行会很拖沓，压扁一点 */
  :deep(.v-switch__track) {
    height: 14px;
    min-width: 28px;
  }
}

.screen-full {
  position: fixed;
  inset: 0;
  z-index: 1000;
  /* 与原来的 pa-3 一致，全屏时也不贴边 */
  padding: 12px;
  background: rgb(var(--v-theme-surface));
  /* 内部自己滚动，别把 body 撑出滚动条 */
  overflow: hidden;
}

:deep(.v-data-table .v-table__wrapper > table > thead > tr > th.v-data-table-column--fixed) {
  z-index: 3;
}

:deep(.v-data-table .v-table__wrapper > table > thead > tr > th)::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  /* 必须与脚本里的 RESIZE_ZONE 保持一致 */
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 4;
}

/* 悬停时给一条竖线做提示 —— 否则用户不知道这里可以拖 */
:deep(.v-data-table .v-table__wrapper > table > thead > tr > th:hover)::after {
  box-shadow: inset -1px 0 0 rgba(var(--v-border-color), var(--v-border-opacity));
}

:global(body.data-table-page .v-overlay-container .v-overlay__content:not(.filter-menu) .v-list) {
  padding-block: 2px;
}

:global(body.data-table-page .v-overlay-container .v-overlay__content:not(.filter-menu) .v-list-item) {
  /* Vuetify 默认行高 40px 上下，4 个选项撑得很空 */
  min-height: 26px;
  padding-block: 2px;
}

:global(body.data-table-page .v-overlay-container .v-overlay__content:not(.filter-menu) .v-list-item-title) {
  font-size: 12px;
}

:deep(.v-data-table-footer__items-per-page > .v-select) {
  /* 覆盖 Vuetify 的 width: 90px。选项是 20/50/100/200，最多 3 个字，62px 足够 */
  width: 70px;
}

:deep(.v-data-table-footer__items-per-page > .v-select .v-field) {
  /* 用 CSS 变量压高度，和 .filter-input/.filter-select 是同一套做法 */
  --v-input-control-height: 30px;
  --v-field-padding-top: 1px;
  --v-field-padding-bottom: 0px;
}

:deep(.v-data-table-footer__items-per-page > .v-select .v-field__input) {
  min-height: 26px;
  padding-top: 0;
  padding-bottom: 0;
}

:deep(.v-data-table-footer__items-per-page > .v-select .v-field__append-inner) {
  align-self: center;
  padding-top: 0;
}
</style>

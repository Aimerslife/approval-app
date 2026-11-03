<template>
  <v-container :class="fullSceen ? 'screen-full' : 'pa-3'" fluid @dblclick="onDblClick" @pointerdown="onPointerDown">
    <v-sheet border class="filter-bar p-3 d-flex flex-wrap align-center ga-3" rounded="5px">
      <v-text-field v-model="draft.search" class="filter-input" density="compact" flat hide-details label="搜索"
        prepend-inner-icon="mdi-magnify" single-line variant="solo-filled" @keyup.enter="applyFilters" />

      <v-select v-for="ctl in selectControls" :key="ctl.key" v-model="draft[ctl.key]" class="filter-select" clearable
        density="compact" flat hide-details :items="ctl.items" :label="ctl.label"
        :menu-props="{ contentClass: 'filter-menu' }" single-line variant="outlined" />
      <!--
        「任务状态」不能像上面那样由 SELECT_CONFIGS 驱动：选项是固定的四个（TASK_STATUS_FILTER_ITEMS），
        而且它不是 bi_rows 的列 —— 条件是反查关联单拼出来的（见 taskStatusQuery）。
      -->
      <v-select v-model="draft.taskStatus" class="filter-select" clearable density="compact" flat hide-details
        :items="TASK_STATUS_FILTER_ITEMS" label="任务状态" :menu-props="{ contentClass: 'filter-menu' }" single-line
        variant="outlined" />

      <div class="d-flex align-center ga-2">
        <v-btn color="surface-variant" size="small" variant="flat" @click="resetFilters">
          <span>重置</span>
        </v-btn>

        <v-btn color="#0052D9" size="small" variant="flat" @click="applyFilters">确认</v-btn>
      </div>

      <!-- 已选 N 条 / 开启任务 / 执行记录：与数据管理页共用同一个组件（逻辑见 composables/useTaskStarter） -->
      <TaskStartBar class="ms-auto" :starter="taskStarter" />
    </v-sheet>

    <div class="d-flex align-center justify-space-between">
      <div class="d-flex align-center ga-2">
        <div class="text-caption pl-1 py-1">
          <span class="text-[12px] text-medium-emphasis">读取时间：{{ fetchedAt || '—' }}</span>
          <span class="text-[12px] text-medium-emphasis"> · 按当前条件共 {{ totalItems }} 行</span>
          <span v-if="activeFilterCount" class="text-primary text-[12px]"> · 已启用 {{ activeFilterCount }} 项筛选</span>

          <span v-if="pendingRows.length > 0 && (dedupePreview.duplicated || dedupePreview.missingKey)"
            class="text-[12px] text-warning">（唯一键去重后 {{ dedupePreview.unique }} 行<template
              v-if="dedupePreview.duplicated">，{{ dedupePreview.duplicated }} 行重复</template>

            <template v-if="dedupePreview.missingKey">，{{ dedupePreview.missingKey }} 行无 SKU 会被跳过</template>）</span>

          <span v-if="fetchError" class="text-error text-[12px]"> · {{ fetchError }}</span>

          <v-btn class="ml-3" color="#0052D9" :disabled="loading" size="x-small" variant="flat"
            @click="exportToExcel">导出</v-btn>
        </div>
      </div>

      <div>
        <v-icon-btn color="#7A7A7A" icon="mdi-refresh" :loading="loading" size="small" title="从数据库重新读取" variant="text"
          @click="reload(true)" />

        <v-icon-btn color="#7A7A7A" icon="mdi-cog-outline" size="small" title="列设置" variant="text"
          @click="settingsOpen = true" />

        <v-icon-btn color="#7A7A7A" :icon="fullSceen ? 'mdi-arrow-collapse-all' : 'mdi-arrow-expand-all'" size="small"
          :title="fullSceen ? '退出全屏' : '全屏'" variant="text" @click="setFullScreen" />
      </div>
    </div>

    <!--
      取数中：表格上方一条细进度条。
      表格自己也有 loading（表体遮罩），但它画在**表头下面**，行多 / 表高时很不显眼；
      首屏"暂无数据"那几秒尤其需要这条，否则看不出是在读还是真没数据。
    -->
    <v-progress-linear v-if="loading" color="#0052D9" height="2" indeterminate />

    <v-data-table-server v-model="selectedIds" v-model:items-per-page="itemsPerPage" v-model:page="page" border
      density="compact" fixed-header :headers="tableHeaders" hover fixed-footer :item-selectable="isRowSelectable"
      :height="tableHeight" item-value="id" class="text-[12px]" :items="rows" :items-length="totalItems"
      :items-per-page-options="[20, 50, 100, 200]" items-per-page-text="每页条数" :loading="loading"
      :no-data-text="noDataText" show-select striped="odd" @update:options="onTableOptions">
      <template #item.图片链接="{ value }">
        <v-img v-if="value" class="rounded mx-auto" cover height="48" :src="String(value)" width="48" />

        <span v-else>—</span>
      </template>

      <template #item.是否属于灯具="{ value }">
        <v-chip :color="value == '是' ? 'primary' : 'success'" size="x-small">
          <span>{{ value == '是' ? '灯具' : '非灯具' }}</span></v-chip>
      </template>

      <template #item.__task_status__="{ item }">
        <!--
          「进行中」但实际办不下去（流程卡住 / 当前环节没有审批人）时补一个警示图标：
          文案不改（筛选按 status 算，见 useTaskStarter 里 statusView 的说明），悬浮提示给出原因。
        -->
        <v-chip v-bind="taskChip(item.id)" class="text-[11px]" size="x-small">
          {{ taskOf(item.id).text }}
          <v-icon v-if="taskOf(item.id).alert" class="ml-1" size="12">mdi-alert-circle-outline</v-icon>
        </v-chip>
      </template>
    </v-data-table-server>

    <v-dialog v-model="settingsOpen" max-width="520" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center ga-3 text-[15px]">
          <span>列设置</span>

          <v-chip color="success" label size="x-small" variant="tonal">
            显示 {{ visibleFields.length }} / {{ orderedFields.length }}
          </v-chip>

          <v-spacer />
          <v-btn size="small" variant="text" @click="resetColumnSettings">恢复默认</v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text class="pa-2">
          <div v-for="(item, index) in orderedFields" :key="item.key" class="col-item"
            :class="{ 'col-item--drag': dragIndex === index, 'col-item--over': overIndex === index }" draggable="true"
            @dragend="onDragEnd" @dragover.prevent="onDragOver(index)" @dragstart="onDragStart(index)"
            @drop.prevent="onDrop(index)">
            <v-icon class="col-item__handle" icon="mdi-drag-vertical" size="16" />
            <span class="col-item__title" :title="item.title">{{ item.title }}</span>
            <span v-if="HIDDEN_COLUMN_KEYS.has(item.key)" class="col-item__note">本页固定只看呆滞</span>

            <v-switch v-else class="col-item__switch" color="primary" density="compact" false-icon="mdi-close"
              hide-details :model-value="isVisible(item.key)" true-icon="mdi-check"
              @update:model-value="toggleVisible(item.key)" />
          </div>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-4">
          <span class="text-caption text-medium-emphasis text-[13px]">拖动左侧手柄调整顺序，改动自动保存</span>
          <v-spacer />
          <v-btn color="#0052D9" size="small" variant="flat" @click="settingsOpen = false">完成</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="6000" variant="tonal">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
// Excel 解析放在独立模块里（纯函数，能被 tsx 直接跑单测），页面只负责接线
import {
  biColumnOf, type BiRowQuery, fetchAllBiRows, fetchBiFacets,
  fetchBiRows,
} from '@/api/api'
import { isEditorFullscreen } from '@/composables/useEditorFullscreen'
// 「勾选数据行 → 开启任务」的全部逻辑（任务状态 / 闸门 / 模板解析 / 建单 / 执行记录）都在这里，
// 与「数据管理」页（pages/setDatas）共用同一份实现
import { useTaskStarter } from '@/composables/useTaskStarter'
import TaskStartBar from '@/components/task/TaskStartBar.vue'
import { useUserStore } from '@/stores/user'
import { APPROVAL_STATUS } from '@/types/approval'
// BI 组件 id（审批任务 / 流程模拟共用同一批 bi_rows，别各写一份字面量）
import { APPROVAL_BI_COMPONENT_ID } from '@/utils/biComponent'
// 与服务端**同一个**唯一键实现，用来预告「这份文件入库后是多少行」
import { makeSyncKey } from '@/utils/biRowFields'
// 「任务状态」筛选要反查关联单（状态不在 bi_rows 里，见 taskStatusQuery）
import {
  getOrderRowKeys, MAX_STATUS_FILTER_VALUES, orderKeyGroupCount, orderKeyGroups,
} from '@/utils/collection'
import { PRODUCT_FIELDS, type ProductField } from '@/utils/productFields'
import { type ExportColumn, exportExcel, formatDatas } from '@/utils/utils'

/*
 * BI 组件 id：与「流程模拟」页读同一批数据，口径收在 utils/biComponent 里
 * （字面量各写一份的话，改一次漏一处，现象是"新页面一行数据都查不到"）。
 */
const COMPONENT_ID = APPROVAL_BI_COMPONENT_ID

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

const colLayout = ref<Array<{ field: string, width?: number }>>([])
const colVisible = ref<Record<string, boolean>>({})

const userStore = useUserStore()

const HIDDEN_COLUMN_KEYS = new Set(['是否属于待评估库存'])

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
  } catch (error) {
    console.error('[workStream] 导出失败:', error)
    showMsg(`导出失败：${error instanceof Error ? error.message : String(error)}`, 'error')
  } finally {
    loading.value = false
  }
}

function ensureFullOrder(): Array<{ field: string, width?: number }> {
  const byKey = new Map(PRODUCT_FIELDS.map(f => [f.key, f]))
  const order: string[] = []
  for (const item of colLayout.value) {
    if (byKey.delete(item.field)) order.push(item.field)
  }
  order.push(...byKey.keys())
  const widthByKey = new Map(colLayout.value.map(i => [i.field, i.width]))
  return order.map(field => {
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
    if (f) {
      out.push(f); byKey.delete(item.field)
    }
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
  order: Array<{ field: string, width?: number }>,
  widths: Record<string, number> | undefined,
): Array<{ field: string, width?: number }> {
  const byField = new Map(order.map(i => [i.field, i]))
  for (const f of PRODUCT_FIELDS) {
    if (byField.has(f.key)) continue
    const item: { field: string, width?: number } = { field: f.key }
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

  const reordered
    = order.length !== DEFAULT_ORDER.length || order.some((k, i) => k !== DEFAULT_ORDER[i])

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
    .catch(error => {
      console.error('[setDatas] 保存列设置失败:', error)
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
/*
 * 「任务状态」列 + 勾选闸门 + 建单的整套逻辑抽在 composables/useTaskStarter 里
 * （数据管理页 pages/setDatas 用的是同一份），这里只留表格要用的列 key。
 * 实例在下面 showMsg 之后创建 —— 它要用页面的 rows / rawRows / showMsg。
 */
const TASK_STATUS_KEY = '__task_status__'

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

let resizing: { key: string, startX: number, startWidth: number } | null = null

const LEADING_COLUMNS = 1

function resizeTargetOf(e: { target: EventTarget | null, offsetX: number }) {
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

type FilterKey
  = | 'type' | 'sale' | 'model' | 'manager' | 'department'
  | 'category1' | 'category2' | 'lamp'
  | 'group' | 'platform' | 'warehouse'
  // 「任务状态」不在 SELECT_CONFIGS 里 —— 它不是 bi_rows 的列，是关联单据算出来的（见 taskStatusQuery）
  | 'taskStatus'

/**
 * 本页固定只看「待评估」的行（页头就是这么写的）。
 *
 * ⚠️ 值必须是**归一化后的中文词**：待评估列入库时已由 BI_VALUE_MAP 统一成
 *    「待评估 / 无需评估」（待评估 = 原来的呆滞 0）。这里若还写 '0'，
 *    就是拿一个库里已不存在的值做等值过滤 —— PB 不报错，只返回 0 行，
 *    页面表现为「一条数据都看不到」，而接口日志看起来完全正常。
 */
const DEAD_COLUMN = biColumnOf('是否属于待评估库存') ?? 'is_dead'
const DEAD_VALUE = '待评估'
const FIXED_EQUALS: Record<string, string> = { [DEAD_COLUMN]: DEAD_VALUE }

/**
 * 本页固定排除「总库存数量 或 总库存金额 为 0」的行。
 *
 * 为什么是**查询条件**而不是前端过滤：
 *   · 分页的总行数、翻页、Excel 导出、勾选建单都来自同一次 PB 查询 ——
 *     前端过滤会让"共 N 行"与看得见的行数对不上，导出的还会把 0 库存带出去；
 *   · PB 的 number 字段未填时是 null，`> 0` 一并排除（没有库存数字的行同样没有处理意义）。
 *
 * 列名走 biColumnOf 翻译（中文 key → ASCII 列名），不要手写列名：
 * 字段改过名时会走别名表，手写字面量会在改名后静默变成"字段不存在"。
 */
const POSITIVE_COLUMNS = ['总库存数量', '总库存金额']
  .map(biColumnOf)
  .filter((c): c is string => !!c)

const SELECT_CONFIGS: { key: FilterKey, field: string, mode: 'eq' | 'includes' }[] = [
  { key: 'sale', field: '供应商', mode: 'eq' },
  // { key: 'model', field: '主MODEL', mode: 'eq' },
  { key: 'manager', field: '组长', mode: 'eq' },
  { key: 'department', field: '部门', mode: 'eq' },
  // { key: 'lamp', field: '是否属于灯具', mode: 'eq' },
  { key: 'group', field: '团队', mode: 'eq' },
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
  const to = f.dateRange.at(-1)
  return {
    componentId: COMPONENT_ID,
    page: page.value,
    perPage: itemsPerPage.value,
    ...(sortBy.value ? { sort: sortBy.value } : {}),
    equals,
    contains,
    // 零库存（或库存为空）的行不进任务列表，见 POSITIVE_COLUMNS
    positive: POSITIVE_COLUMNS,
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
 * ⚠️ 必须与 `useTaskStarter` 里 statusView() 的文案**逐字一致**：不一致的话，用户在下拉里选一个界面上
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
  } catch (error) {
    console.error('[setDatas] 从 PB 读取失败:', error)
    rows.value = []
    totalItems.value = 0
    const raw = error instanceof Error ? error.message : String(error)

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
  } catch (error) {
    // 失败不置标志，下次进来会重试
    console.error('[setDatas] 读取筛选选项失败:', error)
  }
}

async function reload(force = false) {
  await Promise.all([loadFacets(force), loadPage(force)])
}

const draft = reactive<{ search: string, dateRange: Date[] } & Record<FilterKey, string | null>>({
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
  if (f.dateRange.length > 0) n++
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
  sortBy: { key: string, order: 'asc' | 'desc' }[]
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
const snackbar = ref<{ show: boolean, text: string, color: 'success' | 'warning' | 'error' }>({
  show: false,
  text: '',
  color: 'success',
})
function showMsg(text: string, color: 'success' | 'warning' | 'error' = 'success') {
  snackbar.value = { show: true, text, color }
}
/*
 * 「勾选数据行 → 开启任务」的实例。
 *
 * 逻辑全在 composables/useTaskStarter：任务状态（表格列 + 勾选闸门）、模板按行解析、
 * 建单前的空跑拦截、批量进度、本机执行记录 —— 与「数据管理」页（pages/setDatas）共用同一份，
 * 建单口径要改只改那一处。这里只把页面的数据源和提示接进去。
 */
const taskStarter = useTaskStarter({
  rows,
  rawRows,
  showMsg,
  // 两个页面各存各的执行记录，互不覆盖
  runsKey: 'approval.workStream.taskRuns',
  logTag: '[workStream]',
})
const { taskOf, taskChip, isRowSelectable, loadTaskStatus } = taskStarter

/**
 * 勾选的行 id。
 *
 * 为什么用 computed 中转、而不是直接从 taskStarter 解构那个 ref：
 * 表格的 `v-model` 会**写回来**（勾选 / 取消 / 全选），这里给一个明确的 setter，
 * 写入一定落到 composable 里那一份 ref 上；建完单后它清空勾选，表格也会跟着刷新。
 */
const selectedIds = computed<string[]>({
  get: () => taskStarter.selectedIds.value,
  set: value => { taskStarter.selectedIds.value = value },
})

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

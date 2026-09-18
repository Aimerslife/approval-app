<template>
  <v-container fluid :class="fullSceen ? 'screen-full' : 'pa-3'" @pointerdown="onPointerDown" @dblclick="onDblClick">
    <v-sheet border rounded="5px" class="p-3 d-flex flex-wrap align-center ga-3">
      <v-text-field v-model="draft.search" density="compact" label="搜索" prepend-inner-icon="mdi-magnify"
        variant="solo-filled" flat hide-details single-line class="filter-input" @keyup.enter="applyFilters">
      </v-text-field>
      <v-select v-for="ctl in selectControls" :key="ctl.key" v-model="draft[ctl.key]" clearable density="compact"
        variant="outlined" hide-details flat single-line class="filter-select" :label="ctl.label" :items="ctl.items"
        :menu-props="{ contentClass: 'filter-menu' }">
      </v-select>
      <div class="d-flex align-center ga-2">
        <v-btn color="surface-variant" variant="flat" size="small" @click="resetFilters">
          <span>重置</span>
        </v-btn>
        <v-btn color="#0052D9" variant="flat" size="small" @click="applyFilters">确认</v-btn>
      </div>
    </v-sheet>
    <div class="d-flex align-center justify-space-between">
      <div class="d-flex align-center ga-2">
        <div class="text-caption pl-1 py-1">
          <span class="text-[12px] text-medium-emphasis">读取时间：{{ fetchedAt || '—' }}</span>
          <!-- totalItems 是 PB 按当前筛选统计的总行数（**不是**当前页行数） -->
          <span class="text-[12px] text-medium-emphasis"> · 库中共 {{ totalItems }} 行</span>
          <span v-if="activeFilterCount" class="text-primary text-[12px]"> · 已启用 {{ activeFilterCount }} 项筛选</span>
          <!-- 待上传文件：先告诉用户入库后是多少行，避免上传完以为丢了数据 -->
          <span v-if="pendingRows.length" class="text-[12px] text-medium-emphasis">
            · 待上传 {{ pendingRows.length }} 行</span>
          <span v-if="pendingRows.length && (dedupePreview.duplicated || dedupePreview.missingKey)"
            class="text-[12px] text-warning">（唯一键去重后 {{ dedupePreview.unique }} 行<template
              v-if="dedupePreview.duplicated">，{{ dedupePreview.duplicated }} 行重复</template><template
              v-if="dedupePreview.missingKey">，{{ dedupePreview.missingKey }} 行无 SKU 会被跳过</template>）</span>
          <span v-if="fetchError" class="text-error text-[12px]"> · {{ fetchError }}</span>
          <v-btn class="ml-3" size="x-small" @click="exportToExcel" variant="flat" color="#0052D9"
            :disabled="loading">导出</v-btn>
        </div>
        <div class="d-flex align-center ml-2">
          <v-file-input ref="fileInputRef" v-model="attachment" hide-input density="compact" accept=".xlsx,.xls,.csv"
            class="attachment-input" @update:model-value="onFileChange">
            <template v-slot:prepend>
              <v-icon size="14" color="#1055C9">mdi-paperclip</v-icon>
            </template>
          </v-file-input>
          <span v-if="attachment" class="text-[12px] text-medium-emphasis text-decoration-underline text-truncate"
            :title="attachment.name">
            {{ attachment.name }}
          </span>
          <span v-else class="text-[12px] text-medium-emphasis cursor-pointer"
            @click="fileInputRef?.click()">上传附件</span>
          <v-btn v-if="attachment" variant="plain" density="compact" icon="mdi-close" @click="attachment = null">
            <v-icon size="15" icon="mdi-close"></v-icon>
          </v-btn>
        </div>
        <v-btn size="x-small" variant="flat" color="#0052D9" :disabled="!pendingRows.length || uploading"
          :loading="uploading" title="把选中的文件写入数据库，并删除库里多出来的旧行" @click="uploadDatas">上传到数据库</v-btn>
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
    <v-data-table-server v-model:page="page" v-model:items-per-page="itemsPerPage" :headers="headers" :items="rows"
      :items-length="totalItems" :loading="loading" :no-data-text="noDataText" items-per-page-text="每页条数"
      :items-per-page-options="[20, 50, 100, 200]" border striped="odd" hover density="compact" fixed-header
      fixed-footer :height="tableHeight" class="text-[12px]" @update:options="onTableOptions">
      <template v-slot:item.图片链接="{ value }">
        <v-img v-if="value" :src="String(value)" width="48" height="48" cover class="rounded mx-auto"></v-img>
        <span v-else>—</span>
      </template>
      <!-- 呆滞列的值已统一成 0 = 呆滞 / 1 = 未呆滞（见 utils/productFields.ts 的 BI_VALUE_MAP）。
           ⚠️ 必须用字符串比较而不是真值判断：0 是有效值，用 `value ?` 会把呆滞全判成未呆滞。 -->
      <template v-slot:item.是否属于呆滞库存="{ value }">
        <v-chip :color="String(value) === '0' ? 'error' : '#00BCD4'" size="x-small" label>
          <span>{{ String(value) === '0' ? '呆滞' : '未呆滞' }}</span></v-chip>
      </template>
      <template v-slot:item.是否属于灯具="{ value }">
        <v-chip :color="value == '是' ? 'primary' : 'success'" size="x-small">
          <span>{{ value == '是' ? '灯具' : '非灯具' }}</span></v-chip>
      </template>
    </v-data-table-server>
    <!-- 列设置：显示哪些字段 + 拖动调顺序。
         65 个字段所以列表要能滚；排序用原生 HTML5 拖拽（项目没装 sortablejs，不引新依赖）。 -->
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
            <v-switch :model-value="isVisible(item.key)" color="primary" density="compact" hide-details
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
import { formatDatas, exportExcel } from '@/utils/utils'
// Excel 解析放在独立模块里（纯函数，能被 tsx 直接跑单测），页面只负责接线
import { parseExcelSheet, describeExcelProblems } from '@/utils/excelTable'
import {
  biColumnOf, fetchAllBiRows, fetchBiFacets, fetchBiRows, uploadBiRows,
  type BiRowQuery,
} from '@/api/api'
import { useUserStore } from '@/stores/user'
import { isEditorFullscreen } from '@/composables/useEditorFullscreen'

/** BI 组件 id */
const COMPONENT_ID = '0c356d17-3c48-4c3b-b133-e6406a88c5fe'

const page = ref(1)
const itemsPerPage = ref(20)
const fullSceen = ref(false)

/* ---------- 表格数据：**全部来自 PocketBase**（服务端分页 / 排序 / 筛选） ---------- */

/** 当前页的行。已是「中文 key 的视图对象」，并做过千分位格式化 */
const rows = ref<Record<string, unknown>[]>([])
/** 满足当前筛选条件的总行数（PB 返回，分页器用它） */
const totalItems = ref(0)
/** 本次读取完成的时间 */
const fetchedAt = ref('')
/** 排序：PB 的 sort 串（'qty_total' 升序 / '-qty_total' 降序） */
const sortBy = ref('')
/**
 * 筛选下拉的选项：PB 列名 → 去重后的取值数组。
 * 由服务端一条 SQL 算好（见 api.ts 的 fetchBiFacets），不在浏览器里扫全量。
 */
const facets = ref<Record<string, string[]>>({})
/** 读取 / 解析过程中的提示 */
const fetchError = ref('')

const loading = ref(false)

/* ---------- 待上传的文件：解析后先放着，**点按钮才写库** ---------- */

/**
 * 已解析、等待上传的行。
 *
 * ⚠️ 表格**不显示**它 —— 表格永远显示 PB 里的数据（上面那个 rows）。
 * 只有点了「上传到数据库」才会把它写进 PB，并按唯一键删掉库里多出来的旧行。
 * 这样「看数据」和「改数据」互不干扰：翻页 / 筛选看到的一定是库里的现状。
 */
const pendingRows = ref<Record<string, unknown>[]>([])
const uploading = ref(false)
const attachment = ref<File | null>(null)
const fileInputRef = ref<{ click: () => void } | null>(null)

/**
 * 选中 Excel → **只解析**，不写库、也不切换表格数据。
 *
 * 解析结果放进 pendingRows，由「上传到数据库」按钮决定什么时候真正写进 PB。
 * 表格始终展示库里的现状 —— 否则「选中文件」这个动作看起来像已经改了数据。
 */
async function onFileChange(value: File | File[]) {
  const file = Array.isArray(value) ? value[0] : value
  fetchError.value = ''
  pendingRows.value = []
  if (!file) return

  loading.value = true
  try {
    const res = parseExcelSheet(await file.arrayBuffer())
    pendingRows.value = res.rows
    fetchError.value = describeExcelProblems(res)
  } catch (e) {
    console.error('[setDatas] 解析 Excel 失败:', e)
    pendingRows.value = []
    fetchError.value = `解析失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    loading.value = false
  }
}

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

/** 字段清单里该列的默认显隐 */
function defaultVisible(key: string): boolean {
  return PRODUCT_FIELDS.find(f => f.key === key)?.visualable ?? true
}

/** 该列当前是否显示 */
function isVisible(key: string): boolean {
  return colVisible.value[key] ?? defaultVisible(key)
}

/** 该列当前宽度：用户调过用调过的，否则用字段清单的默认值（内容宽 + 内边距） */
function widthOf(key: string): number {
  const saved = colLayout.value.find(item => item.field === key)?.width
  return typeof saved === 'number' && saved >= MIN_COL_WIDTH ? saved : DEFAULT_WIDTHS[key]
}
/**
 * 导出：按**当前生效的筛选条件**从 PB 取全量（不是只导当前那一页）。
 * 取回来的是中文 key 的行，与上传导入用的是同一套列名，可以来回倒。
 */
async function exportToExcel() {
  loading.value = true
  try {
    const all = await fetchAllBiRows(currentQuery({ page: undefined, perPage: undefined }))
    exportExcel(all.map(formatDatas), '导出数据')
  } catch (e) {
    console.error('[setDatas] 导出失败:', e)
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
      // ⚠️ 顺序**只有真的重排过才写**：全量 65 项约 1.9KB，
      // 会把 PB 的登录 cookie 撑过 4096 字节上限而被浏览器静默丢弃（详见 stores/user.ts）。
      // 没重排就写空数组，读取侧回落字段清单的默认顺序。
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

/**
 * 拖动排序。
 * 面板列的是**全部字段**（含隐藏的），且顺序与 ensureFullOrder() 完全一致，
 * 所以这里的下标可以直接用 —— 不能拿 visibleFields 的下标去查，那会把隐藏列算错。
 */
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

// 离开页面必须还原：isEditorFullscreen 是跨组件共享的，
// 不还原的话顶栏和侧边栏会一直藏着，整个应用都回不来。
onBeforeUnmount(() => {
  isEditorFullscreen.value = false
})


onMounted(() => document.body.classList.add('data-table-page'))
onBeforeUnmount(() => document.body.classList.remove('data-table-page'))

const headers = computed(() =>
  visibleFields.value.map(({ title, key, sortable, fixed }) => {
    const w = widthOf(key)
    // 只有「用户调过宽度」的列才给 width，没调过的只给 minWidth（原因见上方注释）
    const resized = colLayout.value.some(i => i.field === key && typeof i.width === 'number')
    return {
      title,
      key,
      sortable: sortable ?? false,
      align: 'center' as const,
      fixed,
      ...(resized ? { width: w, minWidth: w } : { minWidth: w }),
    }
  }),
)

// —— 拖拽 ——

/** 正在拖的列（null = 没在拖） */
let resizing: { key: string; startX: number; startWidth: number } | null = null

function resizeTargetOf(e: { target: EventTarget | null; offsetX: number }) {
  const th = (e.target as HTMLElement | null)?.closest?.('th')
  if (!th) return null
  if (th.clientWidth - e.offsetX > RESIZE_ZONE) return null
  // th 在表头行里的序号就是 headers 的序号（这个表没有多选框列 / 展开列）
  const row = th.parentElement
  const index = row ? Array.from(row.children).indexOf(th) : -1
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

onBeforeUnmount(() => {
  endResize()
  clearTimeout(layoutSaveTimer)
})
// 排序改为**服务端**做（见 onTableOptions → sortBy → PB 的 sort 参数）：
// 分页之后客户端排序只能排当前页，那是错的。
// 也因此不再需要「收集数值列 + 自定义比较器」那套 —— PB 按真列的原生类型排，
// 比原来把千分位字符串解析回数字再比更准。

const SEARCH_FIELDS = ['SKU', 'SPU', '主MODEL', '产品名称']

/** 日期范围按哪一列过滤。BI 返回 'YYYY-MM-DD' 字符串，可直接按字典序比大小 */
const DATE_FILTER_FIELD = '最早开售日期-SKU'

type FilterKey =
  | 'type' | 'sale' | 'model' | 'manager' | 'department'
  | 'remain' | 'category1' | 'category2' | 'lamp'
  | 'group' | 'platform' | 'warehouse'


const SELECT_CONFIGS: { key: FilterKey; field: string; mode: 'eq' | 'includes' }[] = [
  { key: 'type', field: '销售状态', mode: 'includes' },
  { key: 'sale', field: '供应商', mode: 'eq' },
  // { key: 'model', field: '主MODEL', mode: 'eq' },
  { key: 'manager', field: '组长', mode: 'eq' },
  { key: 'department', field: '部门', mode: 'eq' },
  { key: 'remain', field: '是否属于呆滞库存', mode: 'eq' },
  { key: 'category1', field: '一级品类', mode: 'eq' },
  { key: 'category2', field: '二级品类', mode: 'eq' },
  // { key: 'lamp', field: '是否属于灯具', mode: 'eq' },
  { key: 'group', field: '组别', mode: 'eq' },
  { key: 'platform', field: '平台', mode: 'eq' },
  { key: 'warehouse', field: '仓位', mode: 'eq' },
]

/* ==================== 从 PocketBase 读（服务端分页 / 排序 / 筛选） ==================== */

/** 参与筛选的列在 PB 里的 ASCII 列名（去重；映射不出来的列自动跳过） */
const FACET_COLUMNS = [...new Set(
  SELECT_CONFIGS.map(c => biColumnOf(c.field)).filter((c): c is string => !!c),
)]

/**
 * 把当前**已生效**的筛选条件翻译成 PB 查询。
 * 列名必须用 ASCII 列名（见 api.ts 的 biColumnOf），否则 PB 会报「字段不存在」。
 */
function currentQuery(extra: Partial<BiRowQuery> = {}): BiRowQuery {
  const f = applied.value
  const equals: Record<string, string> = {}
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
 * 上一次查询的参数签名。
 *
 * 作用：参数没变就**不重复发请求**。必须要有，因为进页面时表自身的首次
 * `update:options` 会和 `onMounted` 撞车，日志里就是两条相隔 47ms 的相同请求。
 * 顺带也让「翻回上一页」不再重查。
 */
let lastQueryKey = ''

/** 读当前页。库里存的是数字（供排序 / 比较），千分位只在显示时加 */
async function loadPage(force = false) {
  const query = currentQuery()
  const key = JSON.stringify(query)
  if (!force && key === lastQueryKey) return
  lastQueryKey = key

  loading.value = true
  fetchError.value = ''
  try {
    const res = await fetchBiRows(query)
    rows.value = res.rows.map(formatDatas)
    totalItems.value = res.totalItems
    fetchedAt.value = new Date().toLocaleString('zh-CN')
  } catch (e) {
    console.error('[setDatas] 从 PB 读取失败:', e)
    rows.value = []
    totalItems.value = 0
    const raw = e instanceof Error ? e.message : String(e)
    // 「连接被中断」这类错误原本只显示 Failed to fetch，看不出所以然。
    // PB 的日志里对应的是 `write tcp ... wsasend: An established connection was aborted` ——
    // 即服务端还在写响应时客户端把连接关了，通常是页面刷新 / HMR 打断了请求，重试即可。
    fetchError.value = /aborted|Failed to fetch|NetworkError|network/i.test(raw)
      ? `连接被中断（${raw}）—— 多为页面刷新/热更新打断，点右上角刷新重试`
      : raw
    // 失败时清掉签名，下次（比如点刷新）能原样重试
    lastQueryKey = ''
  } finally {
    loading.value = false
  }
}

/**
 * 筛选下拉的选项是否已经取过。
 *
 * 服务端做得很快（一条 DISTINCT，几十毫秒），但仍没必要每次翻页都取：
 * 选项只在「进页面」和「上传成功后（数据变了，可能出现新取值）」时才需要刷新。
 */
let facetsLoaded = false

/** 读筛选下拉的选项（服务端一条 DISTINCT，一个请求） */
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

/**
 * 重新读一遍。
 * @param force 忽略「参数没变」的短路，强制重查（刷新按钮 / 上传成功后用）
 */
async function reload(force = false) {
  await Promise.all([loadFacets(force), loadPage(force)])
}

/**
 * 控件绑定的**草稿**值。
 * 改控件不动表格，点「确认」才生效 —— 否则每敲一个字都要重算 7900 行 × 65 列。
 * 每个 FilterKey 都要在这里有一条，漏了就会在 f[c.key] 处报索引类型错误。
 */
const draft = reactive<{ search: string; dateRange: Date[] } & Record<FilterKey, string | null>>({
  search: '',
  dateRange: [],
  type: null,
  sale: null,
  model: null,
  manager: null,
  department: null,
  remain: null,
  category1: null,
  category2: null,
  lamp: null,
  group: null,
  platform: null,
  warehouse: null,
})

/** 快照草稿。dateRange 必须复制：直接展开会与 draft 共享同一个数组引用 */
function snapshotFilters() {
  return { ...draft, dateRange: [...draft.dateRange] }
}

/** 已生效的筛选条件，点「确认」时快照 */
const applied = ref(snapshotFilters())

/** 当前生效的条件个数 */
const activeFilterCount = computed(() => {
  const f = applied.value
  let n = 0
  if (f.search.trim()) n++
  for (const c of SELECT_CONFIGS) if (f[c.key]) n++
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

// 筛选改为**服务端**做（见 currentQuery → PB 的 filter）：
// 客户端筛选只能筛当前这一页，分页之后是错的。
// matchesFilters / filteredRows 那套已删除。

/**
 * 下拉选项：直接取服务端算好的去重值（列名要从中文 key 翻译成 PB 的 ASCII 列名）。
 *
 * 选项取自**全量**（不随当前筛选收窄）—— 否则选了「亚马逊」之后其它平台就从列表里消失，
 * 用户没法改选别的。
 */
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

const OPTION_LABELS: Record<string, Record<string, string>> = {
  是否属于呆滞库存: { '0': '呆滞', '1': '未呆滞' },
}

const selectControls = computed(() =>
  SELECT_CONFIGS.map(cfg => {
    const labels = OPTION_LABELS[cfg.field]
    const values = filterOptions.value[cfg.key]
    return {
      key: cfg.key,
      label: TITLE_BY_KEY[cfg.field] ?? cfg.field,
      items: labels ? values.map(v => ({ title: labels[v] ?? v, value: v })) : values,
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
  applyFilters()
}

/**
 * v-data-table-server 的 options 变化（翻页 / 改每页条数 / 点表头排序）→ 重新查。
 *
 * 排序 key 是**列 key（中文）**，要翻译成 PB 的 ASCII 列名；
 * 翻译不出来（该列在库里没有对应列）就当没排序，避免 PB 报「字段不存在」。
 * 排序交给服务端：分页之后客户端排序只能排当前页，那是错的。
 */
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
const snackbar = ref<{ show: boolean; text: string; color: 'success' | 'error' }>({
  show: false,
  text: '',
  color: 'success',
})
function showMsg(text: string, color: 'success' | 'error' = 'success') {
  snackbar.value = { show: true, text, color }
}


/**
 * 「上传到数据库」—— **唯一会改库的入口**。
 *
 * 语义是「替换」：把这份文件写进 bi_rows，并按唯一键删掉库里多出来的旧行（传 prune）。
 * 服务端是**先写后删**而不是先删后写，所以中途失败时旧数据仍在，
 * 不会出现「删完了没写进去」的空表。
 *
 * 写完重新从 PB 读一次，表格立刻反映新数据。
 */
async function uploadDatas() {
  const pending = pendingRows.value
  if (!pending.length) {
    showMsg('没有可上传的数据，请先选择 Excel 文件', 'error')
    return
  }
  uploading.value = true
  try {
    const res = await uploadBiRows(pending, { componentId: COMPONENT_ID, prune: true })
    const parts = [`新增 ${res.created}`, `更新 ${res.updated}`, `未变 ${res.unchanged}`]
    if (res.pruned) parts.push(`删除旧数据 ${res.pruned} 行`)
    if (res.missingKey) parts.push(`跳过 ${res.missingKey} 行（无 SKU）`)
    if (res.conflictRows) parts.push(`同键冲突丢弃 ${res.conflictRows} 行`)
    const failed = res.failures.length
    showMsg(
      `已替换：${pending.length} 行 → 入库 ${res.unique} 行；${parts.join('，')}` +
        (failed ? `；${failed} 条写入失败（详见控制台）` : ''),
      failed ? 'error' : 'success',
    )
    // 明细只进控制台：冲突键 / 未入库列 / 失败原因，都是排查用的
    if (res.conflicts.length) console.warn('[setDatas] 唯一键冲突（同键不同内容）:', res.conflicts)
    if (res.unmappedColumns.length) console.warn('[setDatas] 未入库的列:', res.unmappedColumns)
    if (failed) console.warn('[setDatas] 写入失败明细:', res.failures)

    // 成功后清掉待传文件，并回到第 1 页重新读（数据变了，旧页码可能越界）
    if (!failed) {
      attachment.value = null
      pendingRows.value = []
      page.value = 1
    }
    // force：数据变了，参数签名可能没变，必须绕过短路；下拉选项也要重取（新值可能出现）
    await reload(true)
  } catch (e) {
    console.error('[setDatas] 上传失败:', e)
    showMsg(e instanceof Error ? e.message : String(e), 'error')
  } finally {
    uploading.value = false
  }
}

// 进页面就从 PB 读（数据源已经是库，不再直连 BI）。
// 表自身的首次 update:options 也会触发一次 loadPage，靠 lastQueryKey 短路掉重复。
onMounted(() => reload())
</script>
<style scoped lang="scss">
.filter-input,
.filter-select {
  flex: 0 0 auto;
}

.filter-input {
  width: 160px;
}

.filter-select {
  width: 120px;
}

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

.col-item__switch {
  flex: 0 0 auto;

  /* v-switch 默认上下留白很大，65 行会很拖沓，压扁一点 */
  :deep(.v-switch__track) {
    height: 14px;
    min-width: 28px;
  }
}

/*
 * 全屏：让「筛选 + 表格」这一块铺满视口。
 *
 * 为什么不能只靠 App.vue 的 isEditorFullscreen 隐藏侧边栏：
 * 侧边栏是 v-show 隐藏的，v-main 的 padding-left（--v-layout-left）不一定跟着收回，
 * 那 240px 未必真能拿到；fixed 铺满则与布局实现无关。
 *
 * z-index 取 1000：高于普通内容；而 v-navigation-drawer(1004)、v-menu 的浮层(2400+)
 * 都在它之上 —— 所以侧边栏必须靠 isEditorFullscreen 隐藏，
 * 同时筛选下拉的菜单反而能正常浮在它上面，不会被压住。
 *
 * position: fixed 相对视口定位、绕开 v-main 的 padding，
 * 所以顶部系统栏那 36px 也就真正省了出来（脚本里表格高度相应改成 calc(100vh - 162px)）。
 */
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

.filter-input {
  :deep(.v-field) {
    --v-field-padding-top: 2px;
    --v-field-padding-bottom: 1px;
    --v-input-control-height: 25px;
    font-size: 12px;
  }

  :deep(.v-field__input) {
    min-height: 30px;
    padding-top: 1px;
    padding-bottom: 1px;
  }

  :deep(.v-label) {
    font-size: 13px;
  }

  :deep(.v-field__append-inner) {
    align-self: center;
    padding-top: 0;
  }

  :deep(.v-field__prepend-inner) {
    margin-top: 0;
    padding-top: 1px;

    .v-icon {
      font-size: 14px;
    }
  }

  :deep(.v-input__details) {
    padding-top: 0;
    min-height: 0;
  }
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
  font-size: 12px;
}

:deep(.v-data-table-footer__items-per-page > .v-select .v-field__input) {
  min-height: 26px;
  padding-top: 0;
  padding-bottom: 0;
  font-size: 12px;
}

:deep(.v-data-table-footer__items-per-page > .v-select .v-field__append-inner) {
  align-self: center;
  padding-top: 0;
}
</style>

<template>
  <v-sheet class="mt-3 mb-8">
    <div class="d-flex justify-space-between mb-2">
      <div />
      <v-icon-btn color="info" icon="mdi-cog-outline" size="small" title="字段设置" variant="text"
        @click="settingsOpen = true" />
    </div>
    <div v-if="fields.length === 0" class="text-[13px] text-medium-emphasis">{{ emptyText }}</div>
    <v-table v-else class="goods-table" density="compact">
      <thead>
        <tr>
          <th v-for="item in fields" :key="item.key" class="text-left" :class="{ 'goods-col--hl': item.highlight }">{{
            item.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td v-for="item in fields" :key="item.key" :class="{ 'goods-col--hl': item.highlight }">
            <v-img v-if="item.key === IMAGE_KEY" cover height="48" :src="String(item.value)" width="48" @click="showImg(String(item.value))" 
              class="cursor-pointer" />
            <div v-else class="goods-cell" :title="textOf(item)">{{ textOf(item) }}</div>
          </td>
        </tr>
      </tbody>
    </v-table>

    <v-dialog v-model="settingsOpen" max-width="520" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center ga-3 text-[14px]">
          <span class="font-bold">字段设置</span>
          <v-chip color="success" label size="x-small" variant="tonal">
            当前显示 {{ fields.length }} 列
          </v-chip>
          <v-spacer />
          <v-btn size="small" variant="text" @click="resetColumnSettings">恢复默认</v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text class="pa-2">
          <div class="col-head text-medium-emphasis">
            <span />
            <span class="col-head__name">字段</span>
            <span>显示</span>
            <span>高亮</span>
          </div>

          <!-- 拖动排序用原生 HTML5 拖拽（与「数据」页的列设置同一套做法，项目没装 sortablejs，不引新依赖） -->
          <div v-for="(item, index) in orderedFields" :key="item.key" class="col-item"
            :class="{ 'col-item--drag': dragIndex === index, 'col-item--over': overIndex === index }" draggable="true"
            @dragend="onDragEnd" @dragover.prevent="onDragOver(index)" @dragstart="onDragStart(index)"
            @drop.prevent="onDrop(index)">
            <v-icon class="col-item__handle" icon="mdi-drag-vertical" size="16" />
            <span class="col-item__title" :title="item.title">
              <span class="col-item__name">{{ item.title }}</span>
              <span v-if="isVisible(item.key) && !hasValueOf(item.key)"
                class="col-item__note text-medium-emphasis text-[11px]">本产品无值</span>
            </span>
            <v-switch class="col-item__switch" color="primary" density="compact" false-icon="mdi-close" hide-details
              :model-value="isVisible(item.key)" true-icon="mdi-check" @update:model-value="toggleVisible(item.key)" />
            <v-switch class="col-item__switch" color="#FF9800" hide-details :model-value="isHighlighted(item.key)"
              @update:model-value="toggleHighlight(item.key)" />
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4">
          <span
            class="text-caption text-medium-emphasis text-[13px]">拖动左侧手柄调整顺序；关闭的字段在其它产品的详情里也不再显示；高亮只让这一列更醒目。改动自动保存</span>
          <v-spacer />
          <v-btn color="#0052D9" size="small" variant="flat" @click="settingsOpen = false">完成</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-overlay v-model="imgShow" @click="imgShow = false">
      <div class="d-flex align-center justify-center" style="width: 100vw; height: 100vh">
        <v-img contain max-height="70vh" :src="String(imgSrc)" :style="{ maxWidth: '70vw' }" width="400" rounded="xl"/>
      </div>
    </v-overlay>
  </v-sheet>
</template>
<script lang="ts" setup>
import { useUserStore } from '@/stores/user'
import { toProductView } from '@/utils/biRowFields'
import { formatNumber } from '@/utils/number'
import { PRODUCT_FIELDS, type ProductField } from '@/utils/productFields'

/** 图片列在字段清单里的 key（表格里用的是同一列，见 workStream.vue 的 item.图片链接 插槽） */
const IMAGE_KEY = '图片链接'
const imgShow=ref(false)
const imgSrc=ref('')
const props = withDefaults(
  defineProps<{
    /** 产品数据：BI 直连行（中文 key）、PB 的 bi_rows 记录（含 data 快照）都能直接传 */
    product?: Record<string, unknown> | null
    /** 没数据时的提示文案 */
    emptyText?: string
  }>(),
  { product: null, emptyText: '没有关联到产品数据' },
)

/** key → 标题：取自字段清单，不另抄一份（与表格、ProductInfoCard 用的是同一份定义） */
const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(PRODUCT_FIELDS.map(f => [f.key, f.title]))

/* ==================== 字段设置（显隐 / 高亮） ==================== */

const userStore = useUserStore()
const settingsOpen = ref(false)

const colVisible = ref<Record<string, boolean>>({})
const colHighlight = ref<Record<string, boolean>>({})
/** 面板拖出来的顺序（字段 key 数组）。空数组 = 没重排过，走字段清单的默认顺序 */
const colOrder = ref<string[]>([])

/** 字段清单的默认顺序：判定「有没有被重排过」，也是没存过顺序时的兜底 */
const DEFAULT_ORDER = PRODUCT_FIELDS.map(f => f.key)

/**
 * 面板列出的**全部字段**（含被关掉的），顺序即下方表格的列顺序。
 * 三件事：按偏好排序、丢掉字段清单里已不存在的键（BI 删了字段）、
 * 把偏好里还没登记的（BI 新增）追加到末尾，保证老用户看得到新字段。
 */
const orderedFields = computed(() => {
  const byKey = new Map(PRODUCT_FIELDS.map(f => [f.key, f]))
  const out: ProductField[] = []
  for (const key of colOrder.value) {
    const f = byKey.get(key)
    if (f) {
      out.push(f)
      byKey.delete(key)
    }
  }
  out.push(...byKey.values())
  return out
})

/** 默认显示；偏好里只存被**关掉**的（见 persistPreferences） */
function isVisible(key: string): boolean {
  return colVisible.value[key] ?? true
}

function showImg(imgUrl:string){
  imgShow.value=true
  imgSrc.value=imgUrl
}
/** 默认不高亮；偏好里只存被**勾上**的 —— 与显隐相反，因为默认值本身就是 false */
function isHighlighted(key: string): boolean {
  return colHighlight.value[key] === true
}

/** 只收布尔值：偏好来自服务端，可能被手改成别的类型 */
function booleanMapOf(saved: unknown): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  if (!saved || typeof saved !== 'object') return next
  for (const [key, value] of Object.entries(saved)) {
    if (typeof value === 'boolean') next[key] = value
  }
  return next
}

/** 只收字符串数组：偏好来自服务端，可能被手改成别的类型 */
function stringListOf(saved: unknown): string[] {
  return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : []
}

/** 用服务端偏好覆盖默认值；数据异常（非对象 / 非布尔 / 非字符串数组）时忽略 */
function applyPreferences() {
  colVisible.value = booleanMapOf(userStore.preferences.goodsFieldVisibility)
  colHighlight.value = booleanMapOf(userStore.preferences.goodsFieldHighlight)
  colOrder.value = stringListOf(userStore.preferences.goodsFieldOrder)
}
// 偏好是异步读回来的（loadPreferences），到位后再覆盖一次；immediate 兼顾首帧
watch(
  () => [
    userStore.preferences.goodsFieldVisibility,
    userStore.preferences.goodsFieldHighlight,
    userStore.preferences.goodsFieldOrder,
  ],
  applyPreferences,
  { deep: true, immediate: true },
)

function persistPreferences() {
  // 两边都只存**与默认值不同**的项（显隐存"关掉的"、高亮存"勾上的"）：
  // BI 增删字段后，没存过的字段自然回落默认，老用户不会被旧快照锁死
  const visibleDiff: Record<string, boolean> = {}
  const highlightDiff: Record<string, boolean> = {}
  for (const f of PRODUCT_FIELDS) {
    const v = colVisible.value[f.key]
    if (typeof v === 'boolean' && v !== true) visibleDiff[f.key] = v
    if (isHighlighted(f.key)) highlightDiff[f.key] = true
  }
  // 顺序：**只有真的重排过才写**。全量字段名进 cookie 是白占体积（PB 登录 cookie
  // 有 4096 字节上限，见 stores/user.ts），没重排就写空数组、读取侧回落默认顺序。
  const order = orderedFields.value.map(f => f.key)
  const reordered
    = order.length !== DEFAULT_ORDER.length || order.some((key, i) => key !== DEFAULT_ORDER[i])

  userStore.savePreferences({
    goodsFieldVisibility: visibleDiff,
    goodsFieldHighlight: highlightDiff,
    goodsFieldOrder: reordered ? order : [],
  }).catch(error => {
    console.error('[GoodsInfo] 保存字段设置失败:', error)
  })
}

/** 连点开关会高频触发，防抖后落库一次 */
let saveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    persistPreferences()
  }, 400)
}
onBeforeUnmount(() => {
  /*
   * ⚠️ 还在防抖窗口里就卸载（改完字段设置立刻关掉审批抽屉）时**必须立刻落库**：
   * 只 clearTimeout 等于把这次改动直接丢掉，而用户以为"改完就存上了"。
   */
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer)
    saveTimer = undefined
    persistPreferences()
  }
})

function toggleVisible(key: string) {
  colVisible.value = { ...colVisible.value, [key]: !isVisible(key) }
  scheduleSave()
}

/** 高亮 = 这一列在下面的表格里加粗强调（只影响观感，不影响取值） */
function toggleHighlight(key: string) {
  colHighlight.value = { ...colHighlight.value, [key]: !isHighlighted(key) }
  scheduleSave()
}

/** 恢复默认 = 全部显示、全部不高亮、顺序回字段清单（清空偏好） */
function resetColumnSettings() {
  colVisible.value = {}
  colHighlight.value = {}
  colOrder.value = []
  scheduleSave()
}

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
 * 面板列的是**全部字段**（含被关掉的），下标与 orderedFields 一一对应，
 * 所以能直接挪 —— 不能拿上面表格实际渲染的列下标来算，那会把关掉的字段漏掉、插错位置。
 */
function onDrop(index: number) {
  const from = dragIndex.value
  onDragEnd()
  if (from < 0 || from === index) return
  const next = orderedFields.value.map(f => f.key)
  const [moved] = next.splice(from, 1)
  next.splice(index, 0, moved)
  colOrder.value = next
  scheduleSave()
}

/** 规范化后的产品对象：fields 与面板的「有没有值」共用，只算一次 */
const view = computed(() => toProductView(props.product))

/** 该字段在本产品里有没有值（面板用来标注「本产品无值」） */
function hasValueOf(key: string): boolean {
  const v = view.value[key]
  return !(v === undefined || v === null || String(v).trim() === '')
}

function textOf(item: { value: string | number }) {
  return typeof item.value === 'number' ? formatNumber(item.value) : String(item.value)
}

const fields = computed(() => {
  const v = view.value
  const out: { key: string, label: string, value: string | number, highlight: boolean }[] = []
  const listed = new Set<string>()
  const push = (key: string, label: string) => {
    const val = v[key]
    if (val === undefined || val === null || String(val).trim() === '') return
    out.push({ key, label, value: typeof val === 'number' ? val : String(val), highlight: isHighlighted(key) })
  }
  // 遍历顺序即列顺序：用 orderedFields（面板排过序的全部字段），不做排序就在这里改口径
  for (const f of orderedFields.value) {
    // ⚠️ 先登记、再看显隐：被关掉的字段也必须登记，
    //    否则下面「清单之外的键」会把它们当成 BI 新增列**再加一遍**，于是怎么关都关不掉
    listed.add(f.key)
    if (isVisible(f.key)) push(f.key, f.title)
  }
  // 字段清单之外的键（BI 新增列还没登记）也带上，避免静默丢数据
  for (const key of Object.keys(v)) {
    if (!listed.has(key) && isVisible(key)) push(key, LABEL_BY_KEY[key] ?? key)
  }
  return out
})
</script>
<style lang="scss" scoped>
.goods-table {
  /* 单元格文本的宽度上限：调大调小只改这一个数（原来想用 max-w-20 = 80px，对中文偏窄） */
  --goods-cell-max: 120px;

  :deep(table) {
    width: max-content;
    min-width: 100%;
  }

  .goods-cell {
    /* 带 fallback：变量没定义时 var() 会退化成 unset（= 不设上限）→ 省略号整个失效，
           所以这里显式给个兜底值，改 --goods-cell-max 仍优先 */
    max-width: var(--goods-cell-max, 150px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :deep(th),
  :deep(td) {
    padding: 4px 8px;
    font-size: 12px;
    /* 不换行：换行后行高参差，横向扫读也失去意义 */
    white-space: nowrap;
    vertical-align: middle;
  }

  :deep(th) {
    font-weight: 500;
    background-color: rgb(var(--v-theme-surface-light));
  }

  /* 高亮列：整列加粗 + 主色，横向扫读时一眼抓住（只改观感，不影响取值） */
  :deep(.goods-col--hl) {
    font-weight: 700;
    color: rgb(var(--v-theme-primary));
  }
}

/* —— 字段设置面板 —— */
/*
 * 表头（.col-head）与每一行（.col-item）共用同一套网格：三列「字段 / 显示 / 高亮」上下对齐。
 * 后两列定宽（开关就那么宽），第一列吃掉剩下的空间并允许省略号。
 */
$col-handle-width: 16px;
$col-opt-width: 56px;

.col-head,
.col-item {
  display: grid;
  /* 手柄 / 字段 / 显示 / 高亮：字段列吃掉剩余空间 */
  grid-template-columns: $col-handle-width minmax(0, 1fr) $col-opt-width $col-opt-width;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  /* 后两列的开关居中：grid 项一旦居中就按内容宽度算，v-input 上的 flex 属性在这里不起作用 */
  justify-items: center;
}

.col-head {
  height: 28px;
  font-size: 12px;
  font-weight: 600;
}

/* 字段列占满整格、左对齐，否则标题会被一起"居中"成歪的 */
.col-head__name,
.col-item__title {
  justify-self: stretch;
  text-align: left;
}

.col-item {
  height: 35px;
  border-radius: 6px;
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

/* 手柄只是示意「这一行可以拖」，真正的拖拽目标是整行（draggable 在 .col-item 上） */
.col-item__handle {
  justify-self: center;
  color: rgba(var(--v-theme-on-surface), 0.35);
}

.col-item__title {
  display: flex;
  align-items: center;
  gap: 6px;
  /* min-width: 0 必须有：grid 子项默认 min-width:auto，长标题会把右边的开关挤出容器 */
  min-width: 0;
  font-size: 13px;
}

.col-item__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 「本产品无值」贴着字段名：不压扁、不换行，宽度不够时让字段名去省略 */
.col-item__note {
  flex: 0 0 auto;
  white-space: nowrap;
}

.col-item__switch {
  justify-self: center;
}
</style>

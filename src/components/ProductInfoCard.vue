<template>
  <v-card min-height="50vh" border variant="flat">
    <!-- 产品概览：图片 / 名称 / 关键标签 -->
    <div class="d-flex align-center ga-4 pa-4">
      <v-img v-if="view['图片链接']" class="mx-auto cursor-pointer" height="70" rounded="10" :src="String(view['图片链接'])"
        width="fit-content" @click="showImg" />

      <v-avatar v-else color="primary-lighten-4" rounded="lg" size="64">
        <v-icon color="primary" size="32">mdi-package-variant-closed</v-icon>
      </v-avatar>

      <div class="flex-grow-1 min-w-0">
        <div class="text-h6 font-weight-bold">
          <span class="line-clamp-2">{{ view['产品名称'] || '未命名产品' }}</span>
          <span class="text-grey-darken-1 text-[12px] ml-2">[{{ view['是否属于灯具'] == '是' ? '灯具' : '非灯具' }}]</span>
        </div>

        <div class="d-flex flex-wrap ga-2 mt-1">
          <v-chip color="primary" size="x-small" variant="flat">{{ view['SKU'] || '—' }}</v-chip>
          <v-chip color="secondary" size="x-small" variant="tonal">{{ view['SPU'] || '—' }}</v-chip>

          <v-chip :color="statusColor(view['销售状态'])" size="x-small" variant="tonal">
            {{ view['销售状态'] || '—' }}
          </v-chip>
          <!-- 与 BI 真实取值对齐：待评估 / 无需评估（详见 mockProduct.ts 同名字段注释） -->
          <v-chip v-if="view['是否属于待评估库存'] === '待评估'" color="warning" size="x-small" variant="flat">
            待评估
          </v-chip>
        </div>
      </div>

      <!-- 字段设置入口。放概览行最右侧：这一行本来就有高度，不额外占位置（样式同 GoodsInfo） -->
      <v-icon-btn class="align-self-start flex-shrink-0" color="info" icon="mdi-cog-outline" size="small" title="字段设置"
        variant="text" @click="settingsOpen = true" />
    </div>

    <v-divider />

    <v-card-text class="py-4">
      <!-- 字段全被关掉时给一句话：否则卡片是一片空白，看着像加载失败 -->
      <div v-if="visibleGroups.length === 0" class="text-[13px] text-medium-emphasis">
        字段都被关掉了：点右上角齿轮可以重新打开
      </div>

      <div v-for="group in visibleGroups" :key="group.label" class="mb-2 rounded-[10px] px-4 py-2"
        :style="{ 'background-color': isDark ? '#121212' : '#F6F6F6' }">
        <div class="d-flex align-center ga-2 mb-2 group-title" draggable="true"
          @dragstart="onGroupDragStart($event, group)">
          <v-icon color="primary" size="15">{{ group.icon }}</v-icon>
          <span class="text-[13px]  text-primary ">{{ group.label }}</span>
          <!-- <v-divider></v-divider> -->
        </div>

        <div class="d-flex flex-wrap ga-2">
          <div v-for="key in group.keys" :key="key" class="px-1 rounded draggable-field" draggable="true">
            <div class="text-[12px] text-grey-darken-1">{{ labelOf(key) }}</div>

            <div class="text-[13px] font-weight-medium text-truncate" :title="valueOf(key)">
              {{ valueOf(key) }}
            </div>
          </div>
        </div>
      </div>
    </v-card-text>

    <!--
      字段设置。按**卡片上的分组**列，而不是像 GoodsInfo 那样一路平铺：
      这里的分组就是卡片上的分区，按它们列才能跟卡片对上号；
      表头与每行共用同一套网格（.set-item），开关才会上下对齐（同 GoodsInfo 的做法）。
    -->
    <v-dialog v-model="settingsOpen" max-width="520" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center ga-3 text-[14px]">
          <span class="font-bold">字段设置</span>

          <v-chip color="success" label size="x-small" variant="tonal">
            当前显示 {{ visibleFieldCount }} 个字段
          </v-chip>

          <v-spacer />
          <v-btn size="small" variant="text" @click="resetVisibleSettings">恢复默认</v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text class="pa-2">
          <div v-for="group in PRODUCT_GROUPS" :key="group.label" class="set-group">
            <div class="set-group__head">
              <v-icon color="primary" size="14">{{ group.icon }}</v-icon>
              <span class="text-[13px] text-primary">{{ group.label }}</span>
            </div>

            <div v-for="key in group.keys" :key="key" class="set-item">
              <!-- 「本产品无值」是这条数据的说明，跟着**字段名**走；塞进开关那一列会被当成开关状态 -->
              <span class="set-item__title" :title="labelOf(key)">
                <span class="set-item__name">{{ labelOf(key) }}</span>
                <span v-if="isVisible(key) && !hasValueOf(key)"
                  class="set-item__note text-medium-emphasis text-[11px]">本产品无值</span>
              </span>

              <v-switch class="set-item__switch" color="primary" density="compact" false-icon="mdi-close" hide-details
                :model-value="isVisible(key)" true-icon="mdi-check" @update:model-value="toggleVisible(key)" />
            </div>
          </div>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-4">
          <span class="text-caption text-medium-emphasis text-[13px]">
            与「产品详情」里的字段设置是同一份（关掉一处，两处都不显示）；图片 / 名称 / 销售状态那排标签是卡片的标识，不在这里管。改动自动保存
          </span>
          <v-spacer />
          <v-btn color="#0052D9" size="small" variant="flat" @click="settingsOpen = false">完成</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import type { DroppedItem } from '@/types/drop'
import { useTheme } from 'vuetify'
import { useUserStore } from '@/stores/user'
import { toProductView } from '@/utils/biRowFields'
import { PRODUCT_GROUPS, PRODUCT_HEADERS, type ProductHeader } from '@/utils/mockProduct'
import { PRODUCT_FIELDS } from '@/utils/productFields'
const theme = useTheme()
const isDark = computed(() => theme.global.name.value === 'dark')
const emits = defineEmits(['sendImg'])
const props = withDefaults(
  defineProps<{
    /** 产品行。可以是 BI 直连的行（中文 key）、PB 的 bi_rows 记录（snake_case 列），或带 data 快照的记录 */
    product: Record<string, unknown>
    // 字段定义（用于字段显示标签），默认使用共享的产品字段
    headers?: ProductHeader[]
  }>(),
  { headers: () => PRODUCT_HEADERS },
)

const view = computed(() => toProductView(props.product))

/* ==================== 字段显示设置（可选显示哪些字段） ==================== */

/**
 * 字段显隐是**用户级偏好**，与「产品详情」（GoodsInfo.vue）**共用同一份**
 * （stores/user 的 goodsFieldVisibility）。
 *
 * 为什么共用而不是另开一个键：两处展示的是同一条产品的同一批字段，默认口径也一致
 * （都默认全显示，SKU 这类关键字段不会莫名其妙消失）；各存一份的话，
 * "在详情里关掉的字段，卡片里还显示着"——用户只会当成 bug。
 * 存量字段的存法照搬那边：**只存与默认值（显示）不同的项**，内容就是 `{ 字段: false }`。
 */
const userStore = useUserStore()
const settingsOpen = ref(false)
const colVisible = ref<Record<string, boolean>>({})

/** 默认显示；偏好里只存**被关掉**的 */
function isVisible(key: string): boolean {
  return colVisible.value[key] ?? true
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

/** 用服务端偏好覆盖默认值；数据异常（非对象 / 非布尔）时忽略 */
function applyPreferences() {
  colVisible.value = booleanMapOf(userStore.preferences.goodsFieldVisibility)
}
// 偏好是异步读回来的（loadPreferences），到位后再覆盖一次；immediate 兼顾首帧
watch(() => userStore.preferences.goodsFieldVisibility, applyPreferences, { deep: true, immediate: true })

/**
 * 落库：**遍历完整字段清单**（PRODUCT_FIELDS）算 diff —— 与 GoodsInfo 的写法逐字一致。
 *
 * 两边写的是**同一个键的整个对象**（savePreferences 只做浅合并），清单不一致的话，
 * 这边保存会把那边关掉的字段又抹回来（"设置存了又自己变回去"）。
 */
function persistPreferences() {
  const diff: Record<string, boolean> = {}
  for (const f of PRODUCT_FIELDS) {
    const v = colVisible.value[f.key]
    if (typeof v === 'boolean' && v !== true) diff[f.key] = v
  }
  userStore.savePreferences({ goodsFieldVisibility: diff }).catch(error => {
    console.error('[ProductInfoCard] 保存字段显示设置失败:', error)
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
   * ⚠️ 还在防抖窗口里就卸载（改完设置立刻切走 / 关掉抽屉）时必须立刻落库：
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

/** 恢复默认 = 清空"被关掉的"记录（读取侧落到「全部显示」） */
function resetVisibleSettings() {
  colVisible.value = {}
  scheduleSave()
}

/** 当前展示的字段数（设置面板上的计数，只算分组里的字段） */
const visibleFieldCount = computed(() =>
  PRODUCT_GROUPS.reduce((n, g) => n + g.keys.filter(isVisible).length, 0))

/**
 * 实际渲染的分组：组内字段先按显隐过滤，**整组字段都被关掉时这一组连标题一起收掉** ——
 * 否则卡片上会留下一串空分组，看着像加载失败。
 */
const visibleGroups = computed(() => PRODUCT_GROUPS
  .map(g => ({ ...g, keys: g.keys.filter(isVisible) }))
  .filter(g => g.keys.length > 0))

/** 该字段在本产品上有没有值（设置面板里标出来：开着但没值，不是设置没生效） */
function hasValueOf(key: string): boolean {
  const v = view.value[key]
  return v != null && v !== ''
}

function showImg() {
  emits('sendImg', String(view.value['图片链接']))
}
// 拖拽整个分组：打包该组所有字段
function onGroupDragStart(
  e: DragEvent,
  group: { label: string, icon: string, keys: string[] },
) {
  const dt = e.dataTransfer
  if (!dt) return
  const item: DroppedItem = {
    type: 'group',
    group: {
      label: group.label,
      icon: group.icon,
      fields: group.keys.map(key => ({
        key,
        title: labelOf(key),
        value: valueOf(key),
      })),
    },
  }
  dt.setData('application/json', JSON.stringify(item))
  dt.effectAllowed = 'copy'
}

// 字段显示标签：优先使用字段定义里的 title
function labelOf(key: string): string {
  return props.headers.find(h => h.key === key)?.title ?? key
}

// 字段显示值：空值显示 —，数字加千分位
function valueOf(key: string): string {
  const v = view.value[key]
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('zh-CN')
  return String(v)
}

// 销售状态对应的 chip 颜色
function statusColor(s: unknown): string {
  switch (s) {
    case '在售': {
      return 'success'
    }
    case '停售': {
      return 'grey'
    }
    case '清仓': {
      return 'warning'
    }
    case '新品': {
      return 'info'
    }
    default: {
      return 'primary'
    }
  }
}
</script>

<style scoped lang="scss">
// 字段条目：浅色底 + 悬浮反馈
.info-item {
  background: rgba(var(--v-theme-surface-variant), 0.12);
  transition: background 0.2s;
}

.info-item:hover {
  background: rgba(var(--v-theme-surface-variant), 0.25);
}

// 可拖拽字段：光标 + 悬浮提示
.draggable-field {
  cursor: grab;
  border: 1px solid transparent;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.draggable-field:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.15);
}

.draggable-field:active {
  cursor: grabbing;
}

// 分组标题：可拖拽整组
.group-title {
  cursor: grab;
  border-radius: 6px;
  transition: background 0.2s;
}

.group-title:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}

.group-title:active {
  cursor: grabbing;
}

/* —— 字段设置面板 —— */
/*
 * 分组标题 + 组内的字段行。字段行两列「字段 / 显示」共用同一套网格才会上下对齐
 * （同 GoodsInfo 的 .col-head / .col-item）：用 flex + gap 的话每行宽度不一，
 * 开关会左右飘、跟上一行对不上号。后一列定宽（开关就那么宽），前一列吃掉剩余空间并允许省略号。
 */
$set-opt-width: 56px;

.set-group {
  padding: 4px 4px 8px;
}

.set-group__head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
}

.set-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) $set-opt-width;
  align-items: center;
  gap: 8px;
  height: 35px;
  padding: 0 8px;
  border-radius: 6px;
  /* 开关居中：grid 项一旦居中就按内容宽度算，v-input 上的 flex 属性在这里不起作用 */
  justify-items: center;
}

.set-item:hover {
  background: rgba(var(--v-border-color), calc(var(--v-hover-opacity) * 0.5));
}

/* 字段列占满整格、左对齐，否则标题会被一起"居中"成歪的 */
.set-item__title {
  justify-self: stretch;
  display: flex;
  align-items: center;
  gap: 6px;
  /* min-width: 0 必须有：grid 子项默认 min-width:auto，长标题会把右边的开关挤出容器 */
  min-width: 0;
  font-size: 13px;
  text-align: left;
}

.set-item__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 「本产品无值」贴着字段名：不压扁、不换行，宽度不够时让字段名去省略 */
.set-item__note {
  flex: 0 0 auto;
  white-space: nowrap;
}

.set-item__switch {
  justify-self: center;
}
</style>

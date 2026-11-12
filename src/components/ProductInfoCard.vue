<template>
  <v-card  class="product-card" variant="flat">
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

    <!-- 唯一可滚动的区域：卡片有多高，这里就有多高，多出来的部分在这里滚 -->
    <v-card-text class="py-4 product-scroll">
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

        <div class="group-body" :class="{ 'group-body--split': asideOf(group).length > 0 }">
          <div class="group-main d-flex flex-column ga-2">
            <div v-for="row in rowsOf(group)" :key="row.label" class="group-row"
              :class="{ 'group-row--plain': !row.label }">
              <span v-if="row.label" class="group-row__label">{{ row.label }}</span>

              <div class="d-flex flex-wrap ga-2">
                <!-- 高亮的字段整块套淡黄玻璃（padding 3px / radius 4px 常态就有，切换时不跳动） -->
                <div v-for="key in row.keys" :key="key" class="field-cell draggable-field"
                  :class="{ 'field-cell--hl': isHighlighted(key) }" draggable="true">
                  <div class="text-[12px] text-grey-darken-1">{{ row.label ? cellLabelOf(key) : labelOf(key) }}</div>

                  <div class="text-[13px] font-weight-medium text-truncate" :title="valueOf(key)">
                    {{ valueOf(key) }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 右份：不加底色，border-left 当分割线（颜色按主题绑），与左份只靠这条线分开 -->
          <div v-if="asideOf(group).length > 0" class="group-aside"
            :style="{ 'border-color': isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)' }">
            <div v-for="key in asideOf(group)" :key="key" class="field-cell draggable-field"
              :class="{ 'field-cell--hl': isHighlighted(key) }" draggable="true">
              <div class="text-[12px] text-grey-darken-1">{{ labelOf(key) }}</div>

              <div class="text-[13px] font-weight-medium text-truncate" :title="valueOf(key)">
                {{ valueOf(key) }}
              </div>
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
          <!-- 表头：字段 / 显示 / 高亮。与下面 .set-item 共用同一套网格，开关列才对得上 -->
          <div class="set-head text-medium-emphasis">
            <span>字段</span>
            <span>显示</span>
            <span>高亮</span>
          </div>

          <div v-for="group in PRODUCT_GROUPS" :key="group.label" class="set-group">
            <div class="set-group__head">
              <v-icon color="primary" size="14">{{ group.icon }}</v-icon>
              <span class="text-[13px] text-primary">{{ group.label }}</span>
            </div>

            <div v-for="key in panelKeysOf(group)" :key="key" class="set-item">
              <!-- 「本产品无值」是这条数据的说明，跟着**字段名**走；塞进开关那一列会被当成开关状态 -->
              <span class="set-item__title" :title="labelOf(key)">
                <span class="set-item__name">{{ labelOf(key) }}</span>
                <span v-if="isVisible(key) && !hasValueOf(key)"
                  class="set-item__note text-medium-emphasis text-[11px]">本产品无值</span>
              </span>

              <v-switch class="set-item__switch" color="primary" density="compact" false-icon="mdi-close" hide-details
                :model-value="isVisible(key)" true-icon="mdi-check" @update:model-value="toggleVisible(key)" />

              <!-- 高亮：与「显示」同一份面板、同一个字段清单，橙色区分（同 GoodsInfo 的口径） -->
              <v-switch class="set-item__switch" color="#FF9800" density="compact" hide-details
                :model-value="isHighlighted(key)" @update:model-value="toggleHighlight(key)" />
            </div>
          </div>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-4">
          <span class="text-caption text-medium-emphasis text-[13px]">
            与「产品详情」里的字段设置是同一份（关掉一处，两处都不显示；高亮那边是加粗列、这边是橙黄底）；
            图片 / 名称 / 销售状态那排标签是卡片的标识，不在这里管。改动自动保存
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
import { PRODUCT_GROUPS, PRODUCT_HEADERS, type ProductGroupSection, type ProductHeader } from '@/utils/mockProduct'
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

/**
 * 高亮开关。与显隐同住一个偏好对象、但存法**相反**：
 * 显隐默认是"显示"（只存关掉的），高亮默认是"不高亮"（只存勾上的）。
 * 与「产品详情」（GoodsInfo.vue）共用同一份 goodsFieldHighlight —— 那边是给表格列加粗，
 * 这边是给卡片上的字段套一片橙黄底，勾一处两处都生效。
 */
const colHighlight = ref<Record<string, boolean>>({})

/** 默认显示；偏好里只存**被关掉**的 */
function isVisible(key: string): boolean {
  return colVisible.value[key] ?? true
}

/** 默认不高亮；偏好里只存**被勾上**的 */
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

/** 用服务端偏好覆盖默认值；数据异常（非对象 / 非布尔）时忽略 */
function applyPreferences() {
  colVisible.value = booleanMapOf(userStore.preferences.goodsFieldVisibility)
  colHighlight.value = booleanMapOf(userStore.preferences.goodsFieldHighlight)
}
// 偏好是异步读回来的（loadPreferences），到位后再覆盖一次；immediate 兼顾首帧
watch(
  () => [userStore.preferences.goodsFieldVisibility, userStore.preferences.goodsFieldHighlight],
  applyPreferences,
  { deep: true, immediate: true },
)

/**
 * 落库：**遍历完整字段清单**（PRODUCT_FIELDS）算 diff —— 与 GoodsInfo 的写法逐字一致。
 *
 * 两边写的是**同一个键的整个对象**（savePreferences 只做浅合并），清单不一致的话，
 * 这边保存会把那边关掉的字段又抹回来（"设置存了又自己变回去"）。
 */
function persistPreferences() {
  const visibleDiff: Record<string, boolean> = {}
  // 高亮同样**遍历完整清单**再写整个对象：只写自己勾的那些，会把 GoodsInfo 里勾的抹掉
  const highlightDiff: Record<string, boolean> = {}
  for (const f of PRODUCT_FIELDS) {
    const v = colVisible.value[f.key]
    if (typeof v === 'boolean' && v !== true) visibleDiff[f.key] = v
    if (isHighlighted(f.key)) highlightDiff[f.key] = true
  }
  userStore.savePreferences({
    goodsFieldVisibility: visibleDiff,
    goodsFieldHighlight: highlightDiff,
  }).catch(error => {
    console.error('[ProductInfoCard] 保存字段设置失败:', error)
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

/** 高亮 = 卡片上这个字段套一片橙黄底（只影响观感，不影响取值） */
function toggleHighlight(key: string) {
  colHighlight.value = { ...colHighlight.value, [key]: !isHighlighted(key) }
  scheduleSave()
}

/** 恢复默认 = 清空"被关掉的"与"被勾上的"记录（读取侧落到「全部显示、全部不高亮」） */
function resetVisibleSettings() {
  colVisible.value = {}
  colHighlight.value = {}
  scheduleSave()
}

/** 当前展示的字段数（设置面板上的计数，只算分组里的字段） */
const visibleFieldCount = computed(() =>
  PRODUCT_GROUPS.reduce((n, g) => n + panelKeysOf(g).filter(isVisible).length, 0))

/**
 * 实际渲染的分组：组内字段先按显隐过滤，**整组字段都被关掉时这一组连标题一起收掉** ——
 * 否则卡片上会留下一串空分组，看着像加载失败。
 * 右侧独立块（asideKeys）也按显隐过滤：主体全关但汇总指标还开着时，组要保留。
 */
const visibleGroups = computed(() => PRODUCT_GROUPS
  .map(g => ({ ...g, keys: g.keys.filter(isVisible), asideKeys: (g.asideKeys ?? []).filter(isVisible) }))
  .filter(g => g.keys.length > 0 || g.asideKeys.length > 0))

/**
 * 右侧独立块的字段（visibleGroups 里已按显隐过滤）：没配置或全被关掉时组内不切左右，
 * 布局回落成一整列 —— 模板靠 `asideOf(group).length` 决定是否套 --split。
 */
function asideOf(group: { asideKeys?: string[] }): string[] {
  return group.asideKeys ?? []
}

/**
 * 设置面板（与整组拖拽）平铺一组的字段清单：主体在前、右侧独立块殿后。
 * 面板不区分左右块 —— 显隐 / 高亮是按字段的，与它在卡片上的哪一块无关。
 */
function panelKeysOf(group: { keys: string[], asideKeys?: string[] }): string[] {
  return [...group.keys, ...(group.asideKeys ?? [])]
}

/**
 * 卡片上按行渲染：分组可以再分小节（账龄分布的「数量 / 金额」），没有小节的组就是一整行。
 * 模板因此只写一套字段块，分行规则全在这里。
 *
 * 小节里的字段必须再按**过滤后的** group.keys 过一遍：被用户关掉的字段不能借小节漏回来。
 */
function rowsOf(group: { keys: string[], sections?: ProductGroupSection[] }): { label: string, keys: string[] }[] {
  if (!group.sections?.length) return [{ label: '', keys: group.keys }]
  return group.sections
    .map(s => ({ label: s.label, keys: s.keys.filter(k => group.keys.includes(k)) }))
    .filter(r => r.keys.length > 0)
}

/**
 * 小节内字段名：去掉「[数量]」「（金额）」这类单位后缀。
 *
 * 行标题已经写明是数量还是金额，每格再带一遍只会把标签撑长、逼着换行；
 * 设置面板仍用带后缀的原名（那边是平铺的，没有行标题可依）。
 */
function cellLabelOf(key: string): string {
  const title = labelOf(key).replace(/[[（(](?:数量|金额)[\]）)]/g, '').trim()
  /*
   * 同一个库龄区间在 BI 里两种写法：数量那列写「1年以上」、金额那列写「一年以上」。
   * 两行并排放在同一张卡上，差一个字读者会以为是两个区间 —— 卡片上统一成「1年以上」；
   * 字段 key、设置面板、导出仍是原写法。
   */
  const normalized = title.replace(/^一年以上/, '1年以上')
  return normalized || labelOf(key)
}

/** 该字段在本产品上有没有值（设置面板里标出来：开着但没值，不是设置没生效） */
function hasValueOf(key: string): boolean {
  const v = view.value[key]
  return v != null && v !== ''
}

function showImg() {
  emits('sendImg', String(view.value['图片链接']))
}
// 拖拽整个分组：打包该组所有字段（右侧独立块的也一起带走，见 panelKeysOf）
function onGroupDragStart(
  e: DragEvent,
  group: { label: string, icon: string, keys: string[], asideKeys?: string[] },
) {
  const dt = e.dataTransfer
  if (!dt) return
  const item: DroppedItem = {
    type: 'group',
    group: {
      label: group.label,
      icon: group.icon,
      fields: panelKeysOf(group).map(key => ({
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

// 字段显示值：空值显示 —，数字加千分位；小数最多留两位（8.333 → 8.33，整数不补零）
function valueOf(key: string): string {
  const v = view.value[key]
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
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
/* ==================== 卡片自身滚动（滚动条在左侧） ==================== */

/*
 * 卡片高度 = 视口高度 − 上下留白，**固定写在卡片自己身上**：
 * 卡片自己滚，只要它高度确定，字段区就能内部滚动；外层只管把它 sticky 到同一位置，
 * 不用再测页头高度再传下来（以前那套一旦量晚了会先铺满整屏再跳一下）。
 *
 * 数值口径（与 approvalPage 里 .product-pane 的 sticky top 一致，否则会压住页头）：
 *   顶部 96px = 页头 sticky top 32 + 页头高 56 + 与卡片之间的 8px 间隙
 *   底部 16px = 与视口底边的视觉间隙
 * 页头变高（窄屏换行、催办按钮变大）时改这两个值，卡片高度与停靠位置一起跟着走。
 */
$product-card-top: 96px;
$product-card-bottom: 16px;

/*
 * 卡片 = 定高的 flex 列：概览行 + 分隔线固定，字段区吃掉剩下的高度并滚动。
 * `overflow: hidden` 不能省：否则字段区再高也会把卡片自己撑开（父容器限高也不管用），
 * 内部滚动就变成了"卡片被裁掉"。
 */
.product-card {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 70px);
  min-height: 0;
  overflow: hidden;
}

/*
 * 字段区：**滚动条放左边**。
 *
 * 垂直滚动条贴哪一边由 inline 方向决定 —— 容器 `direction: rtl` 就会画到左侧；
 * 所以容器 rtl、里面的内容再逐个 `ltr` 还原，否则文字、缩略图、换行方向全会跟着右对齐。
 * 这是唯一不改 DOM 结构的做法（`overflow` / `scrollbar-gutter` 都挪不了滚动条）。
 */
.product-scroll {
  flex: 1 1 auto;
  /* flex 子项的 min-height 默认是 auto：不显式归零，内容再高也不会滚，只会把卡片撑破 */
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  direction: rtl;
}

.product-scroll > * {
  direction: ltr;
}

/* 细滚动条（同 OrgTree 的 .org-scroll 口径），跟着主题走 */
.product-scroll::-webkit-scrollbar {
  width: 6px;
}

.product-scroll::-webkit-scrollbar-thumb {
  background: rgb(var(--v-theme-on-surface) / 30%);
  border-radius: 3px;
}

.product-scroll::-webkit-scrollbar-thumb:hover {
  background: rgb(var(--v-theme-on-surface) / 45%);
}

.product-scroll::-webkit-scrollbar-track {
  background: transparent;
}

// 字段条目：浅色底 + 悬浮反馈
.info-item {
  background: rgba(var(--v-theme-surface-variant), 0.12);
  transition: background 0.2s;
}

.info-item:hover {
  background: rgba(var(--v-theme-surface-variant), 0.25);
}

/*
 * 字段块：padding 3px / radius 4px 是**常态**就写死的（不是高亮时才加），
 * 否则勾选高亮的瞬间整块会变高、把后面字段挤动一下，切换观感很跳。
 */
.field-cell {
  padding: 3px;
  border-radius: 4px;
}

/*
 * 高亮 = 给这一格套一块「淡黄玻璃」：
 * 底色是**半透明**淡黄（实色橙黄改成玻璃的三层叠加 —— 磨砂 blur + 淡黄描边 + 内侧白高光），
 * 卡片底是纯白平面，玻璃感主要靠半透明色与描边高光衬出来。
 * 描边/阴影用 .field-cell.field-cell--hl（双类权重）：.draggable-field 的透明 border
 * 定义在本块之后、同权重会被它盖掉；hover 反馈（.draggable-field:hover）权重相同又更靠后，
 * 悬停时依然正常显边。深色主题保持半透明实底 —— 磨砂亮黄在深底上发灰，浅字也压不住。
 */
.field-cell--hl {
  background-color: rgba(255, 224, 130, 0.38);
  backdrop-filter: blur(6px) saturate(1.4);
  -webkit-backdrop-filter: blur(6px) saturate(1.4);
}

.field-cell.field-cell--hl {
  border-color: rgba(255, 193, 7, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.65),
    0 1px 3px rgba(184, 134, 11, 0.14);
}

.v-theme--dark .field-cell--hl {
  background-color: rgba(255, 193, 7, 0.22);
}

/* 深色下白高光与亮描边太扎眼：描边压暗、投影高光都收掉 */
.v-theme--dark .field-cell.field-cell--hl {
  border-color: rgba(255, 193, 7, 0.28);
  box-shadow: none;
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

/*
 * 组内分行：左侧一列固定的行标题（数量 / 金额），右侧字段自动换行。
 * 用 grid 而不是把标题塞进 flex-wrap：那样第二行字段会顶到标题下面，
 * 数量和金额的行一眼就看不出边界（正是这次要解决的问题）。
 */
.group-row {
  display: grid;
  grid-template-columns: 2.2em minmax(0, 1fr);
  gap: 6px;
  align-items: start;
}

/* 没有小节的组（其余分组）：不留空的标题列 */
.group-row--plain {
  grid-template-columns: minmax(0, 1fr);
}

/*
 * 组内容容器：默认纵向排（与原来 ga-2 的 flex column 等价）；
 * 配了 asideKeys 的组切横向 —— 逐月明细在左（group-main 弹性吃掉剩余宽度），
 * 汇总指标独立在右（group-aside 按内容自适应宽）。
 */
.group-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-body--split {
  flex-direction: row;
  align-items: stretch;
  gap: 12px;
}

/*
 * 一行分成两份：左份（group-main）吃掉右份以外的全部宽度，
 * 右份（group-aside）**按内容自适应宽**（flex: 0 0 auto）—— 右边只有两个汇总指标，
 * 占一半宽会空出一大截；收窄后把空间还给左侧的逐月明细（正好排成两行）。
 * 两份都**不加底色、不加包裹** —— 分隔只靠 aside 的 border-left 一条竖向分割线
 * （颜色模板上按主题绑），线两侧各留 12px 的呼吸空间。
 */
.group-body--split > .group-main {
  flex: 1 1 auto;
  min-width: 0;
}

/* 右份：纵向排字段（column + stretch 两格等宽对齐），padding-left 让内容离分割线留出距离 */
.group-aside {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 auto;
  padding-left: 12px;
  border-left: 1px solid;
}

/* 与字段名那行（12px）对齐，标题才不会浮在上下两块中间 */
.group-row__label {
  font-size: 12px;
  line-height: 18px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding-top: 1px;
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
$set-opt-width: 50px;

/* 表头「字段 / 显示 / 高亮」：与 .set-item 同一套网格，开关列才对得上；左内边距 = set-group 的 4 + set-item 的 8 */
.set-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) $set-opt-width $set-opt-width;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0 12px;
  font-size: 11px;
  justify-items: center;
}

/* 第一列是字段名，左对齐（与下面每行的标题同一条边） */
.set-head > span:first-child {
  justify-self: stretch;
  text-align: left;
}

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
  grid-template-columns: minmax(0, 1fr) $set-opt-width $set-opt-width;
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

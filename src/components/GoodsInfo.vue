<template>
    <v-sheet class="mt-3 mb-8">
        <div class="d-flex justify-space-between mb-2">
            <div></div>
            <v-icon-btn icon="mdi-cog-outline" size="small" color="info" variant="text" title="字段设置"
                @click="settingsOpen = true"></v-icon-btn>
        </div>
        <div v-if="!fields.length" class="text-[13px] text-medium-emphasis">{{ emptyText }}</div>
        <v-table v-else density="compact" class="goods-table">
            <thead>
                <tr>
                    <th v-for="item in fields" :key="item.key" class="text-left">{{ item.label }}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td v-for="item in fields" :key="item.key">
                        <v-img v-if="item.key === IMAGE_KEY" :src="String(item.value)" width="48" height="48"
                            cover />
                        <div v-else class="goods-cell" :title="textOf(item)">{{ textOf(item) }}</div>
                    </td>
                </tr>
            </tbody>
        </v-table>
        <v-dialog v-model="settingsOpen" max-width="520" scrollable>
            <v-card>
                <v-card-title class="d-flex align-center ga-3 text-[14px]">
                    <span class="font-bold">字段设置</span>
                    <v-chip size="x-small" variant="tonal" color="success" label>
                        当前显示 {{ fields.length }} 列
                    </v-chip>
                    <v-spacer />
                    <v-btn variant="text" size="small" @click="resetColumnSettings">恢复默认</v-btn>
                </v-card-title>
                <v-divider />
                <v-card-text class="pa-2">
                    <div v-for="item in PRODUCT_FIELDS" :key="item.key" class="col-item">
                        <span class="col-item__title" :title="item.title">{{ item.title }}</span>
                        <span v-if="isVisible(item.key) && !hasValueOf(item.key)"
                            class="col-item__note text-medium-emphasis text-[11px]">本产品无值</span>
                        <v-switch :model-value="isVisible(item.key)" color="primary" density="compact" hide-details
                            class="col-item__switch" @update:model-value="toggleVisible(item.key)" true-icon="mdi-check"
                            false-icon="mdi-close"></v-switch>
                    </div>
                </v-card-text>
                <v-divider />
                <v-card-actions class="px-4">
                    <span class="text-caption text-medium-emphasis text-[13px]">关闭的字段在其它产品的详情里也不再显示，改动自动保存</span>
                    <v-spacer />
                    <v-btn color="#0052D9" variant="flat" size="small" @click="settingsOpen = false">完成</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-sheet>
</template>
<script lang="ts" setup>
import { PRODUCT_FIELDS } from '@/utils/productFields'
import { formatNumber } from '@/utils/number'
import { toProductView } from '@/utils/biRowFields'
import { useUserStore } from '@/stores/user'

/** 图片列在字段清单里的 key（表格里用的是同一列，见 workStream.vue 的 item.图片链接 插槽） */
const IMAGE_KEY = '图片链接'

const props = withDefaults(
    defineProps<{
        /** 产品数据：BI 直连行（中文 key）、PB 的 bi_rows 记录（含 data 快照）都能直接传 */
        product?: Record<string, unknown> | null
        /** 没数据时的提示文案 */
        emptyText?: string
    }>(),
    { product: null, emptyText: '没有关联到产品数据' }
)

/** key → 标题：取自字段清单，不另抄一份（与表格、ProductInfoCard 用的是同一份定义） */
const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(PRODUCT_FIELDS.map(f => [f.key, f.title]))

/* ==================== 字段设置（显隐） ==================== */

const userStore = useUserStore()
const settingsOpen = ref(false)

const colVisible = ref<Record<string, boolean>>({})

/** 默认显示；偏好里只存被**关掉**的（见 persistPreferences） */
function isVisible(key: string): boolean {
    return colVisible.value[key] ?? true
}

/** 用服务端偏好覆盖默认值；数据异常（非布尔）时忽略 */
function applyPreferences() {
    const saved = userStore.preferences.goodsFieldVisibility
    if (!saved || typeof saved !== 'object') return
    const next: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(saved)) {
        if (typeof value === 'boolean') next[key] = value
    }
    colVisible.value = next
}
// 偏好是异步读回来的（loadPreferences），到位后再覆盖一次；immediate 兼顾首帧
watch(() => userStore.preferences.goodsFieldVisibility, applyPreferences, { deep: true, immediate: true })

function persistPreferences() {
    const diff: Record<string, boolean> = {}
    for (const f of PRODUCT_FIELDS) {
        const v = colVisible.value[f.key]
        if (typeof v === 'boolean' && v !== true) diff[f.key] = v
    }
    userStore.savePreferences({ goodsFieldVisibility: diff }).catch((err) => {
        console.error('[GoodsInfo] 保存字段显隐失败:', err)
    })
}

/** 连点开关会高频触发，防抖后落库一次 */
let saveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(persistPreferences, 400)
}
onBeforeUnmount(() => clearTimeout(saveTimer))

function toggleVisible(key: string) {
    colVisible.value = { ...colVisible.value, [key]: !isVisible(key) }
    scheduleSave()
}

/** 恢复默认 = 全部显示（清空偏好） */
function resetColumnSettings() {
    colVisible.value = {}
    scheduleSave()
}

/** 规范化后的产品对象：fields 与面板的「有没有值」共用，只算一次 */
const view = computed(() => toProductView(props.product))

/** 该字段在本产品里有没有值（面板用来标注「本产品无值」） */
function hasValueOf(key: string): boolean {
    const v = view.value[key]
    return !(v === undefined || v === null || String(v).trim() === '')
}

const textOf = (item: { value: string | number }) =>
    typeof item.value === 'number' ? formatNumber(item.value) : String(item.value)

const fields = computed(() => {
    const v = view.value
    const out: { key: string; label: string; value: string | number }[] = []
    const listed = new Set<string>()
    const push = (key: string, label: string) => {
        const val = v[key]
        if (val === undefined || val === null || String(val).trim() === '') return
        out.push({ key, label, value: typeof val === 'number' ? val : String(val) })
    }
    for (const f of PRODUCT_FIELDS) {
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
}

/* —— 字段设置面板 —— */
.col-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    height: 35px;
    border-radius: 6px;
}

.col-item__title {
    flex: 1 1 auto;
    /* min-width: 0 必须有：flex 子项默认 min-width:auto，长标题会把右边的开关挤出容器 */
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
}

.col-item__switch {
    flex: 0 0 auto;
}
</style>

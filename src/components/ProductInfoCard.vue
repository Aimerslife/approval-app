<template>
  <v-card min-height="50vh">
    <!-- 产品概览：图片 / 名称 / 关键标签 -->
    <div class="d-flex align-center ga-4 pa-4">
      <v-img
        v-if="view['图片链接']"
        class="mx-auto cursor-pointer"
        height="70"
        rounded="10"
        :src="String(view['图片链接'])"
        width="fit-content"
        @click="showImg"
      />

      <v-avatar v-else color="primary-lighten-4" rounded="lg" size="64">
        <v-icon color="primary" size="32">mdi-package-variant-closed</v-icon>
      </v-avatar>

      <div class="flex-grow-1 min-w-0">
        <div class="text-h6 font-weight-bold">
          <span class="line-clamp-2">{{ view['产品名称'] || '未命名产品' }}</span>
          <span class="text-grey-darken-1 text-[12px] ml-2">[{{ view['是否属于灯具']=='是'?'灯具':'非灯具' }}]</span>
        </div>

        <div class="d-flex flex-wrap ga-2 mt-1">
          <v-chip color="primary" size="x-small" variant="flat">{{ view['SKU'] || '—' }}</v-chip>
          <v-chip color="secondary" size="x-small" variant="tonal">{{ view['SPU'] || '—' }}</v-chip>

          <v-chip :color="statusColor(view['销售状态'])" size="x-small" variant="tonal">
            {{ view['销售状态'] || '—' }}
          </v-chip>
          <!-- 与 BI 真实取值对齐：呆滞 / 空（详见 mockProduct.ts 同名字段注释） -->
          <v-chip v-if="view['是否属于呆滞库存'] === '呆滞'" color="warning" size="x-small" variant="flat">
            呆滞库存
          </v-chip>
        </div>
      </div>
    </div>

    <v-divider />

    <v-card-text class="py-4">
      <div
        v-for="group in PRODUCT_GROUPS"
        :key="group.label"
        class="mb-2 rounded-[10px] px-4 py-2"
        :style="{ 'background-color': isDark ? '#121212' : '#F6F6F6' }"
      >
        <div
          class="d-flex align-center ga-2 mb-2 group-title"
          draggable="true"
          @dragstart="onGroupDragStart($event, group)"
        >
          <v-icon color="primary" size="15">{{ group.icon }}</v-icon>
          <span class="text-[13px]  text-primary ">{{ group.label }}</span>
          <!-- <v-divider></v-divider> -->
        </div>

        <div class="d-flex flex-wrap ga-2">
          <div
            v-for="key in group.keys"
            :key="key"
            class="px-1 rounded draggable-field"
            draggable="true"
          >
            <div class="text-[12px] text-grey-darken-1">{{ labelOf(key) }}</div>

            <div class="text-[13px] font-weight-medium text-truncate" :title="valueOf(key)">
              {{ valueOf(key) }}
            </div>
          </div>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
  import type { DroppedItem } from '@/types/drop'
  import { useTheme } from 'vuetify'
  import { toProductView } from '@/utils/biRowFields'
  import { PRODUCT_GROUPS, PRODUCT_HEADERS, type ProductHeader } from '@/utils/mockProduct'
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

  // 拖拽单个字段：把 字段名(key) + 标签(title) + 值(value) 放入 dataTransfer
  function onFieldDragStart (e: DragEvent, key: string) {
    const dt = e.dataTransfer
    if (!dt) return
    const item: DroppedItem = {
      type: 'field',
      field: { key, title: labelOf(key), value: valueOf(key) },
    }
    dt.setData('application/json', JSON.stringify(item))
    dt.effectAllowed = 'copy'
  }
  function showImg () {
    emits('sendImg', String(view.value['图片链接']))
  }
  // 拖拽整个分组：打包该组所有字段
  function onGroupDragStart (
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
  function labelOf (key: string): string {
    return props.headers.find(h => h.key === key)?.title ?? key
  }

  // 字段显示值：空值显示 —，数字加千分位
  function valueOf (key: string): string {
    const v = view.value[key]
    if (v == null || v === '') return '—'
    if (typeof v === 'number') return v.toLocaleString('zh-CN')
    return String(v)
  }

  // 销售状态对应的 chip 颜色
  function statusColor (s: unknown): string {
    switch (s) {
      case '在售': { return 'success'
      }
      case '停售': { return 'grey'
      }
      case '清仓': { return 'warning'
      }
      case '新品': { return 'info'
      }
      default: { return 'primary'
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
</style>

<template>
  <div class="p-2 d-flex flex-wrap items-center gap-3">
    <v-text-field
      class="filter-input w-[220px]"
      density="compact"
      flat
      hide-details
      label="搜索"
      :model-value="filters.search"
      prepend-inner-icon="mdi-magnify"
      single-line
      variant="solo-filled"
      @update:model-value="emit('patch', { search: String($event ?? '') })"
    />

    <v-select
      v-for="ctl in SELECT_FILTERS"
      :key="ctl.key"
      class="filter-select w-[150px]"
      clearable
      flat
      hide-details
      :items="options[ctl.key]"
      :label="ctl.label"
      :menu-props="{ contentClass: 'filter-menu' }"
      :model-value="filters.selects[ctl.key]"
      single-line
      variant="outlined"
      @update:model-value="emit('patch', { selects: { [ctl.key]: $event } })"
    />

    <v-date-input
      class="filter-select"
      density="compact"
      hide-details
      label="建单日期"
      max-width="300"
      :model-value="filters.dateRange"
      multiple="range"
      prepend-icon=""
      prepend-inner-icon="$calendar"
      single-line
      variant="outlined"
      @update:model-value="emit('patch', { dateRange: $event })"
    />

    <!--
      确认：把草稿里的搜索词提交给表格。
      颜色用 #0052D9 —— 与「数据」「任务」页那个「确认」是同一个蓝，别处认得出它是"提交条件"。
      未提交的提示放在 title 里（按钮本身按需求保持常蓝，不改色）。
    -->
    <v-btn
      color="#0052D9"
      size="small"
      :title="dirty ? '搜索词有改动，点这里生效' : '按当前条件筛选'"
      variant="flat"
      @click="emit('apply')"
    >
      <span>确认</span>
    </v-btn>

    <v-btn color="surface-variant" size="small" variant="flat" @click="emit('reset')">
      <span>重置</span>
    </v-btn>
  </div>
</template>

<script lang="ts" setup>
  import type { ApprovalFilters, FilterPatch, SelectFilterKey } from '@/utils/approvalFilters'
  import { SELECT_FILTERS } from '@/utils/approvalFilters'

  defineProps<{
    /**
     * 当前条件 —— **只读**。
     * 控件改动一律 emit patch 交回父组件（见 useApprovalTable.patchFilters）：
     * 直接改 props 会被 eslint 的 vue/no-mutating-props 拦，也让"谁在改条件"难追。
     */
    filters: ApprovalFilters
    /** 各下拉的选项（父组件用**全部**行推导，见 useApprovalTable.filterOptionsMap） */
    options: Record<SelectFilterKey, string[]>
    /** 搜索框里有内容还没提交（父组件的 filtersDirty）—— 用来把「搜索」按钮点成主色 */
    dirty?: boolean
  }>()

  const emit = defineEmits<{
    patch: [patch: FilterPatch]
    /** 点「搜索」：把草稿提交为生效条件 */
    apply: []
    reset: []
  }>()
</script>

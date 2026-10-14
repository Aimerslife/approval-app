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
      v-for="ctl in shownFilters"
      :key="ctl.key"
      class="filter-select w-[150px]"
      clearable
      flat
      hide-details
      :items="options[ctl.key]"
      :label="selectLabels[ctl.key] ?? ctl.label"
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

  const props = withDefaults(defineProps<{
    filters: ApprovalFilters
    /** 各下拉的选项（父组件用**全部**行推导，见 useApprovalTable.filterOptionsMap） */
    options: Record<SelectFilterKey, string[]>
    selectKeys?: SelectFilterKey[]
    selectLabels?: Partial<Record<SelectFilterKey, string>>
    /** 条件有改动还没提交（父组件的 filtersDirty）—— 用来提示「确认」按钮"点了才生效" */
    dirty?: boolean
  }>(), {
    selectKeys: () => [],
    selectLabels: () => ({}),
  })

  /** 实际渲染的下拉：限定了就只渲染那几个，没限定就是全套 */
  const shownFilters = computed(() =>
    props.selectKeys.length > 0
      ? SELECT_FILTERS.filter(def => props.selectKeys.includes(def.key))
      : SELECT_FILTERS,
  )

  const emit = defineEmits<{
    patch: [patch: FilterPatch]
    /** 点「搜索」：把草稿提交为生效条件 */
    apply: []
    reset: []
  }>()
</script>

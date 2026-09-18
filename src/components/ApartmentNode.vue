<template>
  <v-sheet class="pa-2 rounded" color="grey-lighten-4" style="max-height: 320px; overflow-y: auto;">
    <v-skeleton-loader v-if="treeLoading" type="list-item-two-line@4" />

    <v-alert v-else-if="treeError" class="ma-2" density="compact" type="error">
      {{ treeError }}
    </v-alert>
    <!-- 不设 open-all：树默认收起，点击部门再展开，减少 DOM 数量 -->
    <v-treeview
      v-else-if="treeItems.length > 0"
      density="compact"
      :hide-actions="true"
      indent-lines
      item-value="id"
      activatable
      :items="treeItems"
      color="#E8F0FE"
      active-class="tree-active-item"
      v-model:activated="activated"
      open-on-click
      @update:activated="onActivated"
    >
      <template #title="{ item }">
        <template v-if="itemOf(item).type === 'dept'">
          <span class="text-[13px] font-weight-medium">{{ itemOf(item).title }}</span>
          <span class="text-[12px] text-grey ml-1">({{ itemOf(item).member_count }}人)</span>
        </template>

        <template v-else>
          <span class="text-[13px]">{{ itemOf(item).title }}</span>

          <v-chip
            v-if="itemOf(item).is_tenant_manager"
            class="ml-1"
            color="error"
            size="x-small"
            variant="tonal"
          >管理员</v-chip>

          <v-chip
            v-if="itemOf(item).is_leader"
            class="ml-1"
            color="warning"
            size="x-small"
            variant="tonal"
          >负责人</v-chip>
        </template>
      </template>

      <template #prepend="{ item, isOpen }">
        <v-icon v-if="itemOf(item).type === 'dept'" color="#1055C9" size="20">
          {{ itemOf(item).has_child ? (isOpen ? 'mdi-layers-outline' : 'mdi-layers') :
            'mdi-account-group' }}
        </v-icon>

        <v-avatar v-else size="24">
          <v-img v-if="itemOf(item).avatar" cover :src="itemOf(item).avatar" />
          <v-icon v-else size="12">mdi-account</v-icon>
        </v-avatar>
      </template>
    </v-treeview>

    <v-alert v-else class="ma-2" type="info" variant="tonal">暂无组织架构数据</v-alert>
  </v-sheet>
</template>
<script setup lang="ts">
  interface TreeItem {
    id: string
    type: 'dept' | 'user'
    title: string
    subtitle?: string
    avatar?: string
    member_count?: number
    has_child?: boolean
    is_tenant_manager?: boolean
    is_leader?: boolean
    children?: TreeItem[]
  }
  const props = defineProps({
    treeItems: {
      type: Array,
      default: () => [],
    },
    treeLoading: {
      type: Boolean,
      default: false,
    },
    treeError: {
      type: String,
      default: '',
    },
    activated: {
      type: Array,
      default: () => [],
    },
  })

  /**
   * Vuetify 的 treeview 插槽把 `item` 推成 `unknown` —— 因为 `treeItems` 这个 prop 是用
   * 运行时声明（`type: Array`）定义的，元素类型传不下去，模板里直接取 item.xxx 会报 TS18046。
   * 这里收窄一次，模板统一写成 itemOf(item).xxx，比在每个字段上各转一次清楚。
   */
  function itemOf (raw: unknown): TreeItem {
    return raw as TreeItem
  }

  const emit = defineEmits(['update:activated'])

  function onActivated (activated: any[]) {
    emit('update:activated', activated)
  }
</script>

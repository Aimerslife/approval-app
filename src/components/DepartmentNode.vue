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
      activatable
      indent-lines
      color="#E8F0FE"
      item-value="id"
      active-class="tree-active-item"
      :items="treeItems"
      v-model:activated="activated"
      open-on-click
      @update:activated="onActivated"
    >
      <template #title="{ item }">
        <template v-if="item.type === 'dept'">
          <span class="text-[13px] font-weight-medium">{{ item.title }}</span>
          <span class="text-[12px] text-grey ml-1">({{ item.member_count }}人)</span>
        </template>

        <template v-else>
          <span class="text-[13px]">{{ item.title }}</span>

          <v-chip
            v-if="item.is_tenant_manager"
            class="ml-1"
            color="error"
            size="x-small"
            variant="tonal"
          >管理员</v-chip>

          <v-chip
            v-if="item.is_leader"
            class="ml-1"
            color="warning"
            size="x-small"
            variant="tonal"
          >负责人</v-chip>
        </template>
      </template>

      <template #prepend="{ item, isOpen }">
        <v-icon v-if="item.type === 'dept'" color="primary" size="20">
          {{ item.has_child ? (isOpen ? 'mdi-layers-outline' : 'mdi-layers') : 'mdi-account-group' }}
        </v-icon>

        <v-avatar v-else size="24">
          <v-img v-if="item.avatar" cover :src="item.avatar" />
          <v-icon v-else size="12">mdi-account</v-icon>
        </v-avatar>
      </template>
    </v-treeview>

    <v-alert v-else class="ma-2" type="info" variant="tonal">暂无组织架构数据</v-alert>
  </v-sheet>
</template>

<script setup lang="ts">
  import { onMounted, ref } from 'vue'
  import { fetchOrgTreeCache, type OrgTreeNode, type UserBrief } from '@/api/api'

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

  const emit = defineEmits<{ select: [user: UserBrief] }>()

  const treeItems = ref<TreeItem[]>([])
  const treeLoading = ref(false)
  const treeError = ref('')
  const activated = ref<string[]>([])

  function toTreeItems (nodes: OrgTreeNode[]): TreeItem[] {
    return nodes.map(node => {
      const deptChildren: TreeItem[] = node.children.length > 0 ? toTreeItems(node.children) : []
      const userChildren: TreeItem[] = (node.users || []).map(u => ({
        id: u.open_id,
        type: 'user' as const,
        title: u.name,
        subtitle: u.email || u.mobile || '',
        avatar: u.avatar,
        is_tenant_manager: u.is_tenant_manager,
        is_leader: u.is_leader,
      }))
      const allChildren = [...userChildren, ...deptChildren]
      return {
        id: node.id,
        type: 'dept' as const,
        title: node.name,
        member_count: node.member_count,
        has_child: allChildren.length > 0,
        children: allChildren,
      }
    })
  }

  function findNode (nodes: TreeItem[], id: string): TreeItem | null {
    for (const n of nodes) {
      if (n.id === id) return n
      if (n.children) {
        const found = findNode(n.children, id)
        if (found) return found
      }
    }
    return null
  }

  async function loadTree () {
    if (treeItems.value.length > 0) return
    treeLoading.value = true
    treeError.value = ''
    try {
      const res = await fetchOrgTreeCache()
      treeItems.value = toTreeItems(res.data.tree)
    } catch (error: any) {
      treeError.value = error?.message || '加载组织架构失败'
    } finally {
      treeLoading.value = false
    }
  }

  function onActivated (ids: string[]) {
    if (ids.length === 0) return
    // 注意：.at(-1) 的返回类型是 string | undefined（eslint 的 prefer-at 自动改的，
    // 运行时与 ids[ids.length - 1] 等价），这里显式收窄一次
    const lastId = ids.at(-1)
    if (!lastId) return
    const node = findNode(treeItems.value, lastId)
    if (node && node.type === 'user') {
      emit('select', {
        open_id: node.id,
        name: node.title,
        email: node.subtitle,
        avatar: node.avatar,
        is_tenant_manager: !!node.is_tenant_manager,
        is_leader: !!node.is_leader,
      })
    }
  }

  onMounted(loadTree)

  // 父组件每次打开弹窗时调用，清空选中高亮
  function reset () {
    activated.value = []
  }

  defineExpose({ reset })
</script>

<style scoped lang="scss">
::deep(.tree-active-item) {
    background-color: rgb(var(--v-theme-primary-lighten-5)) !important;
}
</style>

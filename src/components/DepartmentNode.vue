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
      indent-lines-opacity="0.2"
      color="#E8F0FE"
      item-value="id"
      active-class="tree-active-item"
      :items="treeItems"
      v-model:activated="activated"
      open-on-click
      :search="keyword"
      :open-all="searching"
      :filter-keys="['title', 'subtitle']"
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
        <v-icon v-if="item.type === 'dept'" color="#1055C9" size="20">
          {{ item.has_child ? (isOpen ? 'mdi-layers-outline' : 'mdi-layers') : 'mdi-account-group' }}
        </v-icon>

        <v-avatar v-else size="24">
          <v-img v-if="item.avatar" cover :src="item.avatar" />
          <v-icon v-else size="12">mdi-account</v-icon>
        </v-avatar>
      </template>

      <!-- 搜索无命中时给一句明确反馈：默认的 "No data available" 会让人以为树没加载出来 -->
      <template #no-data>
        <div class="text-[12px] text-grey pa-4 text-center">
          {{ searching ? `没有匹配「${keyword.trim()}」的成员` : '暂无组织架构数据' }}
        </div>
      </template>
    </v-treeview>

    <v-alert v-else class="ma-2" type="info" variant="tonal">暂无组织架构数据</v-alert>
  </v-sheet>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { type OrgTreeNode, type UserBrief } from '@/api/api'
  // 组织树的会话级缓存与请求去重（选人弹窗预热也走它），不再直接调 api
  import { fetchOrgTreeOnce, orgTreeCache } from '@/utils/orgPickerCache'

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

  const props = withDefaults(defineProps<{
    /**
     * 搜索关键字（由选人弹窗的搜索框传入）。
     * 树内部用 v-treeview 自带的 `search` 过滤：命中项的祖先会自动保留，
     * 同时 `open-all` 把剩下的部门全部展开 —— 否则结果都藏在收起的部门里，看起来像"搜不到"。
     */
    keyword?: string
  }>(), { keyword: '' })

  const searching = computed(() => props.keyword.trim() !== '')

  const emit = defineEmits<{ select: [user: UserBrief] }>()

  const treeItems = ref<TreeItem[]>([])
  /**
   * 初始就是 loading：首帧直接是骨架屏。
   * 以前初始 false —— 组件一挂载会先闪一下「暂无组织架构数据」再转骨架
   * （onMounted 里才把 loading 置 true，中间那一帧已经画出去了）。
   */
  const treeLoading = ref(true)
  const treeError = ref('')
  const activated = ref<string[]>([])

  /**
   * 渲染树缓存（模块级）：会话内**第二次**打开弹窗 / 切回「全部部门」直接复用，
   * 不再重复跑一遍 toTreeItems（几千个节点的同步递归，一次 ~1s）。
   * 原始数据由 utils/orgPickerCache 兜住；这里缓存的是转换结果。
   */
  let builtTreeMemo: TreeItem[] | null = null

  /**
   * 让出一帧：**先把界面画出来（切到「全部部门」+ 骨架屏），再做同步重活**。
   *
   * 为什么必须让：`toTreeItems` 是全量同步递归，整棵组织树转换会占住主线程 ~1s ——
   * 和"切 tab / 弹窗打开"放在同一个 tick 里，首帧就出不来，用户看到的是
   * "点了没反应，等一会儿直接整棵树出现"（反馈：先加载再跳转）。
   * rAF 等下一次绘制、setTimeout 把重活挪出该帧，两条都要：只 rAF 仍可能在同一帧内跑完。
   */
  function nextPaint (): Promise<void> {
    return new Promise<void>(resolve => {
      requestAnimationFrame(() => setTimeout(resolve, 0))
    })
  }

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
    // 先让骨架屏绘制出来，再开始加载 / 转换（见 nextPaint 的说明）
    await nextPaint()
    try {
      // 渲染树已建过：直接复用（切 tab / 重开弹窗都是瞬时）
      if (builtTreeMemo) {
        treeItems.value = builtTreeMemo
        return
      }
      // 会话级缓存优先：选人弹窗预热过 / 上次打开拉过的话，这里直接重建树，不再发请求
      // （缓存与去重在 utils/orgPickerCache —— 弹窗每次关闭会卸载本组件，靠它保住数据）
      const cached = orgTreeCache()
      const tree = cached ?? await fetchOrgTreeOnce()
      builtTreeMemo = toTreeItems(tree)
      treeItems.value = builtTreeMemo
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

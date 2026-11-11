<template>
  <v-sheet class="p-4 border border-dashed border-accent d-flex flex-column org-sheet" rounded>
    <!-- 头部：固定区域，不随树滚动 -->
    <div class="shrink-0">
      <div class="d-flex align-center flex-wrap mb-2">
        <span class="text-[14px] font-weight-bold">组织架构</span>

        <v-tooltip location="right" text="刷新组织架构">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              class="ml-2"
              :loading="loading"
              size="20"
              variant="flat"
              @click="refreshTreeFromServer"
            >
              <v-icon color="primary" size="20">mdi-refresh</v-icon>
            </v-btn>
          </template>

          <span class="text-[12px]">刷新组织架构</span>
        </v-tooltip>

        <v-chip
          v-if="orgData"
          class="ml-2"
          color="primary"
          size="small"
          variant="tonal"
        >
          共 {{ orgData.total_departments }} 个部门 · {{ orgData.total_members }} 人
        </v-chip>

        <!-- **人员收藏夹**（总人数右侧）：点击以悬浮菜单展开，数量跟着收藏数走 -->
        <v-menu v-model="favOpen" :close-on-content-click="false" location="bottom start" offset="6">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              class="ml-1"
              :color="favOpen ? 'warning' : undefined"
              size="26"
              variant="text"
            >
              <v-icon size="18">{{ favorites.length > 0 ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
              <span v-if="favorites.length > 0" class="text-[12px] font-weight-bold ml-0.5">{{ favorites.length }}</span>
            </v-btn>
          </template>

          <!-- 悬浮菜单本体：点人 = 树上点人（同一个 select 事件，右侧面板照常收人） -->
          <v-card class="fav-menu" elevation="8">
            <div v-if="favorites.length === 0" class="text-[12px] text-medium-emphasis pa-2">
              暂无收藏 · 悬浮下方人员点击星标收藏
            </div>

            <div v-else class="fav-list">
              <div
                v-for="f in favorites"
                :key="f.open_id"
                class="fav-row d-flex align-center ga-2 px-2 py-1 rounded cursor-pointer"
                @click="pickFavorite(f)"
              >
                <v-avatar size="22">
                  <v-img v-if="f.avatar" cover :src="f.avatar" />
                  <v-icon v-else size="13">mdi-account</v-icon>
                </v-avatar>

                <span class="text-[13px] shrink-0">{{ f.name }}</span>
                <span class="text-[11px] text-medium-emphasis text-truncate">{{ f.department_path }}</span>
                <v-spacer />

                <v-icon
                  class="fav-remove"
                  color="warning"
                  size="15"
                  @click.stop="toggleFavoriteById(f.open_id)"
                >mdi-star</v-icon>
              </div>
            </div>
          </v-card>
        </v-menu>
      </div>

      <v-text-field
        v-model="search"
        class="filter-input mt-1"
        clear-icon="mdi-close-circle-outline"
        clearable
        flat
        hide-details
        label="搜索员工"
        single-line
        variant="solo-filled"
      />
    </div>

    <div class="org-scroll mt-2">
      <v-skeleton-loader v-if="loading" type="list-item-three-line@5" />

      <v-treeview
        v-else-if="treeItems.length > 0"
        v-model:activated="activeDept"
        activatable
        :custom-filter="filter"
        :color="activeTint"
        density="compact"
        :hide-actions="true"
        active-class="tree-active-item"
        :indent-lines="true"
        :indent-lines-opacity="0.2"
        item-value="id"
        :items="treeItems"
        open-all
        open-on-click
        :search="search"
        :separate-roots="true"
        @update:activated="onNodeClick"
      >
        <template #title="{ item }">
          <template v-if="item.type === 'dept'">
            <span class="text-[15px] font-weight-medium">{{ item.title }}</span>
            <span class="text-[12px] text-grey ml-1">({{ item.member_count }}人)</span>
          </template>

          <template v-else>
            <span class="text-[13px]  mr-1">{{ item.title }}</span>

            <v-chip
              v-if="item.is_tenant_manager"
              class="mr-1"
              color="error"
              size="x-small"
              variant="tonal"
            >管理员</v-chip>

            <v-chip v-if="item.is_leader" color="warning" size="x-small" variant="tonal">负责人</v-chip>

            <!-- **收藏星**：悬浮该行才显形（已收藏常显实心）；click.stop 避免触发行选中 -->
            <v-icon
              :class="['fav-star', { 'fav-star--on': isFavorite(item.id) }]"
              :color="isFavorite(item.id) ? 'warning' : 'grey'"
              size="15"
              @click.stop="toggleFavorite(item)"
            >
              {{ isFavorite(item.id) ? 'mdi-star' : 'mdi-star-outline' }}
            </v-icon>
          </template>
        </template>

        <template #prepend="{ item, isOpen }">
          <v-icon v-if="item.type === 'dept'" color="primary" size="21">
            {{ item.has_child ? (isOpen ? 'mdi-jellyfish-outline' : 'mdi-jellyfish') :
              'mdi-pig' }}
          </v-icon>

          <v-avatar v-else class="mr-1" size="25">
            <v-img v-if="item.avatar" cover :src="item.avatar" />
            <v-icon v-else size="14">mdi-account</v-icon>
          </v-avatar>
        </template>
      </v-treeview>

      <v-alert v-else type="info" variant="tonal">
        暂无组织架构数据，请点击刷新按钮加载
      </v-alert>
    </div>
  </v-sheet>
</template>

<script lang="ts" setup>
  import { useTheme } from 'vuetify'
  import { fetchOrgTreeCache, type OrgTreeData, type OrgTreeNode, refreshOrgTree } from '@/api/api'

  /*
   * 树节点选中态的浅蓝底。
   *
   * 这里没能走"主题 token"：Vuetify 的 color 属性只认主题色，喂不进 CSS 变量，
   * 所以按项目里已有的写法用 isDark 三元（另见 ProductInfoCard / StreamPanel）。
   * 原来写死 E8F0FE —— 深色主题下那是一整块刺眼的浅蓝。
   */
  const { current: currentTheme } = useTheme()
  const activeTint = computed(() => (currentTheme.value.dark ? '#1D283A' : '#E8F0FE'))

  // ===== 对外类型 =====

  /** 选中员工数据（含部门信息，与 ApprovalChainItem 兼容，可随对象展开存入审批链） */
  export interface OrgSelectedUser {
    /**
     * 飞书 open_id（= 树上该用户节点的 id）。
     *
     * 选人结果会随流程存进模板、再随单据快照存进单据。**单据快照里的成员不再带头像**
     * （见 types/approval 的 slimFlowMembers），展示时按这个 id 现查头像
     * （见 stores/avatarDirectory）—— 所以这里必须带上，否则头像查不到。
     */
    open_id: string
    name: string
    email: string
    avatar?: string
    is_tenant_manager: boolean
    is_leader: boolean
    department: string
    department_path: string
  }
  /** 选中的部门 */
  export interface OrgSelectedDept {
    name: string
    member_count: number
  }
  /** 树节点选中事件载荷：type=user 员工 / type=dept 部门；null 表示取消选中 */
  export type OrgSelectPayload
    = | { type: 'user', user: OrgSelectedUser }
      | { type: 'dept', dept: OrgSelectedDept }

  const emit = defineEmits<{
    /** 选中组织架构节点（含取消选中） */
    select: [payload: OrgSelectPayload | null]
  }>()

  // ===== 树数据 =====

  type TreeItem = DeptTreeItem | UserTreeItem
  interface DeptTreeItem {
    id: string
    type: 'dept'
    title: string
    member_count: number
    has_child: boolean
    children: TreeItem[]
  }
  interface UserTreeItem {
    id: string
    type: 'user'
    title: string
    subtitle: string
    avatar?: string
    is_tenant_manager: boolean
    is_leader: boolean
    department: string
    departmentPath: string
  }

  const loading = ref(false)
  const orgData = ref<OrgTreeData | null>(null)
  const activeDept = ref<string[]>([])
  const treeItems = ref<TreeItem[]>([])

  /**
   * open_id → 该成员最邻近（层级最深）的部门。
   * 飞书按部门查询成员时会带上子部门的人，同一员工可能在树的多个层级重复出现，
   * 因此不能直接用"所点节点"的部门（那可能是父部门），
   * 而应取该员工出现过的层级最深的部门。
   */
  interface NearestDept {
    department: string
    departmentPath: string
    depth: number
  }
  const nearestDeptMap = new Map<string, NearestDept>()
  const search = shallowRef('')

  function filter (value: string, search: string, item: any) {
    return value.toLowerCase().includes(search.toLowerCase())
  }
  let userChildrenLogged = false
  function toTreeItems (nodes: OrgTreeNode[], parentPath: string[] = []): TreeItem[] {
    return nodes.map(node => {
      // 当前部门在组织架构中的完整路径（含自身）
      const currentPath = [...parentPath, node.name]
      // 子部门
      const deptChildren: TreeItem[] = node.children.length > 0 ? toTreeItems(node.children, currentPath) : []

      // 该部门下的员工（作为叶子节点挂到部门下方）
      const userChildren: UserTreeItem[] = (node.users || []).map(u => {
        const path = currentPath.join(' / ')
        // 同一员工可能出现在多个层级，只在映射中保留层级最深（最邻近）的那个部门
        const prev = nearestDeptMap.get(u.open_id)
        if (!prev || currentPath.length > prev.depth) {
          nearestDeptMap.set(u.open_id, {
            department: node.name,
            departmentPath: path,
            depth: currentPath.length,
          })
        }
        return {
          id: u.open_id,
          type: 'user',
          title: u.name,
          subtitle: u.email || u.mobile || '',
          avatar: u.avatar,
          is_tenant_manager: u.is_tenant_manager,
          is_leader: u.is_leader,
          // 树上所在节点的部门；选中时会用 nearestDeptMap 校正为最邻近部门
          department: node.name,
          departmentPath: path,
        }
      })

      // 部门节点：合并子部门 + 员工子节点
      const allChildren = [...deptChildren, ...userChildren]

      // 调试：打印第一个用户头像
      if (userChildren.length > 0 && !userChildrenLogged) {
        console.log('[OrgTree] 第一个用户节点数据:', JSON.stringify(userChildren[0], null, 2))
        userChildrenLogged = true
      }
      return {
        id: node.id,
        type: 'dept',
        title: node.name,
        member_count: node.member_count,
        has_child: allChildren.length > 0,
        children: allChildren,
      } satisfies DeptTreeItem
    })
  }

  /** 构建组织架构树，并重建「员工 → 最邻近部门」映射 */
  function buildTreeItems (nodes: OrgTreeNode[]): TreeItem[] {
    nearestDeptMap.clear()
    return toTreeItems(nodes)
  }

  // ===== 选中逻辑 =====

  function onNodeClick (ids: string[]) {
    if (ids.length === 0) {
      emit('select', null)
      return
    }
    const id = ids[0]
    const node = findNode(treeItems.value, id)
    if (!node) {
      emit('select', null)
      return
    }

    // 打印被选中项
    console.log('[TreeSelect] 选中项:', JSON.stringify(node, null, 2))

    if (node.type === 'dept') {
      const dept = node as DeptTreeItem
      emit('select', { type: 'dept', dept: { name: dept.title, member_count: dept.member_count } })
    } else {
      const user = node as UserTreeItem
      // 取该成员最邻近（层级最深）的部门，而非树上所点节点所在的部门
      const nearest = nearestDeptMap.get(user.id)
      emit('select', {
        type: 'user',
        user: {
          // 树节点 id 就是 open_id（见 toTreeItems），单据快照靠它查头像、认人
          open_id: user.id,
          name: user.title,
          email: user.subtitle,
          avatar: user.avatar,
          is_tenant_manager: user.is_tenant_manager,
          is_leader: user.is_leader,
          department: nearest?.department ?? user.department,
          department_path: nearest?.departmentPath ?? user.departmentPath,
        },
      })
    }
  }

  function findNode (items: TreeItem[], id: string): TreeItem | null {
    for (const item of items) {
      if (item.id === id) return item
      if (item.type === 'dept' && item.children) {
        const found = findNode(item.children, id)
        if (found) return found
      }
    }
    return null
  }

  // ===== 人员收藏（收藏夹） =====
  //
  // 纯个人 UI 偏好：localStorage 持久（键 org-tree-favorites），不进库 —— 收藏只是
  // 「把常选的人放到手边」，不参与任何流程数据。存整份人员快照（OrgSelectedUser），
  // 点收藏夹里的人 = 在树上点他（emit 同一个 select 载荷），右侧面板逻辑零改动。
  // 树上同一员工可能在多个层级重复出现，星状态按 open_id 全局判定（多层级同亮）。

  const FAV_STORAGE_KEY = 'org-tree-favorites'

  const favorites = ref<OrgSelectedUser[]>(loadFavorites())
  const favOpen = ref(false)

  function loadFavorites (): OrgSelectedUser[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(FAV_STORAGE_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function persistFavorites () {
    localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(favorites.value))
  }

  function isFavorite (openId: string): boolean {
    return favorites.value.some(f => f.open_id === openId)
  }

  /** 树节点 → 选中载荷（与 onNodeClick 的 user 分支同一口径：部门取最邻近层级） */
  function toSelectedUser (item: UserTreeItem): OrgSelectedUser {
    const nearest = nearestDeptMap.get(item.id)
    return {
      open_id: item.id,
      name: item.title,
      email: item.subtitle,
      avatar: item.avatar,
      is_tenant_manager: item.is_tenant_manager,
      is_leader: item.is_leader,
      department: nearest?.department ?? item.department,
      department_path: nearest?.departmentPath ?? item.departmentPath,
    }
  }

  /** 点星收藏 / 取消（新收藏插到最前，常用的排上面） */
  function toggleFavorite (item: UserTreeItem) {
    const idx = favorites.value.findIndex(f => f.open_id === item.id)
    if (idx === -1) {
      favorites.value.unshift(toSelectedUser(item))
    } else {
      favorites.value.splice(idx, 1)
    }
    persistFavorites()
  }

  /** 收藏夹面板里的移除（按 open_id，不依赖树节点） */
  function toggleFavoriteById (openId: string) {
    const idx = favorites.value.findIndex(f => f.open_id === openId)
    if (idx !== -1) {
      favorites.value.splice(idx, 1)
      persistFavorites()
    }
  }

  /** 点收藏夹里的人 = 在树上点他：发同一个 select 载荷，右侧面板照常收人；选完收起菜单 */
  function pickFavorite (f: OrgSelectedUser) {
    favOpen.value = false
    emit('select', { type: 'user', user: f })
  }

  // ===== 数据加载 =====

  /** 从 PocketBase 缓存读取组织架构树（首屏加载，秒级响应） */
  async function loadCachedTree () {
    loading.value = true
    userChildrenLogged = false
    try {
      const res = await fetchOrgTreeCache()
      console.log(res)
      if (res.data) {
        orgData.value = res.data
        treeItems.value = buildTreeItems(res.data.tree)
      } else {
        console.log('[OrgTree] 暂无缓存数据')
      }
      activeDept.value = []
    } catch (error) {
      console.error('加载缓存组织架构失败:', error)
    } finally {
      loading.value = false
    }
  }

  /** 点击刷新按钮：从飞书重新拉取并更新 PocketBase 缓存 */
  async function refreshTreeFromServer () {
    loading.value = true
    userChildrenLogged = false
    try {
      const res = await refreshOrgTree()
      orgData.value = res.data
      treeItems.value = buildTreeItems(res.data.tree)
      activeDept.value = []
    } catch (error) {
      console.error('刷新组织架构失败:', error)
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    loadCachedTree()
  })
</script>

<style scoped lang="scss">
/* 面板整体限高：头部固定，树区域在内部滚动，避免撑高页面带动右侧画布一起滚动 */
.org-sheet {
  max-height: calc(100vh - 100px);
}

.org-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* 树 open-all 展开后可能比外层 v-col 更宽：横向滚动消化在组件内部，
       不把固有宽度顶到 v-col 上（否则页面栅格被撑破） */
  overflow-x: auto;
  /* 滚到边界时不把滚动传递给页面 */
  overscroll-behavior: contain;
}

/* 细滚动条，避免抢视觉焦点 */
.org-scroll::-webkit-scrollbar {
  width: 6px;
}

.org-scroll::-webkit-scrollbar-thumb {
  /* 跟着主题：深色下原来的浅灰滑块会变成一条亮线 */
  background: rgb(var(--v-theme-on-surface) / 30%);
  border-radius: 3px;
}

.org-scroll::-webkit-scrollbar-thumb:hover {
  background: rgb(var(--v-theme-on-surface) / 45%);
}

.org-scroll::-webkit-scrollbar-track {
  background: transparent;
}

/* ===== 人员收藏 ===== */

/* 树上的收藏星：默认隐形，悬浮该行才显形（已收藏的常显实心，见 --on） */
.fav-star {
  opacity: 0;
  transition: opacity 0.15s ease;
  cursor: pointer;
}

:deep(.v-treeview-item:hover) .fav-star {
  opacity: 1;
}

.fav-star--on {
  opacity: 1 !important;
}

/* 收藏夹面板样式已迁到文件末尾的全局块（v-menu 内容 teleport 出组件，scoped 够不着） */
/* 树节点选中态：文字颜色 */
::deep(.tree-active-item) {
  /* 原来写死 1A73E8（既不是主题主色，深色下也偏暗） */
  color: rgb(var(--v-theme-primary)) !important;
}

::deep(.tree-active-item span) {
  /* 原来写死 1A73E8（既不是主题主色，深色下也偏暗） */
  color: rgb(var(--v-theme-primary)) !important;
}
</style>

<style>
/* ===== 收藏夹悬浮菜单（全局块） =====
   v-menu 的内容被 teleport 到 overlay 容器（body 下），本组件的 scoped 属性够不着，
   这几个类必须放全局；统一加 .fav-menu 前缀防止污染其它页面。 */
.fav-menu {
  min-width: 252px;
  max-width: 330px;
}

/* 限高内部滚动：收藏多了也不撑爆屏幕 */
.fav-menu .fav-list {
  max-height: 240px;
  overflow-y: auto;
}

.fav-menu .fav-row {
  transition: background-color 0.15s ease;
}

.fav-menu .fav-row:hover {
  background: rgb(var(--v-theme-primary) / 8%);
}

/* 移除星默认淡、悬浮行才实 */
.fav-menu .fav-remove {
  opacity: 0.55;
  transition: opacity 0.15s ease;
}

.fav-menu .fav-row:hover .fav-remove {
  opacity: 1;
}
</style>

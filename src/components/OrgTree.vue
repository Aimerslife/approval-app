<template>
    <v-sheet rounded class="p-4 border border-dashed border-accent d-flex flex-column org-sheet">
        <!-- 头部：固定区域，不随树滚动 -->
        <div class="shrink-0">
            <div class="d-flex align-center flex-wrap mb-2">
                <span class="text-[14px] font-weight-bold">组织架构</span>
                <v-tooltip text="刷新组织架构" location="right">
                    <template v-slot:activator="{ props }">
                        <v-btn variant="flat" size="20" @click="refreshTreeFromServer" v-bind="props" :loading="loading"
                            class="ml-2">
                            <v-icon color="#1055C9" size="20">mdi-refresh</v-icon>
                        </v-btn>
                    </template>
                    <span class="text-[12px]">刷新组织架构</span>
                </v-tooltip>
                <v-chip v-if="orgData" size="small" class="ml-2" color="primary" variant="tonal">
                    共 {{ orgData.total_departments }} 个部门 · {{ orgData.total_members }} 人
                </v-chip>
            </div>
            <v-text-field v-model="search" clear-icon="mdi-close-circle-outline" label="搜索员工" class="filter-input mt-1"
                variant="solo-filled" clearable flat hide-details single-line></v-text-field>
        </div>

        <div class="org-scroll mt-2">
            <v-skeleton-loader v-if="loading" type="list-item-three-line@5" />
            <v-treeview v-else-if="treeItems.length" :hide-actions="true" :indent-lines="true" :items="treeItems"
                :search="search" :custom-filter="filter" :separate-roots="true" density="compact" item-value="id"
                open-all activatable v-model:activated="activeDept" open-on-click color="#E8F0FE"
                active-class="tree-active-item" @update:activated="onNodeClick">
                <template v-slot:title="{ item }">
                    <template v-if="item.type === 'dept'">
                        <span class="text-[15px] font-weight-medium">{{ item.title }}</span>
                        <span class="text-[12px] text-grey ml-1">({{ item.member_count }}人)</span>
                    </template>
                    <template v-else>
                        <span class="text-[13px]  mr-1">{{ item.title }}</span>
                        <v-chip v-if="item.is_tenant_manager" size="x-small" color="error" variant="tonal"
                            class="mr-1">管理员</v-chip>
                        <v-chip v-if="item.is_leader" size="x-small" color="warning" variant="tonal">负责人</v-chip>
                    </template>
                </template>
                <template v-slot:prepend="{ item, isOpen }">
                    <v-icon v-if="item.type === 'dept'" size="25" color="#1055C9">
                        {{ item.has_child ? (isOpen ? 'mdi-layers-outline' : 'mdi-layers') :
                            'mdi-account-group' }}
                    </v-icon>
                    <v-avatar v-else size="25" class="mr-1">
                        <v-img v-if="item.avatar" :src="item.avatar" cover />
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
import { fetchOrgTreeCache, refreshOrgTree, type OrgTreeNode, type OrgTreeData } from '@/api/api'

// ===== 对外类型 =====

/** 选中员工数据（含部门信息，与 ApprovalChainItem 兼容，可随对象展开存入审批链） */
export interface OrgSelectedUser {
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
export type OrgSelectPayload =
    | { type: 'user'; user: OrgSelectedUser }
    | { type: 'dept'; dept: OrgSelectedDept }

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

function filter(value: string, search: string, item: any) {

    return value.toLowerCase().indexOf(search.toLowerCase()) > -1
}
let userChildrenLogged = false
function toTreeItems(nodes: OrgTreeNode[], parentPath: string[] = []): TreeItem[] {
    return nodes.map(node => {
        // 当前部门在组织架构中的完整路径（含自身）
        const currentPath = [...parentPath, node.name]
        // 子部门
        const deptChildren: TreeItem[] = node.children.length ? toTreeItems(node.children, currentPath) : []

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
function buildTreeItems(nodes: OrgTreeNode[]): TreeItem[] {
    nearestDeptMap.clear()
    return toTreeItems(nodes)
}

// ===== 选中逻辑 =====

function onNodeClick(ids: string[]) {
    if (!ids.length) {
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

function findNode(items: TreeItem[], id: string): TreeItem | null {
    for (const item of items) {
        if (item.id === id) return item
        if (item.type === 'dept' && item.children) {
            const found = findNode(item.children, id)
            if (found) return found
        }
    }
    return null
}

// ===== 数据加载 =====

/** 从 PocketBase 缓存读取组织架构树（首屏加载，秒级响应） */
async function loadCachedTree() {
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
    } catch (err) {
        console.error('加载缓存组织架构失败:', err)
    } finally {
        loading.value = false
    }
}

/** 点击刷新按钮：从飞书重新拉取并更新 PocketBase 缓存 */
async function refreshTreeFromServer() {
    loading.value = true
    userChildrenLogged = false
    try {
        const res = await refreshOrgTree()
        orgData.value = res.data
        treeItems.value = buildTreeItems(res.data.tree)
        activeDept.value = []
    } catch (err) {
        console.error('刷新组织架构失败:', err)
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
    background: #d8dee8;
    border-radius: 3px;
}

.org-scroll::-webkit-scrollbar-thumb:hover {
    background: #b9c2cf;
}

.org-scroll::-webkit-scrollbar-track {
    background: transparent;
}

/* 树节点选中态：文字颜色 */
::deep(.tree-active-item) {
    color: #1A73E8 !important;
}

::deep(.tree-active-item span) {
    color: #1A73E8 !important;
}

.filter-input {
    :deep(.v-field) {
        --v-field-padding-top: 2px;
        --v-field-padding-bottom: 1px;
        --v-input-control-height: 30px;
        font-size: 12px;
    }

    :deep(.v-field__input) {
        min-height: 40px;
        padding-top: 1px;
        padding-bottom: 1px;
    }

    :deep(.v-label) {
        font-size: 13px;
    }

    :deep(.v-field__append-inner) {
        align-self: center;
        padding-top: 0;
    }

    :deep(.v-field__prepend-inner) {
        margin-top: 0;
        padding-top: 1px;

        .v-icon {
            font-size: 14px;
        }
    }

    :deep(.v-input__details) {
        padding-top: 0;
        min-height: 0;
    }
}
</style>

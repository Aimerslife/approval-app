<template>
  <v-container class="page-bg px-30 pb-6" fluid>
    <!-- 页头 -->
    <div class="mt-3 mb-5 px-1">
      <div class="font-bold block-title">角色设置</div>
      <div class="text-[12px] text-medium-emphasis mt-1">管理成员所属角色与权限</div>
    </div>
    <!-- 成员表格卡片 -->
    <v-sheet class="overflow-hidden card-border px-4 pt-4 pb-2" rounded="15">
      <!-- 卡片工具栏：成员数 + 搜索 -->
      <div class="d-flex align-center flex-wrap ga-4 pr-5 pl-2 pt-1 pb-3">
        <div class="flex-grow-1">
          <span class="text-[13px] text-medium-emphasis">
            <b class="text-primary">{{ data.length }}</b> 位成员</span>
        </div>
        <v-text-field v-model="search" density="compact" hide-details clearable class="filter-input" label="搜索成员"
          prepend-inner-icon="mdi-magnify" single-line style="max-width: 300px" variant="outlined" />
      </div>
      <v-divider />
      <v-data-table v-model:page="page" density="compact" :headers="headers" hover :items="data" class="text-[12px]"
        :items-per-page="itemsPerPage" :loading="memberLoading" :search="search">
        <template #item.avatar_url="{ value }">
          <v-avatar color="primary" size="30" variant="tonal">
            <v-img v-if="value" :src="value" />
            <v-icon v-else icon="mdi-account" size="20" />
          </v-avatar>
        </template>
        <template #item.name="{ value }">
          <span class="text-[13px] font-semibold">{{ value }}</span>
        </template>
        <template #item.role="{ value }">
          <v-chip color="primary" label size="small" variant="tonal">{{ roleName(value) }}</v-chip>
        </template>
        <template #item.permission="{ item }">
          <div class="d-flex flex-wrap justify-center ga-1">
            <span v-for="p in permissionsOf(item)" :key="p.key" class="text-[12px] text-medium-emphasis">
              {{ p.title }}</span>
          </div>
        </template>
        <template #item.department="{ value }">
          <span class="text-[13px]">{{ value }}</span>
        </template>
        <template #item.status="{ value }">
          <v-chip :color="value === 1 ? 'success' : value === 2 ? 'warning' : 'error'" size="small" variant="tonal">
            {{ value == 1 ? '通过' : value == 2 ? '驳回' : '待审批' }}
          </v-chip>
        </template>
        <template #item.action="{ item }">
          <v-icon-btn color="primary" icon="mdi-clipboard-edit-outline" size="30" title="权限变更" variant="tonal"
            @click="goEdit(item)">
            <v-icon size="16" />
          </v-icon-btn>
        </template>
        <template #bottom>
          <div class="d-flex justify-center py-2">
            <v-pagination v-model="page" active-color="primary" density="compact" :length="pageCount" />
          </div>
        </template>
      </v-data-table>
    </v-sheet>
    <!-- 团队 → 默认审批人：默认值在 utils/organazation.ts 里维护，这里负责展示与「换人」 -->
    <div class="my-5 px-1">
      <div class="font-bold block-title">人员配置</div>
      <div class="text-[12px] text-medium-emphasis mt-1">
        管理团队默认审批人；部门审批人按部门维护（同部门的团队共用）
      </div>
    </div>
    <v-sheet class="overflow-hidden card-border px-4 pt-4 pb-2" rounded="15">
      <div class="d-flex align-center flex-wrap ga-4 pr-5 pl-2 pt-1 pb-3">
        <div class="flex-grow-1">
          <span class="text-[13px] text-medium-emphasis">
            <b class="text-primary">{{ approverRows.length }}</b> 个团队</span>
          <span v-if="customCount" class="text-[12px] text-medium-emphasis ml-2">
            · 团队已改 <b class="text-primary">{{ customCount }}</b> 个</span>
          <span v-if="deptCustomCount" class="text-[12px] text-medium-emphasis ml-2">
            · 部门已改 <b class="text-primary">{{ deptCustomCount }}</b> 个</span>
        </div>
        <v-text-field v-model="approverSearch" clearable density="compact" hide-details class="filter-input"
          label="搜索团队 / 审批人" prepend-inner-icon="mdi-magnify" single-line style="max-width: 260px" variant="outlined" />
      </div>
      <v-divider />
      <v-data-table class="text-[12px]" density="compact" :headers="approverHeaders" hover :items="approverRows"
        :items-per-page="10" :items-per-page-options="[10, 20, 50]" :loading="approverLoading" :search="approverSearch">
        <template #item.manager="{ item }">
          <div class="d-flex align-center ga-2">
            <v-avatar color="primary" size="28" variant="tonal">
              <v-img v-if="item.avatar" :alt="item.manager" :src="item.avatar" />
              <span v-else class="text-[12px] font-weight-semibold">{{ item.manager?.slice(0, 1) }}</span>
            </v-avatar>
            <div class="d-flex flex-column">
              <span class="text-[13px] font-semibold">{{ item.manager || '—' }}</span>
              <span v-if="item.email" class="text-[11px] text-medium-emphasis">{{ item.email }}</span>
            </div>
          </div>
        </template>
        <!-- 部门审批人：部门级维护（同部门的团队共用），默认取 organazation 的 parentManager -->
        <template #item.deptManager="{ item }">
          <div class="d-flex align-center ga-2">
            <span class="text-[13px] font-semibold">{{ item.deptManager || '—' }}</span>
            <v-chip v-if="item.deptSource === 'custom'" color="primary" size="x-small" variant="tonal">
              已改
            </v-chip>
            <v-btn size="x-small" variant="text" @click="openDeptPicker(item)">更换</v-btn>
            <v-btn v-if="item.deptSource === 'custom'" size="x-small" variant="text"
              @click="resetDeptApprover(item)">恢复默认</v-btn>
          </div>
        </template>
        <template #item.source="{ value }">
          <v-chip :color="value === 'custom' ? 'primary' : undefined" size="x-small" variant="tonal">
            {{ value === 'custom' ? '已改' : '默认' }}
          </v-chip>
        </template>
        <template #item.action="{ item }">
          <div class="d-flex justify-center ga-1">
            <v-btn color="primary" size="small" variant="tonal" @click="openPicker(item)">更换</v-btn>
            <v-btn v-if="item.source === 'custom'" size="x-small" variant="text"
              @click="resetApprover(item)">恢复默认</v-btn>
          </div>
        </template>
      </v-data-table>
    </v-sheet>
    <div class="my-5 px-1">
      <div class="font-bold block-title">仓库配置</div>
      <div class="text-[12px] text-medium-emphasis mt-1">管理仓库对应类型</div>
    </div>
    <v-sheet class="overflow-hidden card-border px-4 pt-4 pb-2" rounded="15">
      <div class="d-flex align-center flex-wrap ga-4 pr-5 pl-2 pt-1 pb-3">
        <div class="flex-grow-1 d-flex align-center ga-2">
          <span class="text-[13px] text-medium-emphasis">
            <b class="text-primary">{{ warehouseRows.length }}</b> 个仓库</span>
        </div>
        <v-btn v-if="warehouseCustom" size="small" variant="text" @click="askResetWarehouses">恢复默认</v-btn>
        <v-btn color="primary" prepend-icon="mdi-plus" size="small" variant="flat"
          @click="openWarehouseAdd">新增仓库</v-btn>
        <v-text-field v-model="warehouseSearch" clearable density="compact" hide-details class="filter-input"
          label="搜索分类 / 仓库名" prepend-inner-icon="mdi-magnify" single-line style="max-width: 240px" variant="outlined" />
      </div>
      <v-divider />
      <v-data-table class="text-[12px]" density="compact" :headers="warehouseHeaders" hover :items="warehouseRows"
        :items-per-page="10" :items-per-page-options="[10, 20, 50]" :loading="warehouseLoading"
        :search="warehouseSearch">
        <template #item.parent="{ value }">
          <v-chip size="small" label variant="tonal" color="info">{{ value }}</v-chip>
        </template>
        <template #item.name="{ value }">
          <span class="text-[12px]">{{ value }}</span>
        </template>
        <template #item.action="{ item }">
          <div class="d-flex justify-center ga-1">
            <v-btn color="primary" size="small" variant="tonal" @click="openWarehouseEdit(item)">编辑</v-btn>
            <v-btn size="small" variant="text" @click="askRemoveWarehouse(item)">删除</v-btn>
          </div>
        </template>
      </v-data-table>
    </v-sheet>
    <v-dialog v-model="warehouseDialog" max-width="520">
      <v-card class="overflow-hidden" rounded="xl">
        <v-card-title class="d-flex align-center justify-space-between px-6 py-4">
          <div class="d-flex align-center ga-2">
            <v-avatar color="primary" size="28" variant="tonal">
              <v-icon icon="mdi-warehouse" size="16" />
            </v-avatar>
            <span class="text-[15px] font-bold">{{ warehouseEditing ? '编辑仓库' : '新增仓库' }}</span>
          </div>
          <v-icon-btn icon="mdi-close" size="small" variant="text" @click="warehouseDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text class="px-6 py-5 d-flex align-center gap-2">
          <v-combobox v-model="warehouseDraft.parent" class="w-[60px] filter-input" density="compact"
            hide-details="auto" :items="warehouseParents" label="上级分类" placeholder="如：本地仓 / 中转仓 / 海外仓 / 平台仓"
            variant="outlined">
            <template #message>
              <span class="text-[11px]">可以直接输入新的分类名，保存后它也会出现在候选里</span>
            </template>
          </v-combobox>
          <v-text-field v-model="warehouseDraft.name" density="compact" class="filter-input" hide-details="auto"
            label="仓库名" placeholder="如：广州仓 / FBA仓" variant="outlined" />
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-6 py-3">
          <v-spacer />
          <v-btn variant="text" @click="warehouseDialog = false">取消</v-btn>
          <v-btn color="primary" :loading="warehouseSaving" variant="flat" @click="saveWarehouseDraft">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="confirmOpen" max-width="460">
      <v-card class="overflow-hidden" rounded="xl">
        <v-card-title class="d-flex align-center ga-2 px-6 py-4">
          <v-avatar :color="confirmKind === 'reset' ? 'warning' : 'error'" size="28" variant="tonal">
            <v-icon size="16">{{ confirmKind === 'reset' ? 'mdi-backup-restore' : 'mdi-delete-outline' }}</v-icon>
          </v-avatar>
          <span class="text-[15px] font-semibold">
            {{ confirmKind === 'reset' ? '恢复默认仓库清单' : '删除仓库' }}
          </span>
        </v-card-title>
        <v-divider />
        <v-card-text class="px-6 py-5 text-[13px]">
          <template v-if="confirmKind === 'reset'">
            将清空维护表里的 <b>{{ warehouseRows.length }}</b> 条记录
          </template>
          <template v-else>
            确定删除「<b>{{ confirmTarget?.parent }}</b> / <b>{{ confirmTarget?.name }}</b>」吗？
            删除后新建的审批单里不会再出现它。
          </template>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-6 py-3">
          <v-spacer />
          <v-btn variant="text" @click="closeConfirm">取消</v-btn>
          <v-btn :color="confirmKind === 'reset' ? 'warning' : 'error'" :loading="confirmLoading" variant="flat"
            @click="runConfirm">确定</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 更换默认审批人：直接复用「通讯录」（组织架构树） -->
    <v-dialog v-model="pickerOpen" max-width="900">
      <v-card class="overflow-hidden" rounded="xl">
        <v-card-title class="d-flex align-center justify-space-between px-6 py-4">
          <div class="d-flex align-center ga-2">
            <v-avatar color="primary" size="28" variant="tonal">
              <v-icon icon="mdi-account-switch-outline" size="16" />
            </v-avatar>
            <span class="text-[15px] font-bold">
              更换「{{ picking?.name }}」的{{ picking?.kind === 'dept' ? '部门审批人' : '默认审批人' }}
            </span>
          </div>

          <v-icon-btn icon="mdi-close" size="small" variant="text" @click="pickerOpen = false" />
        </v-card-title>

        <v-divider />

        <v-card-text class="px-6 py-4">
          <div class="text-[12px] text-medium-emphasis mb-3">
            在下面的通讯录里点选一位成员；当前是
            <b>{{ picking?.manager || '—' }}</b>
          </div>

          <!-- 通讯录自带搜索与刷新，这里只负责给它一个有界高度（见样式里的 .approver-tree） -->
          <div class="approver-tree">
            <OrgTree @select="onOrgSelect" />
          </div>

          <div v-if="picked" class="picked-box d-flex align-center ga-3 mt-3 px-3 py-2">
            <v-avatar color="primary" size="36" variant="tonal">
              <v-img v-if="picked.avatar" :alt="picked.name" :src="picked.avatar" />
              <span v-else class="text-[13px] font-weight-semibold">{{ picked.name.slice(0, 1) }}</span>
            </v-avatar>

            <div class="d-flex flex-column">
              <span class="text-[13px] font-semibold">{{ picked.name }}</span>
              <span class="text-[11px] text-medium-emphasis">
                {{ picked.department_path || picked.department || '—' }}
                <template v-if="picked.email"> · {{ picked.email }}</template>
              </span>
            </div>
          </div>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-6 py-3">
          <v-spacer />
          <v-btn variant="text" @click="pickerOpen = false">取消</v-btn>
          <v-btn color="primary" :disabled="!picked" :loading="saving" variant="flat" @click="savePicked">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 改数据的结果要有反馈，不能静默 -->
    <v-snackbar v-model="hint.show" :color="hint.color" location="top" timeout="3000" variant="tonal">
      {{ hint.text }}
    </v-snackbar>

    <!-- 权限变更弹窗 -->
    <v-dialog v-model="model" max-width="560">
      <v-card class="overflow-hidden" rounded="xl">
        <v-card-title class="d-flex align-center justify-space-between px-6 py-4">
          <span class="d-flex align-center ga-2 text-[15px] font-semibold">
            <v-avatar color="primary" size="28" variant="tonal">
              <v-icon size="16">mdi-shield-account</v-icon>
            </v-avatar>
            权限变更
            <!-- 带上目标名字：这张表里每行的按钮长一样，不写清楚改的是谁很容易点错人 -->
            <span v-if="editingUser" class="text-[13px] font-normal text-medium-emphasis">
              · {{ editingUser.name || editingUser.email || editingUser.id }}
            </span>
          </span>

          <v-icon-btn icon="mdi-close" size="small" variant="text" @click="model = false" />
        </v-card-title>

        <v-divider />

        <v-card-text class="px-6 py-5">
          <div class="text-[grey] text-[12px] font-bold mb-1">目标角色</div>

          <v-radio-group v-model="currentRole" class="role-radio" hide-details>
            <div class="d-flex flex-column ga-2">
              <div v-for="r in roleList" :key="r.key" class="role-option"
                :class="{ 'role-option-active': currentRole === r.key }" @click="currentRole = r.key">
                <v-radio color="primary" class="ma-0" hide-details :ripple="false" :value="r.key">
                  <template #label>
                    <div class="d-flex flex-column ml-2">
                      <span class="text-[13px] font-semibold">{{ r.title }}</span>
                      <span class="text-[12px] text-medium-emphasis">默认拥有 {{ r.permission.length }} 项权限</span>
                    </div>
                  </template>
                </v-radio>

                <v-spacer />

                <v-chip v-if="currentRole === r.key" color="primary" label size="x-small" variant="tonal">当前</v-chip>
              </div>
            </div>
          </v-radio-group>

          <div class="d-flex align-center justify-space-between mt-5 mb-2">
            <div class="text-[grey] text-[12px] font-bold mb-1">角色权限</div>
          </div>

          <div class="perms-box px-3 py-2">
            <v-checkbox v-for="p in rolePermission" :key="p.key" class="perms-checkbox" color="primary"
              density="compact" hide-details :model-value="true" readonly>
              <template #label>
                <span class="text-[13px]">{{ p.title }}</span>
              </template>
            </v-checkbox>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-6 py-3">
          <v-spacer />
          <v-btn color="primary" rounded="lg" size="small" text="取消" variant="tonal" @click="model = false" />
          <v-btn color="primary" rounded="lg" size="small" text="确认变更" :loading="updating" @click="handleUpdate" />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
<script lang="ts" setup>
import OrgTree from '@/components/OrgTree.vue'
import type { OrgSelectPayload, OrgSelectedUser } from '@/components/OrgTree.vue'
import {
  deleteDeptApproverOverride,
  deleteGroupApproverOverride,
  getDeptApproverOverrides,
  getGroupApproverOverrides,
  getUserInfo,
  loadWarehouses,
  resetWarehouses,
  saveDeptApprover,
  saveGroupApprover,
  saveWarehouses,
  updateUserRole,
  WAREHOUSE_SETUP_ERROR,
  type UserInfo,
} from '@/utils/collection'
import {
  attachDeptApprovers,
  countCustom,
  defaultDeptApproverRows,
  defaultGroupApproverRows,
  mergeDeptApprovers,
  mergeGroupApprovers,
  type ApproverDisplayRow,
  type DeptApproverRow,
} from '@/utils/groupApprovers'
/*
 * 角色档位的**唯一事实源**：下面 roleList 的 key 与中文名都从这里取。
 * 之前这张页自己抄了一份，多出个 `admin`、还把 `approval` 标成「审批人员」——
 * 选「管理员」写进库的是 `admin`，而路由守卫 normalizeRole('admin') 会把它归成最低档，
 * 权限静默失效（见 roleList 上的说明）。
 */
import { normalizeRole, ROLE_LABELS, type AppRole } from '@/utils/permissions'
import {
  cleanWarehouse,
  findBadWarehouse,
  warehouseKey,
  type WarehouseRow,
} from '@/utils/warehouse'

const currentRole = ref('')
const data = ref<UserInfo[]>([])
/**
 * 成员列表取数中（挂到「成员」那张表的 `:loading` 上）。
 *
 * 与同文件的 approverLoading / warehouseLoading 同一套写法：进去置 true、复位放 finally，
 * 请求失败时表格不会永久停在加载态（这张表原来连标志都没有，进来先是"空表一闪"）。
 */
const memberLoading = ref(false)
async function getDatas() {
  memberLoading.value = true
  try {
    const res = await getUserInfo()
    data.value = res
    // ⚠️ 列表可能为空（集合规则没放行 / 库里还没人），不能直接读 `res[0].role` ——
    //    那会抛 TypeError 打断 onMounted 里后面的 loadApprovers / loadWarehouseList
    currentRole.value = normalizeRole(res[0]?.role)
  } finally {
    memberLoading.value = false
  }
}
const model = ref(false)
const search = ref('')
const page = ref(1)
const itemsPerPage = ref(5)

/**
 * 可分配的角色档位。
 *
 * ⚠️ key 必须与 `utils/permissions.ts` 的 `AppRole` **完全一致**，中文名直接取 `ROLE_LABELS`。
 * 这里原来自己抄了一份，结果多出一个 `admin`、还把 `approval` 标成「审批人员」：
 * 弹窗里选「管理员」写进库的是 `admin`，而路由守卫 `normalizeRole('admin')`
 * 会把它归成最低档「一般员工」—— 界面上显示"已改成功"，权限却静默失效。
 *
 * permission 只是**界面说明**（这一档大致能做什么），真正的判定在 permissions.ts 的
 * ROUTE_ROLES / ACTION_ROLES 两张表里，别拿它当权限依据。
 */
const roleList = ref([
  {
    key: 'superAdmin' as AppRole,
    title: ROLE_LABELS.superAdmin,
    permission: [
      { key: 'manageApproval', title: '审批管理' },
      { key: 'manageUser', title: '用户管理' },
      { key: 'manageRole', title: '角色管理' },
      { key: 'manageProduct', title: '产品管理' },
      { key: 'manageApprovalFlow', title: '审批流管理' },
    ],
  },
  {
    key: 'approval' as AppRole,
    title: ROLE_LABELS.approval,
    permission: [
      { key: 'manageApproval', title: '审批管理' },
      { key: 'manageUser', title: '用户管理' },
      { key: 'manageProduct', title: '产品管理' },
      { key: 'manageApprovalFlow', title: '审批流管理' },
    ],
  },
  {
    key: 'normal' as AppRole,
    title: ROLE_LABELS.normal,
    permission: [
      { key: 'viewApproval', title: '查看审批单' },
      { key: 'searchApproval', title: '搜索审批单' },
    ],
  },
])
/** 弹窗里选中的那个角色的权限明细 */
const rolePermission = computed(() => {
  return roleList.value.find(item => item.key === currentRole.value)?.permission || []
})

/**
 * 表格「权限」列：按**该成员自己的**角色推导。
 * 旧实现直接 v-for 了上面的 rolePermission，于是全表每一行显示的都是
 * 「弹窗当前选中角色」的权限 —— 与这名成员毫无关系。
 */
function permissionsOf(item: UserInfo) {
  const role = normalizeRole(item.role)
  return roleList.value.find(r => r.key === role)?.permission ?? []
}
const headers = ref([
  {
    align: 'center',
    key: 'avatar_url',
    sortable: false,
    title: '头像',
  },
  { title: '用户名', key: 'name', align: 'center' },
  { title: '部门', key: 'department', align: 'center' },
  { title: '邮箱', key: 'email', align: 'center' },
  { title: '角色', key: 'role', align: 'center' },
  { title: '权限', key: 'permission', align: 'center' },
  { title: '权限变更', key: 'action', align: 'center', sortable: false },
] as const)

const pageCount = computed(() => {
  return Math.ceil(data.value.length / itemsPerPage.value)
})

/**
 * 角色 key → 中文名。
 * 与 userSetting.vue 用同一口径（normalizeRole + ROLE_LABELS）：库里若有历史脏值（如 `admin`），
 * 按最低档展示，而不是把一个英文串直接丢到界面上。
 */
function roleName(value: unknown): string {
  if (value == null || value === '') return '—'
  return ROLE_LABELS[normalizeRole(String(value))]
}

/** 权限列可能是数组或字符串，统一转成可读文本 */
function formatPermission(value: unknown): string {
  if (Array.isArray(value)) {
    const list = value
      .map(v => (typeof v === 'string' ? v : v?.title ?? ''))
      .filter(Boolean)
    return list.length > 0 ? list.join('、') : '—'
  }
  return value == null || value === '' ? '—' : String(value)
}
/** 权限变更弹窗正在改的那个成员 —— 点哪行就改哪行 */
const editingUser = ref<UserInfo | null>(null)
const updating = ref(false)

/**
 * ⚠️ 目标必须是**被点的那一行**。
 * 旧实现写死 `data.value[0].id`，也就是列表第一条（按当时的口径正好是登录者自己），
 * 于是点任何一行的「权限变更」都在改自己，别人的角色永远动不了。
 */
function goEdit(item: UserInfo) {
  editingUser.value = item
  // 弹窗默认选中他当前的角色，方便对比着改
  currentRole.value = normalizeRole(item.role)
  model.value = true
}

async function handleUpdate() {
  const target = editingUser.value
  if (!target) {
    return
  }
  const next = normalizeRole(currentRole.value)
  updating.value = true
  try {
    await updateUserRole(target.id, next)
    // 重新拉一次：表格的「角色」列要立刻反映新值（改的也可能正是登录者自己）
    await getDatas()
    model.value = false
    showHint(`「${target.name || target.email || target.id}」已改为${ROLE_LABELS[next]}`, 'success')
  } catch (error) {
    console.error('[roleSetting] 修改角色失败:', error)
    // 旧实现的 updateUserRole 会吞掉错误，失败时界面静默无反应；现在必须说出来
    showHint('角色变更失败，请稍后重试', 'error')
  } finally {
    updating.value = false
  }
}

const hint = ref<{ show: boolean, text: string, color: 'success' | 'error' | 'warning' }>({
  show: false,
  text: '',
  color: 'success',
})
function showHint(text: string, color: 'success' | 'error' | 'warning' = 'warning') {
  hint.value = { show: true, text, color }
}

const approverRows = ref<ApproverDisplayRow[]>([])
/** 部门审批人（按部门一行；同一部门的团队共用，贴在团队行上展示） */
const deptApproverRows = ref<DeptApproverRow[]>([])
const approverLoading = ref(false)
const approverSearch = ref('')
const approverHeaders = ref([
  { title: '上级部门', key: 'parent', align: 'start' },
  { title: '团队', key: 'group', align: 'start' },
  { title: '默认审批人', key: 'manager', align: 'start', sortable: false },
  { title: '部门审批人', key: 'deptManager', align: 'start', sortable: false },
  { title: '来源', key: 'source', align: 'center' },
  { title: '操作', key: 'action', align: 'center', sortable: false },
] as const)
const customCount = computed(() => countCustom(approverRows.value))
/** 有几个部门被换过部门审批人（同部门的多行只算一次） */
const deptCustomCount = computed(() => deptApproverRows.value.filter(d => d.source === 'custom').length)

/**
 * 拉覆盖值并与文件里的默认值合并（团队、部门两套覆盖值）。
 * 覆盖值读取失败时按"没有任何覆盖"处理（见 getGroupApproverOverrides / getDeptApproverOverrides），
 * 于是 PB 还没应用迁移时也能看到默认值，不至于整页白屏。
 */
async function loadApprovers() {
  approverLoading.value = true
  try {
    const [teamOverrides, deptOverrides] = await Promise.all([
      getGroupApproverOverrides(),
      getDeptApproverOverrides(),
    ])
    deptApproverRows.value = mergeDeptApprovers(defaultDeptApproverRows(), deptOverrides)
    approverRows.value = attachDeptApprovers(
      mergeGroupApprovers(defaultGroupApproverRows(), teamOverrides),
      deptApproverRows.value,
    )
  } finally {
    approverLoading.value = false
  }
}

const pickerOpen = ref(false)
/** 正在换人的对象：团队（默认审批人）或部门（部门审批人） */
interface PickTarget {
  kind: 'team' | 'dept'
  /** 团队名 / 部门名 */
  name: string
  /** 仅团队：所属部门（覆盖记录里冗余存一份） */
  parent?: string
  manager: string
}
const picking = ref<PickTarget | null>(null)
const picked = ref<OrgSelectedUser | null>(null)
const saving = ref(false)

/** 换团队的默认审批人 */
function openPicker(row: ApproverDisplayRow) {
  picking.value = { kind: 'team', name: row.group, parent: row.parent, manager: row.manager }
  picked.value = null
  pickerOpen.value = true
}

/** 换部门审批人（部门级：同部门下的团队共用这一个） */
function openDeptPicker(row: ApproverDisplayRow) {
  picking.value = { kind: 'dept', name: row.parent, manager: row.deptManager }
  picked.value = null
  pickerOpen.value = true
}

/** 通讯录里只能选**人**：点到部门时忽略并提示，否则会把部门名当成审批人存进去 */
function onOrgSelect(payload: OrgSelectPayload | null) {
  if (!payload) {
    return
  }
  if (payload.type !== 'user') {
    showHint('请在通讯录里点选成员，而不是部门')
    return
  }
  picked.value = payload.user
}

async function savePicked() {
  const target = picking.value
  const user = picked.value
  if (!target || !user) {
    return
  }
  const contact = {
    manager: user.name,
    manager_email: user.email,
    manager_avatar: user.avatar,
    manager_department: user.department,
    manager_department_path: user.department_path,
  }
  saving.value = true
  try {
    if (target.kind === 'dept') {
      await saveDeptApprover({ dept: target.name, ...contact })
    } else {
      await saveGroupApprover({ group: target.name, parent: target.parent, ...contact })
    }
    await loadApprovers()
    pickerOpen.value = false
    const what = target.kind === 'dept' ? '部门审批人' : '默认审批人'
    showHint(`「${target.name}」的${what}已改为 ${user.name}`, 'success')
  } catch (error) {
    console.error('[roleSetting] 保存审批人失败:', error)
    // 失败必须显式提示：静默失败的话，下次进页面又变回旧值，用户会以为界面在骗他
    showHint('保存失败，请稍后重试', 'error')
  } finally {
    saving.value = false
  }
}

/** 恢复默认：删掉团队的覆盖记录，回到 organazation.ts 里的那个人 */
async function resetApprover(row: ApproverDisplayRow) {
  try {
    await deleteGroupApproverOverride(row.group)
    await loadApprovers()
    showHint(`「${row.group}」已恢复为默认审批人`, 'success')
  } catch (error) {
    console.error('[roleSetting] 恢复默认失败:', error)
    showHint('恢复失败，请稍后重试', 'error')
  }
}

/** 恢复默认：删掉部门的覆盖记录（同部门下的团队一起回到默认） */
async function resetDeptApprover(row: ApproverDisplayRow) {
  try {
    await deleteDeptApproverOverride(row.parent)
    await loadApprovers()
    showHint(`「${row.parent}」已恢复为默认部门审批人`, 'success')
  } catch (error) {
    console.error('[roleSetting] 恢复部门审批人失败:', error)
    showHint('恢复失败，请稍后重试', 'error')
  }
}

/* ==================== 仓库（仓位）清单 ==================== */
/*
 * 与上面「团队 → 默认审批人」的差别：那边是**逐行覆盖**（默认值为主、只换个人），
 * 这里是**整表替换** —— 仓库要能新增、改名、删除，逐行覆盖表达不了"删掉某一项"。
 * 口径（见 utils/warehouse 的文件头）：维护表里有记录就完全以它为准，空表才用文件默认值。
 */

const warehouseRows = ref<WarehouseRow[]>([])
const warehouseCustom = ref(false)
const warehouseLoading = ref(false)
const warehouseSearch = ref('')
const warehouseHeaders = ref([
  { title: '序号', key: 'index', align: 'start' },
  { title: '仓库名', key: 'name', align: 'start' },
  { title: '上级分类', key: 'parent', align: 'start' },
  { title: '操作', key: 'action', align: 'center', sortable: false },
] as const)

/** 写失败时的提示：环境没准备好（没应用迁移）就把原因原样说出来，其余换成通用文案 */
function warehouseErrorHint(error: unknown): string {
  return error instanceof Error && error.name === WAREHOUSE_SETUP_ERROR
    ? error.message
    : '操作失败，请稍后重试'
}

/** 维护表读不出来（未应用迁移）时 `loadWarehouses` 会回落默认值，页面照常可用 */
async function loadWarehouseList() {
  warehouseLoading.value = true
  try {
    const res = await loadWarehouses()
    warehouseRows.value = res.rows
    warehouseCustom.value = res.custom
  } finally {
    warehouseLoading.value = false
  }
}

/** 上级分类的候选：清单里已出现过的（弹窗里是 combobox，可以直接写新的） */
const warehouseParents = computed(() => [...new Set(warehouseRows.value.map(r => r.parent))])

const warehouseDialog = ref(false)
/** 正在编辑的那一行；null = 新增 */
const warehouseEditing = ref<WarehouseRow | null>(null)
const warehouseDraft = ref<WarehouseRow>({ parent: '', name: '', index: 0 })
const warehouseSaving = ref(false)

function openWarehouseAdd() {
  warehouseEditing.value = null
  warehouseDraft.value = { parent: warehouseParents.value[0] ?? '', name: '', index: 0 }
  warehouseDialog.value = true
}

function openWarehouseEdit(row: WarehouseRow) {
  warehouseEditing.value = { ...row }
  warehouseDraft.value = { ...row }
  warehouseDialog.value = true
}

async function saveWarehouseDraft() {
  const editing = warehouseEditing.value
  // 改自己时不该跟"自己"判重：只有**其余行**参与重复检查（改成同分类同名会被拦下）
  const others = warehouseRows.value.filter(r => !editing || warehouseKey(r) !== warehouseKey(editing))
  const bad = findBadWarehouse(warehouseDraft.value, others)
  if (bad) {
    showHint(bad, 'warning')
    return
  }

  const next = cleanWarehouse(warehouseDraft.value)
  const list = editing
    ? warehouseRows.value.map(r => (warehouseKey(r) === warehouseKey(editing) ? next : r))
    : [...warehouseRows.value, next]

  warehouseSaving.value = true
  try {
    await saveWarehouses(list)
    await loadWarehouseList()
    warehouseDialog.value = false
    showHint(`「${next.parent} / ${next.name}」已保存`, 'success')
  } catch (error) {
    console.error('[roleSetting] 保存仓库失败:', error)
    // 与「换审批人」同理：写失败必须说出来，否则下次进页面又变回旧值
    showHint(warehouseErrorHint(error), 'error')
  } finally {
    warehouseSaving.value = false
  }
}

/*
 * 删除与「恢复默认」都动维护表，所以都要先确认。
 * 一个弹窗按 `confirmKind` 切换文案与动作，避免为两件"取消/确定"几乎一样的事写两套。
 */
const confirmKind = ref<'remove' | 'reset' | null>(null)
const confirmTarget = ref<WarehouseRow | null>(null)
const confirmLoading = ref(false)
const confirmOpen = computed({
  get: () => confirmKind.value !== null,
  set: (open: boolean) => {
    if (!open) {
      confirmKind.value = null
    }
  },
})

function askRemoveWarehouse(row: WarehouseRow) {
  // 只留一条时不给删：删掉最后一条 = 清空维护表 = 整份默认清单又回来，用户会以为界面在骗他
  if (warehouseRows.value.length <= 1) {
    showHint('至少要留一个仓库；想回到默认清单请点「恢复默认」', 'warning')
    return
  }
  confirmTarget.value = row
  confirmKind.value = 'remove'
}

function askResetWarehouses() {
  confirmTarget.value = null
  confirmKind.value = 'reset'
}

function closeConfirm() {
  confirmKind.value = null
  confirmTarget.value = null
}

async function runConfirm() {
  const kind = confirmKind.value
  const target = confirmTarget.value
  if (!kind) {
    return
  }
  confirmLoading.value = true
  try {
    if (kind === 'reset') {
      await resetWarehouses()
      showHint('已恢复为默认仓库清单', 'success')
    } else if (target) {
      const list = warehouseRows.value.filter(r => warehouseKey(r) !== warehouseKey(target))
      await saveWarehouses(list)
      showHint(`已删除「${target.parent} / ${target.name}」`, 'success')
    }
    await loadWarehouseList()
    closeConfirm()
  } catch (error) {
    console.error('[roleSetting] 仓库清单写入失败:', error)
    showHint(warehouseErrorHint(error), 'error')
  } finally {
    confirmLoading.value = false
  }
}

onMounted(() => {
  getDatas()
  loadApprovers()
  loadWarehouseList()
  document.body.classList.add('role-setting-page')
})

onBeforeUnmount(() => {
  document.body.classList.remove('role-setting-page')
})
</script>

<style scoped>
/* 可点选的角色卡片行 */
.role-option {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid rgba(28, 40, 72, 0.14);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
}

.role-option:hover {
  background-color: rgba(28, 40, 72, 0.04);
}

.role-option-active {
  border-color: rgb(var(--v-theme-primary));
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 7%, transparent);
}

.v-theme--dark .role-option {
  border-color: rgba(255, 255, 255, 0.16);
}

.v-theme--dark .role-option:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.v-theme--dark .role-option-active {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, transparent);
}

/* 角色权限格子 */
.perms-box {
  display: flex;
  flex-wrap: wrap;
  gap: 0 18px;
  background-color: rgba(127, 140, 170, 0.08);
  border: 1px solid rgba(127, 140, 170, 0.16);
  border-radius: 10px;
}

.v-theme--dark .perms-box {
  background-color: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.1);
}

.perms-checkbox {
  flex: 0 0 auto;
}

.role-radio :deep(.v-selection-control) {
  --v-selection-control-size: 20px;
}

.role-radio :deep(.v-selection-control__input) {
  font-size: 12px;
}

:deep(th.v-data-table__th--sortable.v-data-table-column--align-center .v-data-table-header__content) {
  box-sizing: border-box;
  padding-inline-start: 1em;
}

.approver-tree :deep(.org-sheet) {
  max-height: 420px;
}

/* 选中的那个人：主色淡底标出来（深浅色都用同一套 rgb(var(--v-theme-*)) 表达式） */
.picked-box {
  background-color: rgb(var(--v-theme-primary) / 7%);
  border: 1px solid rgb(var(--v-theme-primary) / 22%);
  border-radius: 10px;
}

:deep(.v-data-table-footer__items-per-page > .v-select .v-field__outline) {
  --v-field-border-opacity: 0.2;
}

:global(body.role-setting-page .v-select__content .v-list-item),
:global(body.role-setting-page .v-select__content .v-list-item-title),
:global(body.role-setting-page .v-select__content .v-list-item-subtitle),
:global(body.role-setting-page .v-combobox__content .v-list-item),
:global(body.role-setting-page .v-combobox__content .v-list-item-title),
:global(body.role-setting-page .v-combobox__content .v-list-item-subtitle) {
  font-size: 12px;
}
</style>

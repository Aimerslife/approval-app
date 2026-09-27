<template>
  <v-container class="page-bg px-6 pb-6 pt-10" fluid>
    <!-- 页头 -->
    <div class="mb-4 px-1">
      <div class="text-[20px] font-bold">角色设置</div>
      <div class="text-[12.5px] text-medium-emphasis mt-1">管理成员所属角色与权限，变更后对新审批单生效</div>
    </div>

    <!-- 成员表格卡片 -->
    <v-sheet border class="overflow-hidden" rounded="xl">
      <!-- 卡片工具栏：成员数 + 搜索 -->
      <div class="d-flex align-center flex-wrap ga-4 px-5 py-3">
        <div class="flex-grow-1">
          <span class="text-[13px] text-medium-emphasis">共
            <b class="text-primary">{{ data.length }}</b> 位成员</span>
        </div>

        <v-text-field
          v-model="search"
          density="compact"
          hide-details
          clearable
          label="搜索成员"
          prepend-inner-icon="mdi-magnify"
          single-line
          style="max-width: 300px"
          variant="outlined"
        />
      </div>

      <v-divider />

      <v-data-table
        v-model:page="page"
        density="compact"
        :headers="headers"
        hover
        :items="data"
        :items-per-page="itemsPerPage"
        :search="search"
      >
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
        <!-- 多个权限标签用 flex + gap 分隔：原来给每个标签加 mr-1，
                     最后一个的尾部外边距也计入行盒宽度，会把整格往左推（内容左偏 2px） -->
        <template #item.permission="{ value }">
          <div class="d-flex flex-wrap justify-center ga-1">
            <span v-for="item in rolePermission" :key="item.key" class="text-[12px] text-medium-emphasis">
              {{ item.title }}</span>
          </div>
        </template>
        <template #item.department="{ value }">
          <span class="text-[13px]">{{ value }}</span>
        </template>
        <template #item.status="{ value }">
          <v-chip
            :color="value === 1 ? 'success' : value === 2 ? 'warning' : 'error'"
            size="small"
            variant="tonal"
          >
            {{ value == 1 ? '通过' : value == 2 ? '驳回' : '待审批' }}
          </v-chip>
        </template>

        <template #item.action>
          <v-icon-btn
            color="primary"
            icon="mdi-shield-account-outline"
            size="30"
            title="权限变更"
            variant="tonal"
            @click="goEdit"
          >
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

    <!-- 组别 → 默认审批人：默认值在 utils/organazation.ts 里维护，这里负责展示与「换人」 -->
    <v-sheet border class="overflow-hidden mt-6" rounded="xl">
      <div class="d-flex align-center flex-wrap ga-4 px-5 py-3">
        <div class="flex-grow-1">
          <span class="text-[13px] text-medium-emphasis">共
            <b class="text-primary">{{ approverRows.length }}</b> 个组别</span>
          <span v-if="customCount" class="text-[12px] text-medium-emphasis ml-2">
            · 已改 <b class="text-primary">{{ customCount }}</b> 个</span>
          <span class="text-[12px] text-medium-emphasis ml-2">（默认值维护在 utils/organazation.ts；改过的显示为「已改」，可恢复默认）</span>
        </div>

        <v-text-field
          v-model="approverSearch"
          clearable
          density="compact"
          hide-details
          label="搜索组别 / 审批人"
          prepend-inner-icon="mdi-magnify"
          single-line
          style="max-width: 260px"
          variant="outlined"
        />
      </div>

      <v-divider />

      <v-data-table
        class="text-[12px]"
        density="compact"
        :headers="approverHeaders"
        hover
        :items="approverRows"
        :items-per-page="10"
        :items-per-page-options="[10, 20, 50]"
        :loading="approverLoading"
        :search="approverSearch"
      >
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

        <template #item.source="{ value }">
          <v-chip :color="value === 'custom' ? 'primary' : undefined" size="x-small" variant="tonal">
            {{ value === 'custom' ? '已改' : '默认' }}
          </v-chip>
        </template>

        <template #item.action="{ item }">
          <div class="d-flex justify-center ga-1">
            <v-btn color="primary" size="x-small" variant="tonal" @click="openPicker(item)">更换</v-btn>

            <v-btn
              v-if="item.source === 'custom'"
              size="x-small"
              variant="text"
              @click="resetApprover(item)"
            >恢复默认</v-btn>
          </div>
        </template>
      </v-data-table>
    </v-sheet>

    <!-- 更换默认审批人：直接复用「通讯录」（组织架构树） -->
    <v-dialog v-model="pickerOpen" max-width="900">
      <v-card class="overflow-hidden" rounded="xl">
        <v-card-title class="d-flex align-center justify-space-between px-6 py-4">
          <div class="d-flex align-center ga-2">
            <v-avatar color="primary" size="28" variant="tonal">
              <v-icon icon="mdi-account-switch-outline" size="16" />
            </v-avatar>
            <span class="text-[15px] font-bold">更换「{{ picking?.group }}」的默认审批人</span>
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
          <v-btn
            color="primary"
            :disabled="!picked"
            :loading="saving"
            variant="flat"
            @click="savePicked"
          >保存</v-btn>
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
          </span>

          <v-icon-btn icon="mdi-close" size="small" variant="text" @click="model = false" />
        </v-card-title>

        <v-divider />

        <v-card-text class="px-6 py-5">
          <div class="text-[grey] text-[12px] font-bold mb-1">目标角色</div>

          <v-radio-group v-model="currentRole" class="role-radio" hide-details>
            <div class="d-flex flex-column ga-2">
              <div
                v-for="r in roleList"
                :key="r.key"
                class="role-option"
                :class="{ 'role-option-active': currentRole === r.key }"
                @click="currentRole = r.key"
              >
                <v-radio
                  color="primary"
                  class="ma-0"
                  hide-details
                  :ripple="false"
                  :value="r.key"
                >
                  <template #label>
                    <div class="d-flex flex-column ml-2">
                      <span class="text-[13px] font-semibold">{{ r.title }}</span>
                      <span class="text-[12px] text-medium-emphasis">默认拥有 {{ r.permission.length }} 项权限</span>
                    </div>
                  </template>
                </v-radio>

                <v-spacer />

                <v-chip
                  v-if="currentRole === r.key"
                  color="primary"
                  label
                  size="x-small"
                  variant="tonal"
                >当前</v-chip>
              </div>
            </div>
          </v-radio-group>

          <div class="d-flex align-center justify-space-between mt-5 mb-2">
            <div class="text-[grey] text-[12px] font-bold mb-1">角色权限</div>

            <v-chip color="primary" density="compact" size="small" variant="tonal">
              {{ rolePermission.length }} 项
            </v-chip>
          </div>

          <div class="perms-box px-3 py-2">
            <v-checkbox
              v-for="p in rolePermission"
              :key="p.key"
              class="perms-checkbox"
              color="primary"
              density="compact"
              hide-details
              :model-value="true"
              readonly
            >
              <template #label>
                <span class="text-[13px]">{{ p.title }}</span>
              </template>
            </v-checkbox>
          </div>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-6 py-3">
          <v-spacer />

          <v-btn
            color="primary"
            rounded="lg"
            size="small"
            text="取消"
            variant="tonal"
            @click="model = false"
          />

          <v-btn
            color="primary"
            rounded="lg"
            size="small"
            text="确认变更"
            @click="handleUpdate"
          />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
<script lang="ts" setup>
  import OrgTree from '@/components/OrgTree.vue'
  import type { OrgSelectPayload, OrgSelectedUser } from '@/components/OrgTree.vue'
  import {
    deleteGroupApproverOverride,
    getGroupApproverOverrides,
    getUserInfo,
    saveGroupApprover,
    updateUserRole,
    type UserInfo,
  } from '@/utils/collection'
  import {
    countCustom,
    defaultGroupApproverRows,
    mergeGroupApprovers,
    type GroupApproverRow,
  } from '@/utils/groupApprovers'

  const currentRole = ref('')
  const data = ref<UserInfo[]>([])
  async function getDatas () {
    const res = await getUserInfo()
    data.value = res
    currentRole.value = res[0].role || 'normal'
    console.log(res)
  }
  const model = ref(false)
  const search = ref('')
  const page = ref(1)
  const itemsPerPage = ref(5)

  const roleList = ref([
    {
      key: 'superAdmin', title: '超级管理员', permission: [
        { key: 'manageApproval', title: '审批管理' },
        { key: 'manageUser', title: '用户管理' },
        { key: 'manageRole', title: '角色管理' },
        { key: 'manageProduct', title: '产品管理' },
        { key: 'manageApprovalFlow', title: '审批流管理' },
      ],
    },
    {
      key: 'approval', title: '审批人员', permission: [
        { key: 'viewApproval', title: '查看审批单' },
        { key: 'searchApproval', title: '搜索审批单' },
        { key: 'manageRole', title: '审批订单' },
      ],
    },
    {
      key: 'normal', title: '员工', permission: [
        { key: 'viewApproval', title: '查看审批单' },
        { key: 'searchApproval', title: '搜索审批单' },
      ],
    },
  ])
  const rolePermission = computed(() => {
    return roleList.value.find(item => item.key === currentRole.value)?.permission || []
  })
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

  /** 把角色 key 映射成中文名，查不到时原样展示 */
  function roleName (value: unknown): string {
    if (value == null) return '—'
    const hit = roleList.value.find(item => item.key === value)
    return hit ? hit.title : String(value)
  }

  /** 权限列可能是数组或字符串，统一转成可读文本 */
  function formatPermission (value: unknown): string {
    if (Array.isArray(value)) {
      const list = value
        .map(v => (typeof v === 'string' ? v : v?.title ?? ''))
        .filter(Boolean)
      return list.length > 0 ? list.join('、') : '—'
    }
    return value == null || value === '' ? '—' : String(value)
  }
  function handleUpdate () {
    updateUserRole(data.value[0].id, currentRole.value)
  }
  function goEdit () {
    model.value = true
  }

  /* ==================== 组别 → 默认审批人 ==================== */
  /*
   * 两个来源合并成一张表（合并口径见 utils/groupApprovers）：
   *   · 默认值 —— utils/organazation.ts 里人工维护的那份，改文件即刻生效；
   *   · 覆盖值 —— 本页通过通讯录换过的人，存在 PocketBase 的 group_approvers 表。
   * 「恢复默认」= 删掉那条覆盖记录。
   */

  /** 提示条：保存/恢复这类"改数据"的动作必须有明确反馈，不能静默 */
  const hint = ref<{ show: boolean, text: string, color: 'success' | 'error' | 'warning' }>({
    show: false,
    text: '',
    color: 'success',
  })
  function showHint (text: string, color: 'success' | 'error' | 'warning' = 'warning') {
    hint.value = { show: true, text, color }
  }

  const approverRows = ref<GroupApproverRow[]>([])
  const approverLoading = ref(false)
  const approverSearch = ref('')
  const approverHeaders = ref([
    { title: '上级部门', key: 'parent', align: 'start' },
    { title: '组别', key: 'group', align: 'start' },
    { title: '默认审批人', key: 'manager', align: 'start', sortable: false },
    { title: '来源', key: 'source', align: 'center' },
    { title: '操作', key: 'action', align: 'center', sortable: false },
  ] as const)
  const customCount = computed(() => countCustom(approverRows.value))

  /**
   * 拉覆盖值并与文件里的默认值合并。
   * 覆盖值读取失败时按"没有任何覆盖"处理（见 getGroupApproverOverrides），
   * 于是 PB 还没应用迁移时也能看到默认值，不至于整页白屏。
   */
  async function loadApprovers () {
    approverLoading.value = true
    try {
      const overrides = await getGroupApproverOverrides()
      approverRows.value = mergeGroupApprovers(defaultGroupApproverRows(), overrides)
    } finally {
      approverLoading.value = false
    }
  }

  const pickerOpen = ref(false)
  const picking = ref<GroupApproverRow | null>(null)
  const picked = ref<OrgSelectedUser | null>(null)
  const saving = ref(false)

  function openPicker (row: GroupApproverRow) {
    picking.value = row
    picked.value = null
    pickerOpen.value = true
  }

  /** 通讯录里只能选**人**：点到部门时忽略并提示，否则会把部门名当成审批人存进去 */
  function onOrgSelect (payload: OrgSelectPayload | null) {
    if (!payload) {
      return
    }
    if (payload.type !== 'user') {
      showHint('请在通讯录里点选成员，而不是部门')
      return
    }
    picked.value = payload.user
  }

  async function savePicked () {
    const row = picking.value
    const user = picked.value
    if (!row || !user) {
      return
    }
    saving.value = true
    try {
      await saveGroupApprover({
        group: row.group,
        parent: row.parent,
        manager: user.name,
        manager_email: user.email,
        manager_avatar: user.avatar,
        manager_department: user.department,
        manager_department_path: user.department_path,
      })
      await loadApprovers()
      pickerOpen.value = false
      showHint(`「${row.group}」的默认审批人已改为 ${user.name}`, 'success')
    } catch (error) {
      console.error('[roleSetting] 保存默认审批人失败:', error)
      // 失败必须显式提示：静默失败的话，下次进页面又变回旧值，用户会以为界面在骗他
      showHint('保存失败，请稍后重试', 'error')
    } finally {
      saving.value = false
    }
  }

  /** 恢复默认：删掉覆盖记录，回到 organazation.ts 里的那个人 */
  async function resetApprover (row: GroupApproverRow) {
    try {
      await deleteGroupApproverOverride(row.group)
      await loadApprovers()
      showHint(`「${row.group}」已恢复为默认审批人`, 'success')
    } catch (error) {
      console.error('[roleSetting] 恢复默认失败:', error)
      showHint('恢复失败，请稍后重试', 'error')
    }
  }

  onMounted(() => {
    getDatas()
    loadApprovers()
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

/* 缩小 radio 选框：Vuetify 中 radio 无 size prop，
   选框尺寸由 --v-selection-control-size 决定（compact 默认 28px），
   圆形图标为 svg 需随字号同步缩放，此处一并覆盖。 */
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

/* ===== 组别默认审批人：通讯录选择 ===== */
/*
 * 弹窗里给通讯录一个有界高度：OrgTree 内部是 flex 列 + 自己滚（.org-scroll），
 * 但它自带的 max-height 是 calc(100vh - 100px) —— 在弹窗里会高得离谱，这里收下来。
 */
.approver-tree :deep(.org-sheet) {
    max-height: 420px;
}

/* 选中的那个人：主色淡底标出来（深浅色都用同一套 rgb(var(--v-theme-*)) 表达式） */
.picked-box {
    background-color: rgb(var(--v-theme-primary) / 7%);
    border: 1px solid rgb(var(--v-theme-primary) / 22%);
    border-radius: 10px;
}
</style>

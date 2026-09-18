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
  import { getUserInfo, updateUserRole, type UserInfo } from '@/utils/collection'

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
  onMounted(() => {
    getDatas()
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
</style>

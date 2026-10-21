<template>
  <div class="d-inline-flex align-center gap-1">
    <v-btn size="small" variant="text" :disabled="disabled" @click="openPicker('cc')" prepend-icon="mdi-email-plus-outline">抄送</v-btn>
    <v-btn size="small" variant="text" :disabled="disabled" @click="openPicker('transfer')" prepend-icon="mdi-share-all-outline">转办
    </v-btn>
    <!-- 人员选择弹窗 -->
    <v-dialog v-model="showPicker" max-width="620">
      <v-card rounded="lg">
        <v-card-text class="pt-5 pb-2">
          <v-text-field v-model="keyword" clearable density="compact" class="mb-2" hide-details label="搜索姓名 / 邮箱"
            variant="outlined" />

          <v-tabs v-model="tab" class="mb-2" color="primary" density="compact" @update:model-value="cleanSelect">
            <v-tab value="dept">本部门</v-tab>
            <v-tab value="all">全部部门</v-tab>
          </v-tabs>

          <!-- 本部门成员：v-show 即时切换，避免 v-window 过渡动画导致的卡顿 -->
          <div v-show="tab === 'dept'">
            <v-sheet class="pa-2 rounded" style="max-height: 320px; overflow-y: auto;">
              <v-skeleton-loader v-if="deptLoading" type="list-item-two-line@4" />
              <v-alert v-else-if="deptError" class="ma-1 text-[13px]" density="compact" type="error" variant="tonal">
                {{ deptError }}
              </v-alert>

              <template v-else>
                <div class="text-[12px] text-grey mb-1 px-2">
                  {{ deptName }} · {{ filteredDeptUsers.length }} 人
                </div>

                <v-list-item v-for="u in filteredDeptUsers" :key="u.open_id" class="mb-1"
                  :class="{ 'bg-primary-lighten-5': isSelected(u) }" density="compact" rounded="lg"
                  @click="selectUser(u)">
                  <template #prepend>
                    <v-avatar size="30">
                      <v-img v-if="u.avatar" cover :src="u.avatar" />
                      <v-icon v-else>mdi-account</v-icon>
                    </v-avatar>
                  </template>

                  <v-list-item-title class="text-[13px]">
                    {{ u.name }}
                    <v-chip v-if="u.is_tenant_manager" class="ml-1" color="error" size="x-small"
                      variant="tonal">管理员</v-chip>

                    <v-chip v-if="u.is_leader" class="ml-1" color="warning" size="x-small" variant="tonal">负责人</v-chip>
                  </v-list-item-title>

                  <v-list-item-subtitle class="text-[12px]">{{ u.email || '—'}}</v-list-item-subtitle>
                </v-list-item>

                <div v-if="filteredDeptUsers.length === 0" class="text-[12px] text-grey pa-4 text-center">
                  {{ keyword.trim() ? `没有匹配「${keyword.trim()}」的成员` : '本部门暂无成员' }}
                </div>
              </template>
            </v-sheet>
          </div>

          <!-- 全部部门树：keyword 一并传下去，搜索才不只在本部门生效 -->
          <DepartmentNode v-show="tab === 'all'" ref="deptNodeRef" :keyword="keyword" @select="selectUser" />

          <!-- 选中人员：转办单选 / 抄送多选 -->
          <SelectedUsers :action="action" :users="selectedUsers" @remove="removeUser" />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn text="取消" variant="plain" @click="showPicker = false" />

          <v-btn color="primary" :disabled="action === 'transfer' ? !selectedUser : selectedCcUsers.length === 0"
            text="确定" variant="tonal" @click="confirm" />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { getDepartmentUsers, proxyAvatar, type UserBrief } from '@/api/api'
import { useUserStore } from '@/stores/user'
import DepartmentNode from '../DepartmentNode.vue'
import SelectedUsers from '../SelectedUsers.vue'

type Action = 'cc' | 'transfer'

/**
 * disabled：把「抄送 / 转办」两个入口一起置灰。
 *
 * 用在**不可再动这张单**的场景 —— 目前是「我的审批单」的历史板块（单已办结 / 已不在我这一环），
 * 那边只做查看，不应该再往流程里塞抄送人或转办。
 * 只置灰按钮、不隐藏：让人看得出现在有这两个能力，只是此刻不能用（避免误以为功能缺失）。
 */
withDefaults(defineProps<{ disabled?: boolean }>(), {
  disabled: false,
})

const emit = defineEmits<{ select: [payload: { action: Action, user: UserBrief }] }>()

const items = [
  { action: 'cc', title: '抄送', icon: 'mdi-email-outline', disabled: false },
  { action: 'transfer', title: '转办', icon: 'mdi-swap-horizontal', disabled: false },
] as const

const showPicker = ref(false)
const action = ref<Action>('cc')
const tab = ref('dept')
const keyword = ref('')
// 转办：单选
const selectedUser = ref<UserBrief | null>(null)
// 抄送：多选
const selectedCcUsers = ref<UserBrief[]>([])

const userStore = useUserStore()

// ---- 本部门成员 ----
const deptUsers = ref<UserBrief[]>([])
const deptName = ref('')
const deptLoading = ref(false)
const deptError = ref('')

// 全部部门树（DepartmentNode 子组件）
const deptNodeRef = ref<InstanceType<typeof DepartmentNode>>()

function openPicker(a: string) {
  if (a !== 'cc' && a !== 'transfer') return
  action.value = a
  selectedUser.value = null
  selectedCcUsers.value = []
  keyword.value = ''
  tab.value = 'dept'
  deptNodeRef.value?.reset()
  showPicker.value = true
  loadDeptUsers()
}

async function loadDeptUsers() {
  const openId = userStore.user?.open_id
  if (!openId) {
    deptError.value = '未获取到当前用户 open_id，请先通过飞书登录'
    return
  }
  deptLoading.value = true
  deptError.value = ''
  try {
    const res = await getDepartmentUsers(openId)
    deptName.value = res.data.department_name
    deptUsers.value = res.data.users.map(u => ({
      ...u,
      avatar: u.avatar ? proxyAvatar(u.avatar) : undefined,
    }))
  } catch (error: any) {
    deptError.value = error?.message || '加载部门成员失败'
  } finally {
    deptLoading.value = false
  }
}

const filteredDeptUsers = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return deptUsers.value
  return deptUsers.value.filter(u =>
    (u.name || '').toLowerCase().includes(kw) || (u.email || '').toLowerCase().includes(kw))
})

// 当前用户是否已选中（转办单选 / 抄送多选）
function isSelected(u: UserBrief) {
  if (action.value === 'transfer') {
    return selectedUser.value?.open_id === u.open_id
  }
  return selectedCcUsers.value.some(x => x.open_id === u.open_id)
}

function selectUser(u: UserBrief) {
  if (action.value === 'transfer') {
    selectedUser.value = { ...u }
  } else {
    const idx = selectedCcUsers.value.findIndex(x => x.open_id === u.open_id)
    if (idx === -1) {
      selectedCcUsers.value.push({ ...u })
    } else {
      selectedCcUsers.value.splice(idx, 1)
    }
  }
}
function cleanSelect(v: string) {
  if (v === 'dept') {
    selectedUser.value = null
  } else {
    selectedCcUsers.value = []
  }
}
// 从抄送多选列表中移除
function removeCc(openId: string) {
  selectedCcUsers.value = selectedCcUsers.value.filter(x => x.open_id !== openId)
}

// 转办：单个用户；抄送：多个用户
const selectedUsers = computed(() => {
  if (action.value === 'transfer') return selectedUser.value ? [selectedUser.value] : []
  return selectedCcUsers.value
})

function removeUser(openId: string) {
  if (action.value === 'transfer') selectedUser.value = null
  else removeCc(openId)
}

function confirm() {
  if (action.value === 'transfer') {
    if (!selectedUser.value) return
    emit('select', { action: 'transfer', user: { ...selectedUser.value } })
  } else {
    if (selectedCcUsers.value.length === 0) return
    // 抄送多选：每人发一条，父组件逐条展示
    for (const u of selectedCcUsers.value) {
      emit('select', { action: 'cc', user: { ...u } })
    }
  }
  showPicker.value = false
}
</script>

<template>
  <!--
    「删除全部历史审批单」的确认框。只提供弹窗，不带触发按钮 ——
    触发点是各页面自己摆的图标/按钮（home.vue 在「历史审批单」区块标题右侧），
    调用方式：deleteAllDialog.value?.open()。

    ⚠️ 弹窗里的权限判断只是界面礼貌，不是权限：approval_chain / approval_files 在
    PocketBase 里的 deleteRule 是空的（只有 superuser 能删），真正拦住人的是服务端
    （server/orderDelete.ts 拿调用者的 token 去问 PB 的 role）。绕过界面也删不掉东西。
  -->
  <v-dialog v-model="open" max-width="560" persistent>
    <v-card>
      <v-card-title class="text-error text-[15px] mt-5 mb--6">删除全部历史审批单</v-card-title>
      <v-card-text class="text-[13px]">
        <p class="mb-2">
          将<strong>永久删除全部已办结</strong>的审批单（通过 / 驳回）及其附件。
          <strong>进行中的单不会被删</strong>，但删掉的记录<strong>不可恢复</strong>。
        </p>
        <!-- 数字来自服务端的 dry-run 统计：删的是这一类，与表格上的筛选、当前页都无关 -->
        <div v-if="counting" class="text-[12px] text-medium-emphasis">正在统计…</div>
        <div v-else-if="targeted === 0" class="text-[12px] text-medium-emphasis">
          库里没有已办结的审批单，无需删除。
        </div>
        <div v-else-if="targeted !== null" class="text-[12px]">
          当前共 <strong class="text-error">{{ targeted }}</strong> 张历史审批单会被删除
          （统计的是全库，不受表格上的筛选影响）
        </div>

        <div v-else class="text-[12px] text-medium-emphasis">暂时拿不到要删除的数量。</div>

        <v-text-field v-model="confirmText" class="mt-3" density="compact" :disabled="deleting" hide-details
          label="输入「删除」以确认" variant="outlined" />
      </v-card-text>

      <v-card-actions class="px-4 pb-3">
        <v-spacer />

        <v-btn :disabled="deleting" variant="text" @click="open = false">取消</v-btn>

        <v-btn color="error" :disabled="confirmText !== CONFIRM_WORD || deleting || targeted === 0" :loading="deleting"
          variant="flat" @click="confirmDelete">
          确认删除
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { deleteHistoryOrders, type DeleteHistorySummary } from '@/api/api'
import { useUserStore } from '@/stores/user'
import { canAct } from '@/utils/permissions'

const emit = defineEmits<{
  /** 删完了（含"本来就一张都没有"）—— 页面据此重新取数 */
  deleted: [summary: DeleteHistorySummary]
  /** 失败：文案交回页面去弹（各页有自己的 snackbar） */
  error: [message: string]
}>()

const userStore = useUserStore()

/** 能不能删：走权限判定表，不在这里写死角色比较（与 DeleteOrderButton 同一档） */
const canDelete = computed(() => canAct(userStore.appRole, 'approval:delete'))

/**
 * 必须手动输入这两个字才能点确认。
 * 与「清空 BI 数据」（pages/setDatas）同一套：不可恢复的批量操作，
 * 不能给"手滑连点两下就没了"的机会。
 */
const CONFIRM_WORD = '删除'

const open = ref(false)
const counting = ref(false)
const deleting = ref(false)
const confirmText = ref('')
/** 将要删掉多少张（服务端 dry-run 数出来的；null = 还没拿到） */
const targeted = ref<number | null>(null)

/**
 * 打开确认框：先让服务端数一遍再把数字摆出来。
 *
 * 为什么不用页面上的历史审批单行数：那是一份筛过、且可能只加载了当前页的数据，
 * 而删除动作做的是"全库这一类"，用列表长度会给出一个偏小的、吓不到人的数字。
 */
async function openDialog() {
  // 图标点了才判权限（按钮在页面上，这里拦不住它被点到）
  if (!canDelete.value) {
    emit('error', '只有超级管理员可以删除历史审批单')
    return
  }
  confirmText.value = ''
  targeted.value = null
  counting.value = true
  open.value = true
  try {
    targeted.value = (await deleteHistoryOrders(true)).targeted
  } catch (error) {
    open.value = false
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    counting.value = false
  }
}

async function confirmDelete() {
  // 双保险：按钮已禁用，这里再判一次
  if (!canDelete.value || confirmText.value !== CONFIRM_WORD) {
    return
  }
  deleting.value = true
  try {
    const summary = await deleteHistoryOrders(false)
    open.value = false
    emit('deleted', summary)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    deleting.value = false
  }
}

defineExpose({ open: openDialog })
</script>

<template>
  <!--
    表格「操作」栏里的删除按钮。
    **只有超级管理员看得到**（判定表在 utils/permissions 的 approval:delete，别在这里写死角色比较）。

    ⚠️ 这只是**界面礼貌**，不是权限：approval_chain / approval_files 在 PocketBase 里的
    deleteRule 是空的（只有 superuser 能删），真正拦住人的是服务端
    （server/orderDelete.ts 拿调用者的 token 去问 PB 的 role）。所以这里即便被绕过也删不掉东西。
  -->
  <v-btn v-if="canDelete" color="error" variant="text" @click.stop="open = true">
    <span class="text-[13px]">删除</span>
  </v-btn>

  <v-dialog v-model="open" max-width="420">
    <v-card>
      <v-card-title class="text-[15px]">删除审批单</v-card-title>

      <v-card-text class="text-[13px]">
        确认删除审批单「{{ orderNo }}」吗？
        <div class="mt-2 text-medium-emphasis">
          会连同这张单的办理记录与附件一起删除，<strong>不可恢复</strong>。
        </div>
      </v-card-text>

      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <v-btn :disabled="deleting" variant="text" @click="open = false">取消</v-btn>
        <v-btn color="error" :loading="deleting" variant="flat" @click="confirmDelete">删除</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import { computed, ref } from 'vue'
  import { deleteApprovalOrder, type DeleteOrderSummary } from '@/api/api'
  import { usePendingStore } from '@/stores/pending'
  import { useUserStore } from '@/stores/user'
  import { canAct } from '@/utils/permissions'

  const props = defineProps<{
    /**
     * 表格行。只取用得上的三个字段（而不是整个 ApprovalRow）：
     * home.vue 与 mine.vue 的行类型不同，这里只管「删哪一条」。
     */
    row: { id: string, order_no?: string, status?: number }
  }>()

  const emit = defineEmits<{
    /** 删成功（含"它本来就已经不在了"）—— 页面据此重新取数 */
    deleted: [summary: DeleteOrderSummary]
    /** 失败：文案交回页面去弹（两个页面各有自己的 snackbar） */
    error: [message: string]
  }>()

  const userStore = useUserStore()
  const pendingStore = usePendingStore()

  /** 能不能删：走权限判定表，不在这里写死角色比较 */
  const canDelete = computed(() => canAct(userStore.appRole, 'approval:delete'))

  const open = ref(false)
  const deleting = ref(false)

  const orderNo = computed(() => props.row.order_no || props.row.id)

  async function confirmDelete () {
    deleting.value = true
    try {
      const summary = await deleteApprovalOrder(props.row.id)
      open.value = false
      // 侧边栏「我的审批单」的角标是另一份 COUNT 缓存，顺手刷一次，
      // 否则删完还挂着旧数字（要等一分钟的定时刷新才对）
      void pendingStore.refresh()
      emit('deleted', summary)
    } catch (error) {
      emit('error', error instanceof Error ? error.message : String(error))
    } finally {
      deleting.value = false
    }
  }
</script>

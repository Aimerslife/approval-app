<template>
  <!-- <v-sheet  rounded :elevation="1" class="p-2"> -->
  <v-timeline :direction="direction" truncate-line="both">
    <v-timeline-item
      v-for="(item, idx) in chain"
      :key="idx"
      dot-color="#1055C9"
      side="end"
      size="20"
    >
      <div v-for="(its, i) in item" :key="i" class="d-flex align-center mb-1 cursor-pointer" @click="send(its)">
        <v-avatar class="mr-3" size="25">
          <!-- 链路成员已瘦身（快照不带头像，见 types/approval 的 slimFlowMembers）：
               老单自带直显，新单按 open_id 从组织目录现查 -->
          <v-img v-if="its.avatar || avatarDir.avatarOf(its)" cover :src="its.avatar || avatarDir.avatarOf(its)" />
          <v-icon v-else size="20">mdi-account</v-icon>
        </v-avatar>

        <div class="text-[12px]">
          {{ its.name }}
          <v-chip class="ml-1" :color="its.type === 'manager' ? 'success' : 'primary'" size="x-small">{{
            its.type === 'manager' ? '审批' : '抄送' }} </v-chip>
        </div>
      </div>
    </v-timeline-item>
  </v-timeline>
  <!-- </v-sheet> -->
</template>
<script lang="ts" setup>
  import type { ApprovalChainItem } from '@/types/approval'
  // 成员目录：瘦身后的链路成员不带头像，按 open_id 现查（见 stores/avatarDirectory）
  import { useAvatarDirectory } from '@/stores/avatarDirectory'
  const avatarDir = useAvatarDirectory()
  void avatarDir.ensure()
  const emits = defineEmits<{
    send: [item: ApprovalChainItem]
  }>()
  withDefaults(defineProps<{
    chain: ApprovalChainItem[][]
    direction?: 'vertical' | 'horizontal'
  }>(), {
    direction: 'vertical',
  })
  function send (item: ApprovalChainItem) {
    emits('send', item)
  }
</script>

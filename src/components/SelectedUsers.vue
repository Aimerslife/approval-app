<template>
  <template v-if="users.length > 0">
    <!-- 多条展示时显示计数 -->
    <div v-if="users.length > 1" class="text-[12px] text-grey mt-2 mb-1 px-1">
      已选 {{ users.length }} 人
    </div>

    <v-sheet
      v-for="u in users"
      :key="u.open_id"
      :class="['mb-1 pa-2 rounded d-flex align-center', { 'bg-primary': action === 'transfer' }]"
    >
      <v-avatar class="mr-2" size="23">
        <v-img v-if="u.avatar" cover :src="u.avatar" />
        <v-icon v-else>mdi-account</v-icon>
      </v-avatar>

      <span class="text-[11px]">{{ u.name }}</span>
      <v-chip class="ml-2" color="primary" size="x-small" variant="tonal">{{ label }}</v-chip>
      <v-spacer />

      <v-btn
        density="compact"
        icon="mdi-close"
        size="x-small"
        variant="plain"
        @click="emit('remove', u.open_id)"
      />
    </v-sheet>
  </template>
</template>

<script setup lang="ts">
  import type { UserBrief } from '@/api/api'
  import { computed } from 'vue'

  const props = defineProps<{
    users: UserBrief[]
    action: 'transfer' | 'cc'
  }>()

  const emit = defineEmits<{ remove: [openId: string] }>()

  const label = computed(() => (props.action === 'transfer' ? '转办' : '抄送'))
</script>

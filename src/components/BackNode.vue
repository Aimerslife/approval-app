<template>
  <div class="d-flex align-center gap-1">
    <v-icon-btn size="20" @click="$router.back()" variant="text">
      <v-icon :icon="props.icon" size="20" />
    </v-icon-btn>
    <span class="text-[13px]">{{ props.title }}</span>
  </div>
</template>
<script lang="ts" setup>
  const props = withDefaults(defineProps<{
    icon?: string
    title?: string
  }>(), {
    icon: 'mdi-chevron-left',
    title: '回到首页',
  })
</script>

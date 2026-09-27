<template>
  <div class="zone-node" :style="zoneStyle">
    <!-- 分区也会当流程节点用（白板里「弃置流程」这类分区本身有出线、也有入线），
         没有连接点的话这些连线会找不到锚点、渲染不出来 -->
    <FlowHandles />

    <div v-if="data.label" class="zone-label" :style="{ borderColor: data.border }">
      {{ data.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import FlowHandles from './FlowHandles.vue'
  const props = defineProps<{ data: { label?: string, color: string, border?: string, width: number, height: number }, id: string }>()
  const zoneStyle = computed(() => ({
    width: `${props.data.width}px`,
    height: `${props.data.height}px`,
    background: props.data.color,
    border: `1.5px dashed ${props.data.border || 'var(--flow-edge)'}`,
  }))
</script>

<style lang="scss" scoped>
.zone-node {
  border-radius: 8px;
  pointer-events: none;
  position: relative;
}
.zone-label {
  position: absolute;
  top: -10px;
  left: 14px;
  background: var(--flow-surface);
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--flow-text);
  border-left: 3px solid var(--flow-edge-selected);
  line-height: 18px;
}
</style>

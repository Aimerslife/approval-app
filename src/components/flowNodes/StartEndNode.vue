<template>
  <div class="node start-end-node" :style="boxStyle">
    <FlowHandles />
    <div class="label">{{ data.label }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import FlowHandles from './FlowHandles.vue'

  const props = defineProps<{
    data: {
      label: string
      width?: number
      height?: number
      /** 底色；不给则用默认绿（起止节点的惯用色） */
      fill?: string
      /** 底色对应的可读文字色（生成器按亮度算好） */
      textColor?: string
    }
    id: string
    selected?: boolean
  }>()

  const boxStyle = computed(() => ({
    ...(props.data.width ? { width: `${props.data.width}px` } : {}),
    ...(props.data.height ? { minHeight: `${props.data.height}px` } : {}),
    background: props.data.fill ?? 'var(--flow-green-dot)',
    borderColor: props.data.fill ?? 'var(--flow-green-dot)',
    ...(props.data.textColor ? { color: props.data.textColor } : {}),
  }))
</script>

<style lang="scss" scoped>
.start-end-node {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 与 boxStyle 的默认底色同一个变量（原来两处都写死 22c55e，深色下不跟着变） */
  border: 1.5px solid var(--flow-green-dot);
  border-radius: 18px;
  padding: 8px 18px;
  min-width: 110px;
  text-align: center;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;

  .label {
    width: 100%;
    white-space: pre-line;
    line-height: 1.4;
  }
}
</style>

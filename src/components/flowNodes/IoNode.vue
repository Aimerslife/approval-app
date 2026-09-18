<template>
  <div class="node io-node" :class="`io-node--${shape}`" :style="boxStyle">
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
      fill?: string
      stroke?: string
      textColor?: string
      /** 外形：parallelogram（默认，输入输出）/ stadium（白板的圆角药丸） */
      shape?: 'parallelogram' | 'stadium'
    }
    id: string
    selected?: boolean
  }>()

  const shape = computed(() => props.data.shape ?? 'parallelogram')

  const boxStyle = computed(() => ({
    ...(props.data.width ? { width: `${props.data.width}px` } : {}),
    ...(props.data.height ? { minHeight: `${props.data.height}px` } : {}),
    ...(props.data.fill ? { background: props.data.fill } : {}),
    ...(props.data.stroke ? { borderColor: props.data.stroke } : {}),
    ...(props.data.textColor ? { color: props.data.textColor } : {}),
  }))
</script>

<style lang="scss" scoped>
.io-node {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--flow-surface);
  border: 1.5px solid var(--flow-edge);
  border-radius: 4px;
  padding: 10px 22px;
  min-width: 160px;
  text-align: center;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  color: var(--flow-text);
  font-size: 12px;
  font-weight: 500;

  .label {
    width: 100%;
    white-space: pre-line;
    line-height: 1.4;
  }

  // 平行四边形：输入 / 输出
  &--parallelogram {
    clip-path: polygon(15% 0, 100% 0, 85% 100%, 0 100%);
  }

  // 白板里大量「药丸」形状（流程结束、财务BP终判、自产/外购…）用它
  &--stadium {
    border-radius: 999px;
  }
}
</style>

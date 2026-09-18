<template>
  <div class="node process-node" :class="`process-node--${shape}`" :style="boxStyle">
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
    /** 白板原框尺寸：给了就按原样渲染（密集区域靠它才不会互相压住） */
    width?: number
    height?: number
    /** 白板填充 / 边框色；不给则跟随主题变量 */
    fill?: string
    stroke?: string
    /** 填充色对应的可读文字色（生成器按亮度算好，浅底深字、深底白字） */
    textColor?: string
    /** 外形：round（默认）/ rect / ellipse */
    shape?: 'round' | 'rect' | 'ellipse'
    /** 虚线边框（便签 / 备注类） */
    dashed?: boolean
  }
  id: string
  selected?: boolean
}>()

const shape = computed(() => props.data.shape ?? 'round')

/**
 * ⚠️ 宽度必须配 box-sizing: border-box（见样式）：白板给的是**外框**尺寸，
 * 按 content-box 渲染会多出 padding + border 的宽度，密集处立刻重叠。
 */
const boxStyle = computed(() => ({
  ...(props.data.width ? { width: `${props.data.width}px` } : {}),
  // 用 minHeight 而不是 height：字号比白板小，正常都能装下；万一装不下宁可长高，也不要裁字
  ...(props.data.height ? { minHeight: `${props.data.height}px` } : {}),
  ...(props.data.fill ? { background: props.data.fill } : {}),
  ...(props.data.stroke ? { borderColor: props.data.stroke } : {}),
  ...(props.data.dashed ? { borderStyle: 'dashed' } : {}),
  ...(props.data.textColor ? { color: props.data.textColor } : {}),
}))
</script>

<style lang="scss" scoped>
.process-node {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--flow-surface);
  border: 1.5px solid var(--flow-text-sub);
  border-radius: 6px;
  padding: 8px 14px;
  min-width: 110px;
  text-align: center;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  line-height: 1.4;
  color: var(--flow-text);
  font-size: 12px;
  font-weight: 500;

  // 保留换行（白板文案本身是多行的），同时允许自动折行
  .label {
    width: 100%;
    white-space: pre-line;
  }

  &--rect {
    border-radius: 0;
  }

  // 白板里的椭圆（如「已操作出库」）
  &--ellipse {
    border-radius: 50%;
  }
}
</style>

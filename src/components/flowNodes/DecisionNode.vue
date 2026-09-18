<template>
  <div class="node decision-node" :style="outerStyle">
    <FlowHandles />

    <div class="decision-node__inner" :style="innerStyle">
      <span class="label">{{ data.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import FlowHandles from './FlowHandles.vue'

  const props = defineProps<{
    data: {
      label: string
      /** 白板原框尺寸（菱形的外接矩形） */
      width?: number
      height?: number
      fill?: string
      stroke?: string
      textColor?: string
    }
    id: string
    selected?: boolean
  }>()

  /**
   * 用 clip-path 画菱形，而不是 `transform: rotate(45deg)`：
   * 旋转正方形的**外接包围盒**是边长的 √2 倍，而白板的坐标是按真实菱形外框量的 ——
   * 两者对不上会让整张图的相对位置全错（越往右下越偏）。
   * clip-path 的盒子就等于白板那个外框，坐标可以直接用。
   */
  const outerStyle = computed(() => ({
    width: `${props.data.width ?? 120}px`,
    height: `${props.data.height ?? 70}px`,
    // 描边没法直接画在 clip-path 上（会被一起裁掉）：外层铺描边色、内层铺填充色，
    // 两层用同一个菱形裁剪，露出的一圈就是描边
    background: props.data.stroke ?? '#facc15',
  }))

  const innerStyle = computed(() => ({
    background: props.data.fill ?? 'var(--flow-amber-soft)',
    color: props.data.textColor ?? 'var(--flow-text)',
  }))
</script>

<style lang="scss" scoped>
// 菱形裁剪，外层与内层用同一个：外层的 1.5px padding 露出来就是描边
.decision-node {
  position: relative;
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  padding: 1.5px;
}

.decision-node__inner {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.label {
  /* 菱形四角是空的：文字收在中间带里才不会压到斜边（也被 clip-path 裁掉） */
  padding: 0 24%;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  white-space: pre-line;
}
</style>

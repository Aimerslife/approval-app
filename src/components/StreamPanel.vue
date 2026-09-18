<template>
  <div class="stream-panel">
    <VueFlow
      v-model:edges="edges"
      v-model:nodes="nodes"
      class="vue-flow-wrapper"
      fit-view-on-init
      :max-zoom="1.5"
      :min-zoom="0.08"
      :node-types="nodeTypes"
      :pan-on-drag="true"
      :zoom-on-scroll="true"
    >
      <Background :gap="20" :pattern-color="isDark ? '#334155' : '#e5e7eb'" />
      <Controls />
      <MiniMap pannable zoomable />
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
  import { Background } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import {
    type Edge,
    MarkerType,
    type Node,
    type NodeTypesObject,
    VueFlow,
  } from '@vue-flow/core'
  import { MiniMap } from '@vue-flow/minimap'
  import { useTheme } from 'vuetify'
  // 流程数据由飞书白板快照转换而来 —— 改内容请改数据文件，别在这里手写节点：
  // 它带着原图的坐标 / 尺寸 / 配色 / 连接点方位，手改很快会和原图对不上。
  import { inventoryEdges, inventoryNodes } from '@/data/inventoryFlow'
  import DecisionNode from './flowNodes/DecisionNode.vue'
  import IoNode from './flowNodes/IoNode.vue'
  import ProcessNode from './flowNodes/ProcessNode.vue'
  import StartEndNode from './flowNodes/StartEndNode.vue'
  import ZoneNode from './flowNodes/ZoneNode.vue'
  import '@vue-flow/core/dist/style.css'
  import '@vue-flow/core/dist/theme-default.css'

  const nodeTypes = {
    process: ProcessNode,
    decision: DecisionNode,
    start: StartEndNode,
    end: StartEndNode,
    io: IoNode,
    zone: ZoneNode,
  } as NodeTypesObject

  // 拷贝一份：VueFlow 会往节点/连线上写运行时字段（选中态、尺寸等），
  // 直接引用模块级常量会把它们污染到下次挂载
  const nodes = ref<Node[]>([...inventoryNodes])
  const edges = ref<Edge[]>([...inventoryEdges])

  /** 连线与箭头是内联样式（CSS 变量盖不住），跟随主题改色 */
  const theme = useTheme()
  const isDark = computed(() => theme.global.name.value === 'dark')
  watch(
    isDark,
    dark => {
      const color = dark ? '#c9d1d9' : '#475569'
      edges.value = edges.value.map(e => ({
        ...e,
        style: { ...e.style, stroke: color },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      }))
    },
    { immediate: true },
  )
</script>

<style lang="scss" scoped>
.stream-panel {
  width: 100%;
  height: calc(100vh - 64px);
  background: var(--flow-canvas-bg);
}

.vue-flow-wrapper {
  width: 100%;
  height: 100%;
}

/*
 连接点只当锚点用：这张图每个节点有 8 个 Handle（四方位各一对 source/target，
 见 flowNodes/FlowHandles.vue），全部露出来会满屏小圆点。
 不能 display:none —— 那样 Vue Flow 量不到锚点位置，连线会飘。
*/
:deep(.vue-flow__handle) {
  opacity: 0;
  width: 1px;
  min-width: 1px;
  height: 1px;
  min-height: 1px;
  border: 0;
}

:deep(.vue-flow__node) {
  font-size: 12px;
}
</style>

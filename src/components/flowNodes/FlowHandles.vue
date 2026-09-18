<template>
  <!--
    每个方位都给 target / source 两个连接点：
    1) 需求里这张图有大量**横向**连线，只给上下两个点时，Vue Flow 会把它们绕成 U 形；
    2) source 与 target 必须用**不同的 id**：同一个 id 挂两个 Handle 时，
       Vue Flow 按 DOM 顺序取到的那个类型可能不对（连线会找不到锚点）。
    视觉上隐藏（见 StreamPanel 的 .vue-flow__handle），只作为连线锚点使用。
  -->
  <Handle v-for="h in HANDLES" :key="h.id" :id="h.id" :type="h.type" :position="h.position" />
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

/**
 * id 命名：`<方位>-<角色>`，方位 t/b/l/r，角色 s=source、t=target。
 * 与 src/data/inventoryFlow.ts 里 sourceHandle / targetHandle 的取值一一对应。
 */
const HANDLES = [
  { id: 't-t', type: 'target', position: Position.Top },
  { id: 't-s', type: 'source', position: Position.Top },
  { id: 'b-t', type: 'target', position: Position.Bottom },
  { id: 'b-s', type: 'source', position: Position.Bottom },
  { id: 'l-t', type: 'target', position: Position.Left },
  { id: 'l-s', type: 'source', position: Position.Left },
  { id: 'r-t', type: 'target', position: Position.Right },
  { id: 'r-s', type: 'source', position: Position.Right },
] as const
</script>

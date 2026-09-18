<template>
  <div class="start-end-node" :class="props.kind">
    <Handle v-if="props.kind === 'start'" :position="Position.Bottom" type="source" />
    <Handle v-else :position="Position.Top" type="target" />

    <div class="d-flex align-center ga-1">
      <span class="dot" />

      <span class="text-[12px] font-weight-medium">{{
        props.kind === 'start' ? '开始' : '结束'
      }}</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { Handle, Position } from '@vue-flow/core'

  const props = defineProps<{
    /** start / end */
    kind: 'start' | 'end'
  }>()
</script>

<style scoped>
.start-end-node {
    display: inline-flex;
    align-items: center;
    padding: 6px 16px;
    border-radius: 999px;
    border: 1px solid;
    font-size: 12px;
    line-height: 1;
    transition:
        box-shadow 0.18s ease,
        transform 0.18s ease;
}

/* hover 不做 translate 位移：节点移动会带着连接点一起跑，
   鼠标相对连接点发生偏移，容易抖动导致连线拉不出来 */

.start-end-node.start {
    background: var(--flow-green-soft);
    border-color: var(--flow-green-border);
    color: var(--flow-green-text);
}

.start-end-node.start:hover {
    box-shadow: 0 4px 12px rgb(5 150 105 / 12%);
}

.start-end-node.start .dot {
    background: var(--flow-green-dot);
}

.start-end-node.end {
    background: var(--flow-surface-sunken);
    border-color: var(--flow-border-strong);
    color: var(--flow-text-sub);
}

.start-end-node.end:hover {
    box-shadow: 0 4px 12px rgb(100 116 139 / 12%);
}

.start-end-node.end .dot {
    background: var(--flow-text-sub);
}

/* 状态圆点，比图标更简约 */
.dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: none;
}
</style>

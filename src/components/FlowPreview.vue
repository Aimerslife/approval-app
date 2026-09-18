<template>
  <div class="flow-preview" :style="{ height }">
    <VueFlow
      :id="flowId"
      v-model:edges="edges"
      v-model:nodes="nodes"
      :edges-focusable="false"
      :elements-selectable="false"
      :min-zoom="0.2"
      :max-zoom="1.6"
      :nodes-connectable="false"
      fit-view-on-init
      :nodes-draggable="false"
      :zoom-on-double-click="false"
    >
      <Background :gap="16" />
      <Controls v-if="controls" position="bottom-right" :show-interactive="false" />

      <template #node-start>
        <StartEndNode kind="start" />
      </template>

      <template #node-end>
        <StartEndNode kind="end" />
      </template>

      <template #node-approval="{ id, data }">
        <ApprovalNode :branches="getBranches(id)" :data="data" />
      </template>

      <template #node-condition="{ id }">
        <ConditionNode :branches="getBranches(id)" />
      </template>
      <!-- 手动拖拽曲线：按保存的弯点还原形状；预览态不渲染拖拽圆点 -->
      <template #edge-adjustable="edgeProps">
        <AdjustableEdge v-bind="(edgeProps as any)" :interactive="false" />
      </template>
    </VueFlow>
  </div>
</template>

<script lang="ts" setup>
  import type { ApprovalChain, ApprovalFlow, FlowGraph } from '@/types/approval'
  import { Background } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  /**
   * 只读流程图预览。
   *
   * 数据源优先级：
   *   1) graph —— 编辑器存的画布快照，可原样还原节点位置与条件分支；
   *   2) flow  —— 带分支的结构，拍平成线性后渲染（分支信息不在 flow 里，只能展示主路径）；
   *   3) chain —— 最老的线性数据，直接生成一条竖向流程。
   *
   * 只读：节点不可拖动、不可连线、不可选中，且不渲染删除 / 添加成员等编辑入口。
   */
  import { MarkerType, useVueFlow, VueFlow } from '@vue-flow/core'
  import AdjustableEdge from '@/components/flow/AdjustableEdge.vue'
  import ApprovalNode from '@/components/flow/ApprovalNode.vue'
  import ConditionNode from '@/components/flow/ConditionNode.vue'
  import StartEndNode from '@/components/flow/StartEndNode.vue'
  import { flowToChain, uid } from '@/types/approval'

  const props = withDefaults(
    defineProps<{
      /** 画布快照（优先） */
      graph?: FlowGraph | null
      /** 带分支的流程结构 */
      flow?: ApprovalFlow | null
      /** 线性审批链（旧数据） */
      chain?: ApprovalChain | null
      height?: string
      /** 大图预览时显示缩放控件 */
      controls?: boolean
    }>(),
    { height: '400px', controls: false },
  )

  /** 多实例共存时必须显式指定 id，否则 useVueFlow 与 VueFlow 组件拿到的不是同一个 store */
  const flowId = `flow-preview-${uid()}`
  const { fitView } = useVueFlow(flowId)

  const arrowMarker = { type: MarkerType.ArrowClosed, color: '#cbd5e1', width: 16, height: 16 }
  const nodes = ref<any[]>([])
  const edges = ref<any[]>([])

  /** 节点卡片要展示的该节点分支名，数据来自出边；目标为「结束」节点的分支标记 toEnd */
  function getBranches (nodeId: string) {
    return edges.value
      .filter(e => e.source === nodeId)
      .map(e => ({
        id: e.id,
        label: String(e.label ?? '').trim(),
        toEnd: nodes.value.some(n => n.id === e.target && n.type === 'end'),
      }))
  }

  /** 有画布快照：原样还原（深拷贝，避免预览态被写回模板数据） */
  function buildFromGraph (graph: FlowGraph) {
    nodes.value = graph.nodes.map(n => ({
      ...n,
      position: { ...n.position },
      data: n.data ? JSON.parse(JSON.stringify(n.data)) : undefined,
    }))
    edges.value = graph.edges.map(e => ({
      ...e,
      data: e.data ? JSON.parse(JSON.stringify(e.data)) : undefined,
      markerEnd: arrowMarker,
    }))
  }

  /** 无画布快照：把线性链铺成一条竖向流程（开始 → 各环节 → 结束） */
  function buildFromChain (chain: ApprovalChain | null | undefined) {
    const steps = (chain ?? []).filter(s => s.length)
    const GAP = 150
    nodes.value = [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      ...steps.map((members, i) => ({
        id: `step-${i}`,
        type: 'approval',
        position: { x: -28, y: GAP * (i + 1) },
        data: { title: `环节${i + 1}`, members: members.map(m => ({ ...m })) },
      })),
      { id: 'end', type: 'end', position: { x: 0, y: GAP * (steps.length + 1) } },
    ]
    const ids = ['start', ...steps.map((_, i) => `step-${i}`), 'end']
    edges.value = ids.slice(0, -1).map((id, i) => ({
      id: `e-${i}`,
      source: id,
      target: ids[i + 1],
      markerEnd: arrowMarker,
    }))
  }

  function rebuild () {
    if (props.graph?.nodes?.length) {
      buildFromGraph(props.graph)
      return
    }
    // flow 里没有分支落点信息，拍平后按线性渲染，保证旧模板也能看到流程
    const chain = props.chain?.length ? props.chain : (props.flow ? flowToChain(props.flow) : [])
    buildFromChain(chain)
  }

  watch(
    () => [props.graph, props.flow, props.chain],
    async () => {
      rebuild()
      await nextTick()
      // 节点尺寸由 ResizeObserver 上报，等一帧再 fit，否则会按 0 尺寸缩放
      setTimeout(() => fitView({ padding: 0.15 }), 60)
    },
    { deep: true, immediate: true },
  )
</script>

<style lang="scss">
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';

.flow-preview {
    position: relative;
    width: 100%;
    border: 1px solid var(--flow-canvas-border);
    border-radius: 8px;
    background: var(--flow-canvas-bg);
    overflow: hidden;
}

/* 只读预览：隐藏编辑态才有的入口，避免误操作 */
.flow-preview :deep(.del-btn),
.flow-preview :deep(.add-btn) {
    display: none;
}

/* 标题输入框只做展示，不接受输入 */
.flow-preview :deep(.node-title) {
    pointer-events: none;
}

.flow-preview :deep(.vue-flow__handle) {
    pointer-events: none;
    opacity: 0.45;
}
</style>

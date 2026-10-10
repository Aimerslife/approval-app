<template>
  <div ref="rootEl" class="flow-preview" :style="{ height }">
    <!--
      ⚠️ `v-if="ready"`：**等宿主定型之后才挂画布**（见脚本里 settleHost 的说明）。
      挂早了，vue-flow 量到的连接点会被祖先的缩放（Vuetify 弹窗开场是 scale(0.9)）一起缩小，
      线端就与节点上的连接点对不上，而且之后再也不会重量 —— 本仓库已在
      「组间轮询」卡片上实测过同一个坑（见 components/flow/LoopCardDialog.vue）。
    -->
    <VueFlow
      v-if="ready"
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

      <!-- 飞书提醒环：只读预览，复用审批节点卡片（kind=notify 只换配色与文案） -->
      <template #node-notify="{ id, data }">
        <ApprovalNode :branches="getBranches(id)" :data="data" kind="notify" />
      </template>

      <!--
        数据查询环：直接复用编辑器里那张卡片（集合 / 条件 / 两条出边名都看得到）。
        ⚠️ 必须注册，否则 vue-flow 会拿**默认渲染器**去画它 —— 默认渲染器只认 data.label，
        我们这个节点没有 label，于是一个空白灰块（"有些模板显示不了"就是这么来的）。
      -->
      <template #node-probe="{ id, data }">
        <ProbeNode :branches="getBranches(id)" :probe="probeOf(data)" :title="data?.title" />
      </template>

      <!-- 组间轮询卡片：同上（轮询条件 + 内部有几个环节）。内部子流程在树形预览里不展开 -->
      <template #node-loop="{ data }">
        <LoopCardNode :data="data" :outer-approvals="outerApprovals" />
      </template>

      <!--
        引用模板卡片：只显示"引用了哪张模板"。被引用的那段流程**不在本图里**
        （内容只有一份，在源模板里），所以预览里也不展开 —— 与轮询卡片同款处理。
      -->
      <template #node-ref="{ id, data }">
        <RefCardNode :branches="getBranches(id)" :data="data" readonly />
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
   * ⚠️ 编辑器新增节点类型时，**必须**在这里补一个 `#node-xxx`（并引它的组件）：
   *    vue-flow 对没注册的 type 会退回**默认渲染器**，而默认渲染器只认 `data.label` ——
   *    我们的节点都没有 label，于是就画成一块空白（"有些模板显示不全"就是这么来的，
   *    踩过：加了「数据查询」「组间轮询」之后漏在这里补）。
   *    当前已注册：start / end / approval / condition / notify / probe / loop / ref。
   *
   * 只读：节点不可拖动、不可连线、不可选中，且不渲染删除 / 添加成员等编辑入口。
   */
  import { MarkerType, useVueFlow, VueFlow } from '@vue-flow/core'
  import AdjustableEdge from '@/components/flow/AdjustableEdge.vue'
  import ApprovalNode from '@/components/flow/ApprovalNode.vue'
  import ConditionNode from '@/components/flow/ConditionNode.vue'
  // 「组间轮询」卡片与「数据查询」环：与编辑器同一批组件，预览态靠 CSS 关掉交互（见 style）
  import LoopCardNode from '@/components/flow/LoopCardNode.vue'
  import ProbeNode from '@/components/flow/ProbeNode.vue'
  // 「引用模板」卡片：只读展示（传 readonly，不渲染下拉与删除按钮）
  import RefCardNode from '@/components/flow/RefCardNode.vue'
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

  /**
   * 「组间轮询」卡片上「轮完走向」下拉的候选：与 createStream 同一口径
   * （卡片外、能到达的审批 / 提醒环节）。
   *
   * 预览态**并没有**交互（卡片 body 的 pointer-events 被关掉了），这里传候选只为一件事：
   * 那个下拉的值存的是**节点 id**，没有候选时它会显示成一个空框 ——
   * 看着像"没配置"，其实人家配了。给了候选才能显示出环节名。
   */
  const outerApprovals = computed(() => nodes.value
    .filter(n => n.type === 'approval' || n.type === 'notify')
    .map(n => ({ id: String(n.id), label: String(n.data?.title ?? '未命名环节') })))

  /** 预览容器（测宿主是否还在缩放动画中，见 hostTransformed） */
  const rootEl = ref<HTMLElement | null>(null)
  /** 画布能不能挂：宿主定型之前不挂，否则连接点会量偏（见 settleHost） */
  const ready = ref(false)

  /**
   * 祖先链上是不是还有 `transform`（Vuetify 弹窗开场是 `scale(0.9)` → `1`）。
   *
   * 只往上找、不往下看：vue-flow 自己的变换层 `.vue-flow__transformationpane` 在预览**内部**，
   * 它的 transform 正是连接点所用的坐标系，必须算数。
   */
  function hostTransformed (): boolean {
    for (let el = rootEl.value?.parentElement; el && el !== document.body; el = el.parentElement) {
      const { transform } = getComputedStyle(el)
      if (transform && transform !== 'none') {
        return true
      }
    }
    return false
  }

  /**
   * 等宿主定型（一帧帧看到祖先的 transform 消失为止，最多等 1s）。
   *
   * 为什么必须等 —— 线与节点的**连接处偏移**就是这么来的：
   * vue-flow 算连接点用的是 `getBoundingClientRect()` 的**差值**，而祖先上若有 scale，
   * 这个差值会跟着一起缩小；节点尺寸却是 `offsetWidth`（不受 transform 影响）——
   * 两者一混，线端就往节点的左上方偏，偏差与节点尺寸成正比
   * （实测 300px 卡片约 19px，正好是弹窗开场的 scale(0.9)）。
   * 更麻烦的是**偏了就一直偏**：vue-flow 只在节点尺寸变化时才重量，动画结束后尺寸没变、不会重算。
   *
   * 与 LoopCardDialog 同一套结论（那里是 `@after-enter` + `v-if="canvasReady"`，实测线端与圆点完全一致）；
   * 这里换成自己判断宿主是否还在动，所以预览放进抽屉 / 普通页面也照样对。
   */
  async function settleHost () {
    const started = Date.now()
    while (hostTransformed() && Date.now() - started < 1000) {
      // rAF 逐帧等：进场缩放是 CSS 过渡，没有可靠的"结束"事件可监听
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
  }

  /** 等一帧再 fit：节点尺寸由 ResizeObserver 上报，立刻 fit 会按 0 尺寸缩放 */
  function fitSoon (delay = 60) {
    setTimeout(() => fitView({ padding: 0.15 }), delay)
  }

  /**
   * 「数据查询」环的配置；缺了给个空壳。
   *
   * 与 createStream 的 probeDataOf 同一套口径，但那边的空壳会**补写**回 data
   * （编辑器要就地改它）；预览只读，所以这里不写回快照，共用一个空壳即可。
   */
  const EMPTY_PROBE = { collection: '', filter: '' }
  function probeOf (data: any) {
    return data?.probe ?? EMPTY_PROBE
  }

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
      fitSoon()
    },
    { deep: true, immediate: true },
  )

  /*
   * 挂载时机：等宿主（弹窗 / 抽屉）的缩放进场动画走完，再挂 vue-flow 量连接点 ——
   * 见 settleHost 的说明。数据可以在此之前就摆好（上面那个 watch 是 immediate 的），
   * 画布一挂上就带着当前这份 nodes/edges（v-model 负责初始化）。
   */
  onMounted(async () => {
    await settleHost()
    ready.value = true
    await nextTick()
    fitSoon()
  })
</script>

<!--
  ⚠️ vue-flow 的三份样式**必须单独放一个不带 scoped 的块**（与 createStream 同一写法）。

  写成 `<style lang="scss" scoped>` 里 @import 会坏掉，而且**看不出报错**：
  Sass 先把 @import 的内容**内联**进这个块，之后 Vue 再统一给规则加 `[data-v-xxx]`，
  编译产物就成了 `.vue-flow__node[data-v-xxx] { ... }` —— 而 `.vue-flow__node` /
  `.vue-flow__pane` / `.vue-flow__edge` 这些类落在 **VueFlow 组件内部**的元素上，
  拿不到本组件的标记（只有子组件的**根**元素才继承父组件的标记，所以只有 `.vue-flow` 那条还生效）。
  结果是节点定位、连线图层、连接点尺寸全丢 —— 预览看着**一片空白**。
  编辑器的画布之所以正常，是因为 createStream 那份导入本来就**没有** scoped。

  预览页不会加载编辑器的那份全局样式（不同路由），所以这里的 scoped 直接等于"没有样式"。
-->
<style lang="scss">
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';
</style>

<style lang="scss" scoped>
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

/*
 * 「组间轮询」卡片 / 「数据查询」环：预览态**只读**。
 * 它们的 body 里全是编辑控件（输入框、下拉、开悬浮窗的按钮），不禁用就能改到预览用的那份
 * 深拷贝上 —— 看着像"改了模板"，其实只是本地副本，最迷惑人。
 * 不用 `disabled`：那会让值发灰、更像坏了；这里只是不给点。
 */
.flow-preview :deep(.loop-card .node-body),
.flow-preview :deep(.probe-node .node-body) {
    pointer-events: none;
}

/* 这两张卡片里"点击填写…"的虚线框：预览里点不了，就别装作能点 */
.flow-preview :deep(.probe-filter),
.flow-preview :deep(.rotation-filter) {
    border-style: solid;
    cursor: default;
}

.flow-preview :deep(.vue-flow__handle) {
    pointer-events: none;
    opacity: 0.45;
}
</style>

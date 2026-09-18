<template>
  <!-- 无弯点：默认贝塞尔；有弯点：曲线两端锚定、中段跟随弯点，可自由绕开其他连线 -->
  <BaseEdge
    :id="id"
    :label="label"
    :label-x="labelX"
    :label-y="labelY"
    :marker-end="markerEnd"
    :path="path"
    :label-style="labelStyle"
    :label-show-bg="labelShowBg"
    :label-bg-style="labelBgStyle"
    :label-bg-padding="labelBgPadding"
    :label-bg-border-radius="labelBgBorderRadius"
  />

  <!-- 拖拽弯点：只在编辑器中渲染；双击复位（恢复自动曲线）。
         注意：vue-flow 默认 .vue-flow__edge { pointer-events: visibleStroke }，
         会让圆点只有描边可点击、几乎拖不动，必须显式覆盖为 all，
         另加一个 12px 透明热区扩大可抓范围 -->
  <g
    v-if="interactive"
    class="edge-cp-group nodrag"
    :class="{ dragging }"
    title="拖动调整连线走向；双击复位"
    @dblclick.stop="onReset"
    @pointerdown.stop.prevent="onDown"
  >
    <circle class="edge-cp-hit" :cx="handleX" :cy="handleY" r="12" />
    <circle class="edge-cp" :cx="handleX" :cy="handleY" r="5" />
  </g>
</template>

<script lang="ts" setup>
  import { BaseEdge, getBezierPath, Position, useVueFlow } from '@vue-flow/core'
  /**
   * 手动可调曲线（自定义 edge 类型 'adjustable'）：
   * - 没有弯点时与默认贝塞尔一致（曲率沿用 pathOptions.curvature）；
   * - 拖动线中点的小圆点即把该点记录为弯点（edge.data.cp，随画布快照持久化），
   *   曲线变为「起点 → 弯点 → 终点」的三次曲线，可手动绕开交叉区域；
   * - 双击圆点清除弯点，恢复自动曲线；
   * - 预览页以 interactive=false 复用：按保存的弯点还原形状，但不渲染拖拽圆点。
   *
   * 拖动实现要点（为什么不用元素上的 pointer capture）：
   * - pointermove / pointerup 直接挂在 window 上，拖动过程中任何 DOM 重渲染都不会丢事件；
   * - 拖动期间用本地 dragCp 立即渲染，不依赖「父组件改 data → store → 回传 props」的响应式回环；
   * - 弯点同时写入 store 里的 edge.data.cp（与渲染同一对象）并 emit 给父级，保证保存到快照。
   */
  import { computed, onBeforeUnmount, ref } from 'vue'

  const props = withDefaults(
    defineProps<{
      id: string
      sourceX: number
      sourceY: number
      targetX: number
      targetY: number
      sourcePosition?: Position
      targetPosition?: Position
      label?: any
      markerEnd?: string
      /** 贝塞尔曲率（pathOptions.curvature 透传） */
      curvature?: number
      /** 连线 data：弯点存放在 data.cp */
      data?: { cp?: { x: number, y: number } } | null
      /** 是否渲染拖拽圆点（编辑器 true / 预览 false） */
      interactive?: boolean
      labelStyle?: Record<string, any>
      labelShowBg?: boolean
      labelBgStyle?: Record<string, any>
      labelBgPadding?: [number, number]
      labelBgBorderRadius?: number
    }>(),
    {
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      curvature: 0.25,
      interactive: true,
    },
  )

  const emit = defineEmits<{
    /** 拖拽中/结束时上报新弯点；null 表示复位 */
    'update:cp': [cp: { x: number, y: number } | null]
  }>()

  const { screenToFlowCoordinate, findEdge } = useVueFlow()

  const dragging = ref(false)
  /** 拖动期间的本地弯点：立即驱动渲染，松手后由 props.data.cp 接管 */
  const dragCp = ref<{ x: number, y: number } | null>(null)

  /** 当前生效的弯点：拖动中优先本地值 */
  const cp = computed(() => dragCp.value ?? props.data?.cp ?? null)

  /** 无弯点时圆点落在自动曲线中点，拖起来手感自然 */
  const autoPath = computed(() => {
    const [d, lx, ly] = getBezierPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      sourcePosition: props.sourcePosition,
      targetX: props.targetX,
      targetY: props.targetY,
      targetPosition: props.targetPosition,
      curvature: props.curvature,
    })
    return { d, lx, ly }
  })

  /**
   * 有弯点时画「必过弯点」的二次贝塞尔：
   * 控制点 C = 2·弯点 − (起点+终点)/2，则曲线在 t=0.5 处恰好等于弯点，
   * 拖动圆点时曲线始终精确穿过圆点，不会脱节。
   */
  const path = computed(() => {
    if (!cp.value) return autoPath.value.d
    const sx = props.sourceX
    const sy = props.sourceY
    const tx = props.targetX
    const ty = props.targetY
    const cpx = 2 * cp.value.x - (sx + tx) / 2
    const cpy = 2 * cp.value.y - (sy + ty) / 2
    return `M${sx},${sy} Q${cpx},${cpy} ${tx},${ty}`
  })

  /** 标签放在弯点正下方（圆点在曲线上，标签下移避免盖住圆点） */
  const labelX = computed(() => (cp.value ? cp.value.x : autoPath.value.lx))
  const labelY = computed(() => (cp.value ? cp.value.y + 20 : autoPath.value.ly))

  const handleX = computed(() => cp.value?.x ?? autoPath.value.lx)
  const handleY = computed(() => cp.value?.y ?? autoPath.value.ly)

  /** 写弯点：store 里的 edge 与渲染是同一对象，直接改立即生效；再 emit 给父级做持久化 */
  function applyCp (p: { x: number, y: number } | null) {
    const edge = findEdge(props.id)
    if (edge) {
      if (!edge.data) edge.data = {}
      if (p) edge.data.cp = p
      else delete edge.data.cp
    }
    emit('update:cp', p)
  }

  function toFlow (ev: PointerEvent) {
    return screenToFlowCoordinate({ x: ev.clientX, y: ev.clientY })
  }

  function onDown (ev: PointerEvent) {
    if (ev.button !== 0) return
    dragging.value = true
    dragCp.value = { x: handleX.value, y: handleY.value }
    window.addEventListener('pointermove', onWinMove)
    window.addEventListener('pointerup', onWinUp)
    window.addEventListener('pointercancel', onWinUp)
  }

  function onWinMove (ev: PointerEvent) {
    if (!dragging.value) return
    const p = toFlow(ev)
    dragCp.value = p
    applyCp(p)
  }

  function onWinUp (ev: PointerEvent) {
    window.removeEventListener('pointermove', onWinMove)
    window.removeEventListener('pointerup', onWinUp)
    window.removeEventListener('pointercancel', onWinUp)
    if (!dragging.value) return
    dragging.value = false
    applyCp(toFlow(ev))
    dragCp.value = null
  }

  function onReset () {
    dragCp.value = null
    applyCp(null)
  }

  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onWinMove)
    window.removeEventListener('pointerup', onWinUp)
    window.removeEventListener('pointercancel', onWinUp)
  })
</script>

<style scoped>
/* 覆盖 .vue-flow__edge 的 pointer-events: visibleStroke，否则只有描边可点击 */
.edge-cp-group {
    cursor: grab;
}

.edge-cp-group.dragging {
    cursor: grabbing;
}

/* 透明热区：唯一接收指针事件的元素（12px 半径，好抓取） */
.edge-cp-hit {
    fill: transparent;
    pointer-events: all;
    touch-action: none;
}

.edge-cp {
    fill: #fff;
    stroke: #f59e0b;
    stroke-width: 1.5;
    pointer-events: none;
    opacity: 0.55;
    transition: opacity 0.15s ease;
}

.edge-cp-group:hover .edge-cp,
.edge-cp-group.dragging .edge-cp {
    opacity: 1;
}
</style>

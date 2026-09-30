/**
 * 连线的「形状」候选与读写口径 —— **主画布与卡片内部画布共用这一份**。
 *
 * 为什么要抽出来：形状选择器原先只写在 `pages/createStream.vue` 里，卡片内部画布
 * 完全没有它；而两处若各写一份清单，迟早会出现"主画布有 5 种、卡片里少一种/名字不同"，
 * 这种不一致只在用户点开时才发现。放一处，两边 import 同一个常量。
 *
 * 值就是 vue-flow 的**内置连线类型**（`edge.type`），另外加一个项目自定义的 `adjustable`
 * （见 components/flow/AdjustableEdge.vue：可拖动弯点的曲线）：
 *   · `default`    贝塞尔曲线，曲率由 `pathOptions.curvature` 控制（vue-flow 默认 0.25）
 *   · `adjustable` 手动拖拽曲线，弯点存在 `edge.data.cp`
 *   · `smoothstep` 圆角折线，圆角由 `pathOptions.borderRadius` 控制（vue-flow 默认 5）
 *   · `step`       直角折线
 *   · `straight`   直线
 *
 * 形状只影响**画布上怎么画**，不参与流程语义（分支条件 / 走向都另存于 `edge.data`），
 * 所以它随画布快照持久化即可，引擎侧完全不需要知道（见 pages/createStream.vue 的 serializeGraph）。
 */

export interface EdgeStyleOption {
  /** 写入 `edge.type` 的值；`default` 会写成 `undefined`（vue-flow 的缺省类型） */
  value: string
  label: string
}

/** 五种连线形状（顺序即下拉里的顺序） */
export const EDGE_STYLES: EdgeStyleOption[] = [
  { value: 'default', label: '贝塞尔（弯曲）' },
  { value: 'adjustable', label: '手动拖拽曲线' },
  { value: 'smoothstep', label: '圆角折线' },
  { value: 'step', label: '直角折线' },
  { value: 'straight', label: '直线' },
]

/** 贝塞尔曲率默认值（vue-flow 默认 0.25） */
export const DEFAULT_EDGE_CURVATURE = 0.25

/** 圆角折线的圆角半径默认值（px，vue-flow 默认 5） */
export const DEFAULT_EDGE_BORDER_RADIUS = 5

/**
 * 把"形状"写进连线。
 *
 * `default` 要写成 `undefined` 而不是字符串 `'default'`：vue-flow 的缺省类型名就是 `default`，
 * 但在 edge 上显式留 `undefined` 更干净（序列化时不会写进库，旧数据的读法也一致）。
 */
export function applyEdgeShape (edge: { type?: string } | null | undefined, value: string) {
  if (!edge) {
    return
  }
  edge.type = value === 'default' ? undefined : value
}

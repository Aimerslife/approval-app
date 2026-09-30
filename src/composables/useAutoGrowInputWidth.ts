import { ref, type Ref, watchEffect } from 'vue'

/**
 * 让输入框**宽度随内容增长**，但**不越过上限** —— 即"最多不超过一行"。
 *
 * 为什么不用字符数估算：中英混排 + 比例字体下，"iii" 与 "国国国" 字符数相同、宽度差一倍，
 * 估算不是偏宽就是偏窄。这里用 canvas 的 measureText 量**真实文本宽度**，字体取该输入框
 * **当前渲染字体**（getComputedStyle）—— 量出来是多少就是多少。
 *
 * 宽度 = 文本宽 + 左右 padding + 左右 border + 2px 余量（光标位）。
 * padding / border 都是**问浏览器要的真实值**，所以不依赖 box-sizing 是 border-box 还是 content-box。
 *
 * 超过上限就停在上限，多出来的内容由输入框自己横向滚动；内容为空时按 placeholder 量，
 * 避免占位提示被截断。
 *
 * 用法（记得给输入框加 ref）：
 * ```vue
 * <input ref="el" v-model="draft" :style="{ width: width + 'px' }">
 * const el = ref<HTMLInputElement | null>(null)
 * const width = useAutoGrowInputWidth(el, () => draft.value || '占位文案', { min: 140, max: 300 })
 * ```
 * ⚠️ 输入框若是 flex 子项且 `flex: 1`（会被拉满），得先改成 `flex: none`，否则宽度不生效。
 */
export function useAutoGrowInputWidth (
  el: Ref<HTMLInputElement | null>,
  text: () => string,
  options: { min?: number, max?: number } = {},
) {
  const { min = 120, max = 320 } = options
  const width = ref(min)
  let ctx: CanvasRenderingContext2D | null = null

  /** 量一段文本在当前字体下的宽度（px） */
  function measure (s: string, node: HTMLElement): number {
    if (!ctx) {
      ctx = document.createElement('canvas').getContext('2d')
    }
    if (!ctx) {
      return 0
    }
    const cs = getComputedStyle(node)
    // canvas 的 font 语法与 CSS 的 font 简写一致；字号/字体族一定要带上，否则量出来是默认字体
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    return ctx.measureText(s).width
  }

  // 依赖：输入框元素（挂载 / 切换连线时变化）+ 文本（打字时变化）
  watchEffect(() => {
    const node = el.value
    if (!node || typeof document === 'undefined') {
      return
    }
    const cs = getComputedStyle(node)
    const chrome
      = (Number.parseFloat(cs.paddingLeft) || 0)
        + (Number.parseFloat(cs.paddingRight) || 0)
        + (Number.parseFloat(cs.borderLeftWidth) || 0)
        + (Number.parseFloat(cs.borderRightWidth) || 0)
    const wanted = Math.ceil(measure(text(), node)) + chrome + 2
    width.value = Math.min(max, Math.max(min, wanted))
  })

  return width
}

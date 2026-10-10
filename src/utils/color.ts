/**
 * 颜色工具：动态色阶生成 + 可读文字色计算。
 *
 * 审批链步骤数不固定（length 动态），写死一组固定档位会导致：
 *   - 步骤数超过档位数 → 取到 undefined，样式静默失效
 *   - 步骤数远小于档位数 → 只用前几档，色阶拉不开
 * 因此这里按 HSL 亮度插值**动态生成**色阶，并为每档背景
 * 自动匹配一个达到 WCAG AA(4.5:1) 的文字色。
 */

/** 品牌主色 #1055C9 的 HSL 分量（h: 218°, s: 85%, l: 43%） */
export const BRAND_H = 218
export const BRAND_S = 85
export const BRAND_L = 43
export const BRAND_COLOR = '#1055C9'

/** 色阶亮度区间（HSL 的 L，百分比）：最浅 → 最深 */
const L_SHALLOWEST = 92
const L_DEEPEST = 26

/** 前景色候选：浅底用近黑蓝，深底用纯白 */
const DARK_TEXT = '#061529'
const LIGHT_TEXT = '#FFFFFF'

/** WCAG AA 正文最低对比度 */
export const AA_RATIO = 4.5

// ============ 颜色空间转换 ============

/** HEX → RGB（0-255） */
export function hexToRgb (hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim()
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ]
}

function rgbToHex (r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

/** HEX → HSL（h: 0-360，s / l: 0-100） */
export function hexToHsl (hex: string): { h: number, s: number, l: number } {
  const [r255, g255, b255] = hexToRgb(hex)
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) {
    return { h: 0, s: 0, l: l * 100 }
  }

  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) {
    h = ((g - b) / d) % 6
  } else if (max === g) {
    h = (b - r) / d + 2
  } else {
    h = (r - g) / d + 4
  }
  h *= 60
  if (h < 0) {
    h += 360
  }
  return { h, s: s * 100, l: l * 100 }
}

/** HSL → HEX（h: 0-360，s / l: 0-100） */
export function hslToHex (h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.max(0, Math.min(100, s)) / 100
  const lum = Math.max(0, Math.min(100, l)) / 100

  const c = (1 - Math.abs(2 * lum - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lum - c / 2

  let r = 0
  let g = 0
  let b = 0
  const i = Math.floor(hue / 60) % 6
  switch (i) {
    case 0: { [r, g, b] = [c, x, 0]
      break
    }
    case 1: { [r, g, b] = [x, c, 0]
      break
    }
    case 2: { [r, g, b] = [0, c, x]
      break
    }
    case 3: { [r, g, b] = [0, x, c]
      break
    }
    case 4: { [r, g, b] = [x, 0, c]
      break
    }
    default: { [r, g, b] = [c, 0, x] }
  }

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

// ============ 对比度（WCAG 2.1） ============

/** 相对亮度（0 ~ 1） */
export function relativeLuminance (hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 两色对比度，取值 1 ~ 21 */
export function contrastRatio (a: string, b: string): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 按背景亮度选择可读前景色（深色 / 白色），取对比度更高的一方。
 * 适用于背景在运行时才算出来的场景。
 */
export function readableTextColor (bg: string): string {
  return contrastRatio(bg, LIGHT_TEXT) >= contrastRatio(bg, DARK_TEXT)
    ? LIGHT_TEXT
    : DARK_TEXT
}

// ============ 动态色阶 ============

export interface ColorStep {
  /** 背景色（浅 → 深） */
  bg: string
  /** 该背景上可读的文字色 */
  fg: string
  /** 前景与背景的实际对比度 */
  ratio: number
}

/**
 * 为一档背景匹配文字色。
 * 中间亮度存在"配白、配深都不达标"的死角（如 #2A70EC 配白仅 4.4），
 * 此时朝能拉开对比的方向微调背景亮度，直到达到 AA。
 */
function withReadableText (bg: string): ColorStep {
  const { h, s, l } = hexToHsl(bg)
  const initialFg = readableTextColor(bg)
  let best: ColorStep = { bg, fg: initialFg, ratio: contrastRatio(bg, initialFg) }
  if (best.ratio >= AA_RATIO) {
    return best
  }

  // 选中白字说明背景偏深 → 继续加深；选中深字说明背景偏浅 → 继续提亮
  const preferLight = best.fg === LIGHT_TEXT
  for (let step = 1; step <= 30; step++) {
    const nextL = preferLight ? l - step : l + step
    if (nextL < L_DEEPEST - 8 || nextL > L_SHALLOWEST + 8) {
      break
    }
    const nextBg = hslToHex(h, s, nextL)
    const fg = readableTextColor(nextBg)
    const ratio = contrastRatio(nextBg, fg)
    if (ratio > best.ratio) {
      best = { bg: nextBg, fg, ratio }
    }
    if (ratio >= AA_RATIO) {
      break
    }
  }
  return best
}

/**
 * 按步骤数动态生成蓝色色阶（浅 → 深）。
 *
 * @param count 步骤数（审批链长度）。<=1 时返回单一品牌色。
 * @returns 每档含背景色、可读文字色与实际对比度
 */
export function buildColorScale (count: number): ColorStep[] {
  const n = Math.max(1, Math.floor(count) || 1)

  // 只有一个节点时直接用品牌主色，避免取到最浅档（近乎白色、看不出圆点）
  if (n === 1) {
    return [withReadableText(BRAND_COLOR)]
  }

  const steps: ColorStep[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) // 0 → 1
    const l = L_SHALLOWEST - (L_SHALLOWEST - L_DEEPEST) * t
    steps.push(withReadableText(hslToHex(BRAND_H, BRAND_S, l)))
  }
  return steps
}

/**
 * 取色阶中第 index 档，越界时回退到最后一档。
 * 避免 index 超出长度拿到 undefined，导致 Vue 静默忽略样式项。
 */
export function pickColorStep (scale: ColorStep[], index: number): ColorStep {
  if (scale.length === 0) {
    return withReadableText(BRAND_COLOR)
  }
  return scale[Math.min(Math.max(0, index), scale.length - 1)]
}

/** 弃置段每往下一环，圆点亮度抬高多少（HSL 的 L，百分点） */
export const DISCARD_LIGHTEN_STEP = 8

/**
 * 弃置段的圆点颜色：与主链（色阶越往后越深）**方向相反** —— 进入这一段起**逐环变浅**。
 *
 * 起点直接取**主链在本环节的颜色** `base`：段首那一环与主链无缝衔接（不会突变成一个全新颜色），
 * 之后每一环抬高一点亮度，到色阶最浅档（L_SHALLOWEST）封顶 —— 与「圆点逐环缩小」同一套递减节奏
 * （见 ApprovalNode 的 inDiscardSegment）。
 *
 * 文字色随之重算（withReadableText）：底变浅之后要换深字，否则白字糊在浅蓝上。
 *
 * @param base  主链在本环节的圆点色（见 pickColorStep）
 * @param index 该环在弃置段内的序号（0 起）
 */
export function discardColorStep (base: string, index: number): ColorStep {
  const { h, s, l } = hexToHsl(base)
  const nextL = Math.min(L_SHALLOWEST, l + Math.max(0, index) * DISCARD_LIGHTEN_STEP)
  return withReadableText(hslToHex(h, s, nextL))
}

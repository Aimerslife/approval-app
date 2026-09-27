import { BI_ROW_FIELD_BY_KEY } from '@/utils/biRowFields'

/**
 * 轮转「行条件」（`RotationSpec.rowFilter`）的解析与参数绑定。
 *
 * 纯函数（不碰 PocketBase），所以能被 tsx 直接断言 —— 与本项目既有做法一致
 * （见 utils/notifyText.ts / groupApprovers.ts 的文件头说明）。
 *
 * ## 为什么是「PB filter 字符串」而不是又一套条件表达式
 *
 * 分支条件那套（`types/approval` 的 ConditionExpr）是**单行比较**：左边取本行某列，
 * 右边是常量或**本行**另一列 —— 它表达不了"同团队里有哪些组别**存在**这样的行"。
 * 那种判断要先把行筛出来、再按组归并，用 PocketBase 自己的 filter 最直接，而且：
 *   · 能利用服务端过滤，不必把整表拉回来在内存里筛；
 *   · 值走 `pb.filter` 的 `{:占位符}` 绑定，**自动转义**（实测值里的单引号会转成 \'），
 *     而不是字符串拼接 —— 所以字段值绝不要手工拼进 filter。
 *
 * ## 占位符从「当前审批单」取值
 *
 * `{:字段名}` 按**当前审批单的行数据**取值（中文列名，与条件字段同一套），例如：
 *
 *     主MODEL = {:主MODEL} && 是否属于呆滞库存 = "否" && 销售状态 ~ "在售"
 *
 * 读作"与当前单同主MODEL、非呆滞、且在售" —— 这就是"当前审批单数据与表格数据的对比"。
 *
 * ⚠️ 两种必须**抛错**而不是静默的情况（都会让条件恒不命中，或直接抛底层错误）：
 *   1. 字段名不在当前单的数据里（列名写错）；
 *   2. 该字段的值是空的 —— 实测 `pb.filter` 收到 undefined 会直接抛
 *      `TypeError: Cannot read properties of undefined (reading 'replace')`，
 *      而 null 会变成字符串 'null' 去比较（永远不命中且看不出原因）。
 *      所以在这里拦下，报成业务能读懂的错。
 */

/** `{:名称}`：名字允许中文（实测可用），也允许两边有空格 */
const PARAM_RE = /\{:\s*([^}]+?)\s*\}/g

/**
 * 标识符（列名 / 关键字）。中文列名里带括号、方括号、连字符与数字
 * （如「3个月内[0-90]（金额）」「Amazon呆滞条件」），所以字符集要放宽；
 * 但不能包含运算符（= ! > < ~ & | : ?）与引号，否则会把它们吞进来。
 */
/** 注意：列名也可能以**数字**开头（如「3个月内[0-90]（金额）」），所以首字符集要含 0-9 */
const IDENT_RE = /^[A-Za-z0-9_\u4e00-\u9fa5][\w\u4e00-\u9fa5（）()[\].-]*/

/** filter 语法里的字面量关键字，不是列名 */
const FILTER_KEYWORDS = new Set(['true', 'false', 'null'])

/**
 * 把 filter 里的**列名**逐段处理：字符串字面量原样照抄、`{:占位符}` 原样照抄，
 * 其余按标识符切分交给回调。
 */
function scanFilter (raw: string, onIdent: (name: string) => string): string {
  const src = String(raw ?? '')
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    // ① 字符串字面量：整段照抄（里面可能就写着列名，那不该被翻译）
    if (ch === '"' || ch === '\'') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === ch) {
          j++
          break
        }
        j++
      }
      out += src.slice(i, j)
      i = j
      continue
    }
    // ② 占位符：连名字一起照抄（参数名用的是中文列名，翻译了反而绑不上值）
    if (ch === '{' && src[i + 1] === ':') {
      const end = src.indexOf('}', i)
      const j = end === -1 ? src.length : end + 1
      out += src.slice(i, j)
      i = j
      continue
    }
    // ③ 标识符
    const m = IDENT_RE.exec(src.slice(i))
    if (m) {
      out += onIdent(m[0])
      i += m[0].length
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * 中文列名 → PocketBase 列名。
 *
 * ⚠️ 这一步不能省：**PB 的列名是 ASCII**（`主MODEL` → `main_model`、`是否属于呆滞库存` → `is_dead`），
 * 中文名只存在于 `data` JSON 快照里。而本项目的惯例是条件里写**中文列名**
 * （分支条件、提醒文案都是），所以用户写出来的 filter 一定是中文的 ——
 * 直接交给 pb 会被服务端拒成 400（实测踩过：建单失败）。
 *
 * 不在映射表里的标识符原样保留：可能是 `true`/`false`/`null` 这类关键字。
 */
export function translateFilterFields (raw: string): string {
  return scanFilter(raw, name => BI_ROW_FIELD_BY_KEY[name]?.field ?? name)
}

/** filter 里出现的**列名**（不含占位符与字符串字面量里的内容） */
export function filterFieldNames (raw: string): string[] {
  const out: string[] = []
  scanFilter(raw, name => {
    if (!FILTER_KEYWORDS.has(name) && !out.includes(name)) {
      out.push(name)
    }
    return name
  })
  return out
}

/** 提取 filter 里用到的占位符名字（去重，保持书写顺序） */
export function extractFilterParams (raw: string): string[] {
  const out: string[] = []
  for (const m of String(raw ?? '').matchAll(PARAM_RE)) {
    const name = (m[1] ?? '').trim()
    if (name && !out.includes(name)) {
      out.push(name)
    }
  }
  return out
}

/**
 * 把 `{:名称}` 绑定成当前审批单的值，返回可直接交给 `pb.filter` 的参数对象。
 *
 * 抛出的错误信息是给用户看的短句（调用方会在前面拼上轮询环节名与字段定位）。
 */
export function bindFilterParams (
  raw: string,
  ctx: Record<string, unknown>,
): Record<string, string | number> {
  const params: Record<string, string | number> = {}
  for (const name of extractFilterParams(raw)) {
    if (!(name in ctx)) {
      throw new Error(`行条件里的「{:${name}}」在当前数据里没有这一列`)
    }
    const v = ctx[name]
    if (v === undefined || v === null) {
      throw new Error(`行条件要拿当前单的「${name}」去比，但这一列没有值`)
    }
    /*
     * 只接受文本与数字：
     *  · `bi_rows` 的业务列只有 text / number 两种（见 utils/biRowFields.ts），
     *    所以出现对象/数组/布尔时一定是配置或取值路径出了问题，当场报出来；
     *  · number 照原样传（数值列比较更准），字符串去首尾空白，**空串必须拦下**
     *    —— 空值会让条件永远不命中，而界面上看不出原因。
     */
    if (typeof v !== 'string' && typeof v !== 'number') {
      const shape = Array.isArray(v) ? '数组' : typeof v
      throw new Error(`行条件要拿当前单的「${name}」去比，但它的值不是文本也不是数字（${shape}）`)
    }
    const value = typeof v === 'string' ? v.trim() : v
    if (value === '') {
      throw new Error(`行条件要拿当前单的「${name}」去比，但它是空的（空值会让条件永远不命中）`)
    }
    params[name] = value
  }
  return params
}

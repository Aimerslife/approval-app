/*
 * 条件左值的**简单四则运算** —— 把"某个字段 vs 某个值"升级成"几个字段算出来 vs 某个值"：
 *   总库存金额 - 已接收数量 > 5000
 *   qty * 2 <= 剩余接收数量
 *   (总库存金额 - 已接收金额) / 总库存数量 > 100
 *
 * ## 为什么自己写解析器
 *
 * · 全库**不用** eval / new Function，也不为这件事引 mathjs（见 utils/approvalTypes 文件头的
 *   "不做表达式 / 脚本引擎"那条约束）；
 * · 需要支持的只是四个运算符 + 括号 + 负号，一个递归下降解析器就够；
 * · 自己写才能给"字段取不到值"一个**业务结果**（null → 不命中），
 *   而不是让 NaN / Infinity 混进比较里 —— 那种错不会报错，只会静默走错分支。
 *
 * ## 语法
 *
 *   expr   := term (('+' | '-') term)*        // 加减（低优先级）
 *   term   := factor (('*' | '/') factor)*    // 乘除（高优先级）
 *   factor := '-' factor                      // 负号
 *           | number                          // 123 / 1,234 / 1.5（逗号按千分位）
 *           | field                           // 求值上下文里的键，允许带 @ 前缀
 *           | '(' expr ')'                    // 括号
 *
 * 变量名 = 求值上下文的键（'总库存金额' / 'amount' / '已接收数量'…，见 utils/conditionFields），
 * 允许夹空格（'参考 MSKU'）、允许写 `@` 前缀（与条件值侧的引用写法一致）。
 * ⚠️ 因此变量名里**不能出现** `+ - * / ( )`：带连字符的字段名请改用它的 key（如 amount）。
 *
 * ## 全角符号
 *
 * 中文输入法下极容易打出 `（ ） ＊ ＋ － ／`：这里统一折算成半角再解析，
 * 而不是让用户对着"语法错误"自己猜（这类问题在现场查起来最费时间）。
 */

/** 解析 / 求值结果 */
export interface ArithmeticCheck {
  /** 求值结果；没给上下文（只做语法检查）或取不到值时是 null */
  value: number | null
  /** 语法 / 求值错误的中文说明；没有错误时空串 */
  error: string
  /** 表达式里引用到的字段（按出现顺序去重）—— 编辑器据此提示"有没有不认识的字段" */
  fields: string[]
}

/** 单次解析允许的最大长度 / 运算数：模板是人手配的，超出这个量级一定是粘贴错了 */
const MAX_LENGTH = 200
const MAX_TOKENS = 120

type Token
  = | { kind: 'num', value: number }
    | { kind: 'field', name: string }
    | { kind: 'op', value: '+' | '-' | '*' | '/' }
    | { kind: 'paren', value: '(' | ')' }

/** 全角 / 同义符号 → 半角运算符（见文件头「全角符号」） */
const SYMBOL_MAP: Record<string, string> = {
  '（': '(',
  '）': ')',
  '＋': '+',
  '－': '-',
  '＊': '*',
  '／': '/',
  '×': '*',
  '÷': '/',
  '−': '-',
  '　': ' ',
}

const OPS = new Set(['+', '-', '*', '/'])

/** 把整串先折算成半角，长度也顺带挡在门口 */
function normalize (expr: string): string {
  return String(expr ?? '')
    .slice(0, MAX_LENGTH)
    .replace(/[（）＋－＊／×÷−　]/g, ch => SYMBOL_MAP[ch] ?? ch)
}

/**
 * 切词。语法错误在这里就能定位到"第几个字符"——面板要显示给人看，
 * 只说"表达式有误"等于没说。
 */
function tokenize (src: string): { tokens: Token[], error: string } {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!

    if (/\s/.test(ch)) {
      i++
      continue
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ kind: 'paren', value: ch })
      i++
      continue
    }

    if (OPS.has(ch)) {
      tokens.push({ kind: 'op', value: ch as '+' | '-' | '*' | '/' })
      i++
      continue
    }

    // 数字：允许千分位（1,234）与小数（1.5）。先扫数字再扫字段，否则 "123" 会被当字段名
    if (/\d/.test(ch)) {
      const rest = src.slice(i)
      const hit = /^\d[\d,]*(?:\.\d+)?/.exec(rest)
      if (!hit) {
        return { tokens: [], error: `第 ${i + 1} 个字符附近的数字写法不对` }
      }
      const raw = hit[0].replace(/,/g, '')
      const value = Number(raw)
      if (!Number.isFinite(value)) {
        return { tokens: [], error: `「${hit[0]}」不是一个有效的数字` }
      }
      tokens.push({ kind: 'num', value })
      i += hit[0].length
      continue
    }

    // 变量名：一直到下一个运算符 / 括号为止（中间可以有空格）
    let j = i
    let name = ''
    while (j < src.length && !OPS.has(src[j]!) && src[j] !== '(' && src[j] !== ')') {
      name += src[j]
      j++
    }
    name = name.trim()
    if (!name) {
      return { tokens: [], error: `第 ${i + 1} 个字符附近无法识别` }
    }
    tokens.push({ kind: 'field', name: name.replace(/^@/, '').trim() })
    i = j
    if (tokens.length > MAX_TOKENS) {
      return { tokens: [], error: '表达式太长，建议拆成多条条件' }
    }
  }
  return { tokens, error: '' }
}

/** 上下文里的值 → 数字；取不到 / 不是数字一律 null（见文件头：null = 不命中） */
function numericOf (raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  if (typeof raw === 'boolean') {
    return raw ? 1 : 0
  }
  const text = String(raw).replace(/,/g, '').trim()
  if (!text) {
    return null
  }
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/**
 * 解析并（可选地）求值。
 *
 * @param expr    表达式
 * @param resolve 变量取值函数；**不传 = 只做语法检查**（编辑器里没有行数据可算）
 */
function analyze (expr: string, resolve?: (name: string) => number | null): ArithmeticCheck {
  const src = normalize(expr).trim()
  if (!src) {
    return { value: null, error: '', fields: [] }
  }

  const { tokens, error } = tokenize(src)
  if (error) {
    return { value: null, error, fields: [] }
  }
  if (tokens.length === 0) {
    return { value: null, error: '', fields: [] }
  }

  const fields: string[] = []
  let pos = 0
  let failure = ''

  const peek = (): Token | undefined => tokens[pos]

  /** 失败时返回 null，并把原因写进 failure —— 用 throw 会让调用方到处 try/catch */
  const fail = (message: string): null => {
    failure ||= message
    return null
  }

  function parseExpr (): number | null {
    let left = parseTerm()
    if (left === null) return null
    while (true) {
      const t = peek()
      if (!t || t.kind !== 'op' || (t.value !== '+' && t.value !== '-')) break
      pos++
      const right = parseTerm()
      if (right === null) return null
      left = t.value === '+' ? left + right : left - right
    }
    return left
  }

  function parseTerm (): number | null {
    let left = parseFactor()
    if (left === null) return null
    while (true) {
      const t = peek()
      if (!t || t.kind !== 'op' || (t.value !== '*' && t.value !== '/')) break
      pos++
      const right = parseFactor()
      if (right === null) return null
      if (t.value === '/') {
        // 除零：直接判错，别让 Infinity 混进比较（Infinity > 任何数都成立，会静默走错分支）
        if (right === 0) return fail('除数不能为 0')
        left = left / right
      } else {
        left = left * right
      }
    }
    return left
  }

  function parseFactor (): number | null {
    const t = peek()
    if (!t) {
      return fail('表达式写了一半：缺少数字或字段')
    }
    if (t.kind === 'op') {
      // 负号：'-字段' / '-3'；其它运算符出现在这里就是语法错
      if (t.value === '-') {
        pos++
        const v = parseFactor()
        return v === null ? null : -v
      }
      return fail(`「${t.value}」前面缺少数字或字段`)
    }
    if (t.kind === 'paren') {
      if (t.value === ')') return fail('括号不配对：多了一个「)」')
      pos++
      const v = parseExpr()
      if (v === null) return null
      const close = peek()
      if (!close || close.kind !== 'paren' || close.value !== ')') {
        return fail('括号不配对：缺少「)」')
      }
      pos++
      return v
    }
    if (t.kind === 'num') {
      pos++
      return t.value
    }
    // 字段
    pos++
    if (!fields.includes(t.name)) fields.push(t.name)
    if (!resolve) {
      // 只做语法检查：字段的具体值此时还不存在，用 0 占位走完整个语法树
      return 0
    }
    const v = resolve(t.name)
    return v === null ? fail(`字段「${t.name}」取不到值`) : v
  }

  const value = parseExpr()
  if (value === null) {
    return { value: null, error: failure || '表达式无法解析', fields }
  }
  if (pos < tokens.length) {
    const t = tokens[pos]!
    const text = t.kind === 'paren' ? t.value : t.kind === 'op' ? t.value : t.kind === 'num' ? String(t.value) : t.name
    return { value: null, error: `「${text}」后面多了一个值：检查是不是漏了运算符`, fields }
  }
  return { value: Number.isFinite(value) ? value : null, error: '', fields }
}

/**
 * 只做**语法检查**（不取值）：编辑器里没有行数据，能查的只有"写得对不对"。
 * 返回的 `fields` 供面板提示"有没有不在候选清单里的字段"。
 */
export function parseArithmetic (expr: string): ArithmeticCheck {
  return analyze(expr)
}

/**
 * 求值：从左值表达式算出数字。取不到值 / 除零 / 语法错都返回 **null**，
 * 调用方按"不命中"处理（与 `@字段` 引用取不到值的口径一致）。
 */
export function evalArithmetic (expr: string, form: Record<string, unknown>): number | null {
  const result = analyze(expr, name => numericOf(form?.[name]))
  return result.error ? null : result.value
}

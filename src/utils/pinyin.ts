/**
 * 中文姓名 → 拼音首字母（审批时间线那个小圆点里的两个字母，如「张三」→「zs」）。
 *
 * 为什么单独一个模块、而且是**动态** import：
 * pinyin 把整个词典内联在入口文件里 —— `node_modules/pinyin/lib/esm/pinyin.js` 有 **7.2MB**。
 * 静态 import 会让每个间接用到它的页面（`ApprovalNode` → home / mine / approvalPage …）
 * 在**渲染之前**先下载并解析这几 MB，而这点东西只用来给一个头像位置算两个字母。
 * 改成首次用到时异步加载之后，它不再出现在这些页面的关键路径上。
 *
 * 用法：
 *   · 先同步调 `pinyinInitials()` —— 词典没就绪时它会退回**姓名首字**（「张」），不会空着；
 *   · 同时 `await ensurePinyin()`，加载完再调一次拿到拼音结果（调用方负责更新界面）。
 */

type PinyinFn = ((name: string, options?: { style?: string }) => string[][]) & {
  STYLE_FIRST_LETTER?: string
}

let pinyinFn: PinyinFn | null = null
let firstLetterStyle = 'first_letter'
let loading: Promise<void> | null = null

/** 加载词典；重复调用只会真正加载一次 */
export function ensurePinyin (): Promise<void> {
  loading ??= import('pinyin')
    .then(mod => {
      /*
       * 取"**真正可调用的那个**"。
       *
       * ⚠️ 不能只写 `mod.default ?? mod`：这个包在不同打包产物下形状不一样
       *    （CJS 互操作时 `default` 可能不存在，函数也可能挂在具名导出上），
       *    取错的后果不是"没拼音"，而是 `pinyinFn is not a function` ——
       *    在 watch 里抛错、头像那两个字母变空，光看代码完全看不出来（实测踩过）。
       *    按"找第一个函数"取，打包形状变了也不会坏。
       */
      const m = mod as unknown as Record<string, unknown>
      const fn = [m.default, m.pinyin, m].find(x => typeof x === 'function') as PinyinFn | undefined
      if (!fn) {
        console.warn('[pinyin] 没找到可调用的导出，姓名将只显示首字')
        return
      }
      pinyinFn = fn
      firstLetterStyle = fn.STYLE_FIRST_LETTER ?? firstLetterStyle
    })
    .catch(error => {
      /*
       * 加载失败**不抛**：这里只影响头像上的两个字母，
       * 不值得让整个时间线报错；之后一直用首字兜底即可。
       * loading 保留已 resolve 的状态，不会反复重试。
       */
      console.warn('[pinyin] 词典加载失败，姓名将只显示首字:', error)
    })
  return loading
}

/**
 * 姓名首字母：'张三' → 'zs'（最多两位，与原实现一致）。
 * 词典未就绪时退回首字，保证界面不出现空白。
 */
export function pinyinInitials (name?: string | null, separator = ''): string {
  const n = name?.trim()
  if (!n) {
    return ''
  }
  if (!pinyinFn) {
    return n.slice(0, 1)
  }
  try {
    return pinyinFn(n, { style: firstLetterStyle }).flat().slice(0, 2).join(separator)
  } catch (error) {
    /*
     * 词典形状不对 / 某个字查不到：退回首字，**绝不把异常抛给调用方** ——
     * 这个函数只用来渲染头像上的两个字母，为它让整条时间线报错不值得。
     * 同时把 pinyinFn 置空，后续调用直接走首字兜底，不会每次都抛。
     */
    console.warn('[pinyin] 取首字母失败，退回姓名首字:', error)
    pinyinFn = null
    return n.slice(0, 1)
  }
}

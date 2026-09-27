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
      // 包的入口同时有 default 与具名导出，取可直接调用的那个
      // （与原先 utils.ts 里的取法一致：常量挂在默认导出的函数对象上）
      const fn = ((mod as { default?: unknown }).default ?? mod) as PinyinFn
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
  return pinyinFn(n, { style: firstLetterStyle }).flat().slice(0, 2).join(separator)
}

/**
 * 提醒文案的插值（纯函数）。
 *
 * 为什么单独一个模块、而不是放在 utils/notifySteps.ts 里：
 * 那里顶层 import 了 `@/api/api` → 会拉进 `@/pocketbase.ts`（用了 `import.meta.env`），
 * **在 Node 里 import 不进来**，纯函数就没法用 tsx 直接跑断言。
 * 这与本项目既有的做法一致（`utils/biQuery`、`utils/excelTable` 都是这个理由下沉出来的）。
 */

/**
 * 把提醒文案里的 `{{字段名}}` 换成业务数据里的值。
 *
 * 取数与分支条件的 `@字段名` 引用**走同一个上下文**（BI 行字段 / 派生指标 / 办理时填的值），
 * 所以两边能引用的东西天然一致 —— 以后加字段也只需加一处。
 *
 * 三条口径（都有理由）：
 *  1. **取不到就原样保留**（字段不存在 / 值为空 / 值是对象）：
 *     替换成空串会让人以为"文案本来就没写"，反而难查；留着占位符一眼能看出是哪个字段没取到。
 *  2. **不递归展开**：替换进去的内容里若还有 `{{}}` 不再二次求值 ——
 *     否则数据里恰好带占位符就会无限套娃，甚至把不该展开的东西展开。
 *  3. **纯函数**：context 为空、或文案里没有 `{{` 时原样返回，
 *     所以没配插值的旧模板行为逐字节不变。
 *
 * @param template 文案模板，如 `库存 {{SKU}} 在 {{仓位}} 已呆滞`
 * @param context  业务上下文（建单时冻结的快照 / 办理时的 form）
 */
export function renderNotifyText (template: string, context: Record<string, unknown> = {}): string {
  // 没有占位符就直接返回：省一次全量扫描，也让"旧模板零影响"这件事一眼可见
  if (!template || !template.includes('{{')) {
    return template
  }
  return template.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (whole, rawKey: string) => {
    const key = rawKey.trim()
    // `{{}}` / `{{  }}`：没写字段名，原样留着
    if (!key) {
      return whole
    }
    const v = context[key]
    /*
     * 注意用 === 逐个判，不要写 !v：
     * 0 和 false 是**合法取值**（数量 0、是否确认 false），用 falsy 判断会把它们吞掉。
     */
    if (v === undefined || v === null || v === '') {
      return whole
    }
    if (typeof v === 'object') {
      return whole
    }
    return String(v)
  })
}

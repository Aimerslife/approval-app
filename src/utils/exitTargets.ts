/**
 * 「跳出循环 / 轮完走向 / 提前结束轮询」的**候选环节** —— 本图里"能跳过去接着走"的节点。
 *
 * ## 为什么必须只有这一份
 * 候选清单（编辑器下拉）与**保存期白名单**（utils/approvalFlow 的 `outerExitIds` 与类型校验）
 * 必须完全一致：不一致就会出现"明明选得下、保存却报目标不存在"这种假错
 * （approvalFlow 里留着这条踩坑记录）。以前两处各写一份 filter，加一类节点就得记着改两处 ——
 * 现在都走这里的 `isExitTargetNode` / `collectExitTargets`。
 *
 * ## 四类节点都算，因为它们都有"到达"这一步、且运行期都能落到具体环节
 *   · approval 审批环节：跳过去接着办；
 *   · notify   飞书提醒：到达即穿过（会真发一条通知），"先通知一下再往下走"是有意义的跳法；
 *   · ref      引用模板：建单期会把源模板那一整段搬进来，跳过去就是**从那一段的第一环接着走**
 *              （见 utils/templateRef 的 remapRefTargets，它就是为这种目标写的）；
 *   · loop     组间轮询：跳过去落在它展开后的**第一环**（见 utils/approvalRotation 的 firstOf）。
 * 开始 / 结束 / 条件分支 / 数据查询没有"到达"这一步，列出来只会让人选错。
 *
 * ## 名字取"人能认出来的那个"
 *   · 审批 / 提醒 / 轮询：环节名、卡片名；没写名字时给个类型叫法；
 *   · 引用模板：**模板名**（`refTemplateName`）—— 引用卡片的"身份"就是它引的那张模板，
 *     卡片名只是可改的别名，而且可能是空的（旧数据），所以模板名优先、卡片名兜底。
 */

export interface ExitTargetOption {
  id: string
  label: string
}

/** 四类可作跳转目标的节点类型 */
const EXIT_TARGET_TYPES = ['approval', 'notify', 'ref', 'loop'] as const

/** 没写名字时的叫法（与画布上其它提示的用词一致，见 createStream 的 CARD_NAME_BY_TYPE） */
const FALLBACK_LABEL: Record<string, string> = {
  approval: '未命名环节',
  notify: '飞书提醒',
  loop: '组间轮询',
  ref: '引用模板',
}

/** 这个节点能不能当跳转目标（口径见文件头；与保存期白名单共用） */
export function isExitTargetNode (node: unknown): boolean {
  return node !== null
    && typeof node === 'object'
    && (EXIT_TARGET_TYPES as readonly string[]).includes(String((node as { type?: unknown }).type))
}

/** 候选名（口径见文件头） */
export function exitTargetLabelOf (node: unknown): string {
  const n = (node ?? {}) as { type?: unknown, data?: Record<string, unknown> }
  const type = String(n.type ?? '')
  const data = n.data ?? {}
  const title = String(data.title ?? '').trim()
  if (type === 'ref') {
    // 模板名优先：卡片名可能被改掉、也可能是空的（旧数据只存了 id + 冗余模板名）
    return String(data.refTemplateName ?? '').trim() || title || FALLBACK_LABEL.ref
  }
  return title || FALLBACK_LABEL[type] || '未命名环节'
}

/**
 * 收集候选（下拉直接用）。
 *
 * @param nodes     本图（主画布 / 卡片内部图所在的那张）的节点
 * @param excludeId 排掉"自己"：一条出线的源头环节不能跳到自己的出线；卡片也不能被自己的
 *                  「轮完走向 / 提前结束轮询」指向（那两种写法运行期都没有意义）
 */
export function collectExitTargets (nodes: unknown[] | undefined, excludeId?: string): ExitTargetOption[] {
  const self = String(excludeId ?? '')
  return (nodes ?? [])
    .filter(n => isExitTargetNode(n) && String((n as { id?: unknown }).id) !== self)
    .map(n => ({ id: String((n as { id?: unknown }).id), label: exitTargetLabelOf(n) }))
}

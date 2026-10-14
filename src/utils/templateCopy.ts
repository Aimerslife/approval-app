/*
 * 模板的「正本 / 副本」名规约 —— 全项目只此一处，判副本、去标记、生成副本名都从这里取。
 *
 * ## 为什么要按名字分
 *
 * 复制模板（见 pages/approvalModel 的 copyParten）会生成一张**独立的新模板**，
 * 名字自动带上后缀 `- 副本`。这批副本是"改到一半的草稿"，不该和正式模板混在一张表里，
 * 所以列表页按名字把它们分到「副本」页签；**去掉后缀 = 移入正本**（改名走 updateApprovalModel）。
 *
 * ## 为什么不去库里加字段
 *
 * 加一个 `is_copy` 字段要迁移历史数据、还要改所有的读写点；而"名字里带 - 副本"这件事
 * 本来就已经由复制功能写死（见 copyNameOf），用它当规约是零迁移、也看得见（用户自己就能改名移动）。
 *
 * ⚠️ 判定按**包含**（不是结尾严格匹配）：用户可能改成 `X - 副本2`、`X-副本（旧）`，
 * 那些仍然是副本，不该因为多打了几个字就混进正本里。
 */

/** 副本名的标记（复制时自动接在原名字后面；分隔符两边是否带空格都认）。`replace` 要 `g` */
const COPY_PATTERN = /-\s*副本/g

/*
 * 判定用的同一份规则，**不能带 `g`**：带 g 的正则对象会在多次 `.test()` 之间记住 lastIndex，
 * 同一个名字连着判两次会一次 true 一次 false（表格里逐行渲染，一屏就能踩到）。
 * 所以这里刻意写第二个、无状态的正则 —— 比"每次 new 一个"省事，也不会有人漏掉 new。
 */
const COPY_TEST = /-\s*副本/

/**
 * 这个模板名是不是「副本」（名字里带 `- 副本` 标记）。
 *
 * 用途：列表页分页签；建单是按 `<组别>模板` 精确查名的（见 pages/workStream 的
 * taskTemplateNameOf），带后缀的副本**查不到**，所以副本不会被误用去建单 —— 这一层是天然隔离的。
 */
export function isTemplateCopy (name?: string | null): boolean {
  return COPY_TEST.test(String(name ?? ''))
}

/**
 * 去掉副本标记后的「正本名」：`美2组模板 - 副本` → `美2组模板`。
 *
 * 重复标记会被一并去掉（`X - 副本 - 副本` → `X`）；去掉后为空时返回原名 ——
 * 一个只剩 `- 副本` 的名字不该变成空字符串（那是个没有名字的模板）。
 */
export function primeNameOf (name?: string | null): string {
  const raw = String(name ?? '')
  const stripped = raw.replace(COPY_PATTERN, '').trim()
  return stripped || raw.trim()
}

/** 复制一张模板时，新记录该叫什么：正本名 + 副本标记（对副本再复制也不会叠成 `- 副本 - 副本`） */
export function copyNameOf (name?: string | null): string {
  const prime = primeNameOf(name)
  return prime ? `${prime} - 副本` : ''
}

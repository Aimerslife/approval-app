import type { ApprovalTypeOverrideMap } from './approvalTypes'
/**
 * 「审批类型」覆盖的读写（集合 `approval_types`，见 pocketbase/pb_migrations/1790900000_*）。
 *
 * 与 utils/pushRulesStore 同一套约定：
 *   · **读失败不抛**、回落"这一层没有覆盖"：集合可能还没建（迁移没跑），
 *     那种情况下页面要能正常打开，办理侧也照旧用内置默认（= 改造前的行为）；
 *   · **写失败必抛**：改数据静默失败会让人以为改好了。
 *
 * 覆盖的层级与回落口径见 utils/approvalTypes 的文件头（内置默认 → 全局 → 模板级）。
 */
import { pb } from '@/pocketbase'
import { normalizeTypeOverride } from './approvalTypes'

const APPROVAL_TYPES_COLLECTION = 'approval_types'

/** "环境没准备好"的错误名：界面据此把原因原样展示（见 collection.ts 的 WAREHOUSE_SETUP_ERROR） */
export const APPROVAL_TYPES_SETUP_ERROR = 'ApprovalTypesSetupError'

/**
 * 覆盖的作用域。
 *   · `{ kind: 'global' }` —— 全局默认，所有审批模板生效；
 *   · `{ kind: 'template', templateId }` —— 只对某个审批模板生效（app_chain 记录 id）。
 */
export type ApprovalTypeScope = { kind: 'global' } | { kind: 'template', templateId: string }

/** 集合里一行的形状（字段是 snake_case） */
type ApprovalTypeRow = Record<string, unknown> & {
  id: string
  scope?: string
  template?: string
  code?: string
  fields?: unknown
  note?: string
  enabled?: boolean
  updated?: string
}

function setupOrOriginal (error: unknown): Error {
  if ((error as { status?: number } | null)?.status === 404) {
    const e = new Error('审批类型表还没建：请重启 PocketBase 以应用迁移 1790900000_created_approval_types')
    e.name = APPROVAL_TYPES_SETUP_ERROR
    return e
  }
  return error instanceof Error ? error : new Error(String(error))
}

/** 作用域 → 查询条件（两个字段唯一确定一层，见迁移里"不做唯一索引"的说明） */
function scopeFilterOf (scope: ApprovalTypeScope): string {
  return scope.kind === 'global'
    ? 'scope = "global"'
    : `scope = "template" && template = "${scope.templateId}"`
}

/** 作用域 → 写库字段 */
function scopeFieldsOf (scope: ApprovalTypeScope): { scope: string, template: string } {
  return scope.kind === 'global'
    ? { scope: 'global', template: '' }
    : { scope: 'template', template: scope.templateId }
}

/** 页面顶部那个「已自定义 / 默认」标记要的数据 */
export interface ApprovalTypeLoadResult {
  /** code → 该层的覆盖（库里没有 = 空对象） */
  overrides: ApprovalTypeOverrideMap
  /** 这一层是否有任何覆盖 */
  custom: boolean
}

/**
 * 读某一层的全部覆盖。
 *
 * ⚠️ **失败不抛**、返回空覆盖：集合可能还没建（迁移没跑），那时页面要能打开、
 * 办理侧也要照旧用内置默认。
 */
export async function loadApprovalTypeOverrides (scope: ApprovalTypeScope): Promise<ApprovalTypeLoadResult> {
  try {
    const rows = await pb
      .collection(APPROVAL_TYPES_COLLECTION)
      .getFullList<ApprovalTypeRow>({ sort: '-updated', filter: scopeFilterOf(scope) })
    const overrides: ApprovalTypeOverrideMap = {}
    for (const row of rows) {
      const code = String(row.code ?? '').trim()
      // 倒序取：同一个码有多行时只认最新那条（与 push_rules "只认最新"同一口径）
      if (!code || overrides[code]) {
        continue
      }
      overrides[code] = normalizeTypeOverride({
        fields: row.fields,
        note: row.note,
        enabled: row.enabled,
      })
    }
    return { overrides, custom: Object.keys(overrides).length > 0 }
  } catch (error) {
    console.warn('[approvalTypeStore] 读取审批类型覆盖失败，按"没有覆盖"处理:', error)
    return { overrides: {}, custom: false }
  }
}

/**
 * 保存某个码的覆盖（`null` = 删掉这一层的覆盖，回到上一层）。
 *
 * 按键 upsert：先查同一层里这个码有没有行，有就更新、没有就新建（不依赖唯一索引，
 * 口径与 pushRulesStore 的单条 upsert 一致）。
 */
export async function saveApprovalTypeOverride (
  scope: ApprovalTypeScope,
  code: string,
  override: Parameters<typeof normalizeTypeOverride>[0] | null,
): Promise<void> {
  const target = String(code ?? '').trim()
  if (!target) {
    throw new Error('保存审批类型失败：结论码为空')
  }
  try {
    const coll = pb.collection(APPROVAL_TYPES_COLLECTION)
    const rows = await coll.getFullList<ApprovalTypeRow>({
      sort: '-updated',
      filter: `${scopeFilterOf(scope)} && code = "${target}"`,
    })
    const existing = rows[0]
    if (override === null) {
      // 恢复默认 = 删掉这一层的覆盖
      for (const row of rows) {
        await coll.delete(row.id)
      }
      return
    }
    const clean = normalizeTypeOverride(override)
    const payload = {
      ...scopeFieldsOf(scope),
      code: target,
      fields: clean.fields ?? [],
      note: clean.note ?? '',
      enabled: clean.enabled !== false,
    }
    if (existing) {
      await coll.update(existing.id, payload)
      return
    }
    await coll.create(payload)
  } catch (error) {
    throw setupOrOriginal(error)
  }
}

/**
 * 恢复默认：删掉**整层**的覆盖。
 *
 * 页面上是"这一层全部回内置默认"，所以逐条删；删完再读一次，`custom` 自然回落 false。
 */
export async function resetApprovalTypeScope (scope: ApprovalTypeScope): Promise<void> {
  try {
    const coll = pb.collection(APPROVAL_TYPES_COLLECTION)
    const rows = await coll.getFullList<ApprovalTypeRow>({ filter: scopeFilterOf(scope) })
    for (const row of rows) {
      await coll.delete(row.id)
    }
  } catch (error) {
    throw setupOrOriginal(error)
  }
}

/** 写失败时的提示文案（"环境没准备好"的错直接把原因原样展示） */
export function approvalTypeWriteHint (error: unknown): string {
  return error instanceof Error && error.name === APPROVAL_TYPES_SETUP_ERROR
    ? error.message
    : '保存失败，请稍后重试'
}

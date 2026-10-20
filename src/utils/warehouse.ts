/**
 * 仓库（仓位）清单：**上级分类 → 仓库名**。
 *
 * 两个来源，与「团队 → 默认审批人」同一套范式（见 utils/groupApprovers）：
 *   1. **默认值**：本文件里人工维护的那份 —— PB 里一条记录都没有时用它；
 *   2. **维护值**：在「角色设置 → 仓库设置」里新增/改名/删除的那份（PocketBase `warehouses` 表）。
 *
 * ⚠️ 合并口径不是"逐行覆盖"，而是**二选一**：PB 里有记录就**完全以它为准**（那是有人
 *    真正维护过的完整清单），没有才回落到本文件的默认值。为什么不做逐行合并：
 *    仓库的新增/删除/改名都是常态（逐行合并表达不了"删掉某一项"），
 *    二选一的语义在界面上才解释得清 —— 界面据此显示"默认 / 已自定义"，并给一个「恢复默认」
 *    （= 清空 PB 表，回落到本文件）。
 *
 * 本模块刻意保持**纯**（不碰 PocketBase，能被 tsx 直接断言）；
 * 读写那张表在 `utils/collection.ts`（`loadWarehouses` / `saveWarehouses` / `resetWarehouses`）。
 *
 * 身份键必须是「分类 + 名称」两个字段：同名仓库可以挂在多个分类下
 * （现成的例子：「代发仓」在「本地仓」和「中转仓」下各有一条），只按名称去重会把它们合成一条。
 */

import type { BranchCondition } from '@/types/approval'
import { conditionValues } from '@/types/approval'

export interface WarehouseRow {
  /** 上级分类：本地仓 / 中转仓 / 海外仓 / 平台仓 */
  parent: string
  /** 仓库名：FBA仓 / 广州仓 / … */
  name: string,
  index:number
}

/** 默认清单（PB 里没维护过时用它）。改动这里即刻生效，无需迁移 */
export const warehouse: WarehouseRow[] = [
  { parent: '本地仓', name: '本地仓',index:1 },
  { parent: '本地仓', name: '广州仓',index:2 },
  { parent: '本地仓', name: '中山仓',index:3 },
  { parent: '本地仓', name: '代发仓',index:4 },
  { parent: '海外仓', name: '海外仓',index:5 },
  { parent: '平台仓', name: 'FBA仓',index:6 },
  { parent: '平台仓', name: 'FBT仓',index:7 },
]

/** 去掉所有空白再比：人工维护的名字里常带多余空格或全角空格 */
function squash (s: unknown): string {
  return String(s ?? '').replace(/\s+/g, '')
}

/** 干净的一行：两侧空白去掉（库里不该存「 FBA仓 」这种） */
export function cleanWarehouse (row: WarehouseRow): WarehouseRow {
  return { parent: String(row.parent ?? '').trim(), name: String(row.name ?? '').trim(),index:row.index }
}

/**
 * 身份键：分类 + 名称（都 squash 过）。
 * 用于"这一行是不是同一项"的判断 —— 改名 = 键变了 = 旧行删掉、新行写入（见 saveWarehouses）。
 */
export function warehouseKey (row: WarehouseRow): string {
  return `${squash(row.parent)}|${squash(row.name)}`
}

/**
 * 展示顺序：分类沿用默认清单里**第一次出现**的位置，新分类排最后；分类内保持入参顺序。
 *
 * 为什么不用 `Array#sort`：项目的 TS lib 还没到 ES2023（没有 `toSorted`），而 eslint 的
 * `unicorn/no-array-sort` 又不允许原地 `sort` —— 两边都满足的写法就是这里这种"先按分类归档、
 * 再按分类顺序取回"（比较器自然消失，也不再需要一份数组副本）。
 * 分类内的顺序由调用方决定：默认清单是文件里的书写顺序，PB 那边查出来时已按名称排过。
 */
export function sortWarehouses (rows: readonly WarehouseRow[], defaults: readonly WarehouseRow[] = warehouse): WarehouseRow[] {
  /** 分类的桶号：默认清单里第一次出现的位置；没见过的分类 → 第 defaults.length 号桶（排最后） */
  const bucketOf = (parent: string): number => {
    const at = defaults.findIndex(r => squash(r.parent) === squash(parent))
    return at === -1 ? defaults.length : at
  }

  const buckets = new Map<number, WarehouseRow[]>()
  for (const row of rows) {
    const at = bucketOf(row.parent)
    const list = buckets.get(at)
    if (list) {
      list.push(row)
    } else {
      buckets.set(at, [row])
    }
  }

  const out: WarehouseRow[] = []
  for (let at = 0; at <= defaults.length; at++) {
    const list = buckets.get(at)
    if (list) {
      out.push(...list)
    }
  }
  return out
}

/**
 * 清洗一份清单：去空白、丢掉空行、按身份键去重（保留首次出现的顺序）。
 *
 * ⚠️ 与 `resolveWarehouses` 的区别很重要：这里**不看**默认值。
 *    "把清单存回去"用的是本函数 —— 传空数组的语义是**清空**，不能被默认值又填满。
 */
export function normalizeWarehouses (rows: readonly WarehouseRow[]): WarehouseRow[] {
  const seen = new Set<string>()
  const out: WarehouseRow[] = []
  for (const raw of rows ?? []) {
    const row = cleanWarehouse(raw)
    if (!row.parent || !row.name) {
      continue
    }
    const key = warehouseKey(row)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * 取本次要用的清单：PB 里有记录就用 PB 的（清洗过、去掉空行、去重），否则回落到默认值。
 *
 * @param overrides PB `warehouses` 表里的记录；空数组/undefined = 没维护过
 */
export function resolveWarehouses (overrides?: readonly WarehouseRow[] | null): WarehouseRow[] {
  const list = normalizeWarehouses(overrides ?? [])
  return sortWarehouses(list.length > 0 ? list : warehouse.map(r => ({ ...r })))
}

/**
 * 校验一行能不能存；返回错误文案，null = 没问题。
 * `siblings` = 除自己以外的现存行（改自己时不该跟"自己"判重）。
 */
export function findBadWarehouse (row: WarehouseRow, siblings: readonly WarehouseRow[] = []): string | null {
  const clean = cleanWarehouse(row)
  if (!clean.parent) {
    return '请填写或选择「上级分类」'
  }
  if (!clean.name) {
    return '请填写「仓库名」'
  }
  if (siblings.some(s => warehouseKey(s) === warehouseKey(clean))) {
    return `「${clean.parent}」下已经有「${clean.name}」了`
  }
  return null
}

/**
 * 按上级分类分组（保持清单里的书写顺序）。
 *
 * 给"需要一个层级化候选值"的地方用：仓库与分类不是数据列里的两列，而是同一列「仓位」的
 * 取值来源（如「本地仓 / 广州仓 / 中山仓」常被配在同一条条件里），分组后更好读。
 */
export function groupWarehouses (rows: readonly WarehouseRow[] = warehouse): Array<{ parent: string, names: string[] }> {
  const out: Array<{ parent: string, names: string[] }> = []
  const index = new Map<string, number>()
  for (const row of rows) {
    const clean = cleanWarehouse(row)
    if (!clean.parent || !clean.name) {
      continue
    }
    const key = squash(clean.parent)
    const at = index.get(key)
    if (at === undefined) {
      index.set(key, out.length)
      out.push({ parent: clean.parent, names: [clean.name] })
      continue
    }
    if (!out[at].names.some(n => squash(n) === squash(clean.name))) {
      out[at].names.push(clean.name)
    }
  }
  return out
}

/* ==================== 条件值里的仓库（编辑器右侧「仓库」候选用） ==================== */

/**
 * 字段没填时补上的列名。
 *
 * 为什么是「仓位」：数据表里承载仓库的那一列就叫这个（见 utils/productFields 的字段清单）。
 * **只在字段为空时补** —— 列名未必都一样（有的库叫「仓库」），作者写过的一律不动。
 */
export const DEFAULT_WAREHOUSE_FIELD = '仓位'

/** 去空白后再比：人工维护的名字里常带多余空格或全角空格（与 squash 同一口径） */
export function sameWarehouseName (a: unknown, b: unknown): boolean {
  return squash(a) === squash(b)
}

/** 字段空着就补默认列名，否则一律不动 */
function ensureWarehouseField (c: BranchCondition): void {
  if (!String(c.field ?? '').trim()) {
    c.field = DEFAULT_WAREHOUSE_FIELD
  }
}

/**
 * 点**分类**：把这一类的全部仓库名写进这条条件（替换原来的值）。
 *
 * 例：选「本地仓」→ `{ field: '仓位', op: 'contains', value: ['本地仓','广州仓','中山仓','代发仓'] }`。
 *
 * 为什么用 `contains` + 数组：这正是"同一列命中任一取值"的现成写法
 * （见 types/approval 的 BranchCondition.value 说明），不必为每个仓库各加一条条件 ——
 * 那还得连带把组合方式改成「任一满足」，很容易配错。
 */
export function applyWarehouseGroup (c: BranchCondition, names: readonly string[]): void {
  ensureWarehouseField(c)
  c.op = 'contains'
  // 拷一份：不能与候选面板共用同一个数组（面板那份是派生的，也不该被条件反向影响）
  c.value = [...names]
}

/**
 * 点**单个**仓库：追加进这条条件（已经在里面就不重复加）。
 *
 * 从别的操作符切过来时旧值（如 `"5000"`）不是仓库，**直接换掉**而不是混进多值里 ——
 * 否则会留下一条永远不可能命中的条件，而且界面上看着像"少填了一个"。
 */
export function appendWarehouseValue (c: BranchCondition, name: string): void {
  ensureWarehouseField(c)
  const list = c.op === 'contains' ? conditionValues(c) : []
  if (!list.some(v => sameWarehouseName(v, name))) {
    // 第一个还是空框就占位：空值不命中，留着会像"少填了一个"
    const emptyAt = list.findIndex(v => String(v ?? '').trim() === '')
    if (emptyAt !== -1) {
      list[emptyAt] = name
    } else {
      list.push(name)
    }
  }
  c.op = 'contains'
  c.value = list.length > 0 ? list : [name]
}

/**
 * 这条条件里已选的仓库值（给候选面板做高亮）。
 *
 * ⚠️ 故意**不用** `conditionValues`：那个会把单值**就地**改成数组 ——
 *    放在模板的渲染表达式里等于"渲染产生数据副作用"。
 */
export function selectedWarehouseValues (c: BranchCondition): string[] {
  if (c.op !== 'contains' || !Array.isArray(c.value)) {
    return []
  }
  return c.value.map(v => String(v ?? '').trim()).filter(Boolean)
}

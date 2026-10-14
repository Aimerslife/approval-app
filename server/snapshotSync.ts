import { BI_ROW_FIELDS, makeSyncKey } from '../src/utils/biRowFields'
// 配置（env 只在那里读一次；它自己 import './env'，所以下面再 import 也只是排序需要）
import { config } from './config'
// 管理员凭据 + 「调用者是不是超级管理员」：与其他特权操作**共用一份**
// （见 server/pbAdmin.ts 的说明：这类校验最怕两处各写一遍）
import { type AdminCaller, adminToken, assertSuperAdmin, PB_URL } from './pbAdmin'

/**
 * 「快照同步」——把 `bi_rows` 的**真实列**回填进 `data` 快照，**只写 `data` 这一个字段**。
 *
 * ## 为什么需要它
 *
 * 表格的单元格值**全部来自 `data`**（见 src/api/api.ts 的 fetchBiRows：
 * `fields: 'id,data'`，行对象就是 `{ ...it.data, id }`），
 * 而**筛选 / 排序 / 唯一键**走的是真实列（`sku` / `shop` / `warehouse` /
 * `group_name` / `is_dead` …）。
 *
 * 于是"直接在库里改列"这件事在界面上的表现是：筛选跟着变了、单元格值**不变** ——
 * 看起来像"同步没生效"（踩过：有人改了列，刷新多少次都不动）。
 *
 * 两个修法：
 *   ① 让表格改成**以列为准**（要动取数口径，`data` 里映射表之外的键还得兜底）；
 *   ② 加这个功能，把列回填进快照。
 * 这里选 ②，因为**不动现有架构**：表结构、唯一键（sync_key）、BI 同步、审批规则
 * 全都不受影响；需要时点一下按钮即可。
 *
 * ## 做什么 / 不做什么
 *
 * 做：把映射表里那 65 个字段的**列值**写进 `data` 对应的中文 key
 *     （类型按字段声明的 number / text 归一），`data` 里**映射表之外的键原样保留**
 *     （那些列没建成真列，只能靠快照带着）。
 * 不做：不改列、不改 `sync_key`、不碰审批单；`data` 算下来没变化的行**根本不写**
 *     （否则一次操作会把全表 8000 多行的 `updated` 全刷一遍）。
 *
 * ## 默认会跳过「列是 0 / 空」的字段（重要）
 *
 * 库里有大批"列从没被写过"的字段 —— 金额类最明显（回款 / 毛利润 / 总库存金额），
 * 实测 8,059 行里有 **6 万多处**列值停在 PB 的默认值 0 上，而快照里是真金额。
 * 不做区分的话，"列 → 快照"一次就把界面上的金额**全刷成 0** —— 那不是同步，是删数据。
 *
 * 所以默认只写"列里**确实有值**、且与快照不同"的字段 —— 也就是一句话：
 * **文件里改过的那几列会被同步进快照，其余一律不动**。
 * `?includeBlanks=1` 才连 0/空一起写（用于"我故意把某列改成 0"）；
 * 跳过多少处会报在 `skippedBlanks` 里，界面要显示。
 *
 * ## 顺带能重算 `sync_key`（`?rekey=1`）
 *
 * 唯一键是 `SKU|店铺|仓位|组别|是否属于呆滞库存`（`src/utils/biRowFields.ts`）。
 * 直接在库里改了**参与键的那几列**（仓位 / 组别 / SKU / 呆滞）之后，行里的 `sync_key`
 * 还是旧值 —— 下次全量同步就认不出它了（会"新建一条同键行 + 把这条当 orphan"）。
 * 打开 rekey 就按**当前列**把键重算一遍（口径与写快照同一套：列里有值取列、否则取快照）。
 *
 * ⚠️ 两件事必须知道：
 *   1. `bi_rows` 上有 `UNIQUE(component_id, sync_key)` —— 两行改成同一个键会被 PB 拒。
 *      所以先做内存预检，冲突的行**跳过改键**（快照照常同步）并报出来，
 *      处理掉之后（删多余行 / 手工改一个）再跑一次即可；
 *   2. `approval_chain.sync_key` 是**审批单里存的键副本**（用来在行换 id 后仍能关联，
 *      见 pb_migrations/1789660200）。这里**刻意不动审批单** ——
 *      所以重算之后，那些"按旧键关联"的老单子会关联不上（按 relation=记录 id 的仍然好着）。
 *      要一起修就得单独做，那是改业务数据，不放在这个功能里。
 *
 * ## 还要知道的一件事
 *
 * BI 同步判断"内容变没变"用的是 **`data` 的 hash**（见 biSync.readExistingRows），
 * 所以快照被重写过的行，下一次 `POST /api/bi/sync` 会被判成 `updated`、
 * 并**用 BI 的值覆盖回来**。这是符合预期的：全量同步的源始终是 BI。
 */

/** PB 列表接口每页条数上限 */
const PB_PAGE_SIZE = 500
/** 默认 BI 组件（取自 server/config.ts —— 与 biSync / 前端 setDatas 同一套默认值） */
const DEFAULT_COMPONENT_ID = config.bi.componentId
/** 同时发出的写请求数（本地 PB，10 足够把 8000 行压到几秒） */
const CONCURRENCY = 10

export interface SnapshotSyncSummary {
  dryRun: boolean
  /** 谁执行的（写进响应与日志，便于追溯） */
  by: AdminCaller
  componentId: string
  /** 扫描到的行数 */
  scanned: number
  /** 需要重写快照的行数（dryRun 与执行都一样，表示"需要"；实际成功多少看 `written`） */
  changed: number
  /** 两样都不需要动、跳过的行数 */
  unchanged: number
  /** 需要重算 `sync_key` 的行数（已排除冲突的） */
  keyChanged: number
  /**
   * 因为**唯一索引冲突**而跳过改键的行数。
   *
   * `bi_rows` 上有 `UNIQUE(component_id, sync_key)`，两行改成同一个键会被 PB 直接拒
   * （报错还很难懂），所以在这里先挑出来：这些行**快照照常同步、键不动**，报给界面。
   * 处理完它们（或删掉多余行）之后再跑一次即可。
   */
  keyConflicts: number
  /** 改键的例子（最多 8 条；`reason` 非空表示这行是冲突被跳过的） */
  keySamples: { id: string, sku: string, from: string, to: string, reason: string }[]
  /** 实际 PATCH 成功的行数（dryRun 恒为 0） */
  written: number
  /** 写入失败的行数（dryRun 时恒为 0；明细见 failures） */
  failed: number
  /** 本次是否重算了 sync_key（`?rekey=1`） */
  rekey: boolean
  /** 每个字段有多少行会被改（按行数降序，最多 12 条）；`zeroed` = 其中"列是 0/空"的次数 */
  fieldChanges: { key: string, column: string, rows: number, zeroed: number }[]
  /** 前几条具体例子（哪个 SKU、哪个字段、从什么变成什么） */
  samples: { id: string, sku: string, key: string, from: string, to: string }[]
  /**
   * ⚠️「列里是 0/空」被**跳过**的总处数（这些字段的列值等于"没写"）。
   *
   * 默认不写它们，否则一次同步会把界面上的金额全刷成 0（金额列实测 6 万多处）。
   * `includeBlanks=true` 时这个数字表示"确实会写下去"的处数。
   */
  skippedBlanks: number
  /** 本次是否连「列为 0/空」一起写（`?includeBlanks=1`） */
  includeBlanks: boolean
  /** 写入失败明细（最多 20 条） */
  failures: string[]
  elapsedMs: number
}

/** 列值 → 快照里的值：number 列统一成数字（列可能是字符串），text 列统一成字符串 */
function toSnapshotValue (value: unknown, type: 'text' | 'number'): string | number {
  if (type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return value === null || value === undefined ? '' : String(value)
}

/**
 * 两个值算不算"一样"。
 *
 * 为什么要跨类型比：`data` 是历史快照，有的行里存的是字符串 `'791'`、列里是数字 `791`。
 * 直接比会判成"不同"→ 把全表都重写一遍（8000 多次写、updated 全变），
 * 而界面上这两个值的显示是一模一样的，重写没有意义。
 */
function isSameValue (a: unknown, b: unknown): boolean {
  const sa = a === null || a === undefined ? '' : String(a).trim()
  const sb = b === null || b === undefined ? '' : String(b).trim()
  if (sa === sb) {
    return true
  }
  if (sa === '' || sb === '') {
    return false
  }
  const na = Number(sa)
  const nb = Number(sb)
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb
}

/** 逐字段差异 */
interface SnapshotDiff {
  key: string
  column: string
  from: unknown
  to: unknown
  /** 被保险挡下来的：列里是 0/空、而快照里有值（默认不写，见 SKIP_BLANK_WRITES 说明） */
  skipped: boolean
}

/**
 * 这一行的列 → 快照：返回新快照（含原有额外键）、是否有变化、以及逐字段差异。
 *
 * @param includeBlanks true = 连同"列里是 0/空"的值一起写（默认 false，见下面的说明）
 */
function snapshotOf (
  rec: Record<string, unknown>,
  includeBlanks: boolean,
): { next: Record<string, unknown>, changed: boolean, diffs: SnapshotDiff[] } {
  const prev = (rec.data && typeof rec.data === 'object' ? rec.data : {}) as Record<string, unknown>
  // 先铺开旧快照：映射表之外的键（未建真列的）原样保留
  const next: Record<string, unknown> = { ...prev }
  const diffs: SnapshotDiff[] = []

  for (const f of BI_ROW_FIELDS) {
    const to = toSnapshotValue(rec[f.field], f.type)
    if (isSameValue(prev[f.key], to)) {
      continue
    }
    /*
     * 保险：**列里是 0 / 空** 时默认**不写**（不看快照里是什么）。
     *
     * 为什么必须有：库里有大批"列从没被写过"的字段（金额类的回款 / 毛利润 / 总库存金额，
     * 实测 8,059 行里 6 万多处），它们的列值停在 PB 的默认值 0 上。
     * 不拦的话，一次"列 → 快照"会把这些金额**全刷成 0** —— 那不是同步，是把界面上的数据删掉；
     * 而且连"快照本来就是空串"的行也一起写成 0，等于无谓重写全表（8000 多行）。
     *
     * 所以默认语义就一句：**只把"列里确实有值、且与快照不同"的字段同步过去**。
     * 想连 0/空一起写（比如你**故意**把某列改成 0）用 `?includeBlanks=1`，
     * 但执行前先看 dryRun 报出来的 skippedBlanks 有多大。
     */
    const skipped = !includeBlanks && isBlank(to)
    if (skipped) {
      diffs.push({ key: f.key, column: f.field, from: prev[f.key], to, skipped: true })
      continue
    }
    next[f.key] = to
    diffs.push({ key: f.key, column: f.field, from: prev[f.key], to, skipped: false })
  }
  return { next, changed: diffs.some(d => !d.skipped), diffs }
}

/** 该值算不算"没填"（用于 zeroOverwrites 的判断：0 / 空串 / null 都算） */
function isBlank (value: unknown): boolean {
  if (value === null || value === undefined) {
    return true
  }
  const s = String(value).trim()
  return s === '' || Number(s) === 0
}

/** 读要处理的行：给了 ids 就只取这些（调试 / 单行修复），否则按 component 全量分页 */
async function readRows (
  token: string,
  componentId: string,
  ids: string[],
  limit: number,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []

  if (ids.length > 0) {
    // ids 走 filter 里的引号拼接前先去掉引号/反斜杠，避免把它们拼进 filter 表达式
    const esc = ids.map(id => `id="${id.replace(/["\\]/g, '')}"`).join(' || ')
    const res = await fetch(
      new URL(`/api/collections/bi_rows/records?perPage=${PB_PAGE_SIZE}&filter=${encodeURIComponent(esc)}`, PB_URL).toString(),
      { headers: { Authorization: token } },
    )
    if (!res.ok) {
      throw new Error(`按 id 读 bi_rows 失败：HTTP ${res.status}`)
    }
    const body: { items?: Record<string, unknown>[] } = await res.json()
    out.push(...(body.items ?? []))
    return limit > 0 ? out.slice(0, limit) : out
  }

  let page = 1
  for (;;) {
    const filter = encodeURIComponent(`component_id="${componentId}"`)
    const res = await fetch(
      new URL(
        `/api/collections/bi_rows/records?page=${page}&perPage=${PB_PAGE_SIZE}`
        + `&filter=${filter}&skipTotal=1`,
        PB_URL,
      ).toString(),
      { headers: { Authorization: token } },
    )
    if (!res.ok) {
      throw new Error(`读取 bi_rows 失败：HTTP ${res.status}`)
    }
    const body: { items?: Record<string, unknown>[] } = await res.json()
    const items = body.items ?? []
    out.push(...items)
    if (limit > 0 && out.length >= limit) {
      return out.slice(0, limit)
    }
    if (items.length < PB_PAGE_SIZE) {
      break
    }
    page++
  }
  return out
}

/** 一行的处理计划 */
interface Plan {
  id: string
  sku: string
  /** 目标快照（列 → data 的结果） */
  next: Record<string, unknown>
  diffs: SnapshotDiff[]
  /** 快照要不要写 */
  changed: boolean
  oldKey: string
  /** rekey 打开时：按当前列算出的新键；否则空串 */
  newKey: string
}

/** 算出某一行"应变成什么样"（目标快照 + 新键） */
function planOf (rec: Record<string, unknown>, includeBlanks: boolean, rekey: boolean): Plan {
  const { next, changed, diffs } = snapshotOf(rec, includeBlanks)
  /*
   * 新键按「列里确实有值就取列、否则取快照」拼 —— 与写快照是**同一套规则**。
   * 不能直接用列拼：呆滞这类字段的列里是空的（从没被写过），快照里才有 '0'/'1'，
   * 直接用列会把键的最后一段算成空串，比现在的键更糟。
   */
  const merged = {
    ...((rec.data && typeof rec.data === 'object' ? rec.data : {}) as Record<string, unknown>),
    ...pickNonBlankColumns(rec),
  }
  return {
    id: String(rec.id ?? ''),
    sku: String(rec.sku ?? ''),
    next,
    diffs,
    changed,
    oldKey: String(rec.sync_key ?? ''),
    newKey: rekey ? makeSyncKey(merged) : '',
  }
}

/**
 * 决定哪些行可以改键。
 *
 * `bi_rows` 上有 `UNIQUE(component_id, sync_key)`：两行写成同一个键会被 PB 直接拒
 * （报错是底层索引错误，很难懂），所以先在内存里挑出来 ——
 * 冲突的行**跳过改键**（快照照常同步），并把原因报给界面。
 *
 * @returns keys = 行 id → 要写成的新键（不需要改的行不在里面）；
 *          changes = 能改的例子；conflicts = 被跳过的 + 原因
 */
function resolveKeys (plans: Plan[]): {
  keys: Map<string, string>
  changes: SnapshotSyncSummary['keySamples']
  conflicts: SnapshotSyncSummary['keySamples']
} {
  const moves = plans.filter(p => p.newKey && p.newKey !== p.oldKey)
  const wantedCount = new Map<string, number>()
  const keyOwner = new Map<string, string>()
  for (const p of plans) {
    keyOwner.set(p.oldKey, p.id)
  }
  for (const p of moves) {
    wantedCount.set(p.newKey, (wantedCount.get(p.newKey) ?? 0) + 1)
  }

  const keys = new Map<string, string>()
  const changes: SnapshotSyncSummary['keySamples'] = []
  const conflicts: SnapshotSyncSummary['keySamples'] = []
  for (const p of moves) {
    const takenByOther = keyOwner.has(p.newKey) && keyOwner.get(p.newKey) !== p.id
    const wantedTwice = (wantedCount.get(p.newKey) ?? 0) > 1
    if (takenByOther || wantedTwice) {
      conflicts.push({
        id: p.id,
        sku: p.sku,
        from: p.oldKey,
        to: p.newKey,
        reason: wantedTwice ? '多行都想改成这个键' : '这个键被另一行占着',
      })
      continue
    }
    keys.set(p.id, p.newKey)
    changes.push({ id: p.id, sku: p.sku, from: p.oldKey, to: p.newKey, reason: '' })
  }
  return { keys, changes, conflicts }
}

/**
 * 执行快照同步。
 *
 * @param opts.token       调用者的 PB token（服务端据此确认是超级管理员，不采信前端字段）
 * @param opts.dryRun      true = 只统计差异、不写库（界面先用它把"将更新多少行"摆出来）
 * @param opts.ids         只处理这些行（调试 / 单行修复）
 * @param opts.limit       只处理前 N 行（0 = 不限）
 */
export async function syncSnapshots (opts: {
  token: string
  /** 不传就用默认组件（见 DEFAULT_COMPONENT_ID） */
  componentId?: string
  dryRun: boolean
  ids?: string[]
  limit?: number
  /** true = 连「列里是 0/空」的值一起写进快照（默认 false，见 snapshotOf 里的保险说明） */
  includeBlanks?: boolean
  /** true = 顺带按当前列重算 `sync_key`（唯一键；冲突的会跳过并报出来） */
  rekey?: boolean
}): Promise<SnapshotSyncSummary> {
  const by = await assertSuperAdmin(opts.token, '同步快照')
  const admin = await adminToken()
  const start = Date.now()
  const componentId = opts.componentId || DEFAULT_COMPONENT_ID
  const includeBlanks = opts.includeBlanks === true

  const rows = await readRows(admin, componentId, opts.ids ?? [], opts.limit ?? 0)
  const rekey = opts.rekey === true

  const fieldChanges = new Map<string, { key: string, column: string, rows: number, zeroed: number }>()
  const samples: SnapshotSyncSummary['samples'] = []
  const failures: string[] = []
  let unchanged = 0
  let skippedBlanks = 0
  let keyChanged = 0

  /* ---------- 第一遍：算出每行"应变成什么样" ---------- */
  const plans = rows.map(rec => planOf(rec, includeBlanks, rekey))

  /* ---------- 唯一索引冲突预检 + 决定谁能改键 ---------- */
  const { keys, changes: keyChanges, conflicts: keyConflicts } = resolveKeys(plans)

  /* ---------- 第二遍：决定每行要不要写、写什么 ---------- */
  const pending: Array<{ id: string, sku: string, data?: Record<string, unknown>, key?: string }> = []

  for (const p of plans) {
    for (const d of p.diffs) {
      const cur = fieldChanges.get(d.key) ?? { key: d.key, column: d.column, rows: 0, zeroed: 0 }
      if (d.skipped) {
        cur.zeroed++
        skippedBlanks++
      } else {
        cur.rows++
        if (samples.length < 8) {
          samples.push({ id: p.id, sku: p.sku, key: d.key, from: fmtForSample(d.from), to: fmtForSample(d.to) })
        }
      }
      fieldChanges.set(d.key, cur)
    }

    const key = keys.get(p.id)
    if (!p.changed && !key) {
      unchanged++
      continue
    }
    if (key) {
      keyChanged++
    }
    pending.push({
      id: p.id,
      sku: p.sku,
      ...(p.changed ? { data: p.next } : {}),
      ...(key ? { key } : {}),
    })
  }

  /* ---------- 写回：只 PATCH 变化的那几个字段（data / sync_key），列一律不动 ---------- */
  let written = 0
  let failed = 0
  if (!opts.dryRun && pending.length > 0) {
    let cursor = 0
    const worker = async () => {
      while (cursor < pending.length) {
        const job = pending[cursor++]
        try {
          const res = await fetch(
            new URL(`/api/collections/bi_rows/records/${job.id}`, PB_URL).toString(),
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': admin },
              body: JSON.stringify({
                ...(job.data ? { data: job.data } : {}),
                ...(job.key ? { sync_key: job.key } : {}),
              }),
            },
          )
          if (res.ok) {
            written++
          } else {
            failed++
            const text = await res.text().catch(() => '')
            if (failures.length < 20) {
              failures.push(`${job.sku || job.id}：HTTP ${res.status} ${text.slice(0, 120)}`)
            }
          }
        } catch (error) {
          failed++
          if (failures.length < 20) {
            failures.push(`${job.sku || job.id}：${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, pending.length)) }, worker))
  }

  const summary: SnapshotSyncSummary = {
    dryRun: opts.dryRun,
    by,
    componentId,
    scanned: rows.length,
    /** 需要重写快照的行数（dryRun 与执行都一样，是"需要"；实际成功多少看 written） */
    changed: plans.filter(p => p.changed).length,
    unchanged,
    /** 需要重算 sync_key 的行数（已排除冲突的） */
    keyChanged,
    keyConflicts: keyConflicts.length,
    // 冲突的先列（要人去处理），再列能改的
    keySamples: [...keyConflicts, ...keyChanges].slice(0, 8),
    written: opts.dryRun ? 0 : written,
    failed: opts.dryRun ? 0 : failed,
    fieldChanges: [...fieldChanges.values()].toSorted((a, b) => b.rows - a.rows).slice(0, 12),
    samples,
    skippedBlanks,
    includeBlanks,
    rekey,
    failures,
    elapsedMs: Date.now() - start,
  }

  console.log(
    `[biSnapshot] ${opts.dryRun ? '(dryRun) ' : ''}${summary.by.email ?? summary.by.id} `
    + `扫描 ${summary.scanned} 行 → 需重写快照 ${summary.changed} 行、未变 ${summary.unchanged} 行；`
    + `跳过「列是 0/空」 ${summary.skippedBlanks} 处`
    + `${summary.includeBlanks ? '（includeBlanks=1，会写下去）' : ''}；`
    + `${rekey ? `重算 sync_key ${summary.keyChanged} 行（冲突跳过 ${summary.keyConflicts} 行）；` : ''}`
    + `${opts.dryRun ? '' : `实际写入 ${summary.written} 行、失败 ${summary.failed} 行；`}`
    + `耗时 ${(summary.elapsedMs / 1000).toFixed(1)}s`,
  )
  return summary
}

/**
 * 列里"确实有值"的字段（中文 key → 值）。
 *
 * 规则与写快照的保险**完全一致**：列为 0 / 空 的一律不算"有值" ——
 * 否则拿它去拼 sync_key 会把呆滞那段算成空串（列里那块从来没人写过）。
 */
function pickNonBlankColumns (rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of BI_ROW_FIELDS) {
    const v = rec[f.field]
    if (isBlank(v)) {
      continue
    }
    out[f.key] = toSnapshotValue(v, f.type)
  }
  return out
}

/** 样例里展示的值：太长截断，空值显式写成「(空)」 */
function fmtForSample (value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') {
    return '(空)'
  }
  const s = String(value)
  return s.length > 24 ? `${s.slice(0, 24)}…` : s
}

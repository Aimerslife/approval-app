/**
 * biSync.ts
 *
 * 把 BI 组件数据同步进 PocketBase 的 `bi_rows` 集合（一行一条记录）。
 *
 * 为什么这件事要在服务端做，而不是像原来那样在浏览器里做：
 *   1) 原方案是浏览器把整份 10.5MB 数据写进 bi_data_cache 的**单个记录**的 json 字段，
 *      已逼近 PB 的请求体上限（实测 35MB 返回 413），且每次读都要全量传输；
 *   2) BI 的 accessKeySecret 不该出现在前端 —— src/api/api.ts 用的是 `VITE_` 变量，
 *      会被打进产物、任何人可见；
 *   3) 服务端写的是本机 PB，不受浏览器超时/切页中断影响，可以放心分页拉、分批写。
 *
 * ⚠️ 下面这套归一化逻辑（BI_FIELD_ALIAS / BI_VALUE_MAP / DIMENSION_FIELDS）
 *    在 src/api/api.ts 里还有一份 —— 服务端拿不到 import.meta.env，也没法直接
 *    import 那个模块。**改一处必须同步改另一处**，否则前端显示的字段名和库里存的会对不上。
 */

import { BI_ROW_FIELDS, BI_ROW_FIELD_BY_KEY, makeSyncKey, SYNC_KEY_FIELDS } from '../src/utils/biRowFields'

const BI_BASE = process.env.BI_BASE_URL || 'https://work.jiushuyun.com/decision'
const BI_ACCESS_KEY_ID = process.env.BI_ACCESS_KEY_ID || process.env.VITE_ACCESSKEYID || ''
const BI_ACCESS_KEY_SECRET = process.env.BI_ACCESS_KEY_SECRET || process.env.VITE_ACCESSKEYSECRET || ''
const BI_COMPONENT_ID = process.env.BI_COMPONENT_ID || '0c356d17-3c48-4c3b-b133-e6406a88c5fe'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8091'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || ''
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || ''

/** 接口 pageSize 上限（与 api.ts 一致） */
const BI_PAGE_SIZE = 500

/**
 * 分片拉取配置。
 *
 * 为什么需要分片：BI 的 component/data 接口**没有确定的排序** ——
 * 实测同一页请求两次返回的**行不一样**、请求体传 sorts/sortBy 四种形态全部被静默忽略，
 * 于是 LIMIT/OFFSET 每页切到的是数据集的任意一片：17 页汇总下来 8017 行里 76% 是重复，
 * 同时又漏行 ✗。
 *
 * 分片能绕开它：**每片控制在 500 行以内 → 每片只请求一页 → 不翻页就没有 OFFSET 漂移** ✓。
 *
 * 配置要求（两者必须对上，否则分片无效且不会有任何报错）：
 *   BI_SHARD_DIMENSION = 用来切分的**数据列名**（如「部门」）
 *   BI_SHARD_PARAM     = 该维度在 BI 仪表板里对应的**参数名**
 *                        （且组件的数据过滤里必须**引用**了它 —— 只建参数不引用，传了也白传）
 *
 * 留空 BI_SHARD_PARAM 则退化为原来的全量翻页（会有重复与漏行）。
 * 分片是否真的生效由 tryShardedFetch 自校验（每片返回的行必须都属于该片）。
 */
const SHARD_DIMENSION = process.env.BI_SHARD_DIMENSION || '部门'
const SHARD_PARAM = process.env.BI_SHARD_PARAM || ''

/**
 * 尝试分片拉取。任何一片不自洽就返回 null（调用方退化为全量翻页）。
 *
 * 自校验是这里最关键的部分 —— 参数名写错时接口**既不报错也不过滤**（静默失效），
 * 如果只看「请求成功」就采信，会把"没过滤的全量"当成"一个分片"存进去 ✗✗。
 * 所以每片都校验：返回的每一行，分片维度的值都必须等于该片的值。
 */
async function tryShardedFetch(
  componentId: string,
  token: string,
  seenColumns: Set<string>,
): Promise<Record<string, unknown>[] | null> {
  const post = async (parameters?: { name: string; value: unknown }[]) => {
    const res = await fetch(`${BI_BASE}/api/public/analysis/v1/component/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `${token}` },
      body: JSON.stringify({
        componentId,
        pageRequest: { pageIndex: 1, pageSize: BI_PAGE_SIZE },
        ...(parameters?.length ? { parameters } : {}),
      }),
    })
    const body: any = await res.json()
    if (body?.code !== 200) {
      throw new Error('分片拉取失败: ' + (body?.errorMsg || body?.message || `code=${body?.code}`))
    }
    if (!body.data) throw new Error('分片拉取失败: 返回体缺少 data')
    const fields: { name: string }[] = body.data.fields ?? []
    const rows: unknown[][] = body.data.rows ?? []
    const normalized = rows.map(row => {
      const item: Record<string, unknown> = {}
      fields.forEach((f, i) => {
        const key = BI_FIELD_ALIAS[f.name] ?? f.name
        seenColumns.add(key)
        item[key] = BI_VALUE_MAP[f.name]?.[String(row[i])] ?? row[i]
      })
      return item
    })
    return { normalized, hasNext: !!body.data.page?.hasNext }
  }

  // 1) 分片值发现：维度取值通常很少，一页 500 行的样本足够覆盖。
  //    （后面每片都会校验行是否真属于该片，所以这里漏了值也不会写进错数据。）
  const probe = await post()
  const values = [...new Set(probe.normalized.map(r => String(r[SHARD_DIMENSION] ?? '').trim()))]
    .filter(Boolean)
    .sort()
  if (values.length <= 1) {
    console.warn(
      `[biSync] ⚠️ 「${SHARD_DIMENSION}」只发现 ${values.length} 个取值，分片没有意义 → 退化为全量翻页`,
    )
    return null
  }
  console.log(
    `[biSync] 分片拉取：按「${SHARD_DIMENSION}」分 ${values.length} 片（参数名「${SHARD_PARAM}」）`,
  )

  // 2) 逐片拉取 + 自校验
  const all: Record<string, unknown>[] = []
  const bad: string[] = []
  for (const value of values) {
    const { normalized, hasNext } = await post([{ name: SHARD_PARAM, value }])
    const wrong = normalized.filter(r => String(r[SHARD_DIMENSION] ?? '').trim() !== value).length
    if (wrong > 0) {
      // 参数没生效：返回的行里混着别的分片
      bad.push(`${value}（${wrong}/${normalized.length} 行不属于该片 → 参数名不对或过滤没引用它）`)
      continue
    }
    if (hasNext) {
      bad.push(`${value}（超过 ${BI_PAGE_SIZE} 行，一页装不下 → 该维度分得不够细）`)
      continue
    }
    all.push(...normalized)
  }

  if (bad.length) {
    console.warn(
      `[biSync] ⚠️ ${bad.length}/${values.length} 片不可用：\n  ` + bad.slice(0, 5).join('\n  ') +
        '\n  → 本次退化为全量翻页（会有重复与漏行）。请核对 BI_SHARD_PARAM / BI_SHARD_DIMENSION。',
    )
    return null
  }

  console.log(`[biSync] ✅ 分片拉取完成：${values.length} 片共 ${all.length} 行（无翻页，无重复）`)
  return all
}
/** 同时发起的 PB 写请求数。本地 PB 不需要太高，10 已经能把 3000+ 行压到几秒 */
const PB_CONCURRENCY = 10
/** PB 列表接口每页条数上限 */
const PB_PAGE_SIZE = 500

/** 见 src/api/api.ts 的同名表，必须保持一致 */
const BI_FIELD_ALIAS: Record<string, string> = {
  '库存SKU': 'SKU',
  '供应商是否为络好饰': '供应商',
  '3个月内[数量]': '3个月内[0-90]',
  '3-6个月内[数量]': '3-6个月内[91-180]',
  '6-9个月内[数量]': '6-9个月内[181-270]',
  '9-12个月内[数量]': '9-12个月内[271-365]',
  '1年以上[数量]': '1年以上[365+]',
  '3个月内（金额）': '3个月内[0-90]（金额）',
  '3-6个月内(金额)': '3-6个月内[91-180](金额)',
  '6-9个月内(金额)': '6-9个月内[181-270](金额)',
  '9-12个月内(金额）': '9-12个月内[271-365](金额）',
  '一年以上(金额)': '一年以上[365+](金额)',
}

/** 见 src/api/api.ts 的同名表，必须保持一致 */
const BI_VALUE_MAP: Record<string, Record<string, string>> = {
  '是否属于灯具': { '灯具': '是', '非灯具': '否' },
}

/**
 * 65 个业务列的中文列名 → PB 列名的映射，唯一来源是 src/utils/biRowFields.ts。
 *
 * 表结构（pocketbase/pb_migrations/1789660100_updated_bi_rows.js）由
 * scripts/gen-bi-rows-migration.ts 从**同一份映射**生成，所以两边不会对不上。
 *
 * ⚠️ biRowFields.ts 在模块加载时会跑几组断言（字段数 65、类型分布 22/43、
 * 与 productFields.ts 逐一对应），有问题会直接抛错 —— 服务启动时就能发现，
 * 而不是等同步把数据写歪了才发现。
 *
 * 说明：这里以前只提升 9 个「维度」，现在按「当前所有字段都建成真列」改成全量。
 * `data` 列仍然保留整行快照，所以将来 BI 新增列时数据不会丢（只会暂时进不了索引）。
 */
const ROW_FIELDS = BI_ROW_FIELDS

// ========== 小工具 ==========

/**
 * 稳定序列化：按 key 排序后再拼字符串。
 * 用途是比较「这一行和库里那行内容是否相同」—— 直接 JSON.stringify 会因为
 * PB 返回的字段顺序与 BI 不同而误判成「变了」，导致每次同步都全量重写。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const obj = value as Record<string, unknown>
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map(k => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  )
}

/** 限制并发的 map。3000+ 行逐个 await 会慢到几十秒，全并发又会打爆 PB */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

// ========== BI 拉取 ==========

async function fetchBiToken(): Promise<string> {
  if (!BI_ACCESS_KEY_ID || !BI_ACCESS_KEY_SECRET) {
    throw new Error('缺少 BI_ACCESS_KEY_ID / BI_ACCESS_KEY_SECRET 环境变量')
  }
  const url =
    `${BI_BASE}/api/v1/corp/oauth/token?accessKeyId=${encodeURIComponent(BI_ACCESS_KEY_ID)}` +
    `&accessKeySecret=${encodeURIComponent(BI_ACCESS_KEY_SECRET)}`
  const res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
  const body: any = await res.json()
  if (!body?.success || !body?.data) {
    throw new Error('获取 BI token 失败: ' + (body?.errorMsg || body?.message || `HTTP ${res.status}`))
  }
  return body.data as string
}

/**
 * 逐页拉完整个组件的数据。
 *
 * ⚠️ 实测该接口的翻页**不可靠**：跨页会返回大量完全重复的行
 * （pageSize=10 时第 2 页有 5/10 与第 1 页重复，第 3 页有 7/10 与第 2 页重复），
 * 且传 sorts / sortBy 四种形态均被**静默忽略**。所以这里只负责「尽量拉全」，
 * 去重交给调用方（按 sync_key）。
 */
async function fetchAllBiRows(
  componentId: string,
): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
  const token = await fetchBiToken()
  const all: Record<string, unknown>[] = []
  /** BI 实际返回的列名（归一化后）。用于比对映射表，发现「BI 新增了但还没入库」的列 */
  const seenColumns = new Set<string>()

  // 优先走分片（每片只取一页，绕开 BI 不稳定的分页）。未配置参数名或校验不通过时返回 null。
  if (SHARD_PARAM) {
    try {
      const sharded = await tryShardedFetch(componentId, token, seenColumns)
      if (sharded) return { rows: sharded, columns: [...seenColumns] }
    } catch (err: any) {
      console.warn('[biSync] ⚠️ 分片拉取异常，退化为全量翻页: ' + (err?.message ?? err))
    }
  }

  let pageIndex = 1

  for (;;) {
    const res = await fetch(`${BI_BASE}/api/public/analysis/v1/component/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `${token}` },
      body: JSON.stringify({ componentId, pageRequest: { pageIndex, pageSize: BI_PAGE_SIZE } }),
    })
    const body: any = await res.json()
    if (body?.code !== 200) {
      throw new Error('拉取 BI 数据失败: ' + (body?.errorMsg || body?.message || `code=${body?.code}`))
    }
    const data = body.data
    if (!data) throw new Error('拉取 BI 数据失败: 返回体缺少 data')

    const fields: { name: string }[] = data.fields ?? []
    const rows: unknown[][] = data.rows ?? []
    for (const row of rows) {
      const item: Record<string, unknown> = {}
      fields.forEach((f, i) => {
        const key = BI_FIELD_ALIAS[f.name] ?? f.name
        seenColumns.add(key)
        item[key] = BI_VALUE_MAP[f.name]?.[String(row[i])] ?? row[i]
      })
      all.push(item)
    }

    if (!data.page?.hasNext || rows.length === 0) break
    pageIndex++
  }

  return { rows: all, columns: [...seenColumns] }
}

// ========== PocketBase 访问 ==========

/**
 * PB 管理员 token。
 *
 * 路径分两种：PB 0.23+ 是 /api/collections/_superusers/...，更早的版本是 /api/admins/...。
 * 两个都试一遍，避免因为版本不同而"同步功能整个不可用"。
 */
let cachedAdminToken = ''
async function pbAdminToken(): Promise<string> {
  if (cachedAdminToken) return cachedAdminToken
  if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
    throw new Error('缺少 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD 环境变量（bi_rows 只有管理员可写）')
  }
  const candidates = [
    '/api/collections/_superusers/auth-with-password',
    '/api/admins/auth-with-password',
  ]
  const errors: string[] = []
  for (const path of candidates) {
    const res = await fetch(new URL(path, PB_URL).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
    })
    const body: any = await res.json().catch(() => null)
    if (res.ok && body?.token) {
      cachedAdminToken = body.token as string
      return cachedAdminToken
    }
    errors.push(`${path} → HTTP ${res.status}`)
  }
  throw new Error('PB 管理员登录失败（已试 _superusers 与 admins）: ' + errors.join('; '))
}

/** 带管理员身份的 PB REST 请求 */
async function pbAuthed(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const token = await pbAdminToken()
  const res = await fetch(new URL(path, PB_URL).toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  // token 过期（PB 默认 14 天，但重启/清理也可能失效）时清掉，下次调用重新登录
  if (res.status === 401 || res.status === 403) cachedAdminToken = ''
  return { status: res.status, data }
}

/** 读出库里现有的所有行（只取比较需要的列，不拉 data 以外的冗余字段） */
async function readExistingRows(
  componentId: string,
): Promise<Map<string, { id: string; hash: string }>> {
  const map = new Map<string, { id: string; hash: string }>()
  let page = 1
  for (;;) {
    const filter = encodeURIComponent(`component_id="${componentId}"`)
    const { status, data } = await pbAuthed(
      'GET',
      `/api/collections/bi_rows/records?page=${page}&perPage=${PB_PAGE_SIZE}` +
        `&filter=${filter}&fields=id,sync_key,data&skipTotal=1`,
    )
    if (status !== 200) throw new Error(`读取 bi_rows 失败: HTTP ${status} ${JSON.stringify(data)?.slice(0, 200)}`)
    const items: any[] = data?.items ?? []
    for (const it of items) {
      map.set(String(it.sync_key ?? ''), { id: it.id, hash: stableStringify(it.data ?? null) })
    }
    if (items.length < PB_PAGE_SIZE) break
    page++
  }
  return map
}

// ========== 同步主流程 ==========

export interface SyncSummary {
  /** BI 返回的总行数（含重复） */
  fetched: number
  /** 按 sync_key 去重后的行数 */
  unique: number
  /** 因为 SKU 为空而跳过的行数（空 key 全都撞在 '' 上，写进去只会互相覆盖） */
  missingKey: number
  /** 去重掉的行数 = exactRepeatRows + conflictRows */
  duplicates: number
  /** 完全重复的行数（同 key 同内容，丢弃安全） */
  exactRepeatRows: number
  /** 冲突行数（同 key 不同内容，被「先到者保留」丢弃 —— 可能是有损的） */
  conflictRows: number
  /**
   * BI 返回次数最多的几个 key（含重复次数）。
   * 用来直接回答「为什么 8017 行只有 ~1943 个逻辑行」：
   * 同一个 key 在 BI 的分页结果里会重复出现很多次。
   */
  topRepeatedKeys: { key: string; rows: number }[]
  /** ⚠️ SKU 相同但内容不同的冲突（说明 SKU 不唯一，需要改 sync_key 口径） */
  conflicts: { key: string; count: number }[]
  /**
   * 冲突行之间「哪几列不一样」的统计（按出现次数降序）。
   * 这就是 sync_key 需要补的维度 —— 看这个，别猜。
   */
  conflictDiffColumns: { column: string; rows: number }[]
  /**
   * 冲突样例（最多 3 组），只含「值不同的列」及其各行取值。
   * 用来判断这批冲突能不能再补一个维度区分开；补不了就只能「后到覆盖先到」。
   */
  conflictSamples: { key: string; count: number; diff: Record<string, unknown[]> }[]
  created: number
  updated: number
  /** 内容没变、跳过的数量（重复同步几乎零写入） */
  unchanged: number
  /** 库里存在但 BI 这次没返回的行数（默认不删，见 prune 参数） */
  orphaned: number
  pruned: number
  /** dryRun 时为 true，表示什么都没写 */
  dryRun: boolean
  elapsedMs: number
  /** BI 返回了但映射表里没有的列（数据仍在 data 里，但没建成真列、无法按它筛选） */
  unmappedColumns: string[]
  /**
   * 本次读库里现有数据失败（通常是没有管理员凭据）。
   * 为 true 时 created/updated/unchanged/orphaned 全是 0、不代表真实情况，
   * 只有 fetched / unique / duplicates / missingKey / conflicts / unmappedColumns 可信。
   */
  existingReadFailed: boolean
}

// ========== 按唯一键去重（纯函数：BI 同步与 Excel 上传共用） ==========

export interface DedupeResult {
  /** 唯一键 → 保留的那一行。同 key 多行时**先到者胜** */
  byKey: Map<string, Record<string, unknown>>
  /** 去重后的行数 */
  unique: number
  /** 因为唯一键为空（SKU 为空）被跳过的行数 —— 空 key 会全撞在 '' 上互相覆盖，必须丢 */
  missingKey: number
  /** 被去重掉的总行数 = exactRepeatRows + conflictRows */
  duplicates: number
  /** 同 key 且内容完全相同（丢弃是安全的） */
  exactRepeatRows: number
  /** 同 key 但内容不同（「先到者保留」丢弃，可能有损） */
  conflictRows: number
  /** 每个 key 出现次数（含重复），用来解释「8000 行只有 ~1900 个逻辑行」 */
  occurrencesByKey: Map<string, number>
  /** 有冲突的 key → 冲突次数 */
  conflicts: Map<string, number>
  /** 冲突行之间「哪几列不一样」的统计 */
  conflictDiffColumns: Map<string, number>
  /** 冲突样例（最多 3 组），只含值不同的列 */
  conflictSamples: { key: string; count: number; diff: Record<string, unknown[]> }[]
}

/**
 * 按唯一键（makeSyncKey = SKU|店铺|仓位|组别）给一批行去重，并统计冲突。
 *
 * ⚠️ 这是「唯一键」口径的**唯一实现**：DB 上的 UNIQUE INDEX 只是最后一道保险，
 * 真正的判等规则在这里。BI 同步与 Excel 上传都必须走它 ——
 * 两边各写一套的话，同一份数据会得出不同的行数，而且不会有任何报错。
 *
 * 纯函数、不碰 I/O，所以能被 tsx 直接加载做单测。
 */
/**
 * 比较「内容是否一致」时要忽略的键。
 *
 * `id` 是**同步过程补的行号**（normalizeBiRows 与 parseExcelSheet 都会加），
 * 不属于 65 个业务字段，而且**每次拉取都会变**（BI 翻页不稳定，同一逻辑行
 * 每次落在不同位置）。不排除它会同时踩两个坑：
 *   1) 判重：BI 翻页重复返回的同一行会被算成「同键不同内容」的**冲突**，
 *      而它们除 id 外逐列一致，属于可以安全丢弃的重复 ——
 *      实测 8018 行里 6062 个「冲突」全部只差 id，会让人误以为键的粒度不够；
 *   2) 增量：`data` 快照里留着 id 的话，下次比对内容时永远判为「变了」，
 *      于是每次同步都全量重写，幂等彻底失效。
 */
const HASH_IGNORED_KEYS = new Set(['id'])

/** 复制一份不含指定键的对象（只用于比较 / 落库，不改原始行） */
function omitKeys(row: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k in row) {
    if (!keys.has(k)) out[k] = row[k]
  }
  return out
}

export function dedupeBySyncKey(rawRows: Record<string, unknown>[]): DedupeResult {
  const byKey = new Map<string, Record<string, unknown>>()
  const hashByKey = new Map<string, string>()
  const firstRowByKey = new Map<string, Record<string, unknown>>()
  const conflicts = new Map<string, number>()
  /**
   * 「冲突行之间到底哪几列不一样」的统计。
   *
   * 这就是唯一键需要补的维度。**不要靠猜**（平台？店铺？日期？）——
   * 选错维度会让本来不同的行互相覆盖，而且不会报错。
   */
  const conflictDiffColumns = new Map<string, number>()
  /** 冲突样例（最多 3 组）：只列「值不同的列」及各行的取值，用于判断能不能再补一个维度 */
  const conflictSamples: { key: string; count: number; diff: Record<string, unknown[]> }[] = []
  const occurrencesByKey = new Map<string, number>()
  let missingKey = 0
  let duplicates = 0
  /** 完全重复的行数（同 key 同内容）：翻页不稳定导致的，丢弃是**安全**的 */
  let exactRepeatRows = 0
  /** 冲突行数（同 key 不同内容）：被「先到者保留」丢弃，**这部分是可能有损的**，要单独计数 */
  let conflictRows = 0

  for (const raw of rawRows) {
    const key = makeSyncKey(raw)
    if (!key) {
      missingKey++
      continue
    }
    occurrencesByKey.set(key, (occurrencesByKey.get(key) ?? 0) + 1)
    // 判内容一致性前先剔除行号等非业务键（见 HASH_IGNORED_KEYS），否则重复会被误判成冲突
    const row = omitKeys(raw, HASH_IGNORED_KEYS)
    const hash = stableStringify(row)
    const prevHash = hashByKey.get(key)
    if (prevHash !== undefined) {
      duplicates++
      if (prevHash === hash) {
        exactRepeatRows++
      } else {
        // 同 key 不同内容 = 真冲突：先到者胜，被丢掉的这部分可能有损，必须报出来
        conflictRows++
        conflicts.set(key, (conflicts.get(key) ?? 0) + 1)
        const first = firstRowByKey.get(key)
        if (first) {
          const diff: Record<string, unknown[]> = {}
          for (const col of Object.keys(row)) {
            const a = stableStringify(row[col])
            const b = stableStringify(first[col])
            if (a !== b) {
              conflictDiffColumns.set(col, (conflictDiffColumns.get(col) ?? 0) + 1)
              // 采样时只记「值不同的列」以及各行该列的取值（去重）——输出短、又能直接看出差在哪
              diff[col] = [...new Set([b, a])].map(s => JSON.parse(s))
            }
          }
          const sampled = conflictSamples.find(s => s.key === key)
          if (sampled) sampled.count++
          else if (conflictSamples.length < 3) conflictSamples.push({ key, count: 1, diff })
        }
      }
      continue
    }
    hashByKey.set(key, hash)
    firstRowByKey.set(key, row)
    byKey.set(key, row)
  }

  return {
    byKey,
    unique: byKey.size,
    missingKey,
    duplicates,
    exactRepeatRows,
    conflictRows,
    occurrencesByKey,
    conflicts,
    conflictDiffColumns,
    conflictSamples,
  }
}

// ========== 差异比对 + 写库（BI 同步与 Excel 上传共用） ==========

export interface UpsertResult {
  created: number
  updated: number
  unchanged: number
  /** 库里存在、但这批数据里没有的行数（**默认不删**） */
  orphaned: number
  pruned: number
  /** 读库里现有数据失败（通常是没有管理员凭据）。为 true 时上面几个计数都不可信 */
  existingReadFailed: boolean
  /** 写入失败的明细（唯一索引冲突 / HTTP 错误），最多保留前 20 条 */
  failures: string[]
}

/**
 * 把「唯一键 → 行」写进 bi_rows：读现有 → 只比 data 字段 → 新增 / 更新（可选删除）。
 *
 * 为什么只比 `data`：其余列（sku / 平台 / 部门 …）都是从 data 派生出来的，
 * data 没变就整行没变 —— 不用去比 65 列，重复同步几乎零写入。
 *
 * @param opts.dryRun 只算差异不写库（读是只读的，没有副作用）
 * @param opts.prune  删除「库里存在但本批没有」的行。**默认 false**：删数据是破坏性的，
 *                    Excel 上传尤其危险 —— 上传的往往只是全量的一个子集，
 *                    一 prune 就把没有覆盖到的行全删了。
 */
export async function upsertBySyncKey(
  byKey: Map<string, Record<string, unknown>>,
  componentId: string,
  opts: { dryRun?: boolean; prune?: boolean } = {},
): Promise<UpsertResult> {
  const dryRun = opts.dryRun === true

  // 读库里现有的，做差异比对。dryRun **也要读** —— 否则 created 永远是「全部新建」、
  // orphaned 永远是 0，dryRun 就失去了意义。读是只读操作，没有副作用。
  //
  // 但「读不到」不等于「库里是空的」：dryRun 最有价值的部分
  // （去重、查冲突、列未入库）**完全不需要 PB 权限**，
  // 没配管理员凭据时也应该能把它们报出来。
  // 写库时读不到则必须报错退出 —— 否则会把所有行都当成新行重复插入。
  let existing: Map<string, { id: string; hash: string }>
  let existingReadFailed = false
  try {
    existing = await readExistingRows(componentId)
  } catch (err: any) {
    if (!dryRun) throw err
    existingReadFailed = true
    console.warn(
      '[biSync] 读不到库里现有数据（通常是没配 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD）：' +
        '本次只报去重与冲突，created / updated / unchanged / orphaned 一律按 0 计。' +
        '原因: ' + (err?.message ?? err),
    )
    existing = new Map()
  }

  const toCreate: { key: string; row: Record<string, unknown> }[] = []
  const toUpdate: { id: string; key: string; row: Record<string, unknown> }[] = []
  let unchanged = 0

  const fetchedAt = new Date().toISOString()
  for (const [key, row] of byKey) {
    const payload = buildRecord(componentId, key, row, fetchedAt)
    const prev = existing.get(key)
    if (!prev) {
      toCreate.push({ key, row: payload })
      continue
    }
    // 只比 data 字段：其余字段都是从 data 派生出来的，data 没变就整行没变
    if (prev.hash === stableStringify(payload.data)) {
      unchanged++
      continue
    }
    toUpdate.push({ id: prev.id, key, row: payload })
  }

  // 库里多出来的行（这批数据没覆盖到的）
  const orphanIds: string[] = []
  for (const [key, info] of existing) {
    if (!byKey.has(key)) orphanIds.push(info.id)
  }

  // dryRun 的语义是「预演」：报出**将要**发生的写入数量，而不是一律 0 ——
  // 全 0 的话调用方分不清「数据没变」和「根本没执行」，这个参数就白加了。
  if (dryRun) {
    return {
      created: toCreate.length,
      updated: toUpdate.length,
      unchanged,
      orphaned: orphanIds.length,
      pruned: 0,
      existingReadFailed,
      failures: [],
    }
  }

  let created = 0
  let updated = 0
  let pruned = 0
  let failures: string[] = []

  {
    const createResults = await mapWithConcurrency(toCreate, PB_CONCURRENCY, async (item) => {
      const { status, data } = await pbAuthed('POST', '/api/collections/bi_rows/records', item.row)
      if (status >= 400) {
        const detail = JSON.stringify(data)?.slice(0, 200)
        // 唯一索引冲突 = 键重复，是最需要让人看见的失败，单独报出来
        if (status === 400 && /unique|UNIQUE/i.test(detail ?? '')) {
          return `唯一索引冲突（${item.key}）: ${detail}`
        }
        return `创建失败（${item.key}）: HTTP ${status} ${detail}`
      }
      created++
      return null
    })

    const updateResults = await mapWithConcurrency(toUpdate, PB_CONCURRENCY, async (item) => {
      const { status, data } = await pbAuthed('PATCH', `/api/collections/bi_rows/records/${item.id}`, item.row)
      if (status >= 400) return `更新失败（${item.key}）: HTTP ${status} ${JSON.stringify(data)?.slice(0, 200)}`
      updated++
      return null
    })

    if (opts.prune) {
      await mapWithConcurrency(orphanIds, PB_CONCURRENCY, async (id) => {
        const { status } = await pbAuthed('DELETE', `/api/collections/bi_rows/records/${id}`)
        if (status < 400) pruned++
        return status
      })
    }

    failures = [...createResults, ...updateResults].filter(Boolean).slice(0, 20) as string[]
    if (failures.length) {
      console.warn(`[biSync] 有 ${failures.length} 条写入失败：`)
      for (const f of failures.slice(0, 10)) console.warn('  ' + f)
    }
  }

  return { created, updated, unchanged, orphaned: orphanIds.length, pruned, existingReadFailed, failures }
}

/**
 * 执行一次同步。
 *
 * @param componentId BI 组件 id
 * @param opts.dryRun 只拉数据、只算差异，**不写库**。
 *                    上线前应该先跑一次 dryRun：它会报出 SKU 冲突，
 *                    这正是「SKU 是否唯一」这个前提的验证手段。
 * @param opts.prune  是否删除「库里存在但 BI 已不再返回」的行。
 *                    默认 false —— 删数据是破坏性的，先看清楚 orphaned 有多少再决定。
 */
export async function syncBiRows(
  componentId = BI_COMPONENT_ID,
  opts: { dryRun?: boolean; prune?: boolean } = {},
): Promise<SyncSummary> {
  const start = Date.now()
  const dryRun = opts.dryRun === true

  const { rows: rawRows, columns } = await fetchAllBiRows(componentId)
  const fetched = rawRows.length
  // BI 有、但映射表里没有的列：数据不会丢（整行快照还在 data 里），但不会建成真列、
  // 也就不能按它筛选或排序。看到这条提示，就去 src/utils/biRowFields.ts 补列并重跑生成器。
  //
  // ⚠️ columns 里是**中文字段名**（BI 归一化后的 key），所以必须用「中文 key → 字段」的表来查。
  //    最初这里错用了 BI_ROW_KEY_BY_FIELD（那是反过来的「字段 → 中文 key」），
  //    结果 65 列全被误报成「未入库」。
  const unmappedColumns = columns.filter(c => !BI_ROW_FIELD_BY_KEY[c])

  // 1) 按唯一键去重；同时检查「同 key 但内容不同」的冲突。
  //    口径的唯一实现在 dedupeBySyncKey —— Excel 上传走的是同一个函数，两边不会分叉。
  const {
    byKey, unique, missingKey, duplicates, exactRepeatRows, conflictRows,
    occurrencesByKey, conflicts, conflictDiffColumns, conflictSamples,
  } = dedupeBySyncKey(rawRows)
  const conflictList = [...conflicts.entries()].map(([key, count]) => ({ key, count }))

  // 2) 读现有 → 比对 → 增 / 改（可选删）。
  //    与 Excel 上传共用同一个实现，两条路不会各写一套差异逻辑。
  const upsert = await upsertBySyncKey(byKey, componentId, { dryRun, prune: opts.prune === true })

  const summary: SyncSummary = {
    fetched,
    unique,
    missingKey,
    duplicates,
    exactRepeatRows,
    conflictRows,
    topRepeatedKeys: [...occurrencesByKey.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, rows]) => ({ key, rows })),
    conflicts: conflictList,
    conflictDiffColumns: [...conflictDiffColumns.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([column, rows]) => ({ column, rows })),
    conflictSamples,
    created: upsert.created,
    updated: upsert.updated,
    unchanged: upsert.unchanged,
    orphaned: upsert.orphaned,
    pruned: upsert.pruned,
    dryRun,
    elapsedMs: Date.now() - start,
    unmappedColumns,
    existingReadFailed: upsert.existingReadFailed,
  }

  console.log(
    `[biSync] ${dryRun ? '(dryRun) ' : ''}拉到 ${fetched} 行 → 去重后 ${unique} 行；` +
      `新增 ${upsert.created} / 更新 ${upsert.updated} / 未变 ${upsert.unchanged}` +
      (opts.prune ? ` / 删除 ${upsert.pruned}` : ` / 库里多余 ${upsert.orphaned}`) +
      `；耗时 ${(summary.elapsedMs / 1000).toFixed(1)}s`,
  )
  if (conflictList.length) {
    console.warn(
      `[biSync] ⚠️ 发现 ${conflictList.length} 个 SKU 存在「同 key 不同内容」的冲突，` +
        `说明 SKU 不唯一，需要改用「SKU + 其它维度」作 sync_key。前几个: ` +
        conflictList.slice(0, 5).map(c => `${c.key}(${c.count})`).join(', '),
    )
  }
  if (conflictDiffColumns.size) {
    // ⚠️ 这里**必须完整列出，不能只打前几名**。
    //    上轮就是只打了 top10，而度量列（总库存数量/金额…）几乎每组都不同、
    //    计数必然霸占前排，把「店铺/平台/部门」这些真正关键的维度挤到了十名之外，
    //    导致按「补仓位」下手时漏掉了店铺。
    //    经验：看差异列时，度量列的高计数是噪声，维度列才是线索。
    const all = [...conflictDiffColumns.entries()].sort((a, b) => b[1] - a[1])
    console.warn(
      `[biSync] 冲突行之间的差异列（共 ${all.length} 列，完整列出）: ` +
        all.map(([col, n]) => `${col}(${n})`).join(', '),
    )
  }
  // 把「去重」拆开说清楚：哪些是安全的完全重复，哪些是可能有损的冲突行
  {
    const top = [...occurrencesByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    console.log(
      `[biSync] 掉行拆解：完全重复 ${exactRepeatRows} 行（安全）+ 冲突行 ${conflictRows} 行（先到者保留，可能有损）；` +
        `平均每个 key 在 BI 里出现 ${(fetched / Math.max(unique, 1)).toFixed(1)} 次` +
        (top.length ? `；出现最多的 key: ${top.map(([k, n]) => `${k}(${n}次)`).join(', ')}` : ''),
    )
  }
  if (unmappedColumns.length) {
    console.warn(
      `[biSync] ⚠️ BI 返回了 ${unmappedColumns.length} 个未入库的列（数据仍在 data 里，但无法按它筛选）: ` +
        unmappedColumns.join(', ') +
        '  → 去 src/utils/biRowFields.ts 补上，然后重跑 npx tsx scripts/gen-bi-rows-migration.ts',
    )
  }

  return summary
}

/**
 * sync_key 的组成部分（按顺序用 `|` 拼接）。
 *
 * 为什么是这几段 —— 实测逐步收敛出来的（同一份 8017 行 BI 数据，每次只改键）：
 *   只用 SKU                → 158 个冲突，去重后 1761 行
 *   + 仓位                  → 24 个冲突，去重后 1854 行
 *   + 店铺                  →  5 个冲突，去重后 1899 行
 *   + 部门                  → 见下方 makeSyncKey 注释
 *
 * 「去重后行数」一路变多，说明之前确实把不同的行误当成同一行合并了 ——
 * 这是判断粒度对不对的关键信号：**对着「行数变多 + 冲突变少」一起看**。
 *
 * 补维度的依据不是「差异列的计数排名」（度量列必然霸榜，会盖住维度），
 * 而是**完整的差异列清单**里出现了哪些维度列。
 *
 * ⚠️ 踩过的坑：判断「该补哪个维度」时**不能只看差异列的计数排名**。
 *   度量列（总库存数量/金额…）几乎每组都不同、计数必然霸占前排，
 *   会把出现次数少但真正关键的维度（店铺/平台/部门）挤出视野。
 *   必须看**完整**的差异列清单。
 *
 * ⚠️ 为什么**不能**用 normalizeBiRows 生成的 `id`，也不能用「整行 hash」：
 *   那个 id 是「累积行号 + 页内下标」，而 BI 翻页不稳定
 *   （实测 8017 行里 6256 行是重复返回的，同一逻辑行每次落在不同位置），
 *   所以 id **每次拉取都会变**；整行 hash 更糟 —— 库存数字每天都在动，
 *   键一变就变成「插入新行 + 旧行变 orphan」，表会无限膨胀且多版本并存。
 *   业务键必须由**跨次拉取稳定**的字段组成，且不能含度量。
 */
// 实现与**现用口径**都在 src/utils/biRowFields.ts（import 见文件顶部）：
// 那边是 SYNC_KEY_FIELDS + makeSyncKey，改键只改那一处。
// 本文件的 syncBiRows（拉 BI 同步）与 uploadRows（Excel 上传）用的都是它。
// 上面这段说明保留在这里，是为了让读本文件的人知道键是怎么定出来的。

/** 把一行 BI 数据拼成 bi_rows 的记录结构（导出仅为便于单测） */
export function buildRecord(
  componentId: string,
  key: string,
  row: Record<string, unknown>,
  fetchedAt: string,
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    component_id: componentId,
    sync_key: key,
    // 整行快照：BI 新增列时数据不会丢（虽然暂时进不了索引）。
    // ⚠️ 剔除 `id`：那是解析阶段补的行号、每次拉取都会变，
    //    留在快照里会让「内容是否变化」的比对永远判为「变了」→ 每次同步全量重写。
    data: omitKeys(row, HASH_IGNORED_KEYS),
    fetched_at: fetchedAt,
  }
  for (const f of ROW_FIELDS) {
    const v = row[f.key]
    if (f.type === 'number') {
      // ⚠️ 这是最容易写坏的一处：BI 数值列的缺失值是**空串**（实测混在数字里有几十个），
      // 而 PB 的 number 字段不接受字符串 —— 直接把 '' 写进去，**整行都会写入失败**。
      //
      // ⚠️ 空值要给 **0**，不能给 null：PB 建出来的 number 列是 `NOT NULL`（实测
      //    `NOT NULL constraint failed: bi_rows.spu_profit_m1`）—— PB 把「未填的数字」
      //    本身就存成 0。给 null 会 500，给 0 和 PB 自己的约定一致。
      //    这不丢信息：原始的空值完整保留在同一行的 `data` 快照里（'' 与 0 分得清）。
      if (v === '' || v === null || v === undefined) {
        record[f.field] = 0
      } else {
        const n = typeof v === 'number' ? v : Number(v)
        record[f.field] = Number.isFinite(n) ? n : 0
      }
    } else {
      // 文本列统一转字符串：BI 偶尔会给数字（如纯数字的 SKU），直接写会让 PB 报类型错
      record[f.field] = v === null || v === undefined ? '' : String(v)
    }
  }
  return record
}

/** 上传结果的对外形状：在同步汇总之上补一个写入失败明细 */
export interface UploadSummary extends SyncSummary {
  /** 写入失败明细（唯一索引冲突 / HTTP 错误），最多 20 条 */
  failures: string[]
}

/**
 * 直接把一批行写进 bi_rows（**Excel 上传走这条**）。
 *
 * 与 syncBiRows 的差别**只在数据来源**：这里不拉 BI，行由调用方给。
 * 唯一键去重（dedupeBySyncKey）、差异比对与写库（upsertBySyncKey）完全共用 ——
 * 所以「页面上传的行」和「BI 同步的行」在库里是同一个口径，不会出现两套判等规则。
 *
 * ⚠️ 默认**不 prune**：上传的往往只是全量的一个子集，一 prune 会把没覆盖到的行全删掉。
 *    多余行数仍然会在 orphaned 里报出来，由调用方自己判断要不要清。
 */
export async function uploadRows(
  rawRows: Record<string, unknown>[],
  componentId = BI_COMPONENT_ID,
  opts: { dryRun?: boolean; prune?: boolean } = {},
): Promise<UploadSummary> {
  const start = Date.now()
  const dryRun = opts.dryRun === true
  const fetched = rawRows.length

  // 上传的行里用到的列，若映射表里没有，就进不了真列（数据仍保留在 data 快照里）。
  // 和 BI 那条路一样要报出来，否则「Excel 里有这列、库里却查不到」会无从解释。
  // 排除 id：那是 Excel 解析时补的行号，不是业务列。
  const unmappedColumns = [...new Set(rawRows.flatMap(r => Object.keys(r)))]
    .filter(k => k !== 'id' && !BI_ROW_FIELD_BY_KEY[k])

  const dedupe = dedupeBySyncKey(rawRows)
  const conflictList = [...dedupe.conflicts.entries()].map(([key, count]) => ({ key, count }))
  const upsert = await upsertBySyncKey(dedupe.byKey, componentId, { dryRun, prune: opts.prune === true })

  const summary: UploadSummary = {
    fetched,
    unique: dedupe.unique,
    missingKey: dedupe.missingKey,
    duplicates: dedupe.duplicates,
    exactRepeatRows: dedupe.exactRepeatRows,
    conflictRows: dedupe.conflictRows,
    topRepeatedKeys: [...dedupe.occurrencesByKey.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, rows]) => ({ key, rows })),
    conflicts: conflictList,
    conflictDiffColumns: [...dedupe.conflictDiffColumns.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([column, rows]) => ({ column, rows })),
    conflictSamples: dedupe.conflictSamples,
    created: upsert.created,
    updated: upsert.updated,
    unchanged: upsert.unchanged,
    orphaned: upsert.orphaned,
    pruned: upsert.pruned,
    dryRun,
    elapsedMs: Date.now() - start,
    unmappedColumns,
    existingReadFailed: upsert.existingReadFailed,
    failures: upsert.failures,
  }

  console.log(
    `[biUpload] ${dryRun ? '(dryRun) ' : ''}上传 ${fetched} 行 → 去重后 ${dedupe.unique} 行；` +
      `新增 ${upsert.created} / 更新 ${upsert.updated} / 未变 ${upsert.unchanged}；` +
      `跳过（唯一键为空）${dedupe.missingKey} 行；耗时 ${(summary.elapsedMs / 1000).toFixed(1)}s`,
  )
  if (dedupe.conflicts.size) {
    console.warn(
      `[biUpload] ⚠️ 有 ${dedupe.conflicts.size} 个唯一键出现「同 key 不同内容」，` +
        `已按「先到者保留」写入（后到的被丢弃，共 ${dedupe.conflictRows} 行）: ` +
        conflictList.slice(0, 5).map(c => `${c.key}(${c.count})`).join(', '),
    )
  }
  if (unmappedColumns.length) {
    console.warn(
      `[biUpload] ⚠️ 有 ${unmappedColumns.length} 个列没有对应的库字段（数据仍在 data 里，但无法按它筛选）: ` +
        unmappedColumns.join(', ') +
        '  → 去 src/utils/biRowFields.ts 补上，然后重跑 npx tsx scripts/gen-bi-rows-migration.ts',
    )
  }

  return summary
}

/** 供 /api/bi/sync 直接调用的便捷入口 */
export async function runBiSync(query: URLSearchParams) {
  const dryRun = query.get('dryRun') === '1' || query.get('dryRun') === 'true'
  const prune = query.get('prune') === '1' || query.get('prune') === 'true'
  const componentId = query.get('componentId') || BI_COMPONENT_ID
  return syncBiRows(componentId, { dryRun, prune })
}

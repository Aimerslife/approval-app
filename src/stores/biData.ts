import { defineStore } from 'pinia'
import pb from '@/pocketbase'
import { getDashbordDatas } from '@/api/api'

/**
 * BI 表格数据的缓存。
 *
 * 背景：整份数据要从 BI **逐页**拉（实测约 7918 行 / 16 个请求 / 10.5MB），
 * 而页面每次进入都重拉一遍 —— 这就是「表格加载很慢」的原因。
 * 但实际使用频率只有「一周几次」，所以没必要每次都取最新的。
 *
 * 三级读取（前两级都不发 BI 请求）：
 *   1. Pinia 内存 —— 同一次会话内切页面来回看，零请求
 *   2. PocketBase —— 刷新页面 / 换个用户打开，TTL 内直接用
 *   3. 回源 BI —— 只在缓存缺失 / 过期 / 手动刷新时发生
 *
 * 依赖 PocketBase 集合 `bi_data_cache`（见 pb_migrations/1789300000_created_bi_data_cache.js）。
 * 集合还没建时不会报错，只是退化成「每次都回源」，跑一次 migration 即可生效。
 */

/**
 * 缓存有效期。默认 24 小时。
 * 「一周几次」的使用频率下，一天以内的数据足够新；想更保守就调小，
 * 反正页面上有手动「刷新数据」。
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 缓存结构版本。
 * 只要改了 api.ts 的 normalizeBiRows / 字段别名表，就把它 +1，
 * 否则会拿旧结构的缓存去喂新代码 —— 字段对不上，且不会有任何报错。
 */
const DATA_VERSION = '1'

/**
 * 写缓存的体积护栏。
 * 实测完整数据约 10.5MB，PB 请求体上限实测在 12~35MB 之间（35MB 返回 413）。
 * 超过 25MB 就放弃写缓存，避免整次加载因为超限而失败（读缓存不受影响）。
 */
const MAX_CACHE_BYTES = 25 * 1024 * 1024

const COLLECTION = 'bi_data_cache'

interface CacheRecord {
  id: string
  component_id: string
  rows: Record<string, unknown>[]
  row_count: number
  fetched_at: string
  data_version: string
  updated: string
}

/** 拼 PocketBase filter 字面量：去掉引号/反斜杠，避免过滤条件被注入 */
function pbQuote(s: string): string {
  return `"${s.replace(/["\\]/g, '')}"`
}

export const useBiDataStore = defineStore('biData', () => {
  /** 原始行数据（未格式化，保留数字类型） */
  const rows = ref<Record<string, unknown>[]>([])
  /** 这份数据是从 BI 拉到的时间（ISO 字符串） */
  const fetchedAt = ref('')
  /** 是否正在回源 BI（读缓存不算，缓存是瞬时的） */
  const refreshing = ref(false)
  /** 异常提示，例如「回源失败，展示的是缓存」 */
  const notice = ref('')

  /** 内存里这份数据属于哪个组件，避免换组件时误用 */
  let loadedComponentId = ''

  function isFresh(at: string): boolean {
    return !!at && Date.now() - new Date(at).getTime() < CACHE_TTL_MS
  }

  /** 数据是否已过期（UI 可据此提示「建议刷新」） */
  const isStale = computed(() => rows.value.length > 0 && !isFresh(fetchedAt.value))

  /** 上次更新时间的展示文案 */
  const updatedText = computed(() =>
    fetchedAt.value ? new Date(fetchedAt.value).toLocaleString('zh-CN') : '',
  )

  /** 读该组件在 PB 里的缓存记录。不校验版本/时效，便于复用它做 update */
  async function readCache(componentId: string): Promise<CacheRecord | null> {
    try {
      return await pb.collection(COLLECTION).getFirstListItem<CacheRecord>(
        `component_id=${pbQuote(componentId)}`,
        { sort: '-updated' },
      )
    } catch {
      // 没有记录（404）、或集合尚未创建（还没跑 migration）都会到这里，都按「无缓存」处理
      return null
    }
  }

  /** 写回 PB。同组件只留一条（先查再 update），记录数不随刷新次数增长 */
  async function writeCache(
    componentId: string,
    data: Record<string, unknown>[],
    at: string,
  ): Promise<void> {
    const bytes = JSON.stringify(data).length
    if (bytes > MAX_CACHE_BYTES) {
      console.warn(
        `[biData] 数据 ${(bytes / 1048576).toFixed(1)}MB 超过缓存护栏 ` +
        `${(MAX_CACHE_BYTES / 1048576).toFixed(0)}MB，本次不写缓存`,
      )
      return
    }
    const payload = {
      component_id: componentId,
      rows: data,
      row_count: data.length,
      fetched_at: at,
      data_version: DATA_VERSION,
    }
    try {
      const existing = await readCache(componentId)
      if (existing) await pb.collection(COLLECTION).update(existing.id, payload)
      else await pb.collection(COLLECTION).create(payload)
      console.log(
        `[biData] 已写入 PB 缓存：${data.length} 行 / ${(bytes / 1048576).toFixed(1)}MB`,
      )
    } catch (err) {
      // 缓存写失败不能影响主流程 —— 数据已经拿到了，只是下次还得回源
      console.warn('[biData] 写入 PB 缓存失败（不影响本次使用）:', err)
    }
  }

  function apply(data: Record<string, unknown>[], at: string, componentId: string) {
    rows.value = data
    fetchedAt.value = at
    loadedComponentId = componentId
  }

  /**
   * 取数据。
   * @param force 跳过内存与 PB 缓存，强制回源（页面上的「刷新数据」用它）
   */
  async function load(componentId: string, { force = false } = {}): Promise<void> {
    // 1) 内存命中：同组件 + 有数据 + 未过期
    const memoryHit =
      loadedComponentId === componentId && rows.value.length > 0 && isFresh(fetchedAt.value)
    if (!force && memoryHit) return

    notice.value = ''

    // 2) PB 缓存。即便已过期也先留着 —— 回源失败时可以拿它兜底
    const cached = await readCache(componentId)
    const cacheUsable =
      !!cached &&
      cached.data_version === DATA_VERSION &&
      Array.isArray(cached.rows) &&
      isFresh(cached.fetched_at)

    if (!force && cacheUsable && cached) {
      apply(cached.rows, cached.fetched_at, componentId)
      console.log(`[biData] 命中 PB 缓存：${cached.rows.length} 行（拉取于 ${cached.fetched_at}）`)
      return
    }

    // 3) 回源 BI
    refreshing.value = true
    try {
      const fresh = await getDashbordDatas(componentId)
      const at = new Date().toISOString()
      apply(fresh, at, componentId)
      await writeCache(componentId, fresh, at)
    } catch (err) {
      console.error('[biData] 从 BI 拉取失败:', err)
      // 宁可展示过期数据，也别给白屏
      if (cached && Array.isArray(cached.rows) && cached.rows.length) {
        apply(cached.rows, cached.fetched_at, componentId)
        notice.value = `BI 拉取失败，当前展示的是 ${cached.fetched_at.slice(0, 16).replace('T', ' ')} 的缓存数据`
      } else {
        notice.value = 'BI 拉取失败，且暂无可用缓存'
      }
    } finally {
      refreshing.value = false
    }
  }

  return {
    rows,
    fetchedAt,
    refreshing,
    notice,
    isStale,
    updatedText,
    load,
  }
})

import { normalizePeople, type PersonRow } from '@/types/people'
import { applyPeopleConfig } from '@/utils/organazation'

/**
 * 人员配置（团队 → 默认审批人）的**读写口**，数据落在仓库根目录 `data/people.json`。
 *
 * 为什么不直接 import JSON 就完事：
 *   import 进来的是**打包时的快照**，页面上新增一条后，下一次构建前它永远是旧的 ——
 *   刷新页面又变回原样，看起来像"没保存成功"。所以运行期以 app server 上的文件为准：
 *     · 启动时 GET 一次（hydratePeopleConfig），覆盖内存里的团队表；
 *     · 新增时 POST 一次（addPersonRow），服务端落盘并回整份清单，前端直接换掉内存表。
 *
 * 两者都只改**内存里那个数组**（见 organazation 的 applyPeopleConfig），
 * 不做整页刷新：表格、团队候选、动态审批人立刻就是新数据。
 */

const ENDPOINT = '/api/people'
/** 启动时最多等这么久：服务没起也不能把首页卡住（这是锦上添花的数据，不是启动必需） */
const HYDRATE_TIMEOUT_MS = 1500

interface PeopleResponse {
  code?: number
  msg?: string
  data?: unknown
}

/**
 * 启动时拉一次服务端清单并覆盖内存表。
 *
 * 拿不到（服务没起 / 超时 / 文件被删空）就**保持打包快照**，不报错、不阻塞 ——
 * 页面照常能用，只是新增的人要等服务起来才看得到。
 * @returns 是否真的换上了服务端的数据
 */
export async function hydratePeopleConfig (): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, {
      // 不能走缓存：这里要的就是"别人刚加的那条"
      cache: 'no-store',
      signal: AbortSignal.timeout(HYDRATE_TIMEOUT_MS),
    })
    if (!res.ok) {
      return false
    }
    const body = await res.json() as PeopleResponse
    const rows = normalizePeople(body?.data)
    if (rows.length === 0) {
      // 空清单多半是"文件被删了 / 内容坏了"，这跟"用户把人都删了"分不出来 ——
      // 这种情况保留打包快照，比让整张表变空（选不到任何团队）更安全
      console.warn('[peopleConfig] 服务端返回空清单，保留内置快照')
      return false
    }
    applyPeopleConfig(rows)
    return true
  } catch {
    // 服务没起 / 超时：静默回落到打包快照（控制台留一条，排查时知道是什么情况）
    console.info('[peopleConfig] 未能从服务端读取人员配置，使用内置快照')
    return false
  }
}

/**
 * 新增一行：写服务端那份 JSON，并把**写完之后**的整份清单应用到内存。
 *
 * 失败时抛带原因的 Error（重名 / 没填全由服务端与前端同一套规则给出），
 * 调用方原样展示即可 —— 这类失败必须让人看见，否则用户会以为加上了。
 */
export async function addPersonRow (row: PersonRow): Promise<PersonRow[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  })
  const body = await res.json().catch(() => null) as PeopleResponse | null
  if (!res.ok || body?.code !== 0) {
    throw new Error(body?.msg || `保存失败（HTTP ${res.status}）`)
  }
  const rows = normalizePeople(body?.data)
  applyPeopleConfig(rows)
  return rows
}

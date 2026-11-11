import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchOrgTreeCache } from '@/api/api'
import { buildOrgDirectory } from '@/utils/orgDirectory'

/**
 * **头像目录**：按 `open_id`（退化用 `email` / `mobile`）给出成员头像。
 *
 * 为什么要它：单据快照里的成员**不再带头像**（见 types/approval 的 slimFlowMembers）——
 * 头像 URL 一个就 ~165 B，而同一份成员记录会被按环节（轮询还要按组）复制很多遍，
 * 一张单里 97 个成员对象去重后只有 15 个人。裁掉之后由这里按需查回来。
 *
 * ## 数据源：组织架构缓存（`/api/org-tree/cache`）
 * 它就是建单期写进快照的那些头像的**同一份数据**，所以这里查到的和"以前快照里那张"是同一张。
 *
 * 为什么不用 users / feishu_users 两个集合（都踩过）：
 *   · `users` 的 listRule 是 `id = @request.auth.id` —— 每个人只能读自己那一条，
 *     按 open_id 查别人**必然查不到**（第一版就是这么写的，表现是头像全没了）；
 *   · `feishu_users` 目前是空表。
 * 组织架构缓存则是**公开可读**（listRule 为空）且本来就带头像，一次取回全公司（~70 KB）。
 *
 * ## 其余口径
 *   · 一个会话只发一次请求（`loading` 记忆化），失败时下次再试；
 *   · 查不到返回空串，展示层退回首字（见 components/ApprovalNode.vue）；
 *   · 只告警不抛错：头像是装饰，绝不能影响审批。
 */
export interface AvatarLookup {
  open_id?: string
  email?: string
}

/**
 * 按人补全的档案（链路成员瘦身后，email / department / department_path 不再进快照，
 * 展示与推送匹配需要它们时由这里按 open_id（退化 email）查回 —— 与头像同一份数据、同一次请求）。
 */
export interface MemberDetail {
  name: string
  email: string
  department: string
  department_path: string
}

const EMPTY_DETAIL: MemberDetail = { name: '', email: '', department: '', department_path: '' }

export const useAvatarDirectory = defineStore('avatarDirectory', () => {
  const byOpenId = ref<Record<string, string>>({})
  const byEmail = ref<Record<string, string>>({})
  /** open_id / email / mobile → 成员档案（含 email 与部门，见 MemberDetail） */
  const byDetail = ref<Record<string, MemberDetail>>({})
  /** 目录加载：一个会话一次（失败后置空，下次 ensure 再试） */
  let loading: Promise<void> | null = null

  /** 这个人的头像地址；没有（还没加载 / 查不到）时返回空串，由调用方退回首字 */
  function avatarOf (person?: AvatarLookup | null): string {
    if (!person) {
      return ''
    }
    const id = person.open_id?.trim()
    if (id && byOpenId.value[id]) {
      return byOpenId.value[id]
    }
    const mail = person.email?.trim().toLowerCase()
    if (mail && byEmail.value[mail]) {
      return byEmail.value[mail]
    }
    return ''
  }

  /**
   * 这个人的档案（email / department / department_path）：查不到返回全空串字段，
   * 调用方按 `m.email || detail.email` 的口径兜底（老单自带字段照旧直显）。
   */
  function detailOf (person?: AvatarLookup | null): MemberDetail {
    if (!person) {
      return EMPTY_DETAIL
    }
    const id = person.open_id?.trim()
    if (id && byDetail.value[id]) {
      return byDetail.value[id]
    }
    const mail = person.email?.trim().toLowerCase()
    if (mail && byDetail.value[mail]) {
      return byDetail.value[mail]
    }
    return EMPTY_DETAIL
  }

  async function load (): Promise<void> {
    try {
      const res = await fetchOrgTreeCache()
      // 索引口径与建单期"给老成员补 open_id"共用一份（见 utils/orgDirectory）
      const dir = buildOrgDirectory(res?.data?.tree)
      for (const p of dir.all) {
        if (p.open_id) {
          byOpenId.value[p.open_id] = p.avatar
          byDetail.value[p.open_id] = {
            name: p.name,
            email: p.email,
            department: p.department,
            department_path: p.department_path,
          }
        }
        // email / mobile 都当"人"的键：通讯录里没有邮箱的人，选人结果里存的是手机号
        // （见 components/OrgTree.vue 的 subtitle = email || mobile）
        for (const key of p.contacts) {
          byEmail.value[key] = p.avatar
          if (!byDetail.value[key]) {
            byDetail.value[key] = {
              name: p.name,
              email: p.email,
              department: p.department,
              department_path: p.department_path,
            }
          }
        }
      }
    } catch (error) {
      /*
       * 缓存还没生成（去「组织架构」页点一次刷新）、或服务端不可达。
       * ⚠️ fetchOrgTreeCache 在 `code !== 0` 时是**抛错**的（见 api 的 feishuGet），
       * 所以这里必须兜住 —— 否则一个头像请求失败会把整个时间线带崩。
       */
      console.warn('[avatarDirectory] 读组织架构缓存失败（头像退回首字）:', error)
      loading = null
    }
  }

  /**
   * 按需加载（幂等，一个会话一次请求）。
   * 调用方不必 await：查到之后 map 变了，读它的模板自然重渲染。
   */
  function ensure (): Promise<void> {
    loading ??= load()
    return loading
  }

  return { byOpenId, byEmail, byDetail, avatarOf, detailOf, ensure }
})

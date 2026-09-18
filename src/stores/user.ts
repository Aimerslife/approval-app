import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import pb from '@/pocketbase.ts'
import { resolveAvatar } from '@/utils/avatar'

export interface UserInfo {
  id: string
  email?: string
  username?: string
  name?: string
  /** 飞书 open_id（OAuth2 登录后由 PocketBase 自动写入） */
  open_id?: string
  /** 自定义 text 字段：飞书完整头像 URL（file 字段 avatar 不存 URL） */
  avatar_url?: string
  avatar?: string
  verified?: boolean
  preferences?: UserPreferences
  /** 飞书租户标识：登录时与 VITE_COMPANY_ID 比对，只有匹配才允许登录 */
  tenant_key?: string
  /** 企业名（取用户所在部门的顶层祖先部门名，见 server 的 /api/feishu/user-org） */
  company_name?: string
  /** 所在部门名 */
  department?: string
  /** 部门完整路径，如「总公司 / 财务部 / 财务BP组」 */
  department_path?: string
}

/**
 * users 集合上的 preferences（json 字段）。
 * 只放**用户级偏好**；账号事实字段（name / email / avatar_url / role）不要往这里塞。
 */
export interface UserPreferences {
  /**
     * 「字段设置」里各 BI 字段的显隐。
     * 只存**与代码默认值不同**的项，key 是 BI 字段名：
     * BI 增 / 删字段后，没存过的字段自动回落代码默认值，
     * 老用户不会被 PB 里的旧快照永久锁定（新字段永远隐藏）。
     */
  columnVisibility?: Record<string, boolean>
  /**
     * 「数据」表格的列布局：**数组顺序即列顺序**，width 为列宽。
     * 只存被用户调过的项；BI 新增的字段不会出现在这里，读取侧追加到末尾（见 pages/setDatas.vue）。
     */
  columnLayout?: Array<{ field: string, width?: number }>
  /**
     * 「数据」表格**被调过**的列宽（稀疏，key → px）。
     *
     * 为什么不塞进 columnLayout：那里要存全量顺序（65 项 ≈ 1.9KB），
     * 而 PB 登录 cookie 的硬上限只有 4096 字节 —— 实测带上它必然超限、
     * cookie 被浏览器静默丢弃，偏好就"存了也读不回来"。
     * 顺序**只有真的重排过才写**，列宽走这个独立的小字段。
     */
  columnWidths?: Record<string, number>
  /**
     * 审批抽屉里「产品详情」（components/GoodsInfo.vue）的字段显隐。
     *
     * 为什么不复用 columnVisibility：两者**默认口径不同**，混用会出问题 ——
     *   数据表格默认只显示 15 列（SKU / 产品名称 / 图片链接这些默认是关的，见 visualable），
     *   而详情视图默认「有值就显示」，SKU 正是它最关键的字段。
     * 共用的话，详情里会莫名其妙少了 SKU。
     *
     * 同样只存**与默认值（显示）不同**的项，所以内容是 `{ 字段: false }` 这种「被关掉的」。
     */
  goodsFieldVisibility?: Record<string, boolean>
  /** 预留：以后新增偏好类型直接加字段，读取侧做好兜底即可 */
  [key: string]: unknown
}

export const useUserStore = defineStore('user', () => {
  const user = ref<UserInfo | null>(null)
  const token = ref('')

  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const displayName = computed(
    () => user.value?.name || user.value?.email || user.value?.username || '未登录',
  )
  const avatar = computed(() => resolveAvatar(user.value?.avatar_url || user.value?.avatar))

  /** 以 pb.authStore 为唯一数据源，同步状态到 Pinia */
  function syncFromPb () {
    const model = pb.authStore.record
    user.value = model
      ? ({
          id: model.id,
          email: model.email,
          username: model.username,
          name: model.name,
          open_id: model.open_id,
          avatar_url: model.avatar_url,
          avatar: model.avatar,
          verified: model.verified,
          preferences: model.preferences,
          tenant_key: model.tenant_key,
          company_name: model.company_name,
          department: model.department,
          department_path: model.department_path,
        } as UserInfo)
      : null
    token.value = pb.authStore.token
  }

  /**
     * 从服务端拉一次最新记录，覆盖 cookie 里的快照。
     *
     * ⚠️ 为什么必须有这一步：PB 的登录态是把 `base64({token, model})` 塞进**单个 cookie** 的，
     * 而浏览器对单个 cookie 的硬上限是 **4096 字节**，超了会**静默丢弃**（旧 cookie 保留）。
     * 实测加了 preferences 后 cookie 已到 4100~4900 字节（随 token 长度），必然超限 ——
     * 于是刷新后 loadFromCookie 读到的是**没有 preferences 的旧记录**，
     * 表现就是「设置明明保存了，下次打开又重置了」。
     *
     * 任何"存在 users 记录上、需要跨刷新保留"的偏好都依赖这里兜底：
     * cookie 只当快照用，**库才是唯一事实源**。
     */
  async function refreshFromServer () {
    if (!pb.authStore.isValid) {
      return
    }
    try {
      // authRefresh 会顺带回写 authStore（也就刷新了 cookie），onChange → syncFromPb
      await pb.collection('users').authRefresh()
      syncFromPb()
    } catch (error) {
      // 拉不到就退回 cookie 快照，不阻断启动
      console.warn('[user] 拉取最新用户记录失败，暂用 cookie 快照:', error)
    }
  }

  /** 防止 init 重复注册 onChange 监听 */
  let bound = false

  /**
     * 应用启动时调用（如 App.vue）。
     * 初始化状态，并监听 pb 登录状态变化自动同步，
     * 覆盖密码登录 / 飞书 OAuth2 登录 / 登出 / 刷新恢复 全部场景。
     */
  function init () {
    syncFromPb()
    if (bound) {
      return
    }
    bound = true
    pb.authStore.onChange(() => {
      syncFromPb()
    })
  }

  /** 邮箱密码登录 */
  async function login (email: string, password: string) {
    const authData = await pb.collection('users').authWithPassword(email, password)
    syncFromPb()
    return authData
  }

  /** 登出并清空状态 */
  async function logout () {
    pb.authStore.clear()
    syncFromPb()
  }

  /**
     * 用户偏好。存在**独立集合 user_preferences**（每个用户一条，用 user 关联），
     * **不再挂在 users 记录上** —— 挂在上面会让 PB 的登录 cookie（base64({token, model}）
     * 单个 cookie，浏览器上限 4096 字节）超限而被静默丢弃，表现就是「设置存了又重置」。
     */
  const preferences = ref<UserPreferences>({})
  /** 是否已从服务端读过一次（用来区分「没有偏好」和「还没读」） */
  const preferencesLoaded = ref(false)

  const PREF_COLLECTION = 'user_preferences'
  /** 该用户的偏好记录 id；缓存它，避免每次写入前都要先查一次 */
  let preferencesRecordId = ''

  /** 只挑已知的偏好字段，避免把 created / updated 之类的元数据也带进来 */
  function pickPreferences (src: Record<string, unknown>): UserPreferences {
    const out: UserPreferences = {}
    if (src.columnVisibility && typeof src.columnVisibility === 'object') {
      out.columnVisibility = src.columnVisibility as Record<string, boolean>
    }
    if (Array.isArray(src.columnLayout)) {
      out.columnLayout = src.columnLayout as UserPreferences['columnLayout']
    }
    if (src.columnWidths && typeof src.columnWidths === 'object') {
      out.columnWidths = src.columnWidths as Record<string, number>
    }
    // ⚠️ 新增的偏好键必须加进这个白名单：它决定「从服务端读回来时保留哪些字段」，
    //    漏了的话偏好**存得进去、读不回来**（保存看起来成功，一刷新就重置）。
    if (src.goodsFieldVisibility && typeof src.goodsFieldVisibility === 'object') {
      out.goodsFieldVisibility = src.goodsFieldVisibility as Record<string, boolean>
    }
    return out
  }

  /**
     * 读自己的偏好。没有记录就建一条，并把历史遗留的 users.preferences **迁过来后清空** ——
     * 那个字段正是把 cookie 撑爆的元凶，不清掉的话登录态还是会被丢。
     */
  async function loadPreferences (): Promise<void> {
    const uid = user.value?.id
    if (!uid) {
      return
    }
    try {
      const rec = await pb
        .collection(PREF_COLLECTION)
      // 泛型里带上 id：只写 Record<string, unknown> 的话 rec.id 是 unknown，
      // 赋给 preferencesRecordId（string）会报 TS2322
        .getFirstListItem<{ id: string } & Record<string, unknown>>(`user = "${uid}"`)
      preferencesRecordId = rec.id
      preferences.value = pickPreferences(rec)
    } catch {
      // 没有记录（404），或集合还没建（还没跑 migration）——都按「首次」处理
      const legacy = (user.value?.preferences ?? {}) as Record<string, unknown>
      try {
        const created = await pb.collection(PREF_COLLECTION).create<{ id: string } & Record<string, unknown>>({
          user: uid,
          ...pickPreferences(legacy),
        })
        preferencesRecordId = created.id
        preferences.value = pickPreferences(created)
      } catch (error) {
        console.warn('[user] 创建偏好记录失败（集合可能还没建，先只放内存）:', error)
      }
      if (Object.keys(legacy).length > 0) {
        try {
          await pb.collection('users').update(uid, { preferences: {} })
          syncFromPb()
        } catch (error) {
          console.warn('[user] 清空遗留的 users.preferences 失败（不影响使用）:', error)
        }
      }
    }
    preferencesLoaded.value = true
  }

  /** 写回偏好。patch 与已有偏好浅合并，避免以后新增偏好类型时互相覆盖。 */
  async function savePreferences (patch: UserPreferences): Promise<void> {
    const uid = user.value?.id
    if (!uid) {
      console.warn('[user] 未登录，偏好仅在当前页面生效')
      return
    }
    const next: UserPreferences = { ...preferences.value, ...patch }
    // 本地先乐观更新：调用方的 watch 会立刻看到结果，不用等往返
    preferences.value = next
    try {
      if (!preferencesRecordId) {
        await loadPreferences()
      }
      if (preferencesRecordId) {
        await pb.collection(PREF_COLLECTION).update(preferencesRecordId, next)
      } else {
        const created = await pb
          .collection(PREF_COLLECTION)
          .create<{ id: string } & Record<string, unknown>>({ user: uid, ...next })
        preferencesRecordId = created.id
      }
    } catch (error) {
      console.error('[user] 保存偏好失败:', error)
    }
  }

  /**
     * 更新账号字段（目前「基本设置」里只有邮箱可编辑）。
     * PB 对 auth 集合改 email 可能要求重新验证，失败时把错误抛给调用方展示。
     */
  async function updateProfile (patch: { email?: string }) {
    const id = user.value?.id
    if (!id) {
      throw new Error('未登录，无法修改账号信息')
    }
    const rec = await pb.collection('users').update(id, patch)
    // 改的是登录者本人：写回 authStore，保证刷新后读到的仍是最新值
    if (pb.authStore.record?.id === id) {
      pb.authStore.save(pb.authStore.token, rec)
    }
    syncFromPb()
  }

  return {
    user,
    token,
    isLoggedIn,
    displayName,
    avatar,
    preferences,
    preferencesLoaded,
    loadPreferences,
    syncFromPb,
    init,
    refreshFromServer,
    login,
    logout,
    savePreferences,
    updateProfile,
  }
})

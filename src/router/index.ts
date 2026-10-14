/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 * 使用懒加载（code splitting），每个页面按需加载，提升 tab 切换速度。
 */

// Composables
import { createRouter, createWebHistory } from 'vue-router'
import pb from '@/pocketbase.ts'
import { canAccess, entryPath, normalizeRole, ROLE_LABELS } from '@/utils/permissions'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/pages/index.vue'),
    },
    {
      path: '/home',
      component: () => import('@/pages/home.vue'),
    },
    {
      path: '/home/newStream',
      component: () => import('@/pages/newStream.vue'),
    },
    {
      path: '/analyze',
      component: () => import('@/pages/analyze.vue'),
    },
    {
      path: '/setDatas',
      component: () => import('@/pages/setDatas.vue'),
    },
    {
      path: '/login',
      component: () => import('@/pages/login.vue'),
      /*
       * guestOnly = 只给**未登录**用户看：已登录时守卫会把访问者送回它该去的入口页
       * （否则登出后再回到书签里的 /login，会看到"已经登录却让再登一次"的页面）。
       * public 仍然要留：它决定"未登录时允许停留"，两个 flag 管的是两件事。
       */
      meta: { public: true, guestOnly: true },
    },
    {
      path: '/logic',
      component: () => import('@/pages/logic.vue'),
    },
    {
      path: '/createStream',
      component: () => import('@/pages/createStream.vue'),
    },
    {
      path: '/register',
      component: () => import('@/pages/register.vue'),
      meta: { public: true },
    },
    {
      path: '/sendEmail',
      component: () => import('@/pages/sendEmail.vue'),
      meta: { public: true },
    },
    {
      path: '/editRule',
      component: () => import('@/pages/editRule.vue'),
    },
    {
      path: '/approvalModel',
      component: () => import('@/pages/approvalModel.vue'),
    },
    {
      path: '/mine',
      component: () => import('@/pages/mine.vue'),
    },
    {
      path: '/approvalDetail',
      component: () => import('@/pages/approvalDetail.vue'),
    },
    {
      path: '/approvalPage',
      component: () => import('@/pages/approvalPage.vue'),
    },
    {
      path: '/roleSetting',
      component: () => import('@/pages/roleSetting.vue'),
    },
    {
      path: '/userSetting',
      component: () => import('@/pages/userSetting.vue'),
    },
    {
      path: '/workStream',
      component: () => import('@/pages/workStream.vue'),
    },
    {
      path: '/alarmSetting',
      component: () => import('@/pages/alarmSetting.vue'),
    },
    {
      path: '/approvalTypeSetting',
      component: () => import('@/pages/approvalTypeSetting.vue'),
    },
    {
      path: '/knowledge',
      component: () => import('@/pages/knowledge.vue'),
    },
  ],
  scrollBehavior () {
    return { top: 0 }
  },
})

router.onError(error => {
  const message = String((error as Error)?.message ?? error)
  const isChunkError = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)
  if (!isChunkError) {
    return
  }

  const KEY = 'app:chunk-reload-at'
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 60_000) {
      return
    }
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    // 隐私模式等场景下 sessionStorage 可能不可用：那就不记标记、直接重载一次
  }
  window.location.reload()
})

/**
 * 全局路由守卫：按 `users.role` 控制能进哪些页面。
 *
 * 为什么必须拦在路由层：菜单只是"看不见"，手输地址照样能打开 ——
 * 判定表在 `utils/permissions.ts`，**侧边栏菜单过滤共用同一张表**，
 * 所以不会出现"菜单藏了但直链能进"或"守卫拦了菜单还留着"的口径不一致。
 *
 * 角色来源用 `pb.authStore.record.role` 而不是 Pinia store：
 * 首次导航发生在组件 setup 之前，那时 `userStore.init()` 还没跑，读 store 会拿到空值。
 * ⚠️ 它读的是登录 cookie 里的快照：服务端改了角色，要等下次刷新（refreshFromServer）才生效。
 */

router.beforeEach(to => {
  /*
   * ⓪ PocketBase 自己的路径放行：OAuth 回调会被 PB 307 到 `/_/#/auth/oauth2-redirect-*`。
   *
   * 为什么单列这一条：PB 客户端是按**同源**建的（见 pocketbase.ts，`/api` 走 vite 代理），
   * 所以那个地址落在应用自己的源上、会被这个守卫看到 —— 而飞书授权的 iframe 正停在那里
   * 等 SDK 通过 realtime 收 code（见 utils/oauth.ts 的说明）。把 iframe 拦去登录页纯属添乱。
   * 这些路径不由 vue-router 渲染，放行不会让用户看到任何页面。
   */
  if (to.path.startsWith('/_/')) {
    return true
  }

  const authed = pb.authStore.isValid

  /*
   * ① 未登录：除公开页外一律送登录页。
   *
   * 必须先判「有没有登录」，再判「这个角色能不能进」：未登录时 `pb.authStore.record` 是 null，
   * `normalizeRole` 会把它当最低档「一般员工」—— 而员工能进 `/`、`/mine`、`/setDatas`…，
   * 于是未登录用户直接被放进去；在 ADMIN_UP 的页面上则被"无权访问"逻辑送去 `/mine`，
   * 两种情况都**永远见不到登录页**。
   *
   * 用 pb.authStore 而不是 userStore：首次导航发生在组件 setup 之前，那时 userStore.init()
   * 还没跑；登录 cookie 由 PB SDK 同步恢复，所以这里读到的就是真实登录态。
   * `isValid` 会连 token 过期一起判，过期等于没登录。
   */
  if (!authed) {
    if (to.meta.public === true) {
      return true
    }
    console.warn(`[权限] 未登录访问 ${to.fullPath}，已跳转登录页`)
    return {
      path: '/login',
      /*
       * 带上原地址，登录后能直接回到刚才要去的页面 —— 飞书卡片是深链进
       * `/approvalPage?order_no=…`，丢了查询参数用户就得自己再找一遍。
       *
       * 只有根路径 `/` 不带：它是默认入口（打开域名就是它，用户并没有表达"要去哪"），
       * 登录后按角色落到真正的工作台更合理（管理员 /home、员工 /mine，见 login.vue）。
       */
      ...(to.fullPath === '/' ? {} : { query: { redirect: to.fullPath } }),
    }
  }

  const role = normalizeRole(pb.authStore.record?.role)

  /*
   * ② 已登录却去「只给未登录用户看」的页面（登录页）→ 送回它该去的入口页。
   *
   * 落点用 entryPath(role) 而不是"原地址"：这里没有"从哪被拦下"可言，
   * 而入口页按角色给（管理员 /home、员工 /mine）与 `entryPath` 的既有口径一致。
   */
  if (to.meta.guestOnly === true) {
    const entry = entryPath(role)
    console.warn(`[权限] 已登录，${to.path} 只给未登录用户看，已送回 ${entry}`)
    return entry
  }

  // ③ 公开页（注册 / 找回密码）到此为止：它们不需要角色判断
  if (to.meta.public === true) {
    return true
  }

  // ④ 角色权限
  if (canAccess(role, to.path)) {
    return true
  }

  const entry = entryPath(role)
  // 兜底页自己都进不去就别再跳了，否则会来回重定向
  if (to.path === entry) {
    return true
  }

  console.warn(`[权限] ${ROLE_LABELS[role]} 无权访问 ${to.path}，已跳回 ${entry}`)
  return entry
})

export default router

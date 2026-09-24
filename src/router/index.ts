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
      meta: { public: true },
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
      path: '/editStream',
      component: () => import('@/pages/editStream.vue'),
    },
    {
      path: '/userSetting',
      component: () => import('@/pages/userSetting.vue'),
    },
    {
      path: '/workStream',
      component: () => import('@/pages/workStream.vue'),
    },
  ],
  scrollBehavior () {
    return { top: 0 }
  },
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
  // 登录 / 注册 / 找回密码等公开页不拦
  if (to.meta.public === true) {
    return true
  }

  const role = normalizeRole(pb.authStore.record?.role)
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

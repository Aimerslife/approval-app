/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 * 使用懒加载（code splitting），每个页面按需加载，提升 tab 切换速度。
 */

// Composables
import { createRouter, createWebHistory } from 'vue-router'

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
      path:'/approvalModel',
      component: () => import('@/pages/approvalModel.vue'),
    },
    {
      path:'/mine',
      component: () => import('@/pages/mine.vue'),
    },
    {
      path:'/approvalDetail',
      component: () => import('@/pages/approvalDetail.vue'),
    },
    {
      path:'/approvalPage',
      component: () => import('@/pages/approvalPage.vue'),
    },
    {
      path:'/roleSetting',
      component: () => import('@/pages/roleSetting.vue'),
    },
    {
      path:'/editStream',
      component: () => import('@/pages/editStream.vue'),
    },
    {
      path:'/userSetting',
      component: () => import('@/pages/userSetting.vue'),
    },
    {
      path:'/workStream',
      component: () => import('@/pages/workStream.vue'),
    }
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router

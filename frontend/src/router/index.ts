/**
 * 路由配置（024）
 *
 * 登录态以 HttpOnly Cookie + `/api/admin/auth/me` 探针为准（前端不读 Cookie）。
 * 守卫对 `meta.requiresAuth` 的业务路由异步探针，未登录跳 `/login`。
 */
import { createRouter, createWebHistory } from 'vue-router'
import { getAuthStore } from '@/composables/useAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      name: 'workbench',
      component: () => import('@/views/WorkbenchView.vue'),
      meta: { requiresAuth: true },
    },
    // 数据展示页面
    {
      path: '/datapage/:pageid',
      name: 'datapage',
      component: () => import('@/views/datapage/datapage.vue'),
      meta: { requiresAuth: true },
    },
    // 排产任务结果页面
    {
      path: '/taskresult',
      name: 'taskResult',
      component: () => import('@/views/datapage/task-result.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/ganttdemo',
      name: 'GanttDemo',
      component: () => import('@/views/demo/gantt-demo.vue'),
      meta: { title: 'DataEvoluter · Gantt Demo', requiresAuth: false },
    },
    {
      path: '/gantt',
      name: 'Gantt',
      component: () => import('@/views/demo/gantt.vue'),
      meta: { title: 'DataEvoluter · Gantt', requiresAuth: false },
    },
  ],
})

// 全局前置守卫：必须登录后才能进入业务页面
router.beforeEach(async (to) => {
  const auth = getAuthStore()
  if (to.meta.requiresAuth) {
    const ok = await auth.ensureAuthenticated()
    if (!ok) return { path: '/login', query: { redirect: to.fullPath } }
  } else if (to.path === '/login') {
    // 已登录访问登录页 → 直接进入工作台
    const ok = await auth.ensureAuthenticated()
    if (ok) return { path: '/' }
  }
  return true
})

export default router

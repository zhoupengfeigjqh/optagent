/**
 * 路由配置
 *
 * 当前仅有工作台一个路由；`App.vue` 只承载 `<RouterView />`，
 * 页面级组件统一放在 `src/views/` 下，新增页面时在此登记路由即可。
 */
import { createRouter, createWebHistory } from 'vue-router'
import {getToken} from '@/utils/cookie'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'workbench',
      // 懒加载：路由级组件按需分包，不进首屏关键路径
      component: () => import('@/views/WorkbenchView.vue'),
    },
    {
      path: '/datapage/:pageid',
      name: 'datapage',
      component: () => import('@/views/datapage/datapage.vue'),
    },
    {
        path: '/ganttdemo',
        name: 'GanttDemo',
        component: () => import('@/views/demo/gantt-demo.vue'),
        meta: {title: 'DataEvoluter · Gantt Demo', requiresAuth: false}
    },
    {
        path: '/gantt',
        name: 'Gantt',
        component: () => import('@/views/demo/gantt.vue'),
        meta: {title: 'DataEvoluter · Gantt', requiresAuth: false}
    },
    // {
    //     path: '/:pathMatch(.*)*',
    //     redirect: '/'
    // }
  ],
})


//全局前置守卫：必须登录后才能进入问答页面
router.beforeEach((to, from, next) => {
    //标题
    // if (to.meta.title) {
    //     document.title = to.meta.title
    // }
    //需要登录的页面
    if (to.meta.requiresAuth) {
        if (!getToken()) {
            //未登录，跳转登录页
            next('/login')
            return
        }
    } else if (to.path === '/login') {
        //已登录访问登录页，直接进入问答页
        if (getToken()) {
            next('/')
            return
        }
    }
    next()
})

export default router

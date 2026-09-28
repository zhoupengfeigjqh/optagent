<script setup lang="ts">
/**
 * 应用根组件。
 *
 * 2026-09-28 收窄为**壳**（原三栏骨架已搬到 `views/WorkbenchView.vue`），只留三件事：
 * 1. **装配唯一的全局会话上下文**：`useAppSession()` 在此调用一次（内部 `provide`），
 *    供**所有**路由取用——工作台用 `useSession()` 取它；甘特图示意（`/ganttdemo`）与
 *    数据页（`/datapage/:pageid`）当前不消费会话，但同样在这棵子树内，将来要用也不会
 *    因缺上下文而抛错（`useSession()` 无上下文时是**硬失败**，不是静默空状态）。
 * 2. 提供 ant-design-vue 的中文语言包。
 * 3. 渲染 `<router-view />`。
 *
 * MUST NOT 在这里加载会话列表或恢复当前会话：那是**工作台**的行为——放在根组件上会让
 * `/ganttdemo`、`/datapage/*` 也白拉一次历史，并让"记住当前会话"在所有路径上改写 URL。
 */
import { ref } from 'vue'

// 引入 Ant Design Vue 的中文语言包
import zhCN from 'ant-design-vue/es/locale/zh_CN'

import { useAppSession } from './composables/useAppSession'

// 装配一次、全局共享（各视图用 `useSession()` 取这份上下文，不各自新建状态）
useAppSession()

// 定义 locale 变量
const locale = ref(zhCN)
</script>

<template>
  <a-config-provider :locale="locale">
    <router-view />
  </a-config-provider>
</template>

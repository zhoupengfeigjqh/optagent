<script setup lang="ts">
/**
 * 应用根组件。
 *
 * 收窄为**壳**：装配全局会话上下文、提供 ant-design-vue 中文语言包、渲染路由。
 *
 * 2026-11-18：移除右下角悬浮「退出登录」。退出入口统一收进聊天页左上角账号菜单
 * （`components/chat/UserMenu.vue`），同一页面不再有两个语义重复的登出入口。
 */
import { ref } from 'vue'

// 引入 Ant Design Vue 的中文语言包
import zhCN from 'ant-design-vue/es/locale/zh_CN'

import { useAppSession } from './composables/useAppSession'

// 装配一次、全局共享（各视图用 `useSession()` 取这份上下文，不各自新建状态）
useAppSession()

const locale = ref(zhCN)
</script>

<template>
  <a-config-provider :locale="locale">
    <router-view />
  </a-config-provider>
</template>

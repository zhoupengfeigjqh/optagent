<!--
 * @Author: Nose陈建
 * @LastEditTime: 2026-09-21 17:03:34
-->
<template>
  <a-config-provider :locale="locale">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { ref } from 'vue';
// 引入 Ant Design Vue 的中文语言包
import zhCN from 'ant-design-vue/es/locale/zh_CN';

// 定义 locale 变量
const locale = ref(zhCN);
</script>
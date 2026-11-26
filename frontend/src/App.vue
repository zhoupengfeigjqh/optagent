<script setup lang="ts">
import { ref } from 'vue'

import zhCN from 'ant-design-vue/es/locale/zh_CN'

import { useAppSession } from './composables/useAppSession'

useAppSession()

const locale = ref(zhCN)
</script>

<template>
  <a-config-provider :locale="locale">
    <router-view />
  </a-config-provider>
</template>

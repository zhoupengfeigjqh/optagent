<script setup lang="ts">
/**
 * 应用根组件：装配路由、常驻一级导航与四个功能区。
 *
 * 一级导航固定 4 项（`FR-053`）；功能区内由各自 Area 组件自行承载两级导航。
 * 全局播报集中在 `AppShell` 的 `aria-live` 区域，避免多处重复播报（原则四）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import AppShell from './components/layout/AppShell.vue'
import AgentArea from './components/agents/AgentArea.vue'
import DeployArea from './components/deploy/DeployArea.vue'
import SkillArea from './components/skills/SkillArea.vue'
import McpArea from './components/mcp/McpArea.vue'
import { NAV_ITEMS, buildPath, createRouter, type RouteName } from './router'

const router = createRouter({ base: '/admin' })
const route = router.current
const announcement = ref('')

const areaLabel = computed(
  () => NAV_ITEMS.find((item) => item.name === route.value.name)?.label ?? '数字人管理平台',
)

function navigateByName(name: RouteName): void {
  router.navigate(buildPath({ name }))
}

function navigateTo(path: string): void {
  router.navigate(path)
}

function announce(text: string): void {
  announcement.value = text
}

onBeforeUnmount(() => router.destroy())
</script>

<template>
  <AppShell
    :current="route.name"
    :area-label="areaLabel"
    :announcement="announcement"
    @navigate="navigateByName"
  >
    <AgentArea
      v-if="route.name === 'agents'"
      :detail="route.detail"
      :tab="route.tab"
      @navigate="navigateTo"
      @announce="announce"
    />
    <DeployArea
      v-else-if="route.name === 'deploy'"
      :detail="route.detail"
      :tab="route.tab"
      @navigate="navigateTo"
      @announce="announce"
    />
    <SkillArea
      v-else-if="route.name === 'skills'"
      :detail="route.detail"
      :tab="route.tab"
      @navigate="navigateTo"
      @announce="announce"
    />
    <McpArea
      v-else
      :detail="route.detail"
      :tab="route.tab"
      @navigate="navigateTo"
      @announce="announce"
    />
  </AppShell>
</template>

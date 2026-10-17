<script setup lang="ts">
/**
 * 应用根组件：装配路由、常驻一级导航与四个功能区。
 *
 * 一级导航固定 5 项（`FR-053`，2026-10-03 新增「本体管理」）；功能区内由各自
 * Area 组件自行承载两级导航。
 * 全局播报集中在 `AppShell` 的 `aria-live` 区域，避免多处重复播报（原则四）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import AppShell from './components/layout/AppShell.vue'
import AgentArea from './components/agents/AgentArea.vue'
import DeployArea from './components/deploy/DeployArea.vue'
import SkillArea from './components/skills/SkillArea.vue'
import McpArea from './components/mcp/McpArea.vue'
import OntologyArea from './components/ontology/OntologyArea.vue'
import { NAV_ITEMS, buildPath, createRouter, type RouteName } from './router'

const router = createRouter({ base: '/admin' })
const route = router.current
const announcement = ref('')

const areaLabel = computed(
  () => NAV_ITEMS.find((item) => item.name === route.value.name)?.label ?? '数字人管理平台',
)

/**
 * 本体详情的两段身份（2026-10-17）：地址是 `/ontology/{场景名}/{本体名}`，
 * 路由把两段合成 `detail`（`场景名/本体名`），这里拆成组件需要的两个 prop。
 * 单段（历史地址）按"只有本体名、缺场景"处理——不加载详情，与缺参同一表现。
 */
const ontologyRef = computed<{ scenario: string | null; name: string | null }>(() => {
  const detail = route.value.detail
  if (!detail) return { scenario: null, name: null }
  const index = detail.indexOf('/')
  if (index < 0) return { scenario: null, name: detail }
  return { scenario: detail.slice(0, index), name: detail.slice(index + 1) }
})

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
    <OntologyArea
      v-else-if="route.name === 'ontology'"
      :detail="ontologyRef.name"
      :tab="route.tab"
      :scenario="ontologyRef.scenario"
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

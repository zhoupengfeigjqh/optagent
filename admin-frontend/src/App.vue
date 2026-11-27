<script setup lang="ts">
/**
 * 应用根组件：装配路由、会话守卫与各顶层视图。
 *
 * 两个顶层分支：
 *  - `login` → 管理员登录页（整页，无导航壳）；
 *  - 其余为受守卫的功能区：会话探测完成后，**非管理员一律改道登录页**。
 *
 * 一级导航固定 5 项（`FR-053`）；功能区内由各自 Area 组件自行承载两级导航。
 * 全局播报集中在 `AppShell` 的 `aria-live` 区域，避免多处重复播报（原则四）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppShell from './components/layout/AppShell.vue'
import AdminLoginView from './components/auth/AdminLoginView.vue'
import UsersArea from './components/users/UsersArea.vue'
import AgentArea from './components/agents/AgentArea.vue'
import SkillArea from './components/skills/SkillArea.vue'
import McpArea from './components/mcp/McpArea.vue'
import OntologyArea from './components/ontology/OntologyArea.vue'
import { useAuthSession } from './composables/useAuthSession'
import { ADMIN_BASE_PATH } from './constants/entries'
import { NAV_ITEMS, buildPath, createRouter, type RouteName } from './router'

const router = createRouter({ base: ADMIN_BASE_PATH })
const route = router.current
const session = useAuthSession()

/** 探测未完成前功能区分支不渲染，避免"闪一下再跳登录页" */
const showConsole = computed(() => session.ready.value && session.isAdmin.value)

onMounted(() => {
  void session.probe()
})

/**
 * 守卫（功能区 ≠ 伪路由）：非管理员访问功能区 → `/login`（replace，不给历史留档）；
 * 已登录管理员误访 `/login` → 直接进控制台。
 */
watch(
  () => [route.value.name, session.ready.value, session.isAdmin.value] as const,
  ([name, ready, admin]) => {
    if (!ready) return
    if (name === 'login') {
      if (admin) router.navigate('/', { replace: true })
      return
    }
    if (!admin) router.navigate('/login', { replace: true })
  },
  { immediate: true },
)

const ontologyRef = computed<{ scenario: string | null; name: string | null }>(() => {
  const detail = route.value.detail
  if (!detail) return { scenario: null, name: null }
  const index = detail.indexOf('/')
  if (index < 0) return { scenario: null, name: detail }
  return { scenario: detail.slice(0, index), name: detail.slice(index + 1) }
})

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

const announcement = ref('')

/** 退出登录：清会话并回登录页（replace） */
async function logout(): Promise<void> {
  await session.logout()
  router.navigate('/login', { replace: true })
}

onBeforeUnmount(() => router.destroy())
</script>

<template>
  <AdminLoginView
    v-if="route.name === 'login'"
    @authenticated="router.navigate('/', { replace: true })"
  />

  <!-- 功能区：探测中 / 非管理员时由守卫改道，此处留白防闪跳 -->
  <p v-else-if="!showConsole" class="app-boot">正在验证登录状态…</p>

  <AppShell
    v-else
    :current="route.name as RouteName"
    :area-label="areaLabel"
    :announcement="announcement"
    :who="session.profile.value?.display_name ?? session.profile.value?.user_id ?? null"
    @navigate="navigateByName"
    @logout="logout"
  >
    <AgentArea
      v-if="route.name === 'agents'"
      :detail="route.detail"
      :tab="route.tab"
      @navigate="navigateTo"
      @announce="announce"
    />
    <!-- 用户管理没有二级路由：不传 detail / tab / navigate（2026-11-27 清理死契约） -->
    <UsersArea v-else-if="route.name === 'users'" @announce="announce" />
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

<style scoped>
.app-boot {
  margin: 48px 0;
  text-align: center;
  color: var(--color-text-muted);
}
</style>

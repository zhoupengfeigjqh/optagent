<script setup lang="ts">
/**
 * 应用外壳：页头（含管理员身份与退出）+ 常驻一级导航 + 内容区 + 全局播报区。
 *
 * 只用于管理员控制台；管理员登录页是独立整页，不经过这里。
 * 「全局播报区」是 `aria-live="polite"` 的单一落点——部署结果、保存结果等
 * 需要被读屏播报的信息都送到这里，避免每个组件各自宣告造成重复播报（原则四）。
 */
import { ref } from 'vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import PrimaryNav from './PrimaryNav.vue'
import type { RouteName } from '../../router'

defineProps<{
  current: RouteName
  areaLabel: string
  announcement?: string
  who?: string | null
}>()

const emit = defineEmits<{
  (e: 'navigate', name: RouteName): void
  (e: 'logout'): void
}>()

/**
 * 页头退出是常驻入口，误点即丢登录态，故与聊天区一致加二次确认，
 * 确认后才向上发出 `logout`（登出编排仍归 `App.vue`）。
 */
const confirmOpen = ref(false)

function requestLogout(): void {
  confirmOpen.value = true
}

function confirmLogout(): void {
  confirmOpen.value = false
  emit('logout')
}
</script>

<template>
  <div class="app-shell">
    <div class="app-shell__wrap">
      <header class="app-shell__header">
        <div>
          <p class="app-shell__brand">数字人管理平台</p>
          <h1 class="app-shell__title">{{ areaLabel }}</h1>
        </div>
        <div v-if="who" class="app-shell__identity">
          <span class="app-shell__who">{{ who }} · 管理员</span>
          <button type="button" class="app-shell__logout" @click="requestLogout">退出登录</button>
        </div>
      </header>

      <PrimaryNav :current="current" @navigate="emit('navigate', $event)" />

      <main class="app-shell__main">
        <slot />
      </main>
    </div>

    <p class="app-shell__live" role="status" aria-live="polite">{{ announcement }}</p>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="退出登录"
      message="退出后需要重新输入账号密码才能进入管理平台，确认退出？"
      confirm-label="退出登录"
      @confirm="confirmLogout"
    />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}

.app-shell__wrap {
  padding: 0 var(--space-5);
}

.app-shell__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-4) 0 var(--space-3);
}

.app-shell__brand {
  margin: 0;
  font-size: var(--font-size-xs);
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.app-shell__title {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-xl);
}

.app-shell__identity {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.app-shell__who {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.app-shell__logout {
  height: 28px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.app-shell__logout:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.app-shell__main {
  flex: 1;
  padding: var(--space-5) 0 48px;
}

.app-shell__live {
  margin: 0;
  padding: 0 var(--space-5) var(--space-4);
  min-height: var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

@media (max-width: 640px) {
  .app-shell__wrap {
    padding: 0 var(--space-4);
  }
}
</style>

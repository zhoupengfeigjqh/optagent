<script setup lang="ts">
/**
 * 应用外壳：深色顶部条 + 管理员身份行 + 一级页签 + 内容区 + 全局播报区。
 *
 * 只用于管理员控制台；登录页和普通用户页都是独立整页，不经过这里。
 */
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
</script>

<template>
  <div class="app-shell">
    <div class="app-shell__topbar" aria-hidden="true"></div>

    <div class="app-shell__wrap">
      <header class="app-shell__header">
        <div class="app-shell__crumb">数字人管理平台</div>
        <div class="app-shell__identity">
          <span class="app-shell__who-tag">管理员 · {{ who ?? '未命名' }}</span>
          <button type="button" class="btn" @click="emit('logout')">退出登录</button>
        </div>
      </header>

      <h1 class="app-shell__title">{{ areaLabel }}</h1>
      <PrimaryNav :current="current" @navigate="emit('navigate', $event)" />

      <main class="app-shell__main">
        <slot />
      </main>
    </div>

    <p class="app-shell__live" role="status" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.app-shell__topbar {
  height: 34px;
  flex: none;
  background: #20242a;
}

.app-shell__wrap {
  width: min(100%, 1440px);
  margin: 0 auto;
  padding: 0 var(--space-5);
}

.app-shell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding-top: 14px;
}

.app-shell__crumb {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.app-shell__title {
  margin: 4px 0 14px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.app-shell__identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.app-shell__who-tag {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  background: #f2f3f5;
  border-radius: var(--radius-sm);
  padding: 3px 8px;
}

.app-shell__main {
  flex: 1;
  padding: 4px 0 48px;
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

  .app-shell__title {
    font-size: 21px;
  }
}
</style>

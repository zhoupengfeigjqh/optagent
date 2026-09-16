<script setup lang="ts">
/**
 * 应用外壳：页头 + 常驻一级导航 + 内容区 + 全局播报区。
 *
 * 「全局播报区」是 `aria-live="polite"` 的单一落点——部署结果、保存结果等
 * 需要被读屏播报的信息都送到这里，避免每个组件各自宣告造成重复播报（原则四）。
 */
import PrimaryNav from './PrimaryNav.vue'
import type { RouteName } from '../../router'

defineProps<{
  current: RouteName
  /** 当前功能区名称（用于文档标题与页头） */
  areaLabel: string
  /** 需要播报的全局状态文本（空串表示无） */
  announcement?: string
}>()

const emit = defineEmits<{
  (e: 'navigate', name: RouteName): void
}>()
</script>

<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <p class="app-shell__brand">数字人管理平台</p>
      <h1 class="app-shell__title">{{ areaLabel }}</h1>
    </header>

    <PrimaryNav :current="current" @navigate="emit('navigate', $event)" />

    <main class="app-shell__main">
      <slot />
    </main>

    <!-- 全局播报区：读屏可播报部署结果、保存结果等 -->
    <p class="app-shell__live" role="status" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}

.app-shell__header {
  padding: var(--space-4) var(--space-4) var(--space-3);
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

.app-shell__main {
  flex: 1;
  padding: var(--space-5) var(--space-4);
}

.app-shell__live {
  margin: 0;
  padding: 0 var(--space-4) var(--space-4);
  min-height: var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
</style>

<script setup lang="ts">
/**
 * 三栏工作台骨架（T032）
 *
 * 插槽命名同时兼容两套口径：
 * - `contracts/ui-contracts.md` 定义 `sidebar` / `main` / `preview`
 * - `tasks.md` 后续任务按 `history` / `chat` / `preview` 接入
 * 因此 `sidebar`/`main` 各自以别名插槽作为默认内容，两者皆可用。
 *
 * 预览列收起时**不占位**（FR-048）：中栏占满剩余宽度。
 */
withDefaults(
  defineProps<{
    /** 是否展开右侧预览列 */
    previewOpen?: boolean
  }>(),
  { previewOpen: false },
)
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--preview-open': previewOpen }">
    <aside class="app-shell__sidebar">
      <slot name="sidebar">
        <slot name="history" />
      </slot>
    </aside>

    <main class="app-shell__main">
      <slot name="main">
        <slot name="chat" />
      </slot>
    </main>

    <section v-if="previewOpen" class="app-shell__preview" aria-label="内容预览">
      <slot name="preview" />
    </section>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: var(--layout-sidebar-width) minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg);
}

.app-shell--preview-open {
  grid-template-columns:
    var(--layout-sidebar-width) minmax(0, 1fr)
    var(--layout-preview-ratio);
}

.app-shell__sidebar,
.app-shell__main,
.app-shell__preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.app-shell__sidebar {
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
}

.app-shell__preview {
  border-left: 1px solid var(--color-border);
  background: var(--color-surface);
}
</style>

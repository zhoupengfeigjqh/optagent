<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  useResizablePanel,
} from '../../composables/useResizablePanel'

const props = withDefaults(
  defineProps<{
    previewOpen?: boolean
    previewMaximized?: boolean
  }>(),
  { previewOpen: false, previewMaximized: false },
)

const rootEl = ref<HTMLElement | null>(null)
const previewEl = ref<HTMLElement | null>(null)

const hiddenByMaximize = computed(() => (props.previewMaximized ? true : undefined))

const { width, resizing, style, onPointerDown, onKeydown } = useResizablePanel({
  container: () => rootEl.value,
  panel: () => previewEl.value,
})
</script>

<template>
  <div
    ref="rootEl"
    class="app-shell"
    :class="{
      'app-shell--preview-open': previewOpen,
      'app-shell--preview-maximized': previewMaximized,
      'app-shell--resizing': resizing,
    }"
    :style="style"
  >
    <aside class="app-shell__sidebar" :inert="hiddenByMaximize">
      <slot name="sidebar">
        <slot name="history" />
      </slot>
    </aside>

    <main class="app-shell__main" :inert="hiddenByMaximize">
      <slot name="main">
        <slot name="chat" />
      </slot>
    </main>

    <template v-if="previewOpen">
      <div
        class="app-shell__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整文件空间宽度"
        :aria-valuemin="PANEL_MIN_WIDTH"
        :aria-valuemax="PANEL_MAX_WIDTH"
        :aria-valuenow="width ?? undefined"
        tabindex="0"
        :inert="hiddenByMaximize"
        @pointerdown="onPointerDown"
        @keydown="onKeydown"
      />

      <section ref="previewEl" class="app-shell__preview" aria-label="内容预览">
        <slot name="preview" />
      </section>
    </template>
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

/* 展开右栏：中栏 + 分隔条 + 右栏（宽度优先取运行时注入的像素值，否则取默认比例） */
.app-shell--preview-open {
  grid-template-columns:
    var(--layout-sidebar-width) minmax(0, 1fr)
    var(--layout-resizer-width)
    var(--layout-preview-width, var(--layout-preview-ratio));
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
  background: var(--color-surface);
}

.app-shell--preview-maximized .app-shell__preview {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-panel-maximized);
}

.app-shell__resizer {
  position: relative;
  z-index: 1;
  cursor: col-resize;
  touch-action: none;
  background: var(--color-surface);
}

.app-shell__resizer::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--color-border);
}

.app-shell__resizer:hover::after,
.app-shell__resizer:focus-visible::after,
.app-shell--resizing .app-shell__resizer::after {
  width: 2px;
  background: var(--color-primary);
}

.app-shell__resizer:focus-visible {
  outline: none;
}

/* 拖动中：全局禁止选中与光标抖动 */
.app-shell--resizing,
.app-shell--resizing * {
  cursor: col-resize;
  user-select: none;
}
</style>

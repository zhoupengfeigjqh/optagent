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
 * 展开时其宽度可经左缘分隔条**手动拖动**调整（`useResizablePanel`）：
 * 未拖动时沿用默认比例（约 1/3），拖动后固定为像素宽度并在上下限内收敛。
 */
import { ref } from 'vue'

import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  useResizablePanel,
} from '../../composables/useResizablePanel'

withDefaults(
  defineProps<{
    /** 是否展开右侧预览列 */
    previewOpen?: boolean
  }>(),
  { previewOpen: false },
)

const rootEl = ref<HTMLElement | null>(null)
const previewEl = ref<HTMLElement | null>(null)

const { width, resizing, style, onPointerDown, onKeydown } = useResizablePanel({
  container: () => rootEl.value,
  panel: () => previewEl.value,
})
</script>

<template>
  <div
    ref="rootEl"
    class="app-shell"
    :class="{ 'app-shell--preview-open': previewOpen, 'app-shell--resizing': resizing }"
    :style="style"
  >
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

    <template v-if="previewOpen">
      <!-- 分隔条：拖动调整右栏宽度；键盘 ← / →（Shift 加速） -->
      <div
        class="app-shell__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整文件空间宽度"
        :aria-valuemin="PANEL_MIN_WIDTH"
        :aria-valuemax="PANEL_MAX_WIDTH"
        :aria-valuenow="width ?? undefined"
        tabindex="0"
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

/* 分隔条：整列可拖动，视觉分隔线居中（1px，悬停/聚焦/拖动时加粗为品牌色） */
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

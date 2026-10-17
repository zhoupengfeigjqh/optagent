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
 *
 * **放大态**（2026-10-16，`specs/011-preview-maximize`）：预览列铺满整个视口。
 * 实现上只加一个类 + 几行样式，**不卸载也不改写**另两栏与栅格宽度——
 * 于是"缩回后宽度逐像素一致"（FR-004）与"草稿 / 消息滚动位置零丢失"（FR-030）
 * 是结构性成立的，而不是靠细节调出来的。放大期间另两栏与分隔条标 `inert`：
 * 它们仍被看见的可能性为零，但**必须**仍然挂载。
 */
import { computed, ref } from 'vue'

import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  useResizablePanel,
} from '../../composables/useResizablePanel'

const props = withDefaults(
  defineProps<{
    /** 是否展开右侧预览列 */
    previewOpen?: boolean
    /** 预览列是否处于放大态（铺满视口；011） */
    previewMaximized?: boolean
  }>(),
  { previewOpen: false, previewMaximized: false },
)

const rootEl = ref<HTMLElement | null>(null)
const previewEl = ref<HTMLElement | null>(null)

/**
 * 传给另两栏与分隔条的 `inert` 值。
 *
 * 用 `true / undefined` 而不是 `true / false`：`false` 会让属性以字面量 `"false"` 留在 DOM 上，
 * 而 `inert` 是"存在即生效"的属性——那样反倒把两栏永久禁掉了。
 */
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
    <!-- 放大态下另两栏与分隔条一并 `inert`：被覆盖层挡住的东西 MUST 同时退出键盘顺序
         与无障碍树（否则 Tab 会把焦点停在一个看不见的控件上）。
         `inert` 不改布局、不动滚动盒——中栏的草稿与消息滚动位置因此零丢失（FR-030）；
         分隔条自带 `tabindex="0"`，必须一起纳入。 -->
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

/* 放大态（011）：预览列铺满整个视口，盖住另两栏。
   层级用令牌（低于 dialog 与 toast）：放大态下的二次确认与提示 MUST 仍浮在上面。
   `fixed` 生效的前提是祖先没有 transform / filter —— 这里从 html 到 .app-shell 都没有，
   因此定位相对视口，且无需任何 JS 尺寸测量（窗口缩放不失效，FR-033）。 */
.app-shell--preview-maximized .app-shell__preview {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-panel-maximized);
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

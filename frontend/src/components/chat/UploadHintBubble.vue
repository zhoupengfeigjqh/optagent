<script setup lang="ts">
/**
 * 空数据引导气泡（2026-10-29，014）。
 *
 * 纯展示组件：文案由调用方传入（固定常量在 `utils/empty-data-hint.ts`），
 * 关闭只上抛 `close`，不持有"是否显示过"之类的业务状态。
 *
 * 无障碍（FR-017）：
 * - `role="status"` ⇒ 读屏会把文案当作提示播报；
 * - 关闭入口是原生 `<button>` + 可读 `aria-label`，可键盘聚焦并用 Enter/Space 触发；
 * - 动效在 `prefers-reduced-motion` 下降级为静态，提示语义不依赖颜色。
 */
import BaseIcon from '../common/BaseIcon.vue'

withDefaults(
  defineProps<{
    /** 提示文案（界面固定常量） */
    text?: string
  }>(),
  { text: '' },
)

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="upload-hint" role="status">
    <p class="upload-hint__text">{{ text }}</p>
    <button
      type="button"
      class="upload-hint__close"
      aria-label="关闭提示"
      @click="emit('close')"
    >
      <BaseIcon name="close" :size="12" />
    </button>
  </div>
</template>

<style scoped>
/* 锚点由父级（工具栏左侧分组）提供 `position: relative`：向上展开，不遮挡「+」本身 */
.upload-hint {
  position: absolute;
  bottom: calc(100% + var(--space-2));
  left: 0;
  z-index: 10;
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: max-content;
  max-width: 240px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  animation: upload-hint-in var(--motion-duration-fast) var(--motion-easing-standard);
}

.upload-hint__text {
  color: var(--color-text);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
  /* 窄屏下允许换行，不横向溢出 */
  overflow-wrap: anywhere;
}

.upload-hint__close {
  display: inline-flex;
  flex: none;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.upload-hint__close:hover {
  color: var(--color-text);
}

.upload-hint__close:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@keyframes upload-hint-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 系统偏好"减少动效"：直接静态呈现，不做淡入/位移 */
@media (prefers-reduced-motion: reduce) {
  .upload-hint {
    animation: none;
  }
}
</style>

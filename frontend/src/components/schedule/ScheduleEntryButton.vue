<script setup lang="ts">
/**
 * 定时任务入口按钮（015，T035）
 *
 * 放在聊天区头部铃铛**之前**：与铃铛同级的"次级入口"，不抢主操作（输入区）的注意力。
 *
 * 无障碍（宪章原则四）：
 * - 原生 `<button>`：Tab 可达，Enter / Space 天然触发，不需要额外键盘处理；
 * - `aria-pressed` 表达"设置页是否展开"（这是一个开关式入口，不是一次性动作）；
 * - 不可用时（未选数字人）**原生 disabled** + `title` 说明原因，读屏会连同名称一起朗读。
 *
 * `title` 之外另给一段 visually-hidden 的原因文本：`title` 在触摸设备上根本不出现，
 * 而"为什么点不动"必须能被感知到。
 */
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 设置页是否已展开（`aria-pressed`） */
    open?: boolean
    /** 是否不可用（未选数字人 / 数字人不可用） */
    disabled?: boolean
    /** 不可用原因（`title` 与隐藏文本共用） */
    disabledReason?: string | null
  }>(),
  { open: false, disabled: false, disabledReason: null },
)

const emit = defineEmits<{ open: [] }>()

function onClick(): void {
  if (props.disabled) return
  emit('open')
}
</script>

<template>
  <button
    type="button"
    class="schedule-entry"
    :class="{ 'schedule-entry--active': open }"
    aria-label="定时任务"
    :aria-pressed="open ? 'true' : 'false'"
    :disabled="disabled"
    :title="disabled ? (disabledReason ?? '暂不可用') : '定时任务'"
    @click="onClick"
  >
    <BaseIcon name="schedule" :size="16" />
    <span v-if="disabled" class="visually-hidden">
      （不可用：{{ disabledReason ?? '暂不可用' }}）
    </span>
  </button>
</template>

<style scoped>
.schedule-entry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.schedule-entry:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

/* 展开态用**颜色 + 底色**双通道，不单靠颜色区分（与状态圆点同口径） */
.schedule-entry--active {
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}

.schedule-entry:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

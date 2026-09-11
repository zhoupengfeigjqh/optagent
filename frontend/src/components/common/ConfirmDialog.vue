<script setup lang="ts">
/**
 * 二次确认弹窗（基于 `BaseDialog`）
 *
 * 用于破坏性操作（如删除会话，`backend-api.md` §3.5 要求"删除前二次确认"）：
 * `BaseDialog` 提供原生 `<dialog>` 的焦点陷阱与 Esc 关闭，本组件只固定
 * "标题 + 说明 + 取消/确认"结构，并把一切关闭意图统一收敛为 `cancel`。
 *
 * 本组件**不发起请求**：`confirm` 只表示用户已确认，由调用方决定后续动作与禁用态（`busy`）。
 */
import BaseButton from './BaseButton.vue'
import BaseDialog from './BaseDialog.vue'

withDefaults(
  defineProps<{
    /** 是否展开 */
    open?: boolean
    /** 标题 */
    title: string
    /** 说明文案（支持换行） */
    message?: string
    /** 确认按钮文案 */
    confirmLabel?: string
    /** 取消按钮文案 */
    cancelLabel?: string
    /** 确认动作是否用危险样式（删除类操作） */
    danger?: boolean
    /** 确认动作进行中：两个按钮均禁用，防重复提交 */
    busy?: boolean
  }>(),
  {
    open: false,
    message: '',
    confirmLabel: '确认',
    cancelLabel: '取消',
    danger: false,
    busy: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <BaseDialog :open="open" :title="title" @close="emit('cancel')">
    <p class="confirm-dialog__message">{{ message }}</p>
    <slot />

    <template #footer>
      <BaseButton variant="secondary" :disabled="busy" @click="emit('cancel')">
        {{ cancelLabel }}
      </BaseButton>
      <BaseButton
        :variant="danger ? 'danger' : 'primary'"
        :disabled="busy"
        :loading="busy"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>

<style scoped>
.confirm-dialog__message {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.7;
  white-space: pre-wrap;
}
</style>

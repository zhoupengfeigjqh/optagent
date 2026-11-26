<script setup lang="ts">
import BaseButton from './BaseButton.vue'
import BaseDialog from './BaseDialog.vue'

withDefaults(
  defineProps<{
    open?: boolean
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
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

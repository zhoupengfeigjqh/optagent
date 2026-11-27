<script setup lang="ts">
import type { Model } from '../../api/types'
import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'
import ModelPicker from './ModelPicker.vue'
import ThinkingToggle from './ThinkingToggle.vue'

withDefaults(
  defineProps<{
    thinking?: boolean
    model?: string | null
    models?: Model[]
    canSend?: boolean
    streaming?: boolean
    uploadDisabled?: boolean
  }>(),
  {
    thinking: false,
    model: null,
    models: () => [],
    canSend: false,
    streaming: false,
    uploadDisabled: false,
  },
)

const emit = defineEmits<{
  'toggle-thinking': []
  'select-model': [model: string]
  send: []
  stop: []
  'toggle-upload': []
}>()

function onSelectModel(model: string): void {
  emit('select-model', model)
}
</script>

<template>
  <div class="composer-toolbar">
    <div class="composer-toolbar__left">
      <BaseButton
        variant="ghost"
        size="sm"
        :disabled="uploadDisabled"
        aria-label="上传文件"
        @click="emit('toggle-upload')"
      >
        <BaseIcon name="plus" :size="16" />
      </BaseButton>

      <slot name="upload-hint" />
    </div>

    <div class="composer-toolbar__right">
      <ModelPicker :model="model" :models="models" @select="onSelectModel" />
      <ThinkingToggle :thinking="thinking" @toggle="emit('toggle-thinking')" />

      <BaseButton
        v-if="streaming"
        variant="danger"
        size="sm"
        aria-label="中断本轮"
        @click="emit('stop')"
      >
        <BaseIcon name="stop" :size="14" />
      </BaseButton>
      <BaseButton v-else variant="primary" size="sm" :disabled="!canSend" @click="emit('send')">
        发送
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.composer-toolbar__left {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.composer-toolbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>

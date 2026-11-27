<script setup lang="ts">
import { computed, ref } from 'vue'

import type { Model } from '../../api/types'
import BaseDropdown from '../common/BaseDropdown.vue'

const props = withDefaults(
  defineProps<{
    model?: string | null
    models?: Model[]
    disabled?: boolean
  }>(),
  { model: null, models: () => [], disabled: false },
)

const emit = defineEmits<{ select: [model: string] }>()

const open = ref(false)

const items = computed(() =>
  props.models.map((item) => ({
    key: item.model,
    label: item.is_default ? `${item.model}（默认）` : item.model,
  })),
)

const activeIndex = computed(() => {
  const index = props.models.findIndex((item) => item.model === props.model)
  return index >= 0 ? index : 0
})

const triggerLabel = computed(() => {
  if (props.models.length === 0) {
    return '模型加载中'
  }
  if (props.model === null) {
    return '默认模型'
  }
  const selected = props.models.find((item) => item.model === props.model)
  if (!selected) {
    return props.model
  }
  return selected.is_default ? `${selected.model}（默认）` : selected.model
})

function onToggle(): void {
  if (props.disabled || props.models.length === 0) {
    return
  }
  open.value = !open.value
}

function onSelect(key: string): void {
  open.value = false
  emit('select', key)
}

function onClose(): void {
  open.value = false
}
</script>

<template>
  <BaseDropdown
    class="model-picker"
    :class="{ 'model-picker--disabled': disabled }"
    :open="open"
    :items="items"
    :active-index="activeIndex"
    @toggle="onToggle"
    @select="onSelect"
    @close="onClose"
  >
    <template #trigger>
      <span class="model-picker__label">{{ triggerLabel }}</span>
    </template>
  </BaseDropdown>
</template>

<style scoped>
.model-picker__label {
  max-width: 220px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.model-picker--disabled {
  opacity: 0.55;
  pointer-events: none;
}
</style>

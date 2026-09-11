<script setup lang="ts">
/**
 * 模型选择（T050，FR-013）
 *
 * 模型是**请求级**参数：切换只改本地状态，随下一条消息提交。
 * 复用 `BaseDropdown` 获得键盘可达（方向键 / Home / End / Esc）与点击外部关闭。
 */
import { computed, ref } from 'vue'

import type { Model } from '../../api/types'
import BaseDropdown from '../common/BaseDropdown.vue'

const props = withDefaults(
  defineProps<{
    /** 当前模型；`null` 表示使用默认模型 */
    model?: string | null
    /** 可选模型列表 */
    models?: Model[]
    /** 是否禁用 */
    disabled?: boolean
  }>(),
  { model: null, models: () => [], disabled: false },
)

const emit = defineEmits<{ select: [model: string] }>()

const open = ref(false)

/** 菜单项：`is_default` 项附「默认」标识。 */
const items = computed(() =>
  props.models.map((item) => ({
    key: item.model,
    label: item.is_default ? `${item.model}（默认）` : item.model,
  })),
)

/** 高亮项对齐当前选择（未命中时落到首项）。 */
const activeIndex = computed(() => {
  const index = props.models.findIndex((item) => item.model === props.model)
  return index >= 0 ? index : 0
})

/** 触发器文案：展示当前模型并标注是否为默认项。 */
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
  // 空列表无可选项，展开只会得到一个空菜单
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

<script setup lang="ts">
/**
 * SOUL 编辑器（`FR-019`：必填非空）。
 *
 * **原样回显**：值不做 trim、不做任何规范化（`FR-017` 要求含换行与标点）。
 * 必填校验只在**提交时**由后端与前端共同判定；此处只给出可读的前置提示，
 * 避免用户边输入边被红色告警打扰。
 */
import { computed } from 'vue'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const isEmpty = computed(() => props.modelValue.trim() === '')
</script>

<template>
  <div class="soul-editor">
    <label class="field__label" for="soul-textarea">
      SOUL 人格全文<span class="field__required" aria-hidden="true">*</span>
    </label>
    <p class="field__hint">
      必填。内容会作为系统提示词追加给模型，换行与标点会**原样保留**。
    </p>
    <textarea
      id="soul-textarea"
      class="soul-editor__input"
      :value="modelValue"
      rows="16"
      :aria-required="true"
      :aria-invalid="isEmpty"
      aria-describedby="soul-hint"
      placeholder="例如：你是一名生产计划助手，负责……"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <p id="soul-hint" class="field__hint">
      <span v-if="isEmpty">当前为空，保存会被拒绝（SOUL 必填）</span>
      <span v-else>共 {{ modelValue.length }} 个字符</span>
    </p>
  </div>
</template>

<style scoped>
.soul-editor__input {
  width: 100%;
}
</style>

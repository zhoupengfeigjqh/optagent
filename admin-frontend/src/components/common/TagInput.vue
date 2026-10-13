<script setup lang="ts">
/**
 * 标签输入（004）：输入文字后**回车即成标签**，每个标签可点 ❌ 删除。
 *
 * 用于「能力标签」与「绝对禁止」两个多值字段。
 *
 * 校验前置在**输入时**给出可读原因（超长 / 重复 / 超条数），
 * 避免用户敲进去一个保存时才被后端拒绝的标签；后端仍是最终判据
 * （两侧同一组上限，见 `soul-design.ts` 的 `SOUL_LIMITS`）。
 */
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    /** 条数上限（超出后拒绝新增并提示） */
    maxItems?: number
    /** 单项字数上限 */
    maxLength?: number
    placeholder?: string
  }>(),
  {
    maxItems: 20,
    maxLength: 100,
    placeholder: '输入后回车添加',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const input = ref('')
const error = ref('')

function add(): void {
  const text = input.value.trim()
  if (text === '') return
  if (text.length > props.maxLength) {
    error.value = `单项不得超过 ${props.maxLength} 字（当前 ${text.length} 字）`
    return
  }
  if (props.modelValue.includes(text)) {
    error.value = `已存在相同内容：${text}`
    return
  }
  if (props.modelValue.length >= props.maxItems) {
    error.value = `最多 ${props.maxItems} 项（当前已满）`
    return
  }
  error.value = ''
  emit('update:modelValue', [...props.modelValue, text])
  input.value = ''
}

function remove(index: number): void {
  const next = [...props.modelValue]
  next.splice(index, 1)
  emit('update:modelValue', next)
  error.value = ''
}
</script>

<template>
  <div class="tag-input">
    <ul v-if="modelValue.length > 0" class="tag-input__list">
      <li v-for="(item, index) in modelValue" :key="`${item}-${index}`" class="tag-input__tag">
        <span>{{ item }}</span>
        <button
          type="button"
          class="tag-input__remove"
          :aria-label="`删除「${item}」`"
          @click="remove(index)"
        >
          ✕
        </button>
      </li>
    </ul>
    <p v-else class="field__hint">暂无内容。</p>

    <input
      v-model="input"
      type="text"
      class="tag-input__entry"
      :placeholder="placeholder"
      :maxlength="maxLength + 1"
      @keydown.enter.prevent="add"
    />

    <p v-if="error" class="tag-input__error" role="alert">{{ error }}</p>
    <p class="field__hint">
      已添加 {{ modelValue.length }} / {{ maxItems }} 项，回车添加，点 ✕ 删除。
    </p>
  </div>
</template>

<style scoped>
.tag-input__list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  padding: 0;
  list-style: none;
}

.tag-input__tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-surface-muted, #f2f4f8);
  font-size: var(--font-size-sm);
}

.tag-input__remove {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1;
  padding: 0 var(--space-1);
}

.tag-input__entry {
  width: 100%;
}

.tag-input__error {
  margin: var(--space-2) 0 0;
  color: var(--color-danger, #c0392b);
  font-size: var(--font-size-sm);
}
</style>

<script setup lang="ts">
/**
 * 多选清单（带搜索），供内置工具 / MCP 服务 / SKILL 三个选择器复用。
 *
 * 无障碍落点（原则四）：
 * - 用原生 `<fieldset>` + `<legend>` 给出可读分组名；
 * - 原生 `<input type="checkbox">` 键盘可达、状态可被读屏读出；
 * - 搜索框只为**缩小范围**服务，不改变已选集合（避免"搜不到就被取消选择"）。
 */
import { computed, ref } from 'vue'
import type { CheckboxOption } from './checkbox-option'

const props = withDefaults(
  defineProps<{
    legend: string
    options: CheckboxOption[]
    modelValue: string[]
    searchPlaceholder?: string
    emptyText?: string
    /** 已选中但不在 `options` 中的项（失效引用），单独呈现并标注 */
    orphans?: string[]
  }>(),
  {
    searchPlaceholder: '搜索…',
    emptyText: '暂无可选项',
    orphans: () => [],
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const keyword = ref('')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.options
  return props.options.filter(
    (o) =>
      o.value.toLowerCase().includes(kw) ||
      o.label.toLowerCase().includes(kw) ||
      (o.description ?? '').toLowerCase().includes(kw),
  )
})

function toggle(value: string, checked: boolean): void {
  const next = checked
    ? [...props.modelValue, value]
    : props.modelValue.filter((v) => v !== value)
  emit('update:modelValue', next)
}

function removeOrphan(value: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((v) => v !== value),
  )
}
</script>

<template>
  <fieldset class="checkbox-list">
    <legend class="checkbox-list__legend">{{ legend }}</legend>

    <label class="checkbox-list__search">
      <span class="visually-hidden">{{ legend }}搜索</span>
      <input v-model="keyword" type="search" :placeholder="searchPlaceholder" />
    </label>

    <ul v-if="filtered.length > 0" class="checkbox-list__items" data-test="options">
      <li v-for="option in filtered" :key="option.value" class="checkbox-list__item">
        <label class="checkbox-list__label">
          <input
            type="checkbox"
            :value="option.value"
            :checked="modelValue.includes(option.value)"
            :disabled="option.disabled === true"
            @change="toggle(option.value, ($event.target as HTMLInputElement).checked)"
          />
          <span class="checkbox-list__text">
            <span class="checkbox-list__title">
              {{ option.label }}
              <span v-if="option.badge" class="checkbox-list__badge">{{ option.badge }}</span>
            </span>
            <span v-if="option.description" class="checkbox-list__description">
              {{ option.description }}
            </span>
          </span>
        </label>
      </li>
    </ul>
    <p v-else class="checkbox-list__empty">{{ emptyText }}</p>

    <div v-if="orphans.length > 0" class="checkbox-list__orphans" role="alert">
      <p class="checkbox-list__orphans-title">以下引用已失效，请移除后再保存：</p>
      <ul>
        <li v-for="name in orphans" :key="name">
          <span class="mono">{{ name }}</span>
          <button type="button" class="btn" @click="removeOrphan(name)">移除</button>
        </li>
      </ul>
    </div>
  </fieldset>
</template>

<style scoped>
.checkbox-list {
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.checkbox-list__legend {
  padding: 0 var(--space-1);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.checkbox-list__search {
  display: block;
  margin-bottom: var(--space-2);
}

.checkbox-list__items {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
}

.checkbox-list__item + .checkbox-list__item {
  border-top: 1px solid var(--color-border);
}

.checkbox-list__label {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  cursor: pointer;
}

.checkbox-list__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.checkbox-list__title {
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.checkbox-list__badge {
  margin-left: var(--space-1);
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  font-weight: 400;
}

.checkbox-list__description {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.checkbox-list__empty {
  margin: var(--space-2) 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.checkbox-list__orphans {
  margin-top: var(--space-3);
  padding: var(--space-2);
  border: 1px solid var(--color-status-error);
  border-radius: var(--radius-sm);
  background: var(--color-status-error-bg);
  font-size: var(--font-size-sm);
}

.checkbox-list__orphans-title {
  margin: 0 0 var(--space-1);
}

.checkbox-list__orphans ul {
  margin: 0;
  padding-left: var(--space-5);
}

.checkbox-list__orphans li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
</style>

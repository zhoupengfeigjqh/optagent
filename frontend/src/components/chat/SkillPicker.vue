<script setup lang="ts">
/**
 * `/技能` 面板（2026-11-07）
 *
 * 与 `MentionPicker` 的关系：**同款浮层、同款交互，不同数据形态**。
 * 这里是**扁平单选**列表（没有级联），展示技能名 + 一行说明（就是进 System Prompt
 * 的那段 description，用户选之前能看到"它会用来做什么"）。
 *
 * 组件不持有业务状态：清单、过滤结果与高亮都由 props 驱动，选择意图上抛。
 */
import { nextTick, ref, watch } from 'vue'

import type { AgentSkill } from '../../api/types'
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    /** 已过滤的技能清单（过滤在 store 里做，组件只渲染） */
    skills?: AgentSkill[]
    /** 键盘高亮索引 */
    activeIndex?: number
    loading?: boolean
    /** 加载失败原因；空串 = 正常 */
    error?: string
    /** 已选技能名（打勾标记） */
    selected?: string | null
  }>(),
  {
    open: false,
    skills: () => [],
    activeIndex: 0,
    loading: false,
    error: '',
    selected: null,
  },
)

const emit = defineEmits<{
  pick: [name: string]
  close: []
  move: [delta: number]
  confirm: []
}>()

const listRef = ref<HTMLElement | null>(null)

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      emit('move', 1)
      break
    case 'ArrowUp':
      event.preventDefault()
      emit('move', -1)
      break
    case 'ArrowRight':
    case 'Enter':
      event.preventDefault()
      emit('confirm')
      break
    case 'Escape':
      event.preventDefault()
      emit('close')
      break
    default:
      break
  }
}

// 高亮项滚动入视区（长列表键盘导航）
watch(
  () => props.activeIndex,
  () => {
    void nextTick(() => {
      listRef.value
        ?.querySelector<HTMLElement>('[data-active="true"]')
        ?.scrollIntoView?.({ block: 'nearest' })
    })
  },
)
</script>

<template>
  <div v-if="open" ref="listRef" class="skill-picker" role="listbox" @keydown="onKeydown">
    <p v-if="loading" class="skill-picker__hint">正在加载技能…</p>
    <p v-else-if="error !== ''" class="skill-picker__hint">{{ error }}</p>
    <p v-else-if="skills.length === 0" class="skill-picker__empty">
      没有匹配的技能（该数字人需先搭配技能）
    </p>
    <template v-else>
      <button
        v-for="(skill, index) in skills"
        :key="skill.name"
        type="button"
        role="option"
        class="skill-picker__item"
        :class="{ 'skill-picker__item--active': activeIndex === index }"
        :aria-selected="activeIndex === index ? 'true' : 'false'"
        :data-active="activeIndex === index ? 'true' : 'false'"
        @click="emit('pick', skill.name)"
      >
        <BaseIcon name="agent" :size="14" />
        <span class="skill-picker__text">
          <span class="skill-picker__name">/{{ skill.name }}</span>
          <span class="skill-picker__description">{{ skill.description }}</span>
        </span>
        <BaseIcon
          v-if="selected === skill.name"
          name="check"
          :size="14"
          class="skill-picker__check"
        />
      </button>
    </template>
  </div>
</template>

<style scoped>
.skill-picker {
  max-height: 260px;
  min-width: 240px;
  max-width: min(420px, calc(100vw - 24px));
  overflow-y: auto;
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 8px 24px rgb(15 20 30 / 14%);
}

.skill-picker__item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}

.skill-picker__item--active {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.skill-picker__text {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.skill-picker__name {
  color: var(--color-text);
  font-weight: 500;
}

.skill-picker__description {
  overflow: hidden;
  color: var(--color-text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.skill-picker__check {
  flex: none;
  color: var(--color-primary);
}

.skill-picker__hint,
.skill-picker__empty {
  padding: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>

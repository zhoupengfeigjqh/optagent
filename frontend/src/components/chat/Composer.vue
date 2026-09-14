<script setup lang="ts">
/**
 * 输入区（T041）
 *
 * - 受控 textarea（`v-model` 语义），Enter 发送、Shift + Enter 换行
 * - `toolbar` 插槽预留给 `ComposerToolbar`（US3）；未提供时渲染内置发送/中断按钮，
 *   保证 US1 可独立使用
 * - `mention` 插槽预留给 `@` 引用面板（US4），并把目录白名单/工作空间清单透传下去
 *
 * 发送后清空、失败后保留由上层（`ChatPanel`）统一编排。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { FileReference } from '../../api/types'
import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 输入文本 */
    modelValue: string
    /** 是否禁用输入与发送 */
    disabled?: boolean
    /** 本轮是否进行中（决定展示"中断本轮"） */
    sending?: boolean
    /** 已选引用 */
    references?: FileReference[]
    /** 占位文案 */
    placeholder?: string
    /** `@` 面板是否展开（展开时 Enter / 方向键 / Esc 交给上层处理，扩展属性） */
    mentionOpen?: boolean
  }>(),
  {
    disabled: false,
    sending: false,
    references: () => [],
    placeholder: '输入消息，Enter 发送，Shift + Enter 换行',
    mentionOpen: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: [payload: { content: string; attachments: FileReference[] }]
  stop: []
  'remove-reference': [reference: FileReference]
  /** US4：引用达上限时由面板上报 */
  'mention-limit': []
  /** 文本与光标位置（供上层做 `@` 触发检测，扩展事件） */
  'input-text': [payload: { value: string; caret: number }]
  /** `@` 面板展开时被拦截的按键（扩展事件） */
  'mention-key': [key: string]
}>()

/** `@` 面板展开时需要让位的按键。 */
const MENTION_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
])

const canSend = computed(() => props.modelValue.trim() !== '' && !props.disabled && !props.sending)

/** 输入框实例（自适应高度测量用） */
const inputRef = ref<HTMLTextAreaElement | null>(null)

/**
 * 自适应高度：把高度贴到内容实际高度，上下限（2 / 10 行）由样式里的
 * min-height / max-height 兜底。单行高度即文字行高（line-height）、行宽即
 * 输入框宽度，故用 scrollHeight 测量可把「排到右边界自动折行」一并计入，
 * 超过 10 行时受 max-height 约束，由内部滚动条承载。
 */
function autosize(): void {
  const el = inputRef.value
  // jsdom 等无布局环境 scrollHeight 恒为 0：不写入高度，交给 CSS 兜底
  if (!el || !el.scrollHeight) {
    return
  }
  const style = getComputedStyle(el)
  // scrollHeight 含 padding 不含 border，而 box-sizing 为 border-box，需补边框
  const borderY =
    (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + borderY}px`
}

onMounted(autosize)

// 非输入路径导致的文本变化（发送后清空、切换会话载入草稿）同样需要重算
watch(
  () => props.modelValue,
  () => {
    void nextTick(autosize)
  },
  { flush: 'post' },
)

function onInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
  emit('input-text', { value: target.value, caret: target.selectionStart ?? target.value.length })
  autosize()
}

function onSend(): void {
  if (!canSend.value) {
    return
  }
  emit('send', { content: props.modelValue.trim(), attachments: [...props.references] })
}

function onKeydown(event: KeyboardEvent): void {
  // `@` 面板展开时，方向键/Enter/Esc 优先用于面板导航（US4）
  if (props.mentionOpen && MENTION_KEYS.has(event.key)) {
    event.preventDefault()
    emit('mention-key', event.key)
    return
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    onSend()
  }
}
</script>

<template>
  <div class="composer">
    <slot name="mention" :references="references" />

    <ul v-if="references.length" class="composer__refs">
      <li
        v-for="reference in references"
        :key="`${reference.dir}/${reference.filename}`"
        class="composer__ref"
      >
        <span class="composer__ref-text">@{{ reference.filename }}</span>
        <button
          type="button"
          class="composer__ref-remove"
          :aria-label="`移除引用 ${reference.filename}`"
          @click="emit('remove-reference', reference)"
        >
          <BaseIcon name="close" :size="12" />
        </button>
      </li>
    </ul>

    <textarea
      ref="inputRef"
      class="composer__input"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      rows="2"
      @input="onInput"
      @keydown="onKeydown"
    />

    <div class="composer__toolbar">
      <slot name="toolbar" :can-send="canSend" :sending="sending">
        <BaseButton v-if="sending" variant="secondary" @click="emit('stop')">中断本轮</BaseButton>
        <BaseButton v-else variant="primary" :disabled="!canSend" @click="onSend">发送</BaseButton>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5) var(--space-4);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.composer__refs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.composer__ref {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-size: var(--font-size-sm);
}

.composer__ref-remove {
  display: inline-flex;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.composer__input {
  /* 单行高度即文字行高（line-height），行宽即输入框宽度；
     高度区间 2 ~ 10 行，超过 10 行不再增高，由内部滚动条承载。
     注：1em 相对自身字号，与 line-height 相乘即单行文字高度。 */
  --composer-line-height: 1.6;
  --composer-padding-y: var(--space-3);
  --composer-border-width: 1px;
  --composer-chrome: calc(var(--composer-padding-y) * 2 + var(--composer-border-width) * 2);

  width: 100%;
  min-height: calc(var(--composer-line-height) * 1em * 2 + var(--composer-chrome));
  max-height: calc(var(--composer-line-height) * 1em * 10 + var(--composer-chrome));
  padding: var(--composer-padding-y) var(--space-3);
  border: var(--composer-border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  /* 必须置于 font 简写之后：font 会把 line-height 一并重置 */
  line-height: var(--composer-line-height);
  overflow-y: auto;
  resize: none;
}

.composer__toolbar {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

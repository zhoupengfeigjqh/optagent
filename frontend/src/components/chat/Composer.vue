<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { FileReference } from '../../api/types'
import { mentionToken } from '../../composables/useFileMention'
import { skillToken } from '../../composables/useSkillMention'
import {
  MENTION_FILENAME_ATTR,
  SKILL_NAME_ATTR,
  caretTextOffset,
  placeCaretAtEnd,
  serializeComposerText,
  splitComposerSegments,
} from '../../utils/composer-text'
import { canSendContent } from '../../utils/can-send'
import { createComposerChip } from '../../utils/composer-chip'
import { withPastedName } from '../../utils/upload-batch'
import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    sending?: boolean
    references?: FileReference[]
    skill?: string | null
    placeholder?: string
    mentionOpen?: boolean
    skillOpen?: boolean
  }>(),
  {
    disabled: false,
    sending: false,
    references: () => [],
    skill: null,
    placeholder: '输入消息：打 @ 可引用文件，打 / 可选择技能',
    mentionOpen: false,
    skillOpen: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: [payload: { content: string; attachments: FileReference[]; skill: string | null }]
  stop: []
  'remove-reference': [reference: FileReference]
  'remove-skill': []
  'input-text': [payload: { value: string; caret: number }]
  'mention-key': [key: string]
  'skill-key': [key: string]
  'paste-files': [files: File[]]
}>()

const PICKER_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
])

const canSend = computed(
  () =>
    canSendContent(props.modelValue, props.skill ?? null, props.references.length) &&
    !props.disabled &&
    !props.sending,
)

const editorRef = ref<HTMLDivElement | null>(null)

function currentSelection(): Selection | null {
  return typeof document.getSelection === 'function' ? document.getSelection() : null
}

/**
 * 自适应高度：把高度贴到内容实际高度，上下限（2 / 10 行）由样式里的
 * min-height / max-height 兜底。超过 10 行时受 max-height 约束，由内部滚动条承载。
 */
function autosize(): void {
  const el = editorRef.value
  // jsdom 等无布局环境 scrollHeight 恒为 0：不写入高度，交给 CSS 兜底
  if (!el || !el.scrollHeight) {
    return
  }
  const style = getComputedStyle(el)
  const borderY =
    (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + borderY}px`
}

function referenceOfToken(token: string): FileReference | null {
  return props.references.find((reference) => mentionToken(reference) === token) ?? null
}

function createMentionChip(reference: FileReference): HTMLElement {
  return createComposerChip({
    text: mentionToken(reference),
    removeLabel: `移除引用 ${reference.filename}`,
    attrs: {
      [MENTION_FILENAME_ATTR]: reference.filename,
      'data-mention-dir': reference.dir,
    },
    onRemove: removeChip,
  })
}

function renderDraft(text: string): void {
  const editor = editorRef.value
  if (!editor) return

  const tokens = props.references.map(mentionToken)
  const skillTokens = props.skill ? [skillToken(props.skill)] : []
  const fragment = document.createDocumentFragment()
  for (const segment of splitComposerSegments(text, tokens, skillTokens)) {
    if (segment.kind === 'text') {
      fragment.appendChild(document.createTextNode(segment.text))
      continue
    }
    if (segment.kind === 'skill') {
      fragment.appendChild(
        props.skill && segment.token === skillToken(props.skill)
          ? createSkillChip(props.skill)
          : document.createTextNode(segment.token),
      )
      continue
    }
    const reference = referenceOfToken(segment.token)
    fragment.appendChild(
      reference ? createMentionChip(reference) : document.createTextNode(segment.token),
    )
  }
  editor.replaceChildren(fragment)
  autosize()
}

function createSkillChip(name: string): HTMLElement {
  return createComposerChip({
    text: skillToken(name),
    removeLabel: `移除技能 ${name}`,
    attrs: { [SKILL_NAME_ATTR]: name },
    onRemove: removeChip,
  })
}

function removeChip(chip: HTMLElement): void {
  const editor = editorRef.value
  if (!editor) return

  const skillName = chip.getAttribute(SKILL_NAME_ATTR)
  const filename = chip.getAttribute(MENTION_FILENAME_ATTR)
  const parent = chip.parentNode
  const index = parent ? Array.from(parent.childNodes).indexOf(chip) : 0
  chip.remove()

  const selection = currentSelection()
  if (selection && parent) {
    const caret = document.createRange()
    caret.setStart(parent, Math.max(0, index))
    caret.collapse(true)
    selection.removeAllRanges()
    selection.addRange(caret)
  }

  editor.focus()
  onInput()
  if (skillName !== null) {
    emit('remove-skill')
    return
  }
  const reference = filename === null ? null : referenceOfToken(`@${filename}`)
  if (reference) emit('remove-reference', reference)
}

function onInput(): void {
  const editor = editorRef.value
  if (!editor) return

  const caret = caretTextOffset(editor, currentSelection())
  const text = serializeComposerText(editor)
  if (text === '' && editor.childNodes.length > 0) {
    editor.replaceChildren()
  }

  emit('update:modelValue', text)
  emit('input-text', { value: text, caret })
  autosize()
}

function insertPlainText(text: string): void {
  const editor = editorRef.value
  if (!editor) return

  const selection = currentSelection()
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  if (!range || !editor.contains(range.startContainer)) {
    editor.appendChild(document.createTextNode(text))
    placeCaretAtEnd(editor)
    onInput()
    return
  }

  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
  onInput()
}

/**
 * 从剪贴板取文件（2026-11-17）。
 *
 * 优先 `items`：截图与"复制文件"在 Chrome/Edge/Firefox 上都只保证这里拿得到 `File`；
 * `files` 只作兜底。截图常没有扩展名，交给 `withPastedName` 按 MIME 补——
 * 补名只覆盖白名单内的类型，不会变相放行 `.svg` 之类。
 */
function pastedFiles(data: DataTransfer): File[] {
  const fromItems: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) fromItems.push(file)
  }
  const files = fromItems.length > 0 ? fromItems : Array.from(data.files ?? [])
  return files.map((file, index) => withPastedName(file, index))
}

function onPaste(event: ClipboardEvent): void {
  if (props.disabled) return
  const data = event.clipboardData
  const files = data ? pastedFiles(data) : []
  if (files.length > 0) {
    event.preventDefault()
    emit('paste-files', files)
    return
  }
  const text = data?.getData('text/plain') ?? ''
  // 一律按纯文本插入：否则 Word/网页会把字体、颜色、表格结构一起带进来
  event.preventDefault()
  if (text !== '') insertPlainText(text)
}

function onSend(): void {
  if (!canSend.value) {
    return
  }
  emit('send', {
    content: props.modelValue.trim(),
    attachments: [...props.references],
    skill: props.skill ?? null,
  })
}

function onKeydown(event: KeyboardEvent): void {
  if (props.skillOpen && PICKER_KEYS.has(event.key)) {
    event.preventDefault()
    emit('skill-key', event.key)
    return
  }
  if (props.mentionOpen && PICKER_KEYS.has(event.key)) {
    event.preventDefault()
    emit('mention-key', event.key)
    return
  }
  if ((event.ctrlKey || event.metaKey) && 'biu'.includes(event.key.toLowerCase())) {
    event.preventDefault()
    return
  }
  if (event.key !== 'Enter') return

  event.preventDefault()
  if (event.shiftKey) {
    insertPlainText('\n')
    return
  }
  onSend()
}

onMounted(() => {
  renderDraft(props.modelValue)
  autosize()
})

// 用户敲字的回环（DOM 文本 === 草稿）一律跳过，避免销毁光标与输入法组合态。
watch(
  () => [props.modelValue, props.references, props.skill] as const,
  () => {
    const editor = editorRef.value
    if (!editor) return
    const renderedSkill =
      editor.querySelector(`[${SKILL_NAME_ATTR}]`)?.getAttribute(SKILL_NAME_ATTR) ?? null
    if (
      serializeComposerText(editor) === props.modelValue &&
      renderedSkill === (props.skill ?? null)
    ) {
      void nextTick(autosize)
      return
    }
    renderDraft(props.modelValue)
    placeCaretAtEnd(editor)
  },
  { flush: 'post' },
)
</script>

<template>
  <div class="composer">
    <slot name="mention" :references="references" :anchor="editorRef" />
    <slot name="skill" :anchor="editorRef" />

    <div
      ref="editorRef"
      class="composer__input"
      role="textbox"
      aria-multiline="true"
      :aria-label="placeholder"
      :aria-placeholder="placeholder"
      :aria-disabled="disabled ? 'true' : undefined"
      :contenteditable="disabled ? 'false' : 'true'"
      :data-placeholder="placeholder"
      @input="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
    />

    <p class="composer__hint">Enter 发送 · Shift + Enter 换行</p>

    <div class="composer__toolbar">
      <slot name="toolbar" :can-send="canSend" :sending="sending">
        <BaseButton v-if="sending" variant="danger" aria-label="中断本轮" @click="emit('stop')">
          <BaseIcon name="stop" :size="14" />
        </BaseButton>
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

.composer__hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.composer__input {
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
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.composer__input:empty::before {
  content: attr(data-placeholder);
  color: var(--color-text-muted);
  pointer-events: none;
}

:global(.composer__mention) {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin: 0 2px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-bg-muted);
  color: var(--color-text);
  line-height: 1.4;
  vertical-align: baseline;
}

:global(.composer__mention-remove) {
  display: inline-flex;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

:global(.composer__mention-remove:hover) {
  color: var(--color-text);
}

.composer__toolbar {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>

<script setup lang="ts">
/**
 * 输入区（T041；2026-10-18 改为「引用即胶囊」）
 *
 * - 富文本容器（`contenteditable`）：正文里选中的文件直接落成**不可编辑的胶囊**
 *   （`@文件名` + 移除按钮），不再在输入框上方另起一排 chip——同一次选择只显示一处；
 * - 草稿仍是字符串：DOM 与文本的互转只在 `utils/composer-text` 里实现一次，
 *   `@` 触发、反向同步、发送载荷（`stripMentionTokens`）都照旧按文本工作；
 * - Enter 发送、Shift + Enter 换行；`@` 面板展开时方向键/Enter/Esc 让位给面板；
 * - `mention` 插槽只出数据与锚点（面板本体是 `fixed` 浮层，见 MentionPopup）。
 *
 * 发送后清空、失败后保留由上层（`ChatPanel`）统一编排。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { FileReference } from '../../api/types'
import { mentionToken } from '../../composables/useFileMention'
import {
  MENTION_FILENAME_ATTR,
  caretTextOffset,
  placeCaretAtEnd,
  serializeComposerText,
  splitComposerSegments,
} from '../../utils/composer-text'
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
    /** 已选引用（决定正文里哪些 `@文件名` 渲染成胶囊） */
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
    placeholder: '输入消息：打 @ 可引用文件空间里的文件',
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

/** 胶囊里的关闭图标：与 `BaseIcon` 的 `close` 同形（contenteditable 子节点只能手工造）。 */
const CLOSE_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" ' +
  'aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>'

const canSend = computed(() => props.modelValue.trim() !== '' && !props.disabled && !props.sending)

/** 输入框实例（自适应高度测量、选区换算、插槽锚点） */
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
  // scrollHeight 含 padding 不含 border，而 box-sizing 为 border-box，需补边框
  const borderY =
    (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + borderY}px`
}

/** 标记 → 引用：正文只有文件名，`dir` 由当前引用集合补齐。 */
function referenceOfToken(token: string): FileReference | null {
  return props.references.find((reference) => mentionToken(reference) === token) ?? null
}

/** 造一枚引用胶囊：文本即标记，移除按钮不参与序列化。 */
function createMentionChip(reference: FileReference): HTMLElement {
  const chip = document.createElement('span')
  chip.className = 'composer__mention'
  // 用属性而不是 `contentEditable` 属性赋值：胶囊的不可编辑性必须落在 DOM 属性上
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute(MENTION_FILENAME_ATTR, reference.filename)
  chip.setAttribute('data-mention-dir', reference.dir)
  chip.textContent = mentionToken(reference)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'composer__mention-remove'
  remove.setAttribute('aria-label', `移除引用 ${reference.filename}`)
  remove.innerHTML = CLOSE_ICON
  // 按下时不让焦点/光标交给按钮：删完仍要在原位继续输入
  remove.addEventListener('mousedown', (event) => event.preventDefault())
  remove.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    removeChip(chip, reference)
  })

  chip.appendChild(remove)
  return chip
}

/** 按草稿重建正文（只用于外部改写草稿：插入标记、点 x、发送后清空、切换会话）。 */
function renderDraft(text: string): void {
  const editor = editorRef.value
  if (!editor) return

  const tokens = props.references.map(mentionToken)
  const fragment = document.createDocumentFragment()
  for (const segment of splitComposerSegments(text, tokens)) {
    if (segment.kind === 'text') {
      fragment.appendChild(document.createTextNode(segment.text))
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

/** 点胶囊的 x：删节点 → 光标落回原位 → 交回文本层（引用由 `handleInput` 反向同步）。 */
function removeChip(chip: HTMLElement, reference: FileReference): void {
  const editor = editorRef.value
  if (!editor) return

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
  emit('remove-reference', reference)
}

function onInput(): void {
  const editor = editorRef.value
  if (!editor) return

  // 先换算光标：随后清空残留节点会让选区失效
  const caret = caretTextOffset(editor, currentSelection())
  const text = serializeComposerText(editor)
  // 浏览器把内容删空后常留一个 `<br>`：留着会让 `:empty` 占位文案失效
  if (text === '' && editor.childNodes.length > 0) {
    editor.replaceChildren()
  }

  emit('update:modelValue', text)
  emit('input-text', { value: text, caret })
  autosize()
}

/** 在当前光标处插入纯文本（换行、粘贴都走这里，保证不引入富文本结构）。 */
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

function onPaste(event: ClipboardEvent): void {
  if (props.disabled) return
  const text = event.clipboardData?.getData('text/plain') ?? ''
  // 一律按纯文本插入：否则 Word/网页会把字体、颜色、表格结构一起带进来
  event.preventDefault()
  if (text !== '') insertPlainText(text)
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
  // 富文本快捷键（Ctrl/⌘ + B/I/U）在纯文本输入区没有意义
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

// 外部改写草稿（插入标记、点 x、清空、切换会话）才重建 DOM；
// 用户敲字的回环（DOM 文本 === 草稿）一律跳过，避免销毁光标与输入法组合态。
watch(
  () => [props.modelValue, props.references] as const,
  () => {
    const editor = editorRef.value
    if (!editor) return
    if (serializeComposerText(editor) === props.modelValue) {
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
    <!--
      `mention` 插槽只出**数据与锚点**：面板本体是 `fixed` 浮层（见 MentionPopup），
      渲染位置不影响布局，所以这里不再让它参与流内排版（原先它会把输入框顶下去）。
    -->
    <slot name="mention" :references="references" :anchor="editorRef" />

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

    <!-- 键盘提示常驻（原型同款）：占位文案让给"打 @ 可引用文件"这条更容易被忽略的信息 -->
    <p class="composer__hint">Enter 发送 · Shift + Enter 换行</p>

    <div class="composer__toolbar">
      <slot name="toolbar" :can-send="canSend" :sending="sending">
        <!-- 与 ComposerToolbar 同口径：发送/中断同位互斥（流式中显示红色方块「终止」） -->
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

/* 键盘提示常驻（原型同款）：占位文案留给"打 @ 可引用文件" */
.composer__hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
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
  /* 胶囊与换行都按原样排版（换行由文本里的 \n 承载，不再依赖 <br>） */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  /* 内容为空时由 ::before 承载占位文案（contenteditable 没有 placeholder 属性） */
}

.composer__input:empty::before {
  content: attr(data-placeholder);
  color: var(--color-text-muted);
  pointer-events: none;
}

/*
 * 引用胶囊：正文里的一个整体（不可编辑），点 x 删除。
 * 浅灰底 + 一圈描边：只靠底色和白输入框拉不开差距，描边负责"看得出边界"（2026-10-18）。
 *
 * 必须用 `:global()`：胶囊是 `createMentionChip` 用 `document.createElement` 造出来的，
 * **没有** scoped 的 `data-v-*` 标记，普通 scoped 选择器对它一律不匹配
 * （这正是"改了样式却没生效"的原因——只看类名断言测不出来）。
 */
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

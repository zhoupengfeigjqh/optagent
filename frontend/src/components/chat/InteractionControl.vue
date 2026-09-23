<script setup lang="ts">
/**
 * 入参节点上的**控件本体**（HITL 递归表单，2026-09-23）。
 *
 * 与 `InteractionField.vue` 的分工：那个负责"这一行"（标签、说明、操作条、文件卡片、规则入口），
 * 本组件只负责"那个控件"——标量控件的渲染与取值、JSON 视图的文本编辑、`@` 引用面板。
 * 表格单元格（`compact`）复用的也是本组件，因此"字段行里能填什么"与"单元格里能填什么"
 * 是同一处实现，不存在两套口径。
 */
import { computed, inject } from 'vue'

import type { FileReference } from '../../api/types'
import {
  INTERACTION_FORM_KEY,
  type InteractionFormContext,
} from '../../composables/useInteractionForm'
import {
  controlOf,
  isScalarControl,
  isTextControl,
  optionsOf,
  type FieldSchema,
} from '../../utils/arg-schema'
import { pathKey, type NodePath } from '../../utils/json-path'
import MentionPicker from './MentionPicker.vue'

const props = withDefaults(
  defineProps<{
    schema: FieldSchema
    path: NodePath
    /** 字段名（`compact` 时作为 `aria-label`，非 compact 时由 `InteractionField` 的 label 承担） */
    name: string
    /** 单元格/列表项：紧凑模式——不挂 DOM id、不展开 `@` 面板、多行文本退化为单行 */
    compact?: boolean
  }>(),
  { compact: false },
)

const context = inject<InteractionFormContext | null>(INTERACTION_FORM_KEY, null)

const control = computed(() => controlOf(props.schema))
const options = computed(() => optionsOf(props.schema))
const mentionable = computed(() => isTextControl(control.value) && !props.compact)

/**
 * 单元格里放不下的形状（对象分组/表格/列表）退化为 JSON 文本框：单元格只出控件本体，
 * 没有地方承载子表格或分组标题——与其渲染成 `[object Object]`，不如给一个明确可编辑的 JSON 框。
 */
const forcedJson = computed(() => props.compact && !isScalarControl(control.value))
const jsonMode = computed(
  () => forcedJson.value || (context?.form.isJsonView(props.path, control.value) ?? false),
)

const rawValue = computed(() => context?.form.valueOf(props.path))
const textValue = computed(() => {
  const value = rawValue.value
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
})
const checkedValue = computed(() => rawValue.value === true)
const jsonText = computed(() => context?.form.jsonTextOf(props.path) ?? '')
const placeholder = computed(() => (control.value === 'number' ? '数字' : '请输入'))

/** 控件的 DOM id（`for` 关联用；encodeURIComponent 保证路径不同则 id 不同）。 */
const domId = computed(() => `interaction-input-${encodeURIComponent(pathKey(props.path))}`)

/** `@` 面板：当前激活字段就是本节点时展开（同一时刻只服务一个字段）。 */
const mentionOpen = computed(() => {
  const mention = context?.mention
  if (!mention || !mentionable.value) return false
  return mention.open.value && mention.activeField.value === pathKey(props.path)
})

function write(value: unknown): void {
  context?.form.setValue(props.path, value)
}

function onTextInput(event: Event): void {
  const el = event.target as HTMLInputElement | HTMLTextAreaElement
  write(el.value)
  context?.mention?.handleInput(pathKey(props.path), el.value, el.selectionStart ?? el.value.length)
}

function onSelect(event: Event): void {
  write((event.target as HTMLSelectElement).value)
}

function onSwitch(event: Event): void {
  write((event.target as HTMLInputElement).checked)
}

function onJsonInput(event: Event): void {
  context?.form.onJsonInput(props.path, (event.target as HTMLTextAreaElement).value)
}

/** 把路径文本按 `@` 触发起点替换进当前值。 */
function applyPath(path: string): void {
  const mention = context?.mention
  if (!mention) return
  const text = textValue.value
  const caret = Math.min(mention.caret.value, text.length)
  const before = text.slice(0, caret)
  const match = /(^|\s)@[^\s@]*$/.exec(before)
  const start = match ? match.index + match[1]!.length : caret
  write(before.slice(0, start) + path + text.slice(caret))
}

/** 面板展开时的按键路由（焦点留在输入框，事件由输入框转发给面板状态机）。 */
function onKeydown(event: KeyboardEvent): void {
  const mention = context?.mention
  if (!mention || !mention.open.value || mention.activeField.value !== pathKey(props.path)) return
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      mention.move(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      mention.move(-1)
      break
    case 'ArrowRight':
    case 'Enter': {
      event.preventDefault()
      const path = mention.confirmActive()
      if (path !== null) applyPath(path)
      break
    }
    case 'ArrowLeft':
      event.preventDefault()
      mention.back()
      break
    case 'Escape':
      event.preventDefault()
      mention.close()
      break
    default:
      break
  }
}

function pickFile(reference: FileReference): void {
  const path = context?.mention?.pickFile(reference)
  if (path !== undefined) applyPath(path)
}

/** 键盘确认面板当前高亮项（文件列才会返回路径）。 */
function confirmMention(): void {
  const path = context?.mention?.confirmActive()
  if (path !== undefined && path !== null) applyPath(path)
}
</script>

<template>
  <!-- JSON 视图（schema 决定的逃逸舱 / 用户切换 / 单元格的退化形态） -->
  <textarea
    v-if="jsonMode"
    class="interaction-dialog__input interaction-dialog__input--area interaction-dialog__input--json"
    :aria-label="name"
    placeholder="JSON 格式"
    :rows="compact ? 1 : 4"
    :value="jsonText"
    @input="onJsonInput"
  />

  <select
    v-else-if="control === 'select'"
    :id="compact ? undefined : domId"
    class="interaction-dialog__input"
    :aria-label="compact ? name : undefined"
    :value="textValue"
    @change="onSelect"
  >
    <option value="" disabled>请选择</option>
    <option v-for="(option, index) in options" :key="index" :value="option">
      {{ String(option) }}
    </option>
  </select>

  <label v-else-if="control === 'switch'" class="interaction-dialog__switch">
    <input
      :id="compact ? undefined : domId"
      type="checkbox"
      :aria-label="compact ? name : undefined"
      :checked="checkedValue"
      @change="onSwitch"
    />
    <span>{{ checkedValue ? '是' : '否' }}</span>
  </label>

  <input
    v-else-if="control === 'number'"
    :id="compact ? undefined : domId"
    type="number"
    class="interaction-dialog__input"
    :aria-label="compact ? name : undefined"
    :placeholder="compact ? undefined : placeholder"
    :value="textValue"
    @input="onTextInput"
  />

  <textarea
    v-else-if="control === 'textarea' && !compact"
    :id="domId"
    class="interaction-dialog__input interaction-dialog__input--area"
    :placeholder="placeholder"
    rows="4"
    :value="textValue"
    @input="onTextInput"
    @keydown="onKeydown"
  />

  <input
    v-else
    :id="compact ? undefined : domId"
    type="text"
    class="interaction-dialog__input"
    :aria-label="compact ? name : undefined"
    :placeholder="compact ? undefined : placeholder"
    :value="textValue"
    @input="onTextInput"
    @keydown="onKeydown"
  />

  <!-- `@` 文件引用面板：绝对定位覆盖在字段下方（定位上下文是字段行），不推挤表单布局 -->
  <div v-if="mentionOpen" class="interaction-dialog__picker">
    <MentionPicker
      :open="true"
      :spaces="context!.mention!.spaces.value"
      :column="context!.mention!.column.value"
      :active-space="context!.mention!.activeSpace.value"
      :active-dir="context!.mention!.activeDir.value"
      :dirs="context!.mention!.dirs.value"
      :files="context!.mention!.files.value"
      :active-index="context!.mention!.activeIndex.value"
      :loading="context!.mention!.loading.value"
      @pick-space="context!.mention!.pickSpace"
      @pick-dir="context!.mention!.pickDir"
      @pick-file="pickFile"
      @close="context!.mention!.close"
      @move="context!.mention!.move"
      @confirm="confirmMention"
      @back="context!.mention!.back"
    />
  </div>
</template>

<style scoped>
.interaction-dialog__input {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
}

.interaction-dialog__input--area {
  resize: vertical;
  font-family: inherit;
}

.interaction-dialog__input--json {
  font-family: monospace;
}

.interaction-dialog__switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
}

.interaction-dialog__picker {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: 30;
  width: max-content;
  max-width: 100%;
}
</style>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'

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
import MentionPopup from './MentionPopup.vue'

const props = withDefaults(
  defineProps<{
    schema: FieldSchema
    path: NodePath
    name: string
    compact?: boolean
  }>(),
  { compact: false },
)

const context = inject<InteractionFormContext | null>(INTERACTION_FORM_KEY, null)

const control = computed(() => controlOf(props.schema))
const options = computed(() => optionsOf(props.schema))
const mentionable = computed(() => isTextControl(control.value))

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
const placeholder = computed(() => {
  if (control.value === 'number') return '数字'
  return mentionable.value ? '可打 @ 选择文件' : '请输入'
})

const selectedIndex = computed(() =>
  options.value.findIndex((item) => String(item) === textValue.value),
)

const domId = computed(() => `interaction-input-${encodeURIComponent(pathKey(props.path))}`)

const inputEl = ref<HTMLElement | null>(null)

const mentionOpen = computed(() => {
  const mention = context?.mention
  if (!mention || !mentionable.value) return false
  return mention.open.value && mention.activeField.value === pathKey(props.path)
})

const popupId = computed(() => `interaction-mention-${encodeURIComponent(pathKey(props.path))}`)

function write(value: unknown): void {
  context?.form.setValue(props.path, value)
}

function onTextInput(event: Event): void {
  const el = event.target as HTMLInputElement | HTMLTextAreaElement
  write(el.value)
  context?.mention?.handleInput(pathKey(props.path), el.value, el.selectionStart ?? el.value.length)
}

function onSelect(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  if (raw === '') {
    write('')
    return
  }
  const option = options.value[Number(raw)]
  write(option === undefined ? '' : option)
}

function onSwitch(event: Event): void {
  write((event.target as HTMLInputElement).checked)
}

function onJsonInput(event: Event): void {
  context?.form.onJsonInput(props.path, (event.target as HTMLTextAreaElement).value)
}

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

function confirmMention(): void {
  const path = context?.mention?.confirmActive()
  if (path !== undefined && path !== null) applyPath(path)
}

function closeMention(): void {
  context?.mention?.close()
}
</script>

<template>
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
    :value="selectedIndex"
    @change="onSelect"
  >
    <option value="" disabled>请选择</option>
    <option v-for="(option, index) in options" :key="index" :value="index">
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
    ref="inputEl"
    class="interaction-dialog__input interaction-dialog__input--area"
    :aria-haspopup="mentionable ? 'listbox' : undefined"
    :aria-expanded="mentionable ? mentionOpen : undefined"
    :aria-controls="mentionOpen ? popupId : undefined"
    :placeholder="placeholder"
    rows="4"
    :value="textValue"
    @input="onTextInput"
    @keydown="onKeydown"
  />

  <input
    v-else
    :id="compact ? undefined : domId"
    ref="inputEl"
    type="text"
    class="interaction-dialog__input"
    :aria-label="compact ? name : undefined"
    :aria-haspopup="mentionable ? 'listbox' : undefined"
    :aria-expanded="mentionable ? mentionOpen : undefined"
    :aria-controls="mentionOpen ? popupId : undefined"
    :placeholder="placeholder"
    :value="textValue"
    @input="onTextInput"
    @keydown="onKeydown"
  />

  <MentionPopup
    :id="popupId"
    :open="mentionOpen"
    :anchor="inputEl"
    :caret="context?.mention?.caret.value ?? null"
    @close="closeMention"
  >
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
  </MentionPopup>
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
</style>

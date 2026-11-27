<script setup lang="ts">
import { computed, inject, ref } from 'vue'

import type { WorkspaceFile } from '../../api/types'
import {
  INTERACTION_FORM_KEY,
  type InteractionFormContext,
} from '../../composables/useInteractionForm'
import {
  columnKeysOf,
  controlOf,
  descriptionOf,
  fieldLabelOf,
  isTextControl,
  itemSchemaOf,
  propertiesOf,
  requiredSetOf,
  type FieldSchema,
} from '../../utils/arg-schema'
import { formatBytes } from '../../utils/format'
import { formatPath, pathKey, type NodePath } from '../../utils/json-path'
import BaseIcon from '../common/BaseIcon.vue'
import HintTip from '../common/HintTip.vue'
import InteractionControl from './InteractionControl.vue'
import InteractionTable from './InteractionTable.vue'
import RulePickerDialog from './RulePickerDialog.vue'

const props = withDefaults(
  defineProps<{
    schema: FieldSchema
    path: NodePath
    name: string
    required?: boolean
  }>(),
  { required: false },
)

const context = inject<InteractionFormContext | null>(INTERACTION_FORM_KEY, null)

const control = computed(() => controlOf(props.schema))
const labelText = computed(() => fieldLabelOf(props.name, props.schema))
const description = computed(() => descriptionOf(props.schema))
const mentionable = computed(() => isTextControl(control.value))

const domId = computed(() => `interaction-input-${encodeURIComponent(pathKey(props.path))}`)
const itemSchema = computed<FieldSchema>(() => itemSchemaOf(props.schema) ?? {})

const children = computed(() => {
  const required = requiredSetOf(props.schema)
  return propertiesOf(props.schema).map(({ key, schema }) => ({
    key,
    schema,
    required: required.has(key),
  }))
})

const elements = computed<unknown[]>(() => {
  const value = context?.form.valueOf(props.path)
  return Array.isArray(value) ? value : []
})

const columns = computed(() => columnKeysOf(itemSchema.value, elements.value))
const itemIndexes = computed(() => elements.value.map((_item, index) => index))

function cellSchemaOf(column: string): FieldSchema {
  return propertiesOf(itemSchema.value).find((item) => item.key === column)?.schema ?? {}
}

const textValue = computed(() => {
  const value = context?.form.valueOf(props.path)
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
})

const jsonMode = computed(() => context?.form.isJsonView(props.path, control.value) ?? false)
const structured = computed(
  () => control.value === 'group' || control.value === 'table' || control.value === 'list',
)

const rulesAnchor = computed(() => context?.form.isRulesAnchor(props.path) ?? false)
const showToolbar = computed(() => structured.value || rulesAnchor.value)

const rulesTargetLabel = computed(() => {
  const target = context?.form.rulesTarget.value ?? null
  return target === null ? props.name : formatPath(target)
})

/**
 * 「?」提示内容：字段说明 + `@` 引用 + 规则入口说明，一次性收进气泡。
 *
 * 为什么不再常驻：三行解释性文案会把真正要填的控件压下去（尤其 7 个子字段的嵌套对象），
 * 而它们只在用户主动问时才需要；紧凑的 `labelHint` 仍留在标签旁保证"不看也知道填什么"。
 */
const hints = computed(() =>
  [
    description.value,
    mentionable.value ? '输入 @ 可引用文件空间路径' : '',
    rulesAnchor.value
      ? `点击「从算法规则选择」读取「数据准备/算法规则」最新规则文件，勾选后生成数组填入 ${rulesTargetLabel.value}`
      : '',
  ]
    .filter((part) => part !== '')
    .join('\n'),
)
const rulesInitialValue = computed(() => context?.form.rulesInitialValue() ?? [])
const rulesOpen = ref(false)

const loadRules = computed(
  () =>
    context?.form.loadRules ?? ((): Promise<never> => Promise.reject(new Error('无会话上下文'))),
)

const fileCard = computed(() => {
  if (!context || !mentionable.value) return null
  const value = textValue.value
  if (value === '') return null
  return context.fileIndex.get(value) ?? null
})

function write(value: unknown): void {
  context?.form.setValue(props.path, value)
}

function toggleJson(): void {
  closeMention()
  context?.form.toggleJsonView(props.path)
}

function addElement(): void {
  write([...elements.value, control.value === 'table' ? {} : ''])
}

function removeElement(index: number): void {
  closeMention()
  write(elements.value.filter((_, position) => position !== index))
}

function closeMention(): void {
  context?.mention?.close()
}

function openRules(): void {
  rulesOpen.value = true
}

function onRulesConfirm(value: Array<Record<string, unknown>>): void {
  context?.form.applyRules(value)
  rulesOpen.value = false
}

function cardOf(): { dir: string; file: WorkspaceFile } | null {
  return fileCard.value
}
</script>

<template>
  <div v-if="context" class="interaction-dialog__field">
    <div class="interaction-dialog__label-row">
      <label
        v-if="!structured"
        class="interaction-dialog__label"
        :class="{ required }"
        :for="domId"
      >
        {{ labelText }}
      </label>
      <div v-else class="interaction-dialog__label" :class="{ required }">
        {{ labelText }}
      </div>
      <HintTip v-if="hints" :text="hints" label="查看参数说明" />
    </div>

    <div v-if="showToolbar" class="interaction-dialog__toolbar">
      <button
        v-if="rulesAnchor && context.mention"
        type="button"
        class="interaction-dialog__rules-btn"
        :aria-label="`从算法规则选择 ${rulesTargetLabel}`"
        @click="openRules"
      >
        从算法规则选择
      </button>
      <button
        v-if="control === 'table'"
        type="button"
        class="interaction-dialog__tool-btn"
        :disabled="columns.length === 0"
        @click="addElement"
      >
        ＋ 添加行
      </button>
      <button
        v-if="control === 'list'"
        type="button"
        class="interaction-dialog__tool-btn"
        @click="addElement"
      >
        ＋ 添加一项
      </button>
      <button
        v-if="structured"
        type="button"
        class="interaction-dialog__tool-btn"
        @click="toggleJson"
      >
        {{ jsonMode ? '按表单编辑' : '按 JSON 编辑' }}
      </button>
    </div>

    <div v-if="control === 'group' && !jsonMode" class="interaction-dialog__group">
      <InteractionField
        v-for="child in children"
        :key="child.key"
        :schema="child.schema"
        :path="[...path, child.key]"
        :name="child.key"
        :required="child.required"
      />
    </div>

    <InteractionTable
      v-else-if="control === 'table' && !jsonMode"
      :path="path"
      :columns="columns"
      :rows="elements"
      :item-schema="itemSchema"
      :cell-schema-of="cellSchemaOf"
      @remove="removeElement"
    />

    <div v-else-if="control === 'list' && !jsonMode" class="interaction-dialog__list">
      <p v-if="elements.length === 0" class="interaction-dialog__table-empty">尚未添加任何项。</p>
      <div v-for="index in itemIndexes" :key="index" class="interaction-dialog__list-row">
        <InteractionControl
          compact
          :schema="itemSchema"
          :path="[...path, index]"
          :name="`${name}[${index}]`"
        />
        <button
          type="button"
          class="interaction-dialog__row-remove"
          :aria-label="`删除第 ${index + 1} 项`"
          @click="removeElement(index)"
        >
          ×
        </button>
      </div>
    </div>

    <InteractionControl v-else :schema="schema" :path="path" :name="name" />

    <div v-if="cardOf()" class="interaction-dialog__file-card">
      <BaseIcon name="file" :size="14" />
      <span class="interaction-dialog__file-card-name">{{ cardOf()!.file.filename }}</span>
      <span class="interaction-dialog__file-card-meta">
        {{ cardOf()!.dir }} · {{ formatBytes(cardOf()!.file.size) }}
      </span>
      <button
        type="button"
        class="interaction-dialog__file-card-clear"
        aria-label="清除"
        @click="write('')"
      >
        ×
      </button>
    </div>

    <RulePickerDialog
      v-if="rulesAnchor && context.mention"
      :open="rulesOpen"
      :field-name="rulesTargetLabel"
      :initial-value="rulesInitialValue"
      :load="loadRules"
      @confirm="onRulesConfirm"
      @close="rulesOpen = false"
    />
  </div>
</template>

<style scoped>
.interaction-dialog__field {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.interaction-dialog__label-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.interaction-dialog__label {
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.interaction-dialog__label.required::after {
  content: ' *';
  color: var(--color-status-error);
}

.interaction-dialog__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.interaction-dialog__tool-btn,
.interaction-dialog__rules-btn {
  align-self: flex-start;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.interaction-dialog__tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.interaction-dialog__tool-btn:hover:enabled,
.interaction-dialog__rules-btn:hover {
  color: var(--color-text);
  border-color: var(--color-text-muted);
}

.interaction-dialog__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-left: var(--space-3);
  border-left: 2px solid var(--color-border);
}

.interaction-dialog__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.interaction-dialog__list-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.interaction-dialog__list-row > :first-child {
  flex: 1;
  min-width: 0;
}

.interaction-dialog__table-empty {
  color: var(--color-text-muted);
}

.interaction-dialog__row-remove {
  padding: 0 var(--space-1);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  line-height: 1;
  cursor: pointer;
}

.interaction-dialog__row-remove:hover {
  color: var(--color-text);
}

.interaction-dialog__file-card {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.interaction-dialog__file-card-name {
  flex: none;
  max-width: 50%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--color-text);
  font-weight: 500;
}

.interaction-dialog__file-card-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.interaction-dialog__file-card-clear {
  flex: none;
  padding: 0 var(--space-1);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  line-height: 1;
  cursor: pointer;
}

.interaction-dialog__file-card-clear:hover {
  color: var(--color-text);
}
</style>

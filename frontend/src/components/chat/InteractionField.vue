<script setup lang="ts">
/**
 * HITL 弹窗的**单个入参字段行**（递归组件，2026-09-23）。
 *
 * 通用性来源：控件形态**只**由 schema 推导（`utils/arg-schema.ts`），本组件不含任何工具/
 * MCP 服务名——对象逐行（自身递归）、对象数组成表格（`InteractionTable`）、标量数组成列表、
 * schema 表达不了的形状交 JSON 逃生舱。因此同一份代码自动适配任意深度的入参结构。
 *
 * 与另两个组件的分工：本组件负责"这一行"（标签、说明、操作条、文件卡片、规则入口）；
 * 控件本体在 `InteractionControl.vue`；表格在 `InteractionTable.vue`。
 * 状态全部来自注入的表单状态（模型、JSON 草稿、规则入口落点），本组件不持有入参数据。
 */
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
  isTextControl,
  itemSchemaOf,
  labelHintOf,
  propertiesOf,
  requiredSetOf,
  type FieldSchema,
} from '../../utils/arg-schema'
import { formatFileSize } from '../../utils/format'
import { formatPath, pathKey, type NodePath } from '../../utils/json-path'
import BaseIcon from '../common/BaseIcon.vue'
import HintTip from '../common/HintTip.vue'
import InteractionControl from './InteractionControl.vue'
import InteractionTable from './InteractionTable.vue'
import RulePickerDialog from './RulePickerDialog.vue'

const props = withDefaults(
  defineProps<{
    /** 本节点的 schema */
    schema: FieldSchema
    /** 本节点在值树里的路径 */
    path: NodePath
    /** 本节点在父级里的名字（对象键） */
    name: string
    /** 父级的 required 是否包含本节点 */
    required?: boolean
  }>(),
  { required: false },
)

/**
 * 表单状态上下文（弹窗提供）。缺失时不渲染任何东西：本组件只在
 * `InteractionDialog` 的 provider 内才有意义（单测需显式 provide）。
 */
const context = inject<InteractionFormContext | null>(INTERACTION_FORM_KEY, null)

const control = computed(() => controlOf(props.schema))
const hint = computed(() => labelHintOf(props.name, props.schema))
const description = computed(() => descriptionOf(props.schema))
const mentionable = computed(() => isTextControl(control.value))

/** 控件 DOM id（与 `InteractionControl` 的生成规则一致，供 label 的 `for` 关联）。 */
const domId = computed(() => `interaction-input-${encodeURIComponent(pathKey(props.path))}`)
const itemSchema = computed<FieldSchema>(() => itemSchemaOf(props.schema) ?? {})

/** 对象分组的子字段（保持 schema 顺序；required 取自本层）。 */
const children = computed(() => {
  const required = requiredSetOf(props.schema)
  return propertiesOf(props.schema).map(({ key, schema }) => ({
    key,
    schema,
    required: required.has(key),
  }))
})

/** 数组元素（**保留原始元素与下标**：过滤会让下标错位，写入就会落到别的行）。 */
const elements = computed<unknown[]>(() => {
  const value = context?.form.valueOf(props.path)
  return Array.isArray(value) ? value : []
})

/** 表格列：schema 声明列在前，值里实际出现的列补在后（规则清单的列来自数据）。 */
const columns = computed(() => columnKeysOf(itemSchema.value, elements.value))
const itemIndexes = computed(() => elements.value.map((_item, index) => index))

function cellSchemaOf(column: string): FieldSchema {
  return propertiesOf(itemSchema.value).find((item) => item.key === column)?.schema ?? {}
}

/** 取值：字符串类控件的显示值（文件卡片按它反查文件空间）。 */
const textValue = computed(() => {
  const value = context?.form.valueOf(props.path)
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
})

/** 该节点是否以 JSON 文本框呈现（schema 决定的逃生舱，或用户手动切换）。 */
const jsonMode = computed(() => context?.form.isJsonView(props.path, control.value) ?? false)
const structured = computed(
  () => control.value === 'group' || control.value === 'table' || control.value === 'list',
)

/** 操作条：结构化形状需要加行与视图切换；规则入口所在行即便只是 JSON 也要有它 */
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
  () => context?.form.loadRules ?? ((): Promise<never> => Promise.reject(new Error('无会话上下文'))),
)

/** 结构化文件卡片：值精确命中文件空间相对路径时才展示（展示层，提交值仍是路径）。 */
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
  context?.form.toggleJsonView(props.path)
}

function addElement(): void {
  write([...elements.value, control.value === 'table' ? {} : ''])
}

function removeElement(index: number): void {
  write(elements.value.filter((_, position) => position !== index))
}

function openRules(): void {
  rulesOpen.value = true
}

function onRulesConfirm(value: Array<Record<string, unknown>>): void {
  // 失败原因由表单状态持有并在弹窗底部统一展示，这里只需关闭选择器
  context?.form.applyRules(value)
  rulesOpen.value = false
}

/** 结构化文件卡片行（值命中文件空间时的展示层）。 */
function cardOf(): { dir: string; file: WorkspaceFile } | null {
  return fileCard.value
}
</script>

<template>
  <div v-if="context" class="interaction-dialog__field">
    <div class="interaction-dialog__label-row">
      <label v-if="!structured" class="interaction-dialog__label" :class="{ required }" :for="domId">
        {{ name }}<span v-if="hint" class="interaction-dialog__label-hint">{{ hint }}</span>
      </label>
      <div v-else class="interaction-dialog__label" :class="{ required }">
        {{ name }}<span v-if="hint" class="interaction-dialog__label-hint">{{ hint }}</span>
      </div>
      <!-- 说明性文案收进「?」：默认不占版面，点开才看 -->
      <HintTip v-if="hints" :text="hints" label="查看参数说明" />
    </div>

    <!-- 行内操作条：规则入口（若有）、加行/加项、JSON 视图切换，都在这一行 -->
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
      <button v-if="control === 'list'" type="button" class="interaction-dialog__tool-btn" @click="addElement">
        ＋ 添加一项
      </button>
      <button v-if="structured" type="button" class="interaction-dialog__tool-btn" @click="toggleJson">
        {{ jsonMode ? '按表单编辑' : '按 JSON 编辑' }}
      </button>
    </div>

    <!-- 对象分组：子字段逐个成行（递归本组件） -->
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

    <!-- 对象数组 → 表格（一行一个元素；列 = schema 声明列 + 值里出现的列） -->
    <InteractionTable
      v-else-if="control === 'table' && !jsonMode"
      :path="path"
      :columns="columns"
      :rows="elements"
      :item-schema="itemSchema"
      :cell-schema-of="cellSchemaOf"
      @remove="removeElement"
    />

    <!-- 标量数组 → 列表（一行一项） -->
    <div v-else-if="control === 'list' && !jsonMode" class="interaction-dialog__list">
      <p v-if="elements.length === 0" class="interaction-dialog__table-empty">尚未添加任何项。</p>
      <div v-for="index in itemIndexes" :key="index" class="interaction-dialog__list-row">
        <InteractionControl compact :schema="itemSchema" :path="[...path, index]" :name="`${name}[${index}]`" />
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

    <!-- 标量控件、以及 JSON 视图（含 schema 决定的逃生舱） -->
    <InteractionControl v-else :schema="schema" :path="path" :name="name" />

    <!-- 结构化文件卡片：值命中文件空间时的展示层（提交值仍是相对路径） -->
    <div v-if="cardOf()" class="interaction-dialog__file-card">
      <BaseIcon name="file" :size="14" />
      <span class="interaction-dialog__file-card-name">{{ cardOf()!.file.filename }}</span>
      <span class="interaction-dialog__file-card-meta">
        {{ cardOf()!.dir }} · {{ formatFileSize(cardOf()!.file.size) }}
      </span>
      <button type="button" class="interaction-dialog__file-card-clear" aria-label="清除" @click="write('')">
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
/* `position: relative` 是 `@` 面板（InteractionControl 内）的定位上下文 */
.interaction-dialog__field {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* 标签行：`?` 与标签同一行，不占额外纵向空间 */
.interaction-dialog__label-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.interaction-dialog__label {
  font-size: var(--font-size-sm);
  font-weight: 600;
}

/* 参数名旁的中文短标签（来自 schema 的 title/description 提炼） */
.interaction-dialog__label-hint {
  margin-left: var(--space-2);
  color: var(--color-text-secondary);
  font-weight: 400;
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

/* 对象分组：子字段缩进一行，视觉上归属父字段 */
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

/* 列表项的删除按钮（表格里的同名按钮样式在 InteractionTable 内，
   scoped CSS 无法跨组件复用，故各持一份） */
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

<script setup lang="ts">
/**
 * 工具调用人工确认弹窗（HITL，Schema 驱动通用表单）。
 *
 * 解耦红线：本组件**唯一输入**是 `request`（title + schema + proposed_args），
 * 不含任何具体工具/MCP 服务名；新增需确认的工具 = 平台改配置 + 部署，零代码。
 *
 * 控件映射（JSON Schema 子集）：
 * - `enum` → 下拉选择；`boolean` → 开关；`integer/number` → 数字输入；
 *   其余标量 → 文本输入（description 含「多行」→ 多行文本）；
 * - `object/array` → JSON 多行文本（提交时解析，解析失败就地提示）
 * - required 标星 + 提交前本地校验（服务端终验为准，失败保持弹窗可重提）
 *
 * 倒计时：remaining_seconds 归零 → 按拒绝关闭（后端超时同样按拒绝收尾，语义一致）。
 */
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'

import type { FileReference, InteractionSnapshot, WorkspaceFile } from '../../api/types'
import { APP_SESSION_KEY, type AppSession } from '../../composables/useAppSession'
import { createPathInsertStore } from '../../composables/usePathInsert'
import { formatFileSize } from '../../utils/format'
import BaseButton from '../common/BaseButton.vue'
import BaseDialog from '../common/BaseDialog.vue'
import BaseIcon from '../common/BaseIcon.vue'
import MentionPicker from './MentionPicker.vue'
import RulePickerDialog from './RulePickerDialog.vue'

const props = withDefaults(
  defineProps<{
    /** 待确认的交互（含预填参数、schema、剩余秒数） */
    request: InteractionSnapshot
    /** 服务端终验失败的逐字段错误（上层经 submit 结果回写；非空时保持弹窗） */
    serverError?: string
  }>(),
  { serverError: '' },
)

const emit = defineEmits<{
  submit: [args: Record<string, unknown>]
  reject: []
}>()

/**
 * 会话上下文可选注入：弹窗在无会话环境（单测/独立挂载）下退化为纯表单
 * （无 @ 引用、无文件卡片），确认/拒绝主流程不受影响。
 */
const session = inject<AppSession | null>(APP_SESSION_KEY, null)

/** `@` 路径插入状态机（无会话不创建）。 */
const pathInsert = session ? createPathInsertStore({ workspace: session.workspace }) : null

/** schema.properties 的形状（只读我们关心的键） */
interface PropSchema {
  type?: unknown
  enum?: unknown
  title?: unknown
  description?: unknown
}

const properties = computed<Record<string, unknown>>(() => {
  const p = props.request.schema.properties
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {}
})

const requiredSet = computed(() => new Set(props.request.required))

interface Field {
  name: string
  control: 'select' | 'switch' | 'number' | 'textarea' | 'json' | 'text'
  options: unknown[]
  required: boolean
  description: string
  /** 参数名旁的中文短标签（title 或 description 首句提炼；无则空串） */
  labelHint: string
  placeholder: string
}

/**
 * 参数中文短标签提炼（解耦：只用 schema 通用字段，无工具特例）：
 * 1. `title` 优先——但自动生成的大写参数名（FastMCP 的 "Image"）与参数名同义，视为无信息忽略
 * 2. 退而取 `description` 首句（截到 。；;. 或换行，超长按 24 字截断）
 * 3. 都没有 → 空串（label 只显示参数名）
 */
function labelHintOf(name: string, schema: PropSchema): string {
  if (typeof schema.title === 'string') {
    const title = schema.title.trim()
    if (title !== '' && title.toLowerCase() !== name.toLowerCase()) return title
  }
  if (typeof schema.description === 'string') {
    const first = /^[^。；;.;\n\r]+/.exec(schema.description.trim())?.[0]?.trim() ?? ''
    if (first === '') return ''
    return first.length > 24 ? `${first.slice(0, 24)}…` : first
  }
  return ''
}

function controlOf(schema: PropSchema): Field['control'] {
  if (Array.isArray(schema.enum)) return 'select'
  switch (schema.type) {
    case 'boolean':
      return 'switch'
    case 'integer':
    case 'number':
      return 'number'
    case 'object':
    case 'array':
      return 'json'
    case 'string':
    default:
      return typeof schema.description === 'string' && schema.description.includes('多行')
        ? 'textarea'
        : 'text'
  }
}

const fields = computed<Field[]>(() =>
  Object.entries(properties.value).map(([name, raw]) => {
    const schema = (raw ?? {}) as PropSchema
    return {
      name,
      control: controlOf(schema),
      options: Array.isArray(schema.enum) ? schema.enum : [],
      required: requiredSet.value.has(name),
      description: typeof schema.description === 'string' ? schema.description : '',
      labelHint: labelHintOf(name, schema),
      placeholder: schema.type === 'integer' || schema.type === 'number' ? '数字' : '请输入',
    }
  }),
)

/** 表单值：JSON 字段以字符串编辑（提交时解析），字符串类控件单独以 string 存值，其余按原类型 */
const values = ref<Record<string, unknown>>({})
const jsonTexts = ref<Record<string, string>>({})
const textValues = ref<Record<string, string>>({})
const localError = ref('')

function initForm(): void {
  const next: Record<string, unknown> = {}
  const texts: Record<string, string> = {}
  const plainTexts: Record<string, string> = {}
  for (const field of fields.value) {
    const proposed = props.request.proposed_args[field.name]
    if (field.control === 'json') {
      texts[field.name] = proposed === undefined ? '' : JSON.stringify(proposed, null, 2)
      next[field.name] = proposed
    } else if (mentionable(field.control)) {
      // string 存值：@ 引用插入 / 卡片反查 / textarea 绑定均要求 string
      plainTexts[field.name] = proposed === undefined || proposed === null ? '' : String(proposed)
    } else {
      next[field.name] = proposed ?? ''
    }
  }
  values.value = next
  jsonTexts.value = texts
  textValues.value = plainTexts
  localError.value = ''
}
// request 变化（新挂起点 / 恢复快照）→ 重置表单 + @ 面板状态 + 刷新文件空间
// （命中预填路径的字段要出结构化卡片，清单可能刚有上传）
watch(
  () => props.request.interaction_id,
  () => {
    initForm()
    pathInsert?.reset()
    if (session && !session.workspace.loading.value) {
      void session.workspace.load()
    }
  },
  { immediate: true },
)

/* ---------- `@` 路径引用（结构化展示 + 路径插入，仅字符串类控件） ---------- */

/** 字符串类控件（text/textarea）启用 @ 引用；json/number/select/switch 不启用 */
function mentionable(control: Field['control']): boolean {
  return control === 'text' || control === 'textarea'
}

/** 文件空间反查索引：user-data 相对路径 → {dir, file}（结构化卡片的展示层数据源） */
const fileIndex = computed(() => {
  const map = new Map<string, { dir: string; file: WorkspaceFile }>()
  if (!session) return map
  for (const dir of session.workspace.dirs.value) {
    for (const file of dir.files) {
      map.set(`${dir.dir}/${file.filename}`, { dir: dir.dir, file })
    }
  }
  return map
})

/** 各字段的命中卡片：值（字符串）精确等于某文件相对路径时才展示；值被改走即自动消失 */
const cards = computed<Record<string, { dir: string; file: WorkspaceFile }>>(() => {
  const result: Record<string, { dir: string; file: WorkspaceFile }> = {}
  if (!session) return result
  for (const field of fields.value) {
    if (!mentionable(field.control)) continue
    const value = textValues.value[field.name] ?? ''
    if (value === '') continue
    const hit = fileIndex.value.get(value)
    if (hit) result[field.name] = hit
  }
  return result
})

function onFieldInput(field: string, event: Event): void {
  if (!pathInsert) return
  const el = event.target as HTMLInputElement | HTMLTextAreaElement
  pathInsert.handleInput(field, el.value, el.selectionStart ?? el.value.length)
}

/** 面板打开时的按键路由（焦点留在输入框，事件由输入框转发给面板状态机） */
function onFieldKeydown(field: string, event: KeyboardEvent): void {
  if (!pathInsert?.open.value || pathInsert.activeField.value !== field) return
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      pathInsert.move(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      pathInsert.move(-1)
      break
    case 'ArrowRight':
    case 'Enter': {
      event.preventDefault()
      const path = pathInsert.confirmActive()
      if (path !== null) applyPath(field, path)
      break
    }
    case 'ArrowLeft':
      event.preventDefault()
      pathInsert.back()
      break
    case 'Escape':
      event.preventDefault()
      pathInsert.close()
      break
    default:
      break
  }
}

/** 选中文件 → 相对路径替换光标前的 `@查询词` 触发片段，写入字段值 */
function applyPath(field: string, path: string): void {
  if (!pathInsert) return
  const text = textValues.value[field] ?? ''
  const caret = Math.min(pathInsert.caret.value, text.length)
  const before = text.slice(0, caret)
  const match = /(^|\s)@[^\s@]*$/.exec(before)
  const start = match ? match.index + match[1]!.length : caret
  textValues.value[field] = before.slice(0, start) + path + text.slice(caret)
}

function onPickPathFile(field: string, reference: FileReference): void {
  if (!pathInsert) return
  applyPath(field, pathInsert.pickFile(reference))
}

function onConfirmPath(field: string): void {
  if (!pathInsert) return
  const path = pathInsert.confirmActive()
  if (path !== null) applyPath(field, path)
}

/** 本地校验（体验层）：必填、数字类型、JSON 可解析。返回错误文案（空 = 通过）。 */
function validate(): string {
  for (const field of fields.value) {
    if (field.control === 'json') {
      const text = jsonTexts.value[field.name]?.trim() ?? ''
      if (text === '') {
        if (field.required) return `参数「${field.name}」为必填项`
        continue
      }
      try {
        JSON.parse(text)
      } catch {
        return `参数「${field.name}」不是合法 JSON`
      }
      continue
    }
    if (mentionable(field.control)) {
      const text = textValues.value[field.name]?.trim() ?? ''
      if (text === '' && field.required) return `参数「${field.name}」为必填项`
      continue
    }
    const value = values.value[field.name]
    if (value === '' || value === undefined || value === null) {
      if (field.required) return `参数「${field.name}」为必填项`
      continue
    }
    if (field.control === 'number' && typeof value !== 'number') {
      return `参数「${field.name}」须为数字`
    }
  }
  return ''
}

async function onSubmit(): Promise<void> {
  const error = validate()
  if (error !== '') {
    localError.value = error
    return
  }
  const args: Record<string, unknown> = {}
  for (const field of fields.value) {
    if (field.control === 'json') {
      const text = jsonTexts.value[field.name]?.trim() ?? ''
      if (text !== '') args[field.name] = JSON.parse(text)
      continue
    }
    if (mentionable(field.control)) {
      const text = textValues.value[field.name] ?? ''
      if (text !== '') args[field.name] = text
      continue
    }
    const value = values.value[field.name]
    if (value === '' || value === undefined) continue
    args[field.name] = value
  }
  localError.value = ''
  emit('submit', args)
}

function onReject(): void {
  emit('reject')
}

/* ---------- 算法规则选择（服务声明 rules_field 且本工具 schema 含该字段时装配） ---------- */

/** 规则选择弹窗：同一时刻只服务一个字段（弹窗单槽位，与 @ 面板同口径） */
const rulePickerField = ref<string | null>(null)

/** 该字段是否装配「从算法规则选择」入口：snapshot 声明了 rules_field 且字段本身是 json 控件 */
function isRulesField(name: string, control: Field['control']): boolean {
  return control === 'json' && props.request.rules_field === name
}

function openRulePicker(field: string): void {
  rulePickerField.value = field
}

function loadRules() {
  // session 缺失（单测/独立挂载）时按钮不渲染，这里仅为类型收敛兜底
  return session!.files.rules()
}

/** 勾选结果写回 JSON 编辑框（可再手改，提交走原有 JSON 解析路径） */
function onRulesPicked(field: string, value: Array<Record<string, unknown>>): void {
  jsonTexts.value[field] = JSON.stringify(value, null, 2)
  values.value[field] = value
  rulePickerField.value = null
}

/* ---------- 倒计时：归零按拒绝关闭 ---------- */

const remaining = ref(props.request.remaining_seconds)
let timer: ReturnType<typeof setInterval> | null = null

watch(
  () => props.request.interaction_id,
  () => {
    remaining.value = props.request.remaining_seconds
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      remaining.value -= 1
      if (remaining.value <= 0 && timer) {
        clearInterval(timer)
        timer = null
        emit('reject')
      }
    }, 1000)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <BaseDialog :open="true" :title="request.title" @close="onReject">
    <div class="interaction-dialog">
      <p class="interaction-dialog__meta">
        工具：<code>{{ request.tool_name }}</code>
        <span class="interaction-dialog__countdown">剩余 {{ remaining }} 秒</span>
      </p>

      <!-- 工具级一句话说明（schema 的 description；无则整行不渲染） -->
      <p v-if="request.tool_description" class="interaction-dialog__tool-desc">
        {{ request.tool_description }}
      </p>

      <p v-if="fields.length === 0" class="interaction-dialog__empty">
        该调用无需填写参数，请确认是否执行。
      </p>

      <div v-for="field in fields" :key="field.name" class="interaction-dialog__field">
        <label class="interaction-dialog__label" :class="{ required: field.required }">
          {{ field.name
          }}<span v-if="field.labelHint" class="interaction-dialog__label-hint">
            {{ field.labelHint }}</span
          >
        </label>

        <!-- 结构化文件卡片：值精确命中文件空间的相对路径时展示（展示层，提交值仍为路径） -->
        <div v-if="cards[field.name]" class="interaction-dialog__file-card">
          <BaseIcon name="file" :size="14" />
          <span class="interaction-dialog__file-card-name">
            {{ cards[field.name].file.filename }}
          </span>
          <span class="interaction-dialog__file-card-meta">
            {{ cards[field.name].dir }} · {{ formatFileSize(cards[field.name].file.size) }}
          </span>
          <button
            type="button"
            class="interaction-dialog__file-card-clear"
            aria-label="清除"
            @click="textValues[field.name] = ''"
          >
            ×
          </button>
        </div>

        <select
          v-if="field.control === 'select'"
          v-model="values[field.name]"
          class="interaction-dialog__input"
        >
          <option value="" disabled>请选择</option>
          <option v-for="(opt, i) in field.options" :key="i" :value="opt">
            {{ String(opt) }}
          </option>
        </select>

        <label v-else-if="field.control === 'switch'" class="interaction-dialog__switch">
          <input v-model="values[field.name]" type="checkbox" />
          <span>{{ values[field.name] ? '是' : '否' }}</span>
        </label>

        <input
          v-else-if="field.control === 'number'"
          v-model.number="values[field.name]"
          type="number"
          class="interaction-dialog__input"
          :placeholder="field.placeholder"
        />

        <textarea
          v-else-if="field.control === 'textarea'"
          v-model="textValues[field.name]"
          class="interaction-dialog__input interaction-dialog__input--area"
          :placeholder="field.placeholder"
          rows="4"
          @input="onFieldInput(field.name, $event)"
          @keydown="onFieldKeydown(field.name, $event)"
        />

        <textarea
          v-else-if="field.control === 'json'"
          v-model="jsonTexts[field.name]"
          class="interaction-dialog__input interaction-dialog__input--area interaction-dialog__input--json"
          placeholder="JSON 格式"
          rows="4"
        />

        <!-- 算法规则选择入口：仅 snapshot 声明 rules_field 且本会话可取文件接口时装配 -->
        <button
          v-if="isRulesField(field.name, field.control) && session"
          type="button"
          class="interaction-dialog__rules-btn"
          :aria-label="`从算法规则选择 ${field.name}`"
          @click="openRulePicker(field.name)"
        >
          从算法规则选择
        </button>

        <RulePickerDialog
          v-if="isRulesField(field.name, field.control) && session"
          :open="rulePickerField === field.name"
          :field-name="field.name"
          :initial-value="values[field.name]"
          :load="loadRules"
          @confirm="(value) => onRulesPicked(field.name, value)"
          @close="rulePickerField = null"
        />

        <input
          v-else
          v-model="textValues[field.name]"
          type="text"
          class="interaction-dialog__input"
          :placeholder="field.placeholder"
          @input="onFieldInput(field.name, $event)"
          @keydown="onFieldKeydown(field.name, $event)"
        />

        <!-- `@` 文件引用面板：仅当前激活的字符串字段下方展开（绝对定位覆盖，不推挤表单） -->
        <div
          v-if="
            pathInsert &&
            pathInsert.open.value &&
            pathInsert.activeField.value === field.name &&
            mentionable(field.control)
          "
          class="interaction-dialog__picker"
        >
          <MentionPicker
            :open="true"
            :spaces="pathInsert.spaces.value"
            :column="pathInsert.column.value"
            :active-space="pathInsert.activeSpace.value"
            :active-dir="pathInsert.activeDir.value"
            :dirs="pathInsert.dirs.value"
            :files="pathInsert.files.value"
            :active-index="pathInsert.activeIndex.value"
            :loading="pathInsert.loading.value"
            @pick-space="pathInsert.pickSpace"
            @pick-dir="pathInsert.pickDir"
            @pick-file="(reference) => onPickPathFile(field.name, reference)"
            @close="pathInsert.close"
            @move="pathInsert.move"
            @confirm="() => onConfirmPath(field.name)"
            @back="pathInsert.back"
          />
        </div>

        <p v-if="field.description" class="interaction-dialog__hint">{{ field.description }}</p>
        <p v-if="pathInsert && mentionable(field.control)" class="interaction-dialog__hint">
          输入 @ 可引用文件空间路径
        </p>
        <p v-if="isRulesField(field.name, field.control)" class="interaction-dialog__hint">
          点击「从算法规则选择」读取「数据准备/算法规则」最新规则文件，勾选后生成数组填入
        </p>
      </div>

      <p v-if="localError" class="interaction-dialog__error">{{ localError }}</p>
      <p v-if="serverError" class="interaction-dialog__error">{{ serverError }}</p>
    </div>

    <template #footer>
      <BaseButton variant="secondary" @click="onReject">拒绝调用</BaseButton>
      <BaseButton variant="primary" @click="onSubmit">确认提交</BaseButton>
    </template>
  </BaseDialog>
</template>

<style scoped>
.interaction-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.interaction-dialog__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.interaction-dialog__meta code {
  font-family: monospace;
}

.interaction-dialog__countdown {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.interaction-dialog__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.interaction-dialog__field {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* 结构化文件卡片：值命中文件空间时的展示层（提交值仍为路径文本） */
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

/* `@` 引用面板：绝对定位覆盖在字段下方，不推挤表单布局 */
.interaction-dialog__picker {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: 30;
  width: max-content;
  max-width: 100%;
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

.interaction-dialog__tool-desc {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  white-space: pre-line;
}

.interaction-dialog__label.required::after {
  content: ' *';
  color: var(--color-status-error);
}

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

.interaction-dialog__hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

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

.interaction-dialog__rules-btn:hover {
  color: var(--color-text);
  border-color: var(--color-text-muted);
}

.interaction-dialog__error {
  margin: 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
  white-space: pre-line;
}
</style>

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
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { InteractionSnapshot } from '../../api/types'
import BaseButton from '../common/BaseButton.vue'
import BaseDialog from '../common/BaseDialog.vue'

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

/** schema.properties 的形状（只读我们关心的键） */
interface PropSchema {
  type?: unknown
  enum?: unknown
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
  placeholder: string
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
      placeholder: schema.type === 'integer' || schema.type === 'number' ? '数字' : '请输入',
    }
  }),
)

/** 表单值：JSON 字段以字符串编辑（提交时解析），其余按原类型 */
const values = ref<Record<string, unknown>>({})
const jsonTexts = ref<Record<string, string>>({})
const localError = ref('')

function initForm(): void {
  const next: Record<string, unknown> = {}
  const texts: Record<string, string> = {}
  for (const field of fields.value) {
    const proposed = props.request.proposed_args[field.name]
    if (field.control === 'json') {
      texts[field.name] = proposed === undefined ? '' : JSON.stringify(proposed, null, 2)
      next[field.name] = proposed
    } else {
      next[field.name] = proposed ?? ''
    }
  }
  values.value = next
  jsonTexts.value = texts
  localError.value = ''
}
// request 变化（新挂起点 / 恢复快照）→ 重置表单
watch(() => props.request.interaction_id, initForm, { immediate: true })

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

      <p v-if="fields.length === 0" class="interaction-dialog__empty">
        该调用无需填写参数，请确认是否执行。
      </p>

      <div v-for="field in fields" :key="field.name" class="interaction-dialog__field">
        <label class="interaction-dialog__label" :class="{ required: field.required }">
          {{ field.name }}
        </label>

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
          v-else-if="field.control === 'textarea' || field.control === 'json'"
          v-model="jsonTexts[field.name]"
          class="interaction-dialog__input interaction-dialog__input--area"
          :class="{ 'interaction-dialog__input--json': field.control === 'json' }"
          :placeholder="field.control === 'json' ? 'JSON 格式' : field.placeholder"
          rows="4"
        />

        <input
          v-else
          v-model="values[field.name]"
          type="text"
          class="interaction-dialog__input"
          :placeholder="field.placeholder"
        />

        <p v-if="field.description" class="interaction-dialog__hint">{{ field.description }}</p>
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
  display: flex;
  flex-direction: column;
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

.interaction-dialog__error {
  margin: 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
  white-space: pre-line;
}
</style>

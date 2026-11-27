<script setup lang="ts">
import { computed } from 'vue'
import { MCP_HEADERS_HINT, MCP_HEADERS_PLACEHOLDER } from '../../constants/mcp'
import { parseHeaders } from '../../utils/mcp-config'

const props = withDefaults(
  defineProps<{
    headers: Record<string, string>
    text: string
    clearing: boolean
    /** 输入框 id——同一页面可能同时存在新建弹窗与详情表单，id 必须唯一 */
    inputId?: string
    hintText?: string
  }>(),
  { inputId: 'mcp-headers', hintText: '' },
)

const emit = defineEmits<{
  (e: 'update:text', value: string): void
  (e: 'update:clearing', value: boolean): void
}>()

const hasHeaders = computed(() => Object.keys(props.headers).length > 0)

const currentText = computed(() =>
  Object.entries(props.headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('、'),
)

const inputError = computed<string | null>(() => {
  if (props.clearing) return null
  if (props.text.trim() === '') return null
  return parseHeaders(props.text).error ?? null
})

const placeholder = computed(() => {
  const names = Object.keys(props.headers)
  return names.length > 0 ? `{"${names[0]}":"你的真实令牌"}` : MCP_HEADERS_PLACEHOLDER
})
</script>

<template>
  <div class="mcp-headers">
    <label class="field" :for="inputId">
      <span class="field__label">
        请求头（可空）
        <span v-if="inputError" class="mcp-headers__invalid" data-test="headers-invalid">
          格式错误！
        </span>
      </span>
      <textarea
        :id="inputId"
        :value="text"
        rows="2"
        data-test="headers-input"
        :class="{ invalid: inputError !== null }"
        :placeholder="placeholder"
        :disabled="clearing"
        :aria-invalid="inputError !== null"
        :aria-describedby="inputError ? `${inputId}-error` : undefined"
        @input="emit('update:text', ($event.target as HTMLTextAreaElement).value)"
      />
    </label>

    <p
      v-if="inputError"
      :id="`${inputId}-error`"
      class="mcp-headers__error"
      role="alert"
      data-test="headers-error"
    >
      {{ inputError }}
    </p>

    <p v-if="hasHeaders" class="field__hint" data-test="headers-view">
      <span class="mcp-headers__ok"><span aria-hidden="true">✓</span> 当前（掩码）</span>：
      <span class="mono mcp-headers__current">{{ currentText }}</span>
    </p>
    <p v-if="clearing" class="mcp-headers__warning" role="alert" data-test="headers-clear-warning">
      保存后该服务的<strong>全部请求头将被清除</strong>；需要令牌的服务会开始返回 401。
    </p>

    <span v-if="hintText" class="field__hint">{{ hintText }}</span>
    <span v-else class="field__hint">
      {{ MCP_HEADERS_HINT }}。<strong>留空 = 不修改</strong>（已配置的令牌不会因保存被清掉）。
      需要访问令牌的服务（如本体侧「自建发布」的
      <span class="mono">X-MCP-Token</span>）填在此处，否则连接与创建都会 401。
    </span>

    <div v-if="hasHeaders" class="mcp-headers__actions">
      <button
        v-if="!clearing"
        type="button"
        class="btn"
        data-test="clear-headers"
        @click="emit('update:clearing', true)"
      >
        清空全部请求头
      </button>
      <button
        v-else
        type="button"
        class="btn"
        data-test="undo-clear-headers"
        @click="emit('update:clearing', false)"
      >
        撤销清空
      </button>
    </div>
  </div>
</template>

<style scoped>
.mcp-headers__ok {
  color: var(--color-status-success);
  font-weight: 600;
}

.mcp-headers__current {
  color: var(--color-status-success);
  overflow-wrap: anywhere;
}

.mcp-headers__invalid {
  margin-left: var(--space-2);
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.mcp-headers__error {
  margin: var(--space-1) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

textarea.invalid {
  border-color: var(--color-status-error);
}

.mcp-headers__warning {
  margin: var(--space-2) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.mcp-headers__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>

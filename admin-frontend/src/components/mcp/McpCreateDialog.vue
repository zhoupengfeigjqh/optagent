<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useMcpServices } from '../../composables/useMcpServices'
import {
  MCP_DESCRIPTION_PLACEHOLDER,
  MCP_HEADERS_HINT,
  MCP_NAME_HINT,
  MCP_URL_HINT,
} from '../../constants/mcp'
import type { McpToolInfo } from '../../api/types'
import { parseHeaders, validateMcpBasics } from '../../utils/mcp-config'
import ErrorNotice from '../common/ErrorNotice.vue'
import McpHeadersField from './McpHeadersField.vue'
import McpToolPicker from './McpToolPicker.vue'

/**
 * 新建态的请求头说明（与详情页同源，但此处**没有存量**：留空即"不带请求头"，
 * 而非"不修改"——这个差别写在文案里，避免管理员以为留空是沿用某处已有配置）。
 */
const CREATE_HEADERS_HINT = `${MCP_HEADERS_HINT}。需要访问令牌的服务（如本体侧「自建发布」的 X-MCP-Token）填在此处，否则连接与创建都会 401。`

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'created', name: string): void
  (e: 'announce', text: string): void
}>()

const m = useMcpServices()

const dialogEl = ref<HTMLDialogElement | null>(null)
const nameEl = ref<HTMLInputElement | null>(null)
let restoreFocusTo: HTMLElement | null = null

const step = ref<'basics' | 'tools'>('basics')
const name = ref('')
const description = ref('')
const transport = ref<'http' | 'stdio'>('http')
const url = ref('')
const command = ref('')
const headersText = ref('')
const tools = ref<McpToolInfo[]>([])
const toolsTruncated = ref(false)
const selectedTools = ref<string[]>([])
const localError = ref<string | null>(null)

function reset(): void {
  step.value = 'basics'
  name.value = ''
  description.value = ''
  transport.value = 'http'
  url.value = ''
  command.value = ''
  headersText.value = ''
  tools.value = []
  toolsTruncated.value = false
  selectedTools.value = []
  localError.value = null
  m.error.value = null
}

function openDialog(): void {
  const el = dialogEl.value
  if (!el) return
  restoreFocusTo = (document.activeElement as HTMLElement | null) ?? null
  // jsdom 早期版本没有 showModal：降级为设置 open 属性，保证行为可测
  if (typeof el.showModal === 'function') {
    if (!el.open) el.showModal()
  } else {
    el.setAttribute('open', '')
  }
  void nextTick(() => nameEl.value?.focus())
}

function closeDialog(): void {
  const el = dialogEl.value
  if (el) {
    if (typeof el.close === 'function' && el.open) el.close()
    else el.removeAttribute('open')
  }
  restoreFocusTo?.focus?.()
  restoreFocusTo = null
}

/** 处理中禁止关闭（取消按钮、Esc 都走这里） */
function requestClose(): void {
  if (m.busy.value) return
  emit('update:open', false)
}

function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

function currentHeaders(): { headers?: Record<string, string>; error?: string } {
  if (transport.value !== 'http') return {}
  const parsed = parseHeaders(headersText.value)
  if (parsed.error !== undefined) return { error: parsed.error }
  return { headers: parsed.headers }
}

async function probeAndNext(): Promise<void> {
  localError.value = null
  const invalid = validateMcpBasics({
    name: name.value,
    transport: transport.value,
    url: url.value,
    command: command.value,
  })
  if (invalid !== null) {
    localError.value = invalid
    return
  }

  const headersPatch = currentHeaders()
  if (headersPatch.error !== undefined) {
    localError.value = headersPatch.error
    return
  }

  const result = await m.probeTarget({
    name: name.value.trim(),
    transport: transport.value,
    ...(transport.value === 'http'
      ? { url: url.value.trim(), headers: headersPatch.headers ?? {} }
      : { command: command.value.trim() }),
  })
  if (result === null) return
  if (!result.ok) {
    localError.value = `无法连接该服务，未创建任何记录：${result.error ?? '未知原因'}`
    return
  }

  tools.value = result.tools
  toolsTruncated.value = result.tools_truncated
  selectedTools.value = []
  step.value = 'tools'
  await nextTick()
  dialogEl.value?.querySelector<HTMLInputElement>('[data-test="tool"]')?.focus()
}

async function submitCreate(): Promise<void> {
  localError.value = null
  if (selectedTools.value.length === 0) {
    localError.value = '请至少勾选一个可见工具：未勾选任何工具的服务无法被数字人使用'
    return
  }

  const headersPatch = currentHeaders()
  if (headersPatch.error !== undefined) {
    localError.value = headersPatch.error
    return
  }

  const saved = await m.createService({
    name: name.value.trim(),
    description: description.value,
    transport: transport.value,
    ...(transport.value === 'http'
      ? { url: url.value.trim(), headers: headersPatch.headers ?? {} }
      : { command: command.value.trim() }),
    allowed_tools: [...selectedTools.value],
  })
  if (saved === null) return

  emit('announce', `MCP 服务 ${saved.name} 已创建`)
  emit('created', saved.name)
  emit('update:open', false)
}

watch(
  () => props.open,
  async (isOpen) => {
    await nextTick()
    if (isOpen) {
      reset()
      openDialog()
    } else {
      closeDialog()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  const el = dialogEl.value
  if (el && typeof el.close === 'function' && el.open) el.close()
})
</script>

<template>
  <dialog
    ref="dialogEl"
    class="mcp-create-dialog"
    aria-labelledby="mcp-create-title"
    @cancel="onCancel"
  >
    <form method="dialog" class="mcp-create-dialog__body" @submit.prevent="() => undefined">
      <h2 id="mcp-create-title" class="mcp-create-dialog__title">新建 MCP 服务</h2>

      <template v-if="step === 'basics'">
        <p class="mcp-create-dialog__intro">
          先登记基础连接信息并<strong>连接一次</strong>以获取工具清单；连接成功后再勾选该服务对数字人
          <strong>可见的工具</strong>（其余工具对数字人不可见）。工具范围之后可在详情页 「工具清单 →
          重新探测」里调整。
        </p>

        <label class="field" for="mcp-create-name">
          <span class="field__label">
            服务名称<span class="field__required" aria-hidden="true">*</span>
          </span>
          <input
            id="mcp-create-name"
            ref="nameEl"
            v-model="name"
            type="text"
            :placeholder="MCP_NAME_HINT"
          />
          <span class="field__hint">{{ MCP_NAME_HINT }}；创建后不可改名。</span>
        </label>

        <label class="field" for="mcp-create-description">
          <span class="field__label">用途描述</span>
          <input
            id="mcp-create-description"
            v-model="description"
            type="text"
            :placeholder="MCP_DESCRIPTION_PLACEHOLDER"
          />
        </label>

        <fieldset class="mcp-create-dialog__conn">
          <legend class="field__label">连接配置</legend>

          <div class="mcp-create-dialog__conn-row">
            <label
              v-if="transport === 'http'"
              class="field mcp-create-dialog__conn-main"
              for="mcp-create-url"
            >
              <span class="field__label">
                连接地址<span class="field__required" aria-hidden="true">*</span>
              </span>
              <input id="mcp-create-url" v-model="url" type="text" :placeholder="MCP_URL_HINT" />
              <span class="field__hint">平台按此地址连接该 MCP 服务（含协议与端口）。</span>
            </label>

            <label v-else class="field mcp-create-dialog__conn-main" for="mcp-create-command">
              <span class="field__label">
                启动命令<span class="field__required" aria-hidden="true">*</span>
              </span>
              <input
                id="mcp-create-command"
                v-model="command"
                type="text"
                placeholder="例如：python"
              />
              <span class="field__hint">启动参数留到详情页填写。</span>
            </label>

            <label class="field mcp-create-dialog__conn-transport" for="mcp-create-transport">
              <span class="field__label">
                传输方式<span class="field__required" aria-hidden="true">*</span>
              </span>
              <select id="mcp-create-transport" v-model="transport">
                <option value="http">streamable-http</option>
                <option value="stdio">stdio</option>
              </select>
            </label>
          </div>

          <McpHeadersField
            v-if="transport === 'http'"
            v-model:text="headersText"
            :headers="{}"
            :clearing="false"
            input-id="mcp-create-headers"
            :hint-text="CREATE_HEADERS_HINT"
          />
        </fieldset>
      </template>

      <template v-else>
        <p class="mcp-create-dialog__intro">
          已连接成功，共探测到 <strong>{{ tools.length }}</strong> 个工具。
          勾选该服务对数字人<strong>可见的工具</strong>——未勾选的工具对模型完全不可见；
          创建后仍可在详情页「工具清单 → 重新探测」里增删。
        </p>

        <p v-if="tools.length === 0" class="mcp-create-dialog__error" role="alert">
          该服务未暴露任何工具，无法创建（工具范围至少需要一个工具）。
        </p>

        <McpToolPicker
          v-else
          v-model:selected="selectedTools"
          :tools="tools"
          :truncated="toolsTruncated"
        />
      </template>

      <p v-if="localError" class="mcp-create-dialog__error" role="alert">{{ localError }}</p>
      <ErrorNotice :error="m.error.value" title="操作未完成" />

      <div class="mcp-create-dialog__actions">
        <button
          v-if="step === 'tools'"
          type="button"
          class="btn"
          data-test="back"
          :disabled="m.busy.value"
          @click="step = 'basics'"
        >
          上一步
        </button>
        <button
          type="button"
          class="btn"
          data-test="cancel"
          :disabled="m.busy.value"
          @click="requestClose"
        >
          取消
        </button>
        <button
          v-if="step === 'basics'"
          type="button"
          class="btn btn--primary"
          data-test="confirm"
          :disabled="m.busy.value"
          @click="probeAndNext"
        >
          {{ m.busy.value ? '连接中…' : '连接并获取工具' }}
        </button>
        <button
          v-else
          type="button"
          class="btn btn--primary"
          data-test="create"
          :disabled="m.busy.value || tools.length === 0"
          @click="submitCreate"
        >
          {{ m.busy.value ? '创建中…' : '创建服务' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.mcp-create-dialog {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 560px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.mcp-create-dialog::backdrop {
  background: var(--color-overlay);
}

.mcp-create-dialog__body {
  padding: var(--space-5);
}

.mcp-create-dialog__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.mcp-create-dialog__intro {
  margin: var(--space-2) 0 var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.mcp-create-dialog__error {
  color: var(--color-status-error);
}

.mcp-create-dialog__conn {
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.mcp-create-dialog__conn-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.mcp-create-dialog__conn-main {
  flex: 1;
  min-width: 0;
}

.mcp-create-dialog__conn-transport {
  flex: 0 0 180px;
}

.mcp-create-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>

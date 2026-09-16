<script setup lang="ts">
/**
 * MCP 调用配置表单（`FR-044`、`FR-056`；原"服务级配置"，2026-09-15 更名）。
 *
 * 关键点：**`endpoints` 按运行形态分组**——每个形态一个输入框，
 * 至少填一个。目标形态缺地址不会静默回退，而是**阻止部署**
 * （`ADM_RUNTIME_FORM_NOT_CONFIGURED`）。
 *
 * 运行形态选项来自服务端（前端 MUST NOT 硬编码，原则七）。
 */
import { onMounted, ref, watch } from 'vue'
import { fetchRuntimeForms } from '../../api/platform'
import { testMcpService, type McpProbePayload } from '../../api/mcp'
import type { ErrorInfo, McpServiceConfigPayload, McpServiceDetail, McpTestResult, RuntimeFormOption } from '../../api/types'
import ErrorNotice from '../common/ErrorNotice.vue'
import StatusBadge from '../common/StatusBadge.vue'

const props = defineProps<{
  service: McpServiceDetail
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'save', payload: Omit<McpServiceConfigPayload, 'revision'>): void
  (e: 'announce', text: string): void
}>()

const forms = ref<RuntimeFormOption[]>([])
const description = ref('')
const transport = ref<'http' | 'stdio'>('http')
const endpoints = ref<Record<string, string>>({})
const command = ref('')
const argsText = ref('')
const fileArgsText = ref('{}')
const localError = ref<string | null>(null)

function loadFrom(service: McpServiceDetail | null): void {
  if (!service) return
  description.value = service.description
  transport.value = service.transport
  endpoints.value = { ...service.endpoints }
  command.value = service.command ?? ''
  argsText.value = (service.args ?? []).join('\n')
  fileArgsText.value = JSON.stringify(service.file_args ?? {}, null, 2)
}

onMounted(async () => {
  try {
    forms.value = (await fetchRuntimeForms()).items
  } catch {
    // 形态列表不可得时仍可编辑已有形态的地址（不阻断主流程）
    forms.value = Object.keys(props.service.endpoints).map((value) => ({ value, label: value }))
  }
})

watch(() => props.service, (next) => loadFrom(next), { immediate: true })

/** 解析文件参数映射：非对象或非法 JSON 一律返回 null（由调用方给出可读错误） */
function parseFileArgs(text: string): Record<string, Record<string, string>> | null {
  try {
    const parsed = JSON.parse(text || '{}') as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, Record<string, string>>
  } catch {
    return null
  }
}

function submit(): void {
  localError.value = null

  const fileArgs = parseFileArgs(fileArgsText.value)
  if (fileArgs === null) {
    localError.value = '文件参数映射不是合法 JSON 对象（应为 { 工具名: { 参数名或取值路径: "url" } }）'
    return
  }

  const cleaned = cleanedEndpoints()
  if (Object.keys(cleaned).length === 0) {
    localError.value = '至少需要一个运行形态的连接地址'
    return
  }

  const payload: Omit<McpServiceConfigPayload, 'revision'> = {
    description: description.value,
    transport: transport.value,
    endpoints: cleaned,
    ...(transport.value === 'stdio'
      ? {
          command: command.value,
          args: argsText.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== ''),
        }
      : {}),
    file_args: fileArgs,
  }
  emit('save', payload)
}

function cleanedEndpoints(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(endpoints.value)) {
    if (value.trim() !== '') out[key] = value.trim()
  }
  return out
}

/**
 * 表单当前值（**允许未保存**）："发起测试"据此探测，保证测的就是管理员
 * 正在编辑的地址，而不是上一次保存的旧值（实测缺陷，2026-09-15）。
 */
function probeTarget(): McpProbePayload {
  return {
    transport: transport.value,
    endpoints: cleanedEndpoints(),
    ...(transport.value === 'stdio'
      ? {
          command: command.value,
          args: argsText.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== ''),
        }
      : {}),
  }
}

defineExpose({ probeTarget })

/**
 * 连通性测试（按表单当前值探测，允许未保存）。
 *
 * 结果以**弹窗**呈现（原生 `<dialog>` + `showModal()`，与 `ConfirmDialog`
 * 同一套可访问性基线：Esc 关闭、焦点归还），不在原页面上挤占版面。
 */
const testResult = ref<McpTestResult | null>(null)
const testBusy = ref(false)
const testError = ref<ErrorInfo | null>(null)
const testDialogEl = ref<HTMLDialogElement | null>(null)
let restoreFocusTo: HTMLElement | null = null

function openTestDialog(): void {
  const el = testDialogEl.value
  if (!el) return
  restoreFocusTo = (document.activeElement as HTMLElement | null) ?? null
  // jsdom 早期版本没有 showModal：降级为设置 open 属性，保证行为可测
  if (typeof el.showModal === 'function') {
    if (!el.open) el.showModal()
  } else {
    el.setAttribute('open', '')
  }
}

function closeTestDialog(): void {
  const el = testDialogEl.value
  if (el) {
    if (typeof el.close === 'function' && el.open) el.close()
    else el.removeAttribute('open')
  }
  restoreFocusTo?.focus?.()
  restoreFocusTo = null
}

function onTestDialogCancel(event: Event): void {
  // Esc 触发：阻止浏览器默认关闭，统一走 closeTestDialog 的焦点归还流程
  event.preventDefault()
  closeTestDialog()
}

async function runTest(): Promise<void> {
  testBusy.value = true
  testError.value = null
  try {
    testResult.value = await testMcpService(props.service.name, probeTarget())
    emit(
      'announce',
      testResult.value.ok ? '连通性与能力验证均通过' : '测试未通过，详见弹窗中的失败原因',
    )
  } catch (err) {
    testError.value = err as ErrorInfo
    emit('announce', '测试请求失败')
  } finally {
    testBusy.value = false
    openTestDialog()
  }
}
</script>

<template>
  <form class="mcp-config-form" @submit.prevent="submit">
    <label class="field" for="mcp-description">
      <span class="field__label">用途描述</span>
      <input id="mcp-description" v-model="description" type="text" placeholder="展示在卡片上的用途说明" />
    </label>

    <label class="field" for="mcp-transport">
      <span class="field__label">传输方式</span>
      <select id="mcp-transport" v-model="transport">
        <option value="http">streamable-http</option>
        <option value="stdio">stdio</option>
      </select>
    </label>

    <fieldset class="mcp-config-form__endpoints">
      <legend class="field__label">连接地址（按运行形态分别声明）</legend>
      <p class="field__hint">
        至少填一个。目标运行形态缺地址会**阻止部署**，不会回退到其他形态的地址。
      </p>
      <label v-for="form in forms" :key="form.value" class="field">
        <span class="field__label">{{ form.label }}（<code class="mono">{{ form.value }}</code>）</span>
        <input
          v-model="endpoints[form.value]"
          type="text"
          :placeholder="form.hint ?? 'http://service:port/mcp'"
        />
      </label>
    </fieldset>

    <template v-if="transport === 'stdio'">
      <label class="field" for="mcp-command">
        <span class="field__label">
          启动命令<span class="field__required" aria-hidden="true">*</span>
        </span>
        <input id="mcp-command" v-model="command" type="text" placeholder="例如：python" />
      </label>
      <label class="field" for="mcp-args">
        <span class="field__label">启动参数（每行一个）</span>
        <textarea id="mcp-args" v-model="argsText" rows="3" />
      </label>
    </template>

    <label class="field" for="mcp-file-args">
      <span class="field__label">文件参数映射（JSON）</span>
      <textarea id="mcp-file-args" v-model="fileArgsText" rows="4" />
      <span class="field__hint">
        形如 <code class="mono">{ "ocr_image": { "image": "url" } }</code>；入参在数组里的用
        <code class="mono">[]</code> 表示「每个元素」，如
        <code class="mono">{ "parse_excel_files": { "items[].excelFileUrl": "url" } }</code>。
        运行环境会把沙箱校验后的签名直链填到该位置（值本身已是 http(s) 直链则原样透传）。
      </span>
    </label>

    <p v-if="localError" class="mcp-config-form__error" role="alert">{{ localError }}</p>

    <div class="mcp-config-form__actions">
      <!-- 发起测试在保存之前：按表单当前值探测，填写了即可测，无需先保存 -->
      <button
        type="button"
        class="btn btn--success"
        :disabled="testBusy === true"
        @click="runTest"
      >
        {{ testBusy ? '测试中…' : '发起测试' }}
      </button>
      <!-- 同时挂 click：不依赖浏览器是否通过按钮触发 form 的 submit 事件 -->
      <button type="button" class="btn btn--primary" :disabled="busy === true" @click="submit">
        {{ busy ? '保存中…' : '保存调用配置' }}
      </button>
    </div>
  </form>

  <!-- 测试结果弹窗：不在原页面上展示，避免挤占表单版面 -->
  <dialog
    ref="testDialogEl"
    class="mcp-test-dialog"
    aria-labelledby="mcp-test-dialog-title"
    @cancel="onTestDialogCancel"
  >
    <div class="mcp-test-dialog__body">
      <h2 id="mcp-test-dialog-title" class="mcp-test-dialog__title">连通性测试结果</h2>

      <ErrorNotice :error="testError" title="测试请求失败" />

      <div v-if="testResult" class="mcp-test-dialog__result">
        <p class="mcp-test-dialog__summary">
          <StatusBadge
            :status="testResult.ok ? 'ok' : 'failed'"
            :label="testResult.ok ? '测试通过' : '测试未通过'"
          />
          <span class="muted">检查时间 {{ testResult.checked_at }}</span>
        </p>

        <p v-if="testResult.target" class="mcp-test-dialog__target">
          实际测试：<code class="mono">{{
            testResult.target.transport === 'http' ? 'streamable-http' : 'stdio'
          }} → {{ testResult.target.url ?? testResult.target.command ?? '（未填写地址）' }}</code>
        </p>

        <dl class="mcp-test-dialog__steps">
          <dt>连通性</dt>
          <dd>
            <StatusBadge :status="testResult.connectivity.ok ? 'ok' : 'failed'" />
            耗时 {{ testResult.connectivity.duration_ms }}ms
            <span v-if="!testResult.connectivity.ok" class="mcp-test-dialog__reason">
              {{ testResult.connectivity.error_code }}：{{ testResult.connectivity.message }}
            </span>
          </dd>

          <dt>能力验证（{{ testResult.capability.method }}）</dt>
          <dd>
            <StatusBadge :status="testResult.capability.ok ? 'ok' : 'failed'" />
            耗时 {{ testResult.capability.duration_ms }}ms
            <span v-if="!testResult.capability.ok" class="mcp-test-dialog__reason">
              {{ testResult.capability.error_code }}：{{ testResult.capability.message }}
            </span>
          </dd>
        </dl>
      </div>

      <div class="mcp-test-dialog__actions">
        <button type="button" class="btn btn--primary" data-test="close-test" @click="closeTestDialog">
          关闭
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.mcp-config-form__endpoints {
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.mcp-config-form__error {
  color: var(--color-status-error);
}

.mcp-config-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.mcp-test-dialog {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 560px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.mcp-test-dialog::backdrop {
  background: var(--color-overlay);
}

.mcp-test-dialog__body {
  padding: var(--space-5);
}

.mcp-test-dialog__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.mcp-test-dialog__summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-3) 0 var(--space-2);
}

.mcp-test-dialog__target {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}

.mcp-test-dialog__steps {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  font-size: var(--font-size-sm);
}

.mcp-test-dialog__steps dt {
  color: var(--color-text-muted);
}

.mcp-test-dialog__steps dd {
  margin: 0;
}

.mcp-test-dialog__reason {
  display: block;
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
}

.mcp-test-dialog__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-5);
}
</style>

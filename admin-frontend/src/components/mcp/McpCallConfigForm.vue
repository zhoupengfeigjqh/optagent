<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { McpProbePayload } from '../../api/mcp'
import type { McpConfirmation, McpServiceConfigInput, McpServiceDetail } from '../../api/types'
import { useMcpConnectionTest } from '../../composables/useMcpConnectionTest'
import { MCP_DESCRIPTION_PLACEHOLDER, MCP_NAME_HINT, MCP_URL_HINT } from '../../constants/mcp'
import { parseHeaders, validateMcpBasics } from '../../utils/mcp-config'
import FileArgsMappingTable from './FileArgsMappingTable.vue'
import HitlConfirmationField from './HitlConfirmationField.vue'
import McpHeadersField from './McpHeadersField.vue'
import RulesFieldMappingTable from './RulesFieldMappingTable.vue'
import McpTestResultDialog from './McpTestResultDialog.vue'

const props = defineProps<{
  service: McpServiceDetail
  busy?: boolean
  /**
   * 最近一次**保存响应**里的掩码请求头（2026-10-08；可为 `null`）。
   *
   * 为什么需要：保存后详情**不重载**（重载会连带触发一次 MCP 实时探测，见
   * `McpServiceDetail` 的注释），详情 props 里的掩码因此会停留在旧值。父级把
   * 保存响应里的掩码透传下来，本表单据此就地刷新展示并把三态复位为 `view`。
   */
  headersOverride?: Record<string, string> | null
}>()

const emit = defineEmits<{
  (e: 'submit', config: McpServiceConfigInput): void
  (e: 'announce', text: string): void
}>()

const name = ref('')
const description = ref('')
const transport = ref<'http' | 'stdio'>('http')
const url = ref('')
const command = ref('')
const argsText = ref('')
const fileArgs = ref<Record<string, Record<string, string>>>({})
const confirmationMode = ref<'never' | 'always' | 'custom'>('never')
const confirmationTools = ref<string[]>([])
/** custom 且服务工具清单不可得时的手填文本（每行一个） */
const confirmationManualText = ref('')
const rulesFields = ref<Record<string, string>>({})
/**
 * 工具显示名（2026-10-27）：`{ 工具名: 中文名 }`。
 *
 * 空串 = 不配置（界面回退英文工具名）；提交时会 trim 并丢弃空值——后端拒绝空串
 * （空串的语义是"配了个空名字"，与"不配"必须区分）。
 */
const toolLabels = ref<Record<string, string>>({})
const localError = ref<string | null>(null)
const headersText = ref('')
const headersClearing = ref(false)
const headersView = ref<Record<string, string>>({})

/** 服务当前工具清单（来自平台对服务的最近一次探测）；不可得时为空数组 → 走手填回退 */
const toolCatalog = computed(() => props.service.tools)
/** 清单不可得 → 回退手填（服务未启动/探测失败时管理员仍要能改配置） */
const manualFallback = computed(() => toolCatalog.value.length === 0)
const orphanTools = computed(() =>
  confirmationTools.value.filter((name) => !toolCatalog.value.some((t) => t.name === name)),
)

function loadFrom(service: McpServiceDetail): void {
  name.value = service.name
  description.value = service.description
  transport.value = service.transport
  url.value = service.url ?? ''
  command.value = service.command ?? ''
  argsText.value = (service.args ?? []).join('\n')
  fileArgs.value = Object.fromEntries(
    Object.entries(service.file_args ?? {}).map(([tool, mapping]) => [tool, { ...mapping }]),
  )
  const policy = service.confirmation ?? 'never'
  if (policy === 'always') {
    confirmationMode.value = 'always'
    confirmationTools.value = []
    confirmationManualText.value = ''
  } else if (typeof policy === 'object' && Array.isArray(policy.tools)) {
    confirmationMode.value = 'custom'
    confirmationTools.value = [...(policy.tools as string[])]
    confirmationManualText.value = (policy.tools as string[]).join('\n')
  } else {
    confirmationMode.value = 'never'
    confirmationTools.value = []
    confirmationManualText.value = ''
  }
  rulesFields.value = { ...(service.rules_fields ?? {}) }
  toolLabels.value = { ...(service.tool_labels ?? {}) }
  headersView.value = { ...(service.headers ?? {}) }
  headersText.value = ''
  headersClearing.value = false
  pruneRulesFields()
}

function pruneRulesFields(): void {
  if (confirmationMode.value === 'never') {
    rulesFields.value = {}
    return
  }
  if (confirmationMode.value !== 'custom') return
  const allowed = new Set(confirmationTools.value)
  rulesFields.value = Object.fromEntries(
    Object.entries(rulesFields.value).filter(([tool]) => allowed.has(tool)),
  )
}

const hitlAllowedTools = computed<string[]>(() => {
  if (confirmationMode.value === 'never') return []
  if (confirmationMode.value === 'always') return toolCatalog.value.map((t) => t.name)
  return [...new Set(confirmationTools.value)]
})

/** 无需确认 / 清单不可得：算法规则参数设置不可编辑（未开 HITL 时本就不生效） */
const rulesDisabled = computed(() => confirmationMode.value === 'never' || manualFallback.value)

watch(confirmationMode, pruneRulesFields)

watch(confirmationTools, () => {
  if (confirmationMode.value === 'custom') pruneRulesFields()
})

/**
 * 草稿锚定「服务标识」（契约 §0.5 原则 ①）：**只有切换服务才重填表单**——同一服务的
 * `props.service` 刷新（保存后重载、并发更新、列表轮询）MUST NOT 覆盖用户未提交的编辑，
 * 旧实现无条件 `loadFrom` 等于把"保存"变成一次"整表重置"。判据用 `name`，而非对象引用。
 */
watch(
  () => props.service,
  (next, prev) => {
    if (prev?.name === next.name) return
    loadFrom(next)
  },
  { immediate: true },
)

/**
 * 保存响应里的掩码请求头（父级透传）：就地刷新展示并把三态复位为 `view`。
 *
 * 只在**拿到新值**时动作（`null` = 没有新保存），避免把用户正在填的编辑态冲掉。
 */
watch(
  () => props.headersOverride,
  (next) => {
    if (!next) return
    headersView.value = { ...next }
    headersText.value = ''
    headersClearing.value = false
  },
)

/**
 * 请求头提交片段：**"留空 = 不修改"**（见 `McpHeadersField` 的说明）——点过「清空全部请求头」
 * 发 `{}`（显式清空）；输入框留空则**不带**该字段（服务端沿用存量，保存不会顺手清空令牌）；
 * 填了内容即整体替换，写法非法返回 `error`，调用方 MUST NOT 提交。
 */
function resolveHeadersPatch(): { headers?: Record<string, string>; error?: string } {
  if (headersClearing.value) return { headers: {} }
  if (headersText.value.trim() === '') return {}
  const parsed = parseHeaders(headersText.value)
  if (parsed.error !== undefined) return { error: parsed.error }
  return { headers: parsed.headers }
}

function submit(): boolean {
  localError.value = null

  // 连接目标判据与新建弹窗**共用同一实现**；名称取自服务端且不可改，故不校验
  const invalid = validateMcpBasics({
    transport: transport.value,
    url: url.value,
    command: command.value,
  })
  if (invalid !== null) {
    localError.value = invalid
    return false
  }

  let confirmation: McpConfirmation = 'never'
  if (confirmationMode.value === 'always') {
    confirmation = 'always'
  } else if (confirmationMode.value === 'custom') {
    const raw = manualFallback.value
      ? confirmationManualText.value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
      : confirmationTools.value
    const tools = [...new Set(raw)]
    if (tools.length === 0) {
      localError.value = '按工具确认模式须至少勾选一个工具（清单为空时请在文本框填写工具名）'
      return false
    }
    confirmation = { tools }
  }

  const trimmedUrl = url.value.trim()

  // 查看态**不带该字段**——服务端据此沿用存量（保存调用配置 MUST NOT 顺手清空令牌）
  let headersPatch: Record<string, string> | undefined
  if (transport.value === 'http') {
    const resolved = resolveHeadersPatch()
    if (resolved.error !== undefined) {
      localError.value = resolved.error
      return false
    }
    headersPatch = resolved.headers
  }

  // （"配了个空名字"与"不配"必须区分），界面上的留空即"不配"。
  const toolLabelsPayload = Object.fromEntries(
    Object.entries(toolLabels.value)
      .map(([tool, label]) => [tool, label.trim()])
      .filter(([, label]) => label !== ''),
  )

  const config: McpServiceConfigInput = {
    description: description.value,
    transport: transport.value,
    ...(transport.value === 'http' ? { url: trimmedUrl } : {}),
    ...(transport.value === 'stdio'
      ? {
          command: command.value,
          args: argsText.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== ''),
        }
      : {}),
    ...(headersPatch !== undefined ? { headers: headersPatch } : {}),
    file_args: fileArgs.value,
    confirmation,
    rules_fields: { ...rulesFields.value },
    tool_labels: toolLabelsPayload,
  }
  emit('submit', config)
  return true
}

function probeTarget(): McpProbePayload {
  const payload: McpProbePayload = {
    transport: transport.value,
    ...(transport.value === 'http' ? { url: url.value.trim() } : {}),
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
  if (transport.value === 'http') {
    const patch = resolveHeadersPatch()
    if (patch.headers !== undefined) payload.headers = patch.headers
  }
  return payload
}

const testDialog = ref<{ open: () => void } | null>(null)
const {
  result: testResult,
  busy: testBusy,
  error: testError,
  run: runTest,
} = useMcpConnectionTest({
  serviceName: () => props.service.name,
  target: probeTarget,
  dialog: testDialog,
  beforeTest: () => (transport.value === 'http' ? (resolveHeadersPatch().error ?? null) : null),
  onLocalError: (message) => {
    localError.value = message
  },
  announce: (text) => emit('announce', text),
})

defineExpose({ submit, probeTarget, runTest })
</script>

<template>
  <form class="mcp-config-form" @submit.prevent="submit">
    <label class="field" for="mcp-name">
      <span class="field__label">服务名称</span>
      <input id="mcp-name" v-model="name" type="text" readonly :placeholder="MCP_NAME_HINT" />
      <span class="field__hint">名称即运行环境的工具前缀，不可修改。</span>
    </label>

    <label class="field" for="mcp-description">
      <span class="field__label">用途描述</span>
      <input
        id="mcp-description"
        v-model="description"
        type="text"
        :placeholder="MCP_DESCRIPTION_PLACEHOLDER"
      />
    </label>

    <fieldset class="mcp-config-form__conn">
      <legend class="field__label">连接配置</legend>

      <div class="mcp-config-form__conn-row">
        <label v-if="transport === 'http'" class="field mcp-config-form__conn-main" for="mcp-url">
          <span class="field__label">
            连接地址<span class="field__required" aria-hidden="true">*</span>
          </span>
          <input id="mcp-url" v-model="url" type="text" :placeholder="MCP_URL_HINT" />
          <span class="field__hint">平台按此地址连接该 MCP 服务（含协议与端口）。</span>
        </label>

        <label v-else class="field mcp-config-form__conn-main" for="mcp-command">
          <span class="field__label">
            启动命令<span class="field__required" aria-hidden="true">*</span>
          </span>
          <input id="mcp-command" v-model="command" type="text" placeholder="例如：python" />
          <span class="field__hint">该服务由平台在本机以该命令启动（可选参数见下行）。</span>
        </label>

        <label class="field mcp-config-form__conn-transport" for="mcp-transport">
          <span class="field__label">
            传输方式<span class="field__required" aria-hidden="true">*</span>
          </span>
          <select id="mcp-transport" v-model="transport">
            <option value="http">streamable-http</option>
            <option value="stdio">stdio</option>
          </select>
        </label>
      </div>

      <McpHeadersField
        v-if="transport === 'http'"
        v-model:text="headersText"
        v-model:clearing="headersClearing"
        :headers="headersView"
      />

      <label v-if="transport === 'stdio'" class="field" for="mcp-args">
        <span class="field__label">启动参数（每行一个）</span>
        <textarea id="mcp-args" v-model="argsText" rows="3" />
      </label>

      <div class="mcp-config-form__conn-actions">
        <button
          type="button"
          class="btn btn--success"
          :disabled="testBusy || busy === true"
          @click="runTest"
        >
          {{ testBusy ? '测试中…' : '发起测试' }}
        </button>
        <span class="field__hint">
          按上方<strong>当前值</strong>连接一次（改完可直接测，无需先保存）；请求头留空时按已保存的请求头连接。
        </span>
      </div>
    </fieldset>

    <FileArgsMappingTable v-model="fileArgs" :tools="toolCatalog" />

    <fieldset class="mcp-config-form__endpoints">
      <legend class="field__label">调用人工确认（HITL）</legend>
      <p class="field__hint">
        开启后，用户侧触发被命中的工具调用时会弹出参数确认窗；拒绝后工具不执行，数字人会说明未执行原因。
      </p>
      <HitlConfirmationField
        v-model:mode="confirmationMode"
        v-model:tools="confirmationTools"
        v-model:manual-text="confirmationManualText"
        :catalog="toolCatalog"
        :orphans="orphanTools"
        :manual-fallback="manualFallback"
        :truncated="service.tools_truncated"
      />
    </fieldset>

    <RulesFieldMappingTable
      v-model="rulesFields"
      :tools="toolCatalog"
      :allowed-tools="hitlAllowedTools"
      :disabled="rulesDisabled"
    />

    <fieldset class="mcp-config-form__labels">
      <legend class="field__label">工具显示名</legend>
      <p class="field__hint">
        工具名可另起名说明，方便理解；也可留空采用原始名称。最多 40 字。
      </p>
      <p v-if="toolCatalog.length === 0" class="field__hint">
        工具清单不可得（服务未连接）：保存连接配置、探测成功后即可另起名称。
      </p>
      <div v-for="tool in toolCatalog" :key="tool.name" class="mcp-config-form__label-row">
        <span class="mcp-config-form__label-name mono">{{ tool.name }}</span>
        <input
          v-model="toolLabels[tool.name]"
          type="text"
          maxlength="40"
          :placeholder="tool.label || '留空 = 采用原始名称'"
          :aria-label="`${tool.name} 的显示名`"
          :disabled="busy === true"
        />
      </div>
    </fieldset>

    <p v-if="localError" class="mcp-config-form__error" role="alert">{{ localError }}</p>
  </form>

  <McpTestResultDialog ref="testDialog" :result="testResult" :error="testError" />
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

.mcp-config-form__labels {
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.mcp-config-form__label-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.mcp-config-form__label-name {
  flex: 0 0 220px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.mcp-config-form__label-row input {
  flex: 1;
  min-width: 0;
}

.mcp-config-form__conn {
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.mcp-config-form__conn-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

/* 连接地址（或启动命令）占满剩余宽度；传输方式定宽，避免下拉框被拉成一行 */
.mcp-config-form__conn-main {
  flex: 1;
  min-width: 0;
}

.mcp-config-form__conn-transport {
  flex: 0 0 180px;
}

.mcp-config-form__conn-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>

<script setup lang="ts">
/**
 * MCP 调用配置表单（`FR-044`；2026-09-27 改版）。
 *
 * 关键点：
 * - **连接地址只有一个**（不再按"容器编排内网 / 宿主机本地"分形态声明）；
 * - 只服务**已登记的服务**（新建走 `McpCreateDialog`）：名称取自服务端且不可改；
 * - 基础字段判据与新建弹窗**共用** `utils/mcp-config.ts`（权威判据仍在服务端）。
 *
 * **请求头（2026-10-08）**：UI 与三态语义见 `McpHeadersField`（掩码回显 / 编辑 / 显式清空）；
 * 本组件只持有状态与**提交规则**——查看态不带该字段，即服务端沿用存量。
 */
import { computed, ref, watch } from 'vue'
import type { McpProbePayload } from '../../api/mcp'
import type { McpConfirmation, McpServiceConfigInput, McpServiceDetail } from '../../api/types'
import { useMcpConnectionTest } from '../../composables/useMcpConnectionTest'
import { MCP_DESCRIPTION_PLACEHOLDER, MCP_NAME_HINT, MCP_URL_HINT } from '../../constants/mcp'
import { parseHeaders, validateMcpBasics } from '../../utils/mcp-config'
import AsyncToolsSelector from './AsyncToolsSelector.vue'
import FileArgsMappingTable from './FileArgsMappingTable.vue'
import HitlConfirmationField from './HitlConfirmationField.vue'
import McpHeadersField from './McpHeadersField.vue'
import RulesFieldMappingTable from './RulesFieldMappingTable.vue'
import McpTestResultDialog from './McpTestResultDialog.vue'

const props = defineProps<{
  /** 服务详情（MUST 非空：本表单只在服务已登记时渲染） */
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
/** 文件参数映射（结构化对象；表格组件只是编辑视图，存储契约不变） */
const fileArgs = ref<Record<string, Record<string, string>>>({})
/** 确认策略模式：never 直跑 / always 全部工具 / custom 按工具清单 */
const confirmationMode = ref<'never' | 'always' | 'custom'>('never')
/** custom 模式下勾选的工具名（清单多选 + 清单外遗留项都在这个数组里） */
const confirmationTools = ref<string[]>([])
/** custom 且服务工具清单不可得时的手填文本（每行一个） */
const confirmationManualText = ref('')
/** 算法规则参数设置：`{ 工具名: 字段名 }`（空对象 = 不启用「从算法规则选择」入口） */
const rulesFields = ref<Record<string, string>>({})
/** 异步工具声明（R11）：被声明的工具调用时会收到结果回写地址，产出回写后进下一轮上下文 */
const asyncTools = ref<string[]>([])
const localError = ref<string | null>(null)
/** 请求头输入（留空 = 不修改；UI 见 `McpHeadersField`）——**不预填掩码**，真值不回显 */
const headersText = ref('')
/** 清空意图（显式点「清空全部请求头」；提交时发 `{}`） */
const headersClearing = ref(false)
/** 展示用的**掩码**请求头（来自详情，或最近一次保存响应） */
const headersView = ref<Record<string, string>>({})

/** 服务当前工具清单（来自平台对服务的最近一次探测）；不可得时为空数组 → 走手填回退 */
const toolCatalog = computed(() => props.service.tools)
/** 清单不可得 → 回退手填（服务未启动/探测失败时管理员仍要能改配置） */
const manualFallback = computed(() => toolCatalog.value.length === 0)
/** 已保存、但当前清单里已没有的工具：保留勾选展示（可能是清单截断或服务改版），不静默丢弃 */
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
  asyncTools.value = [...(service.async_tools ?? [])]
  // 请求头：只载入**掩码**；输入框与清空意图复位（切换服务 = 全新一次编辑）
  headersView.value = { ...(service.headers ?? {}) }
  headersText.value = ''
  headersClearing.value = false
  // 载入即按当前 HITL 模式收敛一次（watch 只在模式**变化**时触发）：
  // 存量数据里"无需确认却配了规则参数"属于脏数据，与切换语义保持一致——清掉
  pruneRulesFields()
}

/**
 * 按当前 HITL 模式收敛「算法规则参数设置」（级联口径，2026-09-19）：
 * `never` → 清空（未开 HITL 时本就不生效）；`custom` → 只留勾选清单内的行；`always` → 保留。
 */
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

/**
 * 当前 HITL 确认范围内的工具（算法规则参数设置「工具」下拉的选项源）：
 * never 为空；always 取清单内全部；custom 取勾选项（含清单外遗留项，同一口径）。
 */
const hitlAllowedTools = computed<string[]>(() => {
  if (confirmationMode.value === 'never') return []
  if (confirmationMode.value === 'always') return toolCatalog.value.map((t) => t.name)
  return [...new Set(confirmationTools.value)]
})

/** 无需确认 / 清单不可得：算法规则参数设置不可编辑（未开 HITL 时本就不生效） */
const rulesDisabled = computed(
  () => confirmationMode.value === 'never' || manualFallback.value,
)

/** HITL 模式切换的级联：无需确认→清空；仅指定→丢清单外；全部→保留 */
watch(confirmationMode, pruneRulesFields)

/** 勾选清单变化：仅指定工具模式下，声明里落在清单外的行随之清掉 */
watch(confirmationTools, () => {
  if (confirmationMode.value === 'custom') pruneRulesFields()
})

/**
 * 草稿锚定「服务标识」（契约 §0.5 原则 ①）：**只有切换服务才重填表单**。
 *
 * 同一服务的 `props.service` 刷新（保存后重载、并发更新、列表轮询）MUST NOT
 * 覆盖用户未提交的编辑——旧实现无条件 `loadFrom`，等于把"保存"变成一次
 * "整表重置"。判据用 `name`（服务标识），而非对象引用。
 */
watch(
  () => props.service,
  (next, prev) => {
    // 同一服务的刷新（保存后重载、列表轮询）：不动草稿
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
 * 请求头提交片段：**"留空 = 不修改"**（见 `McpHeadersField` 的说明）。
 *
 * - 点过「清空全部请求头」→ 发 `{}`（显式清空）；
 * - 输入框留空 → **不带**该字段（服务端沿用存量，保存不会顺手清空令牌）；
 * - 填了内容 → 整体替换；写法非法返回 `error`，调用方 MUST NOT 提交。
 */
function resolveHeadersPatch(): { headers?: Record<string, string>; error?: string } {
  if (headersClearing.value) return { headers: {} }
  if (headersText.value.trim() === '') return {}
  const parsed = parseHeaders(headersText.value)
  if (parsed.error !== undefined) return { error: parsed.error }
  return { headers: parsed.headers }
}

function submit(): void {
  localError.value = null

  // 连接目标判据与新建弹窗**共用同一实现**；名称取自服务端且不可改，故不校验
  const invalid = validateMcpBasics({
    transport: transport.value,
    url: url.value,
    command: command.value,
  })
  if (invalid !== null) {
    localError.value = invalid
    return
  }

  // 确认策略：custom 模式须至少勾选一个工具（保存期服务端会再校验形状）
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
      return
    }
    confirmation = { tools }
  }

  const trimmedUrl = url.value.trim()

  // 请求头（2026-10-08）：仅 http 有意义（stdio 由启动参数/环境变量承载，服务端也会丢弃）；
  // 查看态**不带该字段**——服务端据此沿用存量（保存调用配置 MUST NOT 顺手清空令牌）
  let headersPatch: Record<string, string> | undefined
  if (transport.value === 'http') {
    const resolved = resolveHeadersPatch()
    if (resolved.error !== undefined) {
      localError.value = resolved.error
      return
    }
    headersPatch = resolved.headers
  }

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
    async_tools: [...asyncTools.value],
  }
  emit('submit', config)
}

/**
 * 表单当前值（**允许未保存**）："发起测试"据此探测，保证测的是管理员正在编辑的地址，
 * 而不是上一次保存的旧值（实测缺陷，2026-09-15）。
 */
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
  // 请求头：只有填了内容（或点了清空）才带上；留空即不带 = 服务端按**已保存**的请求头连
  // （界面手上只有掩码，不带才不会因"没带令牌"误报 401）；写法非法由 runTest 先拦
  if (transport.value === 'http') {
    const patch = resolveHeadersPatch()
    if (patch.headers !== undefined) payload.headers = patch.headers
  }
  return payload
}

/** 连通性测试（按表单当前值探测，允许未保存）：逻辑见 `useMcpConnectionTest` */
const {
  result: testResult,
  busy: testBusy,
  error: testError,
  dialog: testDialog,
  run: runTest,
} = useMcpConnectionTest({
  serviceName: () => props.service.name,
  target: probeTarget,
  /** 请求头本地校验先行：JSON 写错时指出"哪里写错了"，而不是变成一次 401/连接失败 */
  beforeTest: () =>
    transport.value === 'http' ? (resolveHeadersPatch().error ?? null) : null,
  onLocalError: (message) => {
    localError.value = message
  },
  announce: (text) => emit('announce', text),
})

/**
 * 暴露给详情页：
 * - `submit()`：页头右上角的「保存调用配置」用它——与表单内回车同一路径（含本地校验），避免两套判据；
 * - `runTest()`：创建成功后的"自动测试一次"（`McpArea` → `McpServiceDetail` → 此处）用它，
 *   与「发起测试」按钮同一路径（同一套结果弹窗与播报）；
 * - `probeTarget()`：表单当前连接目标，供外部按需读取。
 */
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

    <!-- 连接配置（2026-10-08 二次改版）：传输方式 / 连接地址 / 请求头**同框**，一行一件事——
         第一行「连接地址（或 stdio 启动命令）+ 传输方式」（必填），第二行「请求头」（可空，留空 = 不修改） -->
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

      <!-- 第二行：请求头（可空；留空 = 不修改）——仅 http 传输有意义 -->
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

      <!-- 测试按框内**当前值**连接（无需先保存）：所以按钮放在这个框里，测的就是上两行 -->
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

    <fieldset class="mcp-config-form__endpoints">
      <legend class="field__label">后台计算（异步工具）</legend>
      <p class="field__hint">
        仅列出在入参 schema 中<strong>声明了 resultUrl</strong> 的工具（判据与平台注入逻辑一致，
        见《异步MCP服务接入约定.md》§2.1）。勾选后：平台在调用时注入结果回写地址，服务算完把结果
        写到该用户的空间，并在<strong>下一轮对话</strong>自动带上「后台计算结果」清单（模型按需读取）。
      </p>
      <!-- 不绑 `busy`：忙态只锁动作按钮，MUST NOT 锁表单控件（契约 §0.5 原则 ③）——
           保存通常在百毫秒级完成，控件级的"禁用→恢复"只会退化成一次无意义的视觉抖动 -->
      <AsyncToolsSelector
        v-model="asyncTools"
        :tools="toolCatalog"
        :tools-error="service.tools_error"
        :tools-truncated="service.tools_truncated"
      />
    </fieldset>

    <!-- 本地校验失败时的可读报错（保存/创建按钮在页面右上角，见 McpServiceDetail） -->
    <p v-if="localError" class="mcp-config-form__error" role="alert">{{ localError }}</p>
  </form>

  <!-- 测试结果弹窗：不在原页面上展示，避免挤占表单版面 -->
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

/* 连接配置框（传输方式 / 连接地址 / 请求头同框，2026-10-08 二次改版） */
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

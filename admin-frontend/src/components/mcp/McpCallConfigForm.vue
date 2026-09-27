<script setup lang="ts">
/**
 * MCP 调用配置表单（`FR-044`；2026-09-27 改版）。
 *
 * 关键点：
 * - **连接地址只有一个**（不再按"容器编排内网 / 宿主机本地"分形态声明）；
 * - 表单同时承担**新建**与**编辑**，差别只有"名称是否可改"；
 * - 服务名会成为运行环境的工具前缀，故新建时按同一判据做前端预校验
 *   （最终判据仍在服务端，这里只为少一次往返）。
 */
import { computed, ref, watch } from 'vue'
import { testMcpService, type McpProbePayload } from '../../api/mcp'
import type {
  ErrorInfo,
  McpConfirmation,
  McpServiceDetail,
  McpServiceSubmitPayload,
  McpTestResult,
} from '../../api/types'
import { MCP_NAME_HINT, MCP_URL_HINT } from '../../constants/mcp'
import AsyncToolsSelector from './AsyncToolsSelector.vue'
import FileArgsMappingTable from './FileArgsMappingTable.vue'
import RulesFieldMappingTable from './RulesFieldMappingTable.vue'
import McpTestResultDialog from './McpTestResultDialog.vue'

const props = defineProps<{
  /** 编辑态的服务详情；新建态为 `null` */
  service: McpServiceDetail | null
  /** 新建态（名称可编辑、服务尚未存在） */
  isNew: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', payload: McpServiceSubmitPayload): void
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

/**
 * 服务当前工具清单（来自平台对服务的最近一次探测）。
 *
 * 新建态（`service === null`）没有清单 → 一律走手填回退。
 */
const toolCatalog = computed(() => props.service?.tools ?? [])
/** 清单不可得 → 回退手填（服务未启动/探测失败时管理员仍要能改配置） */
const manualFallback = computed(() => toolCatalog.value.length === 0)
/** 已保存、但当前清单里已没有的工具：保留勾选展示（可能是清单截断或服务改版），不静默丢弃 */
const orphanTools = computed(() =>
  confirmationTools.value.filter((name) => !toolCatalog.value.some((t) => t.name === name)),
)

function loadFrom(service: McpServiceDetail | null): void {
  if (!service) {
    // 新建态初值
    name.value = ''
    description.value = ''
    transport.value = 'http'
    url.value = ''
    command.value = ''
    argsText.value = ''
    fileArgs.value = {}
    confirmationMode.value = 'never'
    confirmationTools.value = []
    confirmationManualText.value = ''
    rulesFields.value = {}
    asyncTools.value = []
    return
  }
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
  // 载入即按当前 HITL 模式收敛一次（watch 只在模式**变化**时触发）：
  // 存量数据里"无需确认却配了规则参数"属于脏数据，与切换语义保持一致——清空
  if (confirmationMode.value === 'never') {
    rulesFields.value = {}
  } else if (confirmationMode.value === 'custom') {
    const allowed = new Set(confirmationTools.value)
    rulesFields.value = Object.fromEntries(
      Object.entries(rulesFields.value).filter(([tool]) => allowed.has(tool)),
    )
  }
}

/**
 * 当前 HITL 确认范围内的工具（算法规则参数设置「工具」下拉的选项源）：
 * - never：空（表格同时被禁用并清空）；
 * - always：清单内全部工具；
 * - custom：勾选的工具（含清单外遗留项——与确认清单同一口径，不静默丢弃）。
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

/** HITL 模式切换的级联（2026-09-19）：无需确认→清空；仅指定→丢清单外；全部→保留 */
watch(confirmationMode, (mode) => {
  if (mode === 'never') {
    rulesFields.value = {}
  } else if (mode === 'custom') {
    const allowed = new Set(confirmationTools.value)
    rulesFields.value = Object.fromEntries(
      Object.entries(rulesFields.value).filter(([tool]) => allowed.has(tool)),
    )
  }
})

/** 勾选清单变化：仅指定工具模式下，声明里落在清单外的行随之清掉 */
watch(confirmationTools, (tools) => {
  if (confirmationMode.value !== 'custom') return
  const allowed = new Set(tools)
  rulesFields.value = Object.fromEntries(
    Object.entries(rulesFields.value).filter(([tool]) => allowed.has(tool)),
  )
})

/**
 * 草稿锚定「服务标识」（契约 §0.5 原则 ①）：**只有切换服务（或切换到新建态）才重填表单**。
 *
 * 同一服务的 `props.service` 刷新（保存后重载、并发更新、列表轮询）MUST NOT
 * 覆盖用户未提交的编辑——旧实现无条件 `loadFrom`，等于把"保存"变成一次
 * "整表重置"。判据用 `name`（服务标识），而非对象引用。
 */
watch(
  () => [props.service, props.isNew] as const,
  (next, prev) => {
    const [nextService, nextIsNew] = next
    const prevService = prev?.[0] ?? null
    const prevIsNew = prev?.[1] ?? false
    // 同一服务的刷新（保存后重载、列表轮询）：不动草稿
    if (!nextIsNew && nextService !== null && prevService?.name === nextService.name) return
    // 已处于新建态：不重填（否则输入会被清空）
    if (nextIsNew && prevIsNew) return
    loadFrom(nextService)
  },
  { immediate: true },
)

function submit(): void {
  localError.value = null

  const serviceName = name.value.trim()
  if (props.isNew) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(serviceName)) {
      localError.value = `服务名非法：${MCP_NAME_HINT}`
      return
    }
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
  if (transport.value === 'http' && trimmedUrl === '') {
    localError.value = `连接地址必填（${MCP_URL_HINT}）`
    return
  }

  const config: McpServiceSubmitPayload['config'] = {
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
    file_args: fileArgs.value,
    confirmation,
    rules_fields: { ...rulesFields.value },
    async_tools: [...asyncTools.value],
  }
  emit('submit', { name: serviceName, config })
}

/**
 * 表单当前值（**允许未保存**）："发起测试"据此探测，保证测的是管理员正在编辑的地址，
 * 而不是上一次保存的旧值（实测缺陷，2026-09-15）。新建态服务还不存在，故不提供测试。
 */
function probeTarget(): McpProbePayload {
  return {
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
}

/**
 * 暴露给详情页：保存/创建按钮在**页面右上角**（不在表单里），故需 `submit()` 供父组件触发；
 * `submit` 与表单内回车走同一路径（含本地校验），避免两套判据。
 */
defineExpose({ submit, probeTarget })

/** 连通性测试（按表单当前值探测，允许未保存）。结果弹窗见 `McpTestResultDialog`。 */
const testResult = ref<McpTestResult | null>(null)
const testBusy = ref(false)
const testError = ref<ErrorInfo | null>(null)
const testDialog = ref<InstanceType<typeof McpTestResultDialog> | null>(null)

async function runTest(): Promise<void> {
  if (!props.service) return
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
    testDialog.value?.open()
  }
}
</script>

<template>
  <form class="mcp-config-form" @submit.prevent="submit">
    <label class="field" for="mcp-name">
      <span class="field__label">
        服务名称<span v-if="isNew" class="field__required" aria-hidden="true">*</span>
      </span>
      <input
        id="mcp-name"
        v-model="name"
        type="text"
        :readonly="!isNew"
        :placeholder="MCP_NAME_HINT"
      />
      <span v-if="isNew" class="field__hint">{{ MCP_NAME_HINT }}；保存后不可改名。</span>
      <span v-else class="field__hint">名称即运行环境的工具前缀，不可修改。</span>
    </label>

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

    <!-- 连接目标（http=连接地址 / stdio=启动命令）与「发起测试」**同排**：测的就是这一行的值 -->
    <div class="field">
      <label v-if="transport === 'http'" class="field__label" for="mcp-url">
        连接地址<span class="field__required" aria-hidden="true">*</span>
      </label>
      <label v-else class="field__label" for="mcp-command">
        启动命令<span class="field__required" aria-hidden="true">*</span>
      </label>
      <div class="mcp-config-form__target-row">
        <input v-if="transport === 'http'" id="mcp-url" v-model="url" type="text" :placeholder="MCP_URL_HINT" />
        <input v-else id="mcp-command" v-model="command" type="text" placeholder="例如：python" />
        <!-- 新建态服务还不存在，故不提供测试入口 -->
        <button
          v-if="!isNew"
          type="button"
          class="btn btn--success"
          :disabled="testBusy || busy === true"
          @click="runTest"
        >
          {{ testBusy ? '测试中…' : '发起测试' }}
        </button>
      </div>
      <span v-if="transport === 'http'" class="field__hint">
        平台按此地址连接该 MCP 服务（含协议与端口）。改完可直接「发起测试」验证，无需先保存。
      </span>
    </div>

    <label v-if="transport === 'stdio'" class="field" for="mcp-args">
      <span class="field__label">启动参数（每行一个）</span>
      <textarea id="mcp-args" v-model="argsText" rows="3" />
    </label>

    <FileArgsMappingTable v-model="fileArgs" :tools="toolCatalog" />

    <fieldset class="mcp-config-form__endpoints">
      <legend class="field__label">调用人工确认（HITL）</legend>
      <p class="field__hint">
        开启后，用户侧触发被命中的工具调用时会弹出参数确认窗（由工具自身的参数
        Schema 驱动，与具体服务解耦）；拒绝后工具不执行，数字人会说明未执行原因。
      </p>
      <label class="field" for="mcp-confirmation-mode">
        <span class="field__label">确认范围</span>
        <select id="mcp-confirmation-mode" v-model="confirmationMode">
          <option value="never">无需确认（默认，直接执行）</option>
          <option value="always">该服务全部工具都需确认</option>
          <option value="custom">仅指定工具需确认</option>
        </select>
      </label>
      <div v-if="confirmationMode === 'custom'" class="field">
        <span class="field__label">需确认的工具</span>

        <!-- 有工具清单：复选框多选，直接勾选 -->
        <div v-if="!manualFallback" class="mcp-config-form__tools" role="group" aria-label="需确认的工具清单">
          <label v-for="tool in toolCatalog" :key="tool.name" class="mcp-config-form__tool">
            <input v-model="confirmationTools" type="checkbox" :value="tool.name" />
            <span class="mcp-config-form__tool-name mono">{{ tool.name }}</span>
            <span v-if="tool.description" class="mcp-config-form__tool-desc">{{ tool.description }}</span>
          </label>
          <!-- 已保存但当前清单未包含：保留展示，避免静默丢弃存量配置 -->
          <label
            v-for="orphan in orphanTools"
            :key="`orphan:${orphan}`"
            class="mcp-config-form__tool mcp-config-form__tool--orphan"
          >
            <input v-model="confirmationTools" type="checkbox" :value="orphan" />
            <span class="mcp-config-form__tool-name mono">{{ orphan }}</span>
            <span class="mcp-config-form__tool-desc">（已保存，当前服务清单中未包含；可能是清单截断或服务改版）</span>
          </label>
        </div>

        <!-- 清单不可得（服务未启动/探测失败/新建态）：回退手填 -->
        <template v-else>
          <textarea
            id="mcp-confirmation-tools"
            v-model="confirmationManualText"
            rows="3"
            placeholder="工具名不含服务前缀，例如：&#10;query_price&#10;create_order"
          />
        </template>

        <span class="field__hint">
          勾选的工具被调用前会弹出参数确认窗。
          <template v-if="service?.tools_truncated">清单被截断显示，完整清单以服务端为准。</template>
        </span>
      </div>

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
        勾选的工具按**异步**方式调用：平台在调用时注入结果回写地址，服务算完把结果写到该用户的
        空间，并在**下一轮对话**自动带上「后台计算结果」清单（模型按需读取）。
        与「是否需要人工确认」互不影响，两者可同时开启。
      </p>
      <!-- 不绑 `busy`：忙态只锁动作按钮，MUST NOT 锁表单控件（契约 §0.5 原则 ③）——
           保存通常在百毫秒级完成，控件级的"禁用→恢复"只会退化成一次无意义的视觉抖动 -->
      <AsyncToolsSelector v-model="asyncTools" :tools="toolCatalog" />
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

.mcp-config-form__tools {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 260px;
  overflow-y: auto;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.mcp-config-form__tool {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  cursor: pointer;
}

.mcp-config-form__tool-name {
  flex-shrink: 0;
}

.mcp-config-form__tool-desc {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.mcp-config-form__tool--orphan .mcp-config-form__tool-desc {
  color: var(--color-status-warning);
}

.mcp-config-form__target-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.mcp-config-form__target-row input {
  flex: 1;
  min-width: 0;
}

.mcp-config-form__target-row .btn {
  flex-shrink: 0;
}
</style>

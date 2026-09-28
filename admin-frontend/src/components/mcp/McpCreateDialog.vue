<script setup lang="ts">
/**
 * 新建 MCP 服务弹窗（2026-09-27）。
 *
 * 弹窗只收**基础连接信息**（服务名称 / 用途描述 / 传输方式 / 连接地址或启动命令）：
 * 其余调用配置（`file_args` / HITL / `rules_fields` / `async_tools`）依赖**工具清单**，
 * 而清单要服务存在且连得上才拿得到——故留到详情页创建后补全。
 *
 * **为什么自建而不复用 `ConfirmDialog`**：
 * 1. 它的确认按钮**无条件关窗**，做不到"校验失败/重名时不关窗、输入不丢"（`FR-043` 边界场景）；
 * 2. 它的 `aria-labelledby` 是固定 id，与详情页的"删除确认"并存时会重复；
 * 3. 它是"破坏性操作二次确认"（`FR-007`）的专用件，扩成录入表单会污染职责。
 *
 * 可访问性基线同 `ConfirmDialog` / `McpTestResultDialog`：原生 `<dialog>` + `showModal()`
 * （焦点陷阱、Esc、焦点归还由浏览器提供；宪章原则六"能用原生就不引库"）。
 * 创建中（`busy`）**屏蔽关闭**，避免"以为没建成"而重复创建（宪章原则五）。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useMcpServices } from '../../composables/useMcpServices'
import { MCP_DESCRIPTION_PLACEHOLDER, MCP_NAME_HINT, MCP_URL_HINT } from '../../constants/mcp'
import { validateMcpBasics } from '../../utils/mcp-config'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  /** 创建成功：父级据此导航到详情页，并触发一次自动测试 */
  (e: 'created', name: string): void
  (e: 'announce', text: string): void
}>()

/**
 * 本组件自己的实例：`useMcpServices()` 每次调用返回**独立**的 busy/error，
 * 与详情页持有的实例互不干扰。
 */
const m = useMcpServices()

const dialogEl = ref<HTMLDialogElement | null>(null)
const nameEl = ref<HTMLInputElement | null>(null)
/** 关闭后焦点归还的目标（打开时记录） */
let restoreFocusTo: HTMLElement | null = null

const name = ref('')
const description = ref('')
const transport = ref<'http' | 'stdio'>('http')
const url = ref('')
const command = ref('')
const localError = ref<string | null>(null)

/** 每次打开都是全新的一次新建：清空输入与上一次的报错 */
function reset(): void {
  name.value = ''
  description.value = ''
  transport.value = 'http'
  url.value = ''
  command.value = ''
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

/** 创建中禁止关闭（取消按钮、Esc 都走这里） */
function requestClose(): void {
  if (m.busy.value) return
  emit('update:open', false)
}

/** `cancel` 由 Esc 触发：阻止浏览器默认关闭，统一走 `update:open` 流程 */
function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

async function submit(): Promise<void> {
  localError.value = null
  // 基础字段判据与详情页表单**共用同一实现**（`utils/mcp-config.ts`）
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

  const saved = await m.createService({
    name: name.value.trim(),
    description: description.value,
    transport: transport.value,
    ...(transport.value === 'http'
      ? { url: url.value.trim() }
      : { command: command.value.trim() }),
  })
  // 失败（重名 `ADM_MCP_SERVICE_EXISTS` / 校验失败 / 网络）：错误由 ErrorNotice 呈现，
  // **弹窗不关、输入不丢**——关掉会让管理员重填一遍
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
    <form method="dialog" class="mcp-create-dialog__body" @submit.prevent="submit">
      <h2 id="mcp-create-title" class="mcp-create-dialog__title">新建 MCP 服务</h2>
      <p class="mcp-create-dialog__intro">
        先登记基础连接信息。工具清单、人工确认与后台计算等调用配置，创建后到详情页补全
        （工具清单需连上服务才能获取）。
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

      <label class="field" for="mcp-create-transport">
        <span class="field__label">传输方式</span>
        <select id="mcp-create-transport" v-model="transport">
          <option value="http">streamable-http</option>
          <option value="stdio">stdio</option>
        </select>
      </label>

      <label v-if="transport === 'http'" class="field" for="mcp-create-url">
        <span class="field__label">
          连接地址<span class="field__required" aria-hidden="true">*</span>
        </span>
        <input id="mcp-create-url" v-model="url" type="text" :placeholder="MCP_URL_HINT" />
        <span class="field__hint">平台按此地址连接该 MCP 服务（含协议与端口）。</span>
      </label>

      <label v-else class="field" for="mcp-create-command">
        <span class="field__label">
          启动命令<span class="field__required" aria-hidden="true">*</span>
        </span>
        <input id="mcp-create-command" v-model="command" type="text" placeholder="例如：python" />
        <span class="field__hint">启动参数留到详情页填写。</span>
      </label>

      <p v-if="localError" class="mcp-create-dialog__error" role="alert">{{ localError }}</p>
      <ErrorNotice :error="m.error.value" title="创建未完成" />

      <div class="mcp-create-dialog__actions">
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
          type="button"
          class="btn btn--primary"
          data-test="confirm"
          :disabled="m.busy.value"
          @click="submit"
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

.mcp-create-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>

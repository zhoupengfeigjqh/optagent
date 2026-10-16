<script setup lang="ts">
/**
 * 「新建数字人」弹窗（`FR-015`，2026-10-09）。
 *
 * 弹窗只采集两件事：
 * 1. **数字人名称**（必填）——本地即校验合法性，并**拒绝**与既有数字人重名；
 * 2. **可选的「复制已有数字人」来源**——选定则以其五类配置为模板，未选定则全部重建。
 *
 * 确认后**不落盘**，只把结果交给父级带入设计明细。原因：`POST /api/admin/agents`
 * 要求 SOUL 非空（`FR-019`）且场景名非空（`FR-020`），此刻还不具备，因此只能
 * "带着初值进入设计器"，由设计器保存时才真正创建——这一点与「新建 MCP 服务」弹窗
 * （弹窗内即可创建落库）不同。
 *
 * **为什么自建而不复用 `ConfirmDialog`**：理由同 `McpCreateDialog`（`FR-043`）——
 * 它的确认按钮**无条件关窗**，做不到"重名/非法时不关窗、输入不丢"，且它是
 * 破坏性操作二次确认（`FR-007`）的专用件，扩成录入表单会污染职责。
 *
 * 可访问性基线同 `ConfirmDialog` / `McpCreateDialog`：原生 `<dialog>` + `showModal()`
 * （焦点陷阱、Esc、焦点归还由浏览器提供；宪章原则六"能用原生就不引库"）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { listAgents } from '../../api/agents'
import type { AgentListItem } from '../../api/types'
import { AGENT_NAME_HINT, AGENT_NAME_MAX_LENGTH } from '../../constants/agent-design'
import { toErrorInfo } from '../../utils/error-message'
import { validateNewAgentName } from '../../utils/agent-name'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  /** 确认：父级据此预填新建草稿并导航到设计明细 */
  (e: 'confirm', value: { name: string; copyFrom: string | null }): void
}>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const nameEl = ref<HTMLInputElement | null>(null)
/** 关闭后焦点归还的目标（打开时记录） */
let restoreFocusTo: HTMLElement | null = null

const name = ref('')
/** 复制源；空串 = 不复制（与 `<select>` 的占位项一致） */
const copyFrom = ref('')
const localError = ref<string | null>(null)

/** 既有数字人：既作复制源候选，也作**重名判据**的数据来源 */
const existing = ref<AgentListItem[]>([])
const listError = ref<string | null>(null)
const loadingSources = ref(false)

/** 当前选中的复制源（用于异常态警示） */
const selected = computed(() => existing.value.find((item) => item.name === copyFrom.value) ?? null)
const selectedAbnormal = computed(() => selected.value?.abnormal === true)

/**
 * 读取**全部**数字人。
 *
 * `GET /api/admin/agents` 每页固定 8 条且**不接受 `page_size`**（服务端的设计决定），
 * 所以这里按 `total_pages` 并发取齐：复制源候选与重名判据都 MUST 基于全量，
 * 只看第一页会漏判重名，变成"弹窗说没重名、保存却被拒"。
 */
async function loadExisting(): Promise<void> {
  loadingSources.value = true
  listError.value = null
  existing.value = []
  try {
    const first = await listAgents(1)
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, first.total_pages - 1) }, (_, index) =>
        listAgents(index + 2),
      ),
    )
    existing.value = [...first.items, ...rest.flatMap((page) => page.items)]
  } catch (err) {
    // 读不到清单**不阻断**新建，但 MUST NOT 假装"没有重名"（原则九）：
    // 本地重名判定随之关闭，并如实告知改由服务端在保存时拒绝。
    listError.value = `未能读取已有数字人清单（${toErrorInfo(err).code}）：复制源不可选，重名改由服务端在保存时拒绝。`
  } finally {
    loadingSources.value = false
  }
}

/** 每次打开都是全新的一次新建：清空输入、报错与上次拉到的清单 */
function reset(): void {
  name.value = ''
  copyFrom.value = ''
  localError.value = null
  existing.value = []
  listError.value = null
  loadingSources.value = false
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

function requestClose(): void {
  emit('update:open', false)
}

/** `cancel` 事件由 Esc 触发：阻止浏览器默认关闭，统一走 `update:open` 流程 */
function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

/**
 * 确认：校验通过才放行。
 *
 * 重名与非法名**留在此处解决**（`FR-015` 要求"被拒绝并说明原因"）：
 * 校验不通过即停在弹窗内并给出可读原因，不关窗、不丢输入。
 */
function confirm(): void {
  localError.value = null
  // 清单读不到时不做本地重名判定：宁可让服务端在保存时拒绝，
  // 也不要给出"没重名"的假阴性（本地判据只是提前暴露，不是权威判据）
  const taken = listError.value === null ? existing.value.map((item) => item.name) : []
  const invalid = validateNewAgentName(name.value, taken)
  if (invalid !== null) {
    localError.value = invalid
    return
  }
  emit('confirm', {
    name: name.value.trim(),
    copyFrom: copyFrom.value === '' ? null : copyFrom.value,
  })
  emit('update:open', false)
}

watch(
  () => props.open,
  async (isOpen) => {
    await nextTick()
    if (!isOpen) {
      closeDialog()
      return
    }
    reset()
    openDialog()
    // 清单只在打开时拉一次；拉取中也能先填名称，确认时会等校验时机自然串上
    await loadExisting()
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
    class="create-agent-dialog"
    aria-labelledby="create-agent-title"
    data-test="create-agent-dialog"
    @cancel="onCancel"
  >
    <form method="dialog" class="create-agent-dialog__body" @submit.prevent="() => undefined">
      <h2 id="create-agent-title" class="create-agent-dialog__title">新建数字人</h2>
      <p class="create-agent-dialog__intro">
        先确定数字人名称。也可以选择一个既有数字人作为<strong>模板</strong>——
        它的五类配置会被复制过来，进入设计明细后按需修改。
      </p>

      <label class="field" for="create-agent-name">
        <span class="field__label">
          数字人名称<span class="field__required" aria-hidden="true">*</span>
        </span>
        <input
          id="create-agent-name"
          ref="nameEl"
          v-model="name"
          type="text"
          :maxlength="AGENT_NAME_MAX_LENGTH"
          placeholder="例如：生产计划助手"
          data-test="create-agent-name"
        />
        <span class="field__hint">{{ AGENT_NAME_HINT }}；名称在创建后不可修改。</span>
      </label>

      <label class="field" for="create-agent-copy-from">
        <span class="field__label">复制已有数字人的内容</span>
        <select
          id="create-agent-copy-from"
          v-model="copyFrom"
          data-test="create-agent-copy-from"
          :disabled="loadingSources || listError !== null"
        >
          <option value="">{{ loadingSources ? '读取中…' : '（不复制，全部新建）' }}</option>
          <option v-for="item in existing" :key="item.name" :value="item.name">
            {{ item.name }}{{ item.abnormal ? '（引用已失效）' : '' }}
          </option>
        </select>
        <span class="field__hint">
          选定后，该数字人的 SOUL、内置工具、MCP 服务、SKILL 与文件空间场景都会复制过来，
          名称使用上面填写的新名称。
        </span>
      </label>

      <!-- 复制异常数字人是允许的（便于"以坏为模板修"），但必须提前讲明后果 -->
      <p v-if="selectedAbnormal" class="create-agent-dialog__warn" role="alert">
        该数字人的部分引用已失效：{{ selected?.abnormal_reason }}。 复制后需先修正这些引用才能保存。
      </p>

      <p v-if="listError" class="create-agent-dialog__warn" role="alert">{{ listError }}</p>

      <p
        v-if="localError"
        class="create-agent-dialog__error"
        role="alert"
        data-test="create-agent-error"
      >
        {{ localError }}
      </p>

      <div class="create-agent-dialog__actions">
        <button type="button" class="btn" data-test="cancel" @click="requestClose">取消</button>
        <button type="button" class="btn btn--primary" data-test="confirm" @click="confirm">
          确认并进入设计
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.create-agent-dialog {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 560px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.create-agent-dialog::backdrop {
  background: var(--color-overlay);
}

.create-agent-dialog__body {
  padding: var(--space-5);
}

.create-agent-dialog__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.create-agent-dialog__intro {
  margin: var(--space-2) 0 var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.create-agent-dialog__warn {
  margin: var(--space-3) 0 0;
  color: var(--color-status-warning, #8a5a00);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.create-agent-dialog__error {
  margin: var(--space-3) 0 0;
  color: var(--color-status-error);
}

.create-agent-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>

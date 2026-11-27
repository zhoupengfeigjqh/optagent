<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useMcpServices } from '../../composables/useMcpServices'
import type { McpServiceDetail } from '../../api/types'
import { buildToolScopePayload } from '../../utils/mcp-config'
import ErrorNotice from '../common/ErrorNotice.vue'
import McpToolPicker from './McpToolPicker.vue'

const props = defineProps<{
  open: boolean
  service: McpServiceDetail
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  /** 保存成功：父级据此**原地**更新白名单与 `revision`（不重载详情，避免再探一次、丢草稿） */
  (e: 'saved', result: { allowed_tools: string[]; revision: number; affected: string[] }): void
  (e: 'announce', text: string): void
}>()

const m = useMcpServices()

const dialogEl = ref<HTMLDialogElement | null>(null)
const selected = ref<string[]>([])
const localError = ref<string | null>(null)
let restoreFocusTo: HTMLElement | null = null

const catalog = computed(() => props.service.available_tools)
const missing = computed(() =>
  props.service.allowed_tools.filter(
    (toolName) => !catalog.value.some((tool) => tool.name === toolName),
  ),
)

function preSelected(): string[] {
  const names = new Set(catalog.value.map((tool) => tool.name))
  return props.service.allowed_tools.filter((toolName) => names.has(toolName))
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
  void nextTick(() => el.querySelector<HTMLInputElement>('[data-test="tool"]')?.focus())
}

function closeDialog(): void {
  const el = dialogEl.value
  if (el) {
    // **顺序不能反：先 `close()`，再兜底清 `open`**（2026-10-16 修复）。
    // 弹窗因失去 `open` 而不可见，却**仍留在 top layer 的模态态**——页面其余部分
    if (typeof el.close === 'function' && el.open) el.close()
    // 兜底：降级路径（无 `showModal()`，走的是 `setAttribute('open')`）与部分 jsdom
    // 版本里 `close()` 并不清该属性——`open` 必须清掉，否则元素会一直"开着"。
    el.removeAttribute('open')
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

async function submit(): Promise<void> {
  localError.value = null
  if (selected.value.length === 0) {
    localError.value =
      '请至少勾选一个工具：空范围在平台语义里等于「不限制」，数字人反而会看到该服务的全部工具'
    return
  }

  const result = await m.saveConfig(
    props.service.name,
    buildToolScopePayload(props.service, selected.value),
    props.service.revision,
  )
  // 失败（并发冲突 / 网络 / 校验）：错误由 ErrorNotice 呈现，**弹窗不关、勾选不丢**
  if (result === null) return

  emit(
    'announce',
    result.affected.length > 0
      ? `工具范围已保存；${result.affected.length} 个引用该服务的数字人将在下次部署时生效`
      : '工具范围已保存',
  )
  emit('saved', {
    allowed_tools: [...selected.value],
    revision: result.revision,
    affected: result.affected,
  })
  emit('update:open', false)
}

watch(
  () => props.open,
  async (isOpen) => {
    await nextTick()
    if (isOpen) {
      selected.value = preSelected()
      localError.value = null
      m.error.value = null
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
    class="mcp-tool-scope"
    aria-labelledby="mcp-tool-scope-title"
    @cancel="onCancel"
  >
    <form method="dialog" class="mcp-tool-scope__body" @submit.prevent="() => undefined">
      <h2 id="mcp-tool-scope-title" class="mcp-tool-scope__title">
        调整「{{ props.service.name }}」的工具范围
      </h2>
      <p class="mcp-tool-scope__intro">
        下列是<strong>本次探测</strong>到的全部工具（已按当前范围预勾选）。
        <strong>取消勾选即对数字人不可见</strong>；保存后需<strong>重新部署</strong>引用该服务的
        数字人才生效，未勾选与已勾选的差别不会立刻反映到运行环境。
      </p>

      <p v-if="missing.length > 0" class="mcp-tool-scope__missing" role="alert" data-test="missing">
        ⚠ 当前范围里有 {{ missing.length }} 个工具在本次探测中已不存在（下架或改名），
        它们无法勾选，保存后将从范围中移除：<span class="mono">{{ missing.join('、') }}</span>
      </p>

      <p v-if="catalog.length === 0" class="mcp-tool-scope__hint" data-test="empty-catalog">
        本次探测没有取到任何工具，无法在此调整范围——请先确认该服务确实暴露了工具。
      </p>
      <McpToolPicker
        v-else
        v-model:selected="selected"
        :tools="catalog"
        :truncated="props.service.available_tools_truncated"
      />

      <p v-if="props.service.tools_error" class="mcp-tool-scope__hint" role="status">
        上一次读取工具清单失败：{{ props.service.tools_error }}
      </p>

      <p v-if="localError" class="mcp-tool-scope__error" role="alert" data-test="local-error">
        {{ localError }}
      </p>
      <ErrorNotice :error="m.error.value" title="保存未完成" />

      <div class="mcp-tool-scope__actions">
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
          data-test="save"
          :disabled="m.busy.value || catalog.length === 0"
          @click="submit"
        >
          {{ m.busy.value ? '保存中…' : '保存工具范围' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.mcp-tool-scope {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 640px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.mcp-tool-scope::backdrop {
  background: var(--color-overlay);
}

.mcp-tool-scope__body {
  padding: var(--space-5);
}

.mcp-tool-scope__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.mcp-tool-scope__intro {
  margin: var(--space-2) 0 var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: var(--line-height-base);
}

.mcp-tool-scope__missing {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-status-warning);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.mcp-tool-scope__hint {
  margin: var(--space-2) 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.mcp-tool-scope__error {
  margin: var(--space-3) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.mcp-tool-scope__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>

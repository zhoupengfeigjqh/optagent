<script setup lang="ts">
/**
 * MCP 连通性测试结果弹窗（从 `McpCallConfigForm` 拆出，2026-09-19）。
 *
 * 原生 `<dialog>` + `showModal()`（与 `ConfirmDialog` 同一套可访问性基线：
 * Esc 关闭、焦点归还）。探测逻辑（调 API、announce）留在父组件，
 * 本组件只负责呈现与开关；父组件在拿到结果后调用暴露的 `open()`。
 */
import { ref } from 'vue'
import type { ErrorInfo, McpTestResult } from '../../api/types'
import ErrorNotice from '../common/ErrorNotice.vue'
import StatusBadge from '../common/StatusBadge.vue'

defineProps<{
  result: McpTestResult | null
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const dialogEl = ref<HTMLDialogElement | null>(null)
let restoreFocusTo: HTMLElement | null = null

/** jsdom 早期版本没有 showModal：降级为设置 open 属性，保证行为可测 */
function open(): void {
  const el = dialogEl.value
  if (!el) return
  restoreFocusTo = (document.activeElement as HTMLElement | null) ?? null
  if (typeof el.showModal === 'function') {
    if (!el.open) el.showModal()
  } else {
    el.setAttribute('open', '')
  }
}

function close(): void {
  const el = dialogEl.value
  if (el) {
    if (typeof el.close === 'function' && el.open) el.close()
    else el.removeAttribute('open')
  }
  restoreFocusTo?.focus?.()
  restoreFocusTo = null
  emit('close')
}

/** Esc 触发：阻止浏览器默认关闭，统一走焦点归还流程 */
function onCancel(event: Event): void {
  event.preventDefault()
  close()
}

defineExpose({ open })
</script>

<template>
  <dialog
    ref="dialogEl"
    class="mcp-test-dialog"
    aria-labelledby="mcp-test-dialog-title"
    @cancel="onCancel"
  >
    <div class="mcp-test-dialog__body">
      <h2 id="mcp-test-dialog-title" class="mcp-test-dialog__title">连通性测试结果</h2>

      <ErrorNotice :error="error" title="测试请求失败" />

      <div v-if="result" class="mcp-test-dialog__result">
        <p class="mcp-test-dialog__summary">
          <StatusBadge
            :status="result.ok ? 'ok' : 'failed'"
            :label="result.ok ? '测试通过' : '测试未通过'"
          />
          <span class="muted">检查时间 {{ result.checked_at }}</span>
        </p>

        <p v-if="result.target" class="mcp-test-dialog__target">
          实际测试：<code class="mono">{{
            result.target.transport === 'http' ? 'streamable-http' : 'stdio'
          }} → {{ result.target.url ?? result.target.command ?? '（未填写地址）' }}</code>
        </p>

        <dl class="mcp-test-dialog__steps">
          <dt>连通性</dt>
          <dd>
            <StatusBadge :status="result.connectivity.ok ? 'ok' : 'failed'" />
            耗时 {{ result.connectivity.duration_ms }}ms
            <span v-if="!result.connectivity.ok" class="mcp-test-dialog__reason">
              {{ result.connectivity.error_code }}：{{ result.connectivity.message }}
            </span>
          </dd>

          <dt>能力验证（{{ result.capability.method }}）</dt>
          <dd>
            <StatusBadge :status="result.capability.ok ? 'ok' : 'failed'" />
            耗时 {{ result.capability.duration_ms }}ms
            <span v-if="!result.capability.ok" class="mcp-test-dialog__reason">
              {{ result.capability.error_code }}：{{ result.capability.message }}
            </span>
          </dd>
        </dl>
      </div>

      <div class="mcp-test-dialog__actions">
        <button type="button" class="btn btn--primary" data-test="close-test" @click="close">
          关闭
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
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

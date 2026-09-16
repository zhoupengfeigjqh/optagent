<script setup lang="ts">
/**
 * MCP 服务日志查看（`FR-048`）。
 *
 * 按时间倒序、**有界返回**——日志量大时页面 MUST 仍快速返回，
 * 因此这里固定请求一个较小的窗口，而不是"先取全量再截断"。
 */
import { onMounted, ref } from 'vue'
import { fetchMcpLogs } from '../../api/mcp'
import type { ErrorInfo, McpLogLine } from '../../api/types'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  serviceName: string
}>()

const items = ref<McpLogLine[]>([])
const truncated = ref(false)
const loading = ref(false)
const error = ref<ErrorInfo | null>(null)
/** 默认 50 条：运维查看日志以"看最近一段"为主，需要更多时再选 200/500 */
const limit = ref(50)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await fetchMcpLogs(props.serviceName, limit.value)
    items.value = res.items
    truncated.value = res.truncated
  } catch (err) {
    error.value = err as ErrorInfo
    items.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="mcp-log-viewer" aria-label="服务运行日志">
    <div class="mcp-log-viewer__header">
      <label class="mcp-log-viewer__limit">
        <span class="field__label">显示条数</span>
        <select v-model.number="limit" @change="load">
          <option :value="50">50</option>
          <option :value="200">200</option>
          <option :value="500">500（上限）</option>
        </select>
      </label>
      <button type="button" class="btn" :disabled="loading" @click="load">
        {{ loading ? '加载中…' : '刷新' }}
      </button>
    </div>

    <ErrorNotice :error="error" title="日志读取失败" />

    <p v-if="!error && items.length === 0 && !loading" class="muted">没有日志输出。</p>

    <ol v-else class="mcp-log-viewer__items" aria-live="polite">
      <li v-for="(line, index) in items" :key="index">
        <span class="mono mcp-log-viewer__ts">{{ line.ts ?? '（无时间戳）' }}</span>
        <span class="mono mcp-log-viewer__line">{{ line.line }}</span>
      </li>
    </ol>

    <p v-if="truncated" class="field__hint">仅显示最近 {{ limit }} 行（服务端有界返回）。</p>
  </section>
</template>

<style scoped>
.mcp-log-viewer__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.mcp-log-viewer__limit select {
  width: auto;
  min-width: 120px;
}

.mcp-log-viewer__items {
  margin: 0;
  padding: var(--space-2);
  list-style: none;
  max-height: 420px;
  overflow: auto;
  background: var(--color-bg-muted);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.mcp-log-viewer__ts {
  color: var(--color-text-muted);
  margin-right: var(--space-2);
}
</style>

<script setup lang="ts">
/**
 * 工具调用卡片列表（002 特性）
 *
 * 一个组件同时服务两种场景（TR-10）：
 * - **历史态**：`Message.tool_calls` 下发元数据；内联小结果展开即见，
 *   外置大结果展开时才拉 `/tool-calls/{call_id}`
 * - **流式态**：SSE 只给名称与状态，结果尚未产生（也不外显结果）
 *
 * 降级（TR-16）：外置正文已被临时空间清理时接口返回 410，卡片显示
 * "内容已被清理"而**不是**错误态——元数据仍然完整。
 */
import { reactive } from 'vue'

import type { ToolCallResult } from '../../api/types'
import {
  TOOL_STATUS_LABEL,
  formatArgsDigest,
  formatBytes,
  formatDuration,
  type ToolCallItem,
} from '../../utils/tool-calls'

const props = withDefaults(
  defineProps<{
    items: ToolCallItem[]
    /**
     * 外置正文加载器（历史态注入）。缺省 = 不发起请求，只展示摘要与体积。
     * 抛出的错误若 `code === 'TOOL_RESULT_EXPIRED'` 视为"内容已清理"而非失败。
     */
    loadResult?: ((callId: string) => Promise<ToolCallResult>) | undefined
  }>(),
  { loadResult: undefined },
)

interface PanelState {
  open: boolean
  loading: boolean
  /** 懒加载到的正文（`null` = 尚未加载） */
  content: string | null
  expired: boolean
  error: string | null
}

const panels = reactive<Record<string, PanelState>>({})

/**
 * 取（必要时创建）某张卡片的展开态。
 *
 * 必须**返回 reactive 代理**而不是刚 new 出来的原始对象——否则后续的
 * `panel.loading = false` 不触发视图更新，卡片会永远停在"加载中"。
 */
function panelOf(callId: string): PanelState {
  if (!panels[callId]) {
    panels[callId] = { open: false, loading: false, content: null, expired: false, error: null }
  }
  return panels[callId]!
}

/** 展开/收起；首次展开且结果为外置时懒加载正文。 */
async function onToggle(item: ToolCallItem): Promise<void> {
  const panel = panelOf(item.callId)
  if (panel.open) {
    panel.open = false
    return
  }
  panel.open = true
  const alreadyLoaded = panel.content !== null || panel.expired || panel.error !== null
  if (item.content !== undefined || item.artifactSize === undefined || alreadyLoaded) {
    return
  }
  if (!props.loadResult) return

  panel.loading = true
  try {
    const result = await props.loadResult(item.callId)
    panel.content = result.content
  } catch (cause) {
    if (isExpired(cause)) panel.expired = true
    else panel.error = '内容加载失败，请稍后重试'
  } finally {
    panel.loading = false
  }
}

/** 展开后展示的正文：懒加载结果优先，其次内联正文。 */
function displayContent(item: ToolCallItem): string {
  const loaded = panels[item.callId]?.content
  if (loaded !== null && loaded !== undefined) return loaded
  return item.content ?? ''
}

function isExpired(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === 'TOOL_RESULT_EXPIRED'
}
</script>

<template>
  <div v-if="items.length" class="tool-calls">
    <p class="tool-calls__head">本轮调用 {{ items.length }} 个工具</p>

    <div v-for="item in items" :key="item.callId" class="tool-call">
      <button
        type="button"
        class="tool-call__head"
        :aria-expanded="panels[item.callId]?.open === true"
        @click="onToggle(item)"
      >
        <span class="tool-call__name">{{ item.name }}</span>
        <span class="tool-call__status" :class="`tool-call__status--${item.status}`">
          {{ TOOL_STATUS_LABEL[item.status] }}
        </span>
        <span v-if="item.durationMs !== undefined" class="tool-call__meta">
          {{ formatDuration(item.durationMs) }}
        </span>
        <span v-if="item.size !== undefined" class="tool-call__meta">
          {{ formatBytes(item.size) }}
        </span>
        <span class="tool-call__toggle">
          {{ panels[item.callId]?.open ? '收起' : '展开' }}
        </span>
      </button>

      <div v-if="panels[item.callId]?.open" class="tool-call__body">
        <p v-if="item.summary" class="tool-call__summary">{{ item.summary }}</p>
        <p v-if="item.argsDigest" class="tool-call__args">
          入参：{{ formatArgsDigest(item.argsDigest) }}
        </p>

        <p v-if="panels[item.callId]?.loading" class="tool-call__hint">加载中…</p>
        <p v-else-if="panels[item.callId]?.expired" class="tool-call__hint">
          内容已被临时空间清理（原 {{ formatBytes(item.artifactSize ?? 0) }}）
        </p>
        <p v-else-if="panels[item.callId]?.error" class="tool-call__hint tool-call__hint--error">
          {{ panels[item.callId]?.error }}
        </p>
        <pre v-else-if="displayContent(item)" class="tool-call__content">{{
          displayContent(item)
        }}</pre>
        <p v-else class="tool-call__hint">
          {{ item.status === 'running' ? '进行中，暂无结果' : '无结果内容' }}
        </p>

        <p v-if="item.truncated" class="tool-call__hint">
          结果过大，仅保留了前一部分
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-calls {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tool-calls__head {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.tool-call {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  overflow: hidden;
}

.tool-call__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}

.tool-call__head:hover {
  background: var(--color-surface);
}

.tool-call__name {
  font-weight: 600;
}

.tool-call__status {
  color: var(--color-text-muted);
}

.tool-call__status--success {
  color: var(--color-status-success);
}

.tool-call__status--error {
  color: var(--color-status-error);
}

.tool-call__meta {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.tool-call__toggle {
  margin-left: auto;
  color: var(--color-primary);
  font-size: var(--font-size-xs);
}

.tool-call__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-top: 1px solid var(--color-border);
}

.tool-call__summary,
.tool-call__args,
.tool-call__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.tool-call__hint--error {
  color: var(--color-status-error);
}

.tool-call__content {
  max-height: 320px;
  margin: 0;
  padding: var(--space-2);
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-xs);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>

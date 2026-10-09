<script setup lang="ts">
/**
 * 工具调用卡片列表（002 特性）
 *
 * 一个组件同时服务两种场景（TR-10）：
 * - **历史态**：`Message.tool_calls` 下发元数据；内联小结果展开即见，
 *   外置大结果展开时才拉 `/tool-calls/{call_id}`
 * - **流式态**：SSE 只给名称与状态，结果尚未产生（也不外显结果）
 *
 * 展示分两层（2026-10-08 改版，spec §4.6 / TR-32~TR-36）：
 * - **计数行**（常显）：`本轮 N 次调用 · 报错 M 次`——报错数**不藏在展开后**
 * - **摘要行**（≥2 次调用时）：最新一次调用 + 明细开关，**整行一个按钮**
 * - **明细区**（展开后）：本轮全部调用、时间正序；每条仍可展开自己的结果
 *
 * 降级（TR-16）：外置正文已被临时空间清理时接口返回 410，卡片显示
 * "内容已被清理"而**不是**错误态——元数据仍然完整。
 */
import { computed, useId } from 'vue'

import type { ToolCallResult } from '../../api/types'
import { useToolPanels, type ToolPanelState } from '../../composables/useToolPanels'
import {
  formatArgsDigest,
  formatBytes,
  formatDuration,
  isToolCallFinished,
  summarizeToolCalls,
  toolGroupKey,
  toolStatusLabel,
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
    /**
     * 本轮是否**仍在流式进行中**（TR-33）：只决定 `running` 的文案是"进行中"还是"未完成"。
     * 由 `MessageBubble` 从 `streaming.phase` 显式传入——MUST NOT 用"能否懒加载"之类的间接信号推断。
     */
    live?: boolean
  }>(),
  { loadResult: undefined, live: false },
)

const panels = useToolPanels()

/** 明细区 / 结果体的 DOM id：同一页面挂着多个实例（每条消息一个），用 `useId()` 保证唯一 */
const uid = useId()
const detailsId = `${uid}-details`
const bodyId = (index: number): string => `${uid}-body-${index}`

const stats = computed(() => summarizeToolCalls(props.items))
/** 最新一次调用（摘要行的展示对象） */
const latest = computed<ToolCallItem | null>(() => props.items[props.items.length - 1] ?? null)
/** ≥2 次调用才有"被折叠掉的明细"；只有 1 次时该卡片即全部（TR-35） */
const foldable = computed(() => props.items.length > 1)
const groupKey = computed(() => toolGroupKey(props.items))
const detailsOpen = computed(() => foldable.value && panels.isDetailsOpen(groupKey.value))
/** 明细区是否渲染：≥2 次时看展开态；只有 1 次时恒渲染（无折叠层，保持"一次点击看结果"） */
const detailsVisible = computed(() => !foldable.value || detailsOpen.value)

function toggleDetails(): void {
  panels.setDetailsOpen(groupKey.value, !detailsOpen.value)
}

/** 可展开 = 已有终态（TR-33）；规则来自 `utils`，组件不自己重写判断 */
function canExpand(item: ToolCallItem): boolean {
  return isToolCallFinished(item.status)
}

function statusLabel(item: ToolCallItem): string {
  return toolStatusLabel(item.status, props.live)
}

function panelOf(item: ToolCallItem): ToolPanelState {
  return panels.panelOf(item.callId)
}

/** 展开/收起；首次展开且结果为外置时懒加载正文。运行中没有结果可看，直接不响应（TR-33）。 */
async function onToggle(item: ToolCallItem): Promise<void> {
  if (!canExpand(item)) return
  const panel = panelOf(item)
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
  const loaded = panelOf(item).content
  if (loaded !== null && loaded !== undefined) return loaded
  return item.content ?? ''
}

function isExpired(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === 'TOOL_RESULT_EXPIRED'
}
</script>

<template>
  <div v-if="items.length" class="tool-calls">
    <!-- 计数行（常显）：报错数 MUST 在折叠态可见——失败绝不能被折叠隐藏（TR-32） -->
    <p class="tool-calls__head" data-test="tool-counts">
      本轮 {{ stats.total }} 次调用 · 报错 {{ stats.errors }} 次
    </p>

    <!-- 摘要行（≥2 次调用时）：最新一次调用 + 明细开关，**整行一个按钮**（TR-34）。
         只有 1 次调用时不渲染它：没有"被折叠的内容"，多一层点击是纯负担（TR-35） -->
    <button
      v-if="foldable && latest"
      type="button"
      class="tool-calls__summary"
      :aria-expanded="detailsOpen"
      :aria-controls="detailsId"
      data-test="tool-summary"
      @click="toggleDetails"
    >
      <span class="tool-calls__latest">最新</span>
      <span class="tool-call__name">{{ latest.name }}</span>
      <span class="tool-call__status" :class="`tool-call__status--${latest.status}`">
        {{ statusLabel(latest) }}
      </span>
      <span v-if="latest.durationMs !== undefined" class="tool-call__meta">
        {{ formatDuration(latest.durationMs) }}
      </span>
      <span class="tool-call__toggle">{{ detailsOpen ? '收起明细' : '查看明细' }}</span>
    </button>

    <!-- 明细区：本轮全部调用（时间正序，最早在上）。它是摘要行的**兄弟节点**——
         摘要行是按钮，而按钮内不能再嵌交互元素（TR-34） -->
    <div v-if="detailsVisible" :id="detailsId" class="tool-calls__details" data-test="tool-details">
      <div v-for="(item, index) in items" :key="item.callId" class="tool-call">
        <button
          type="button"
          class="tool-call__head"
          :disabled="!canExpand(item)"
          :aria-expanded="canExpand(item) ? panelOf(item).open : undefined"
          :aria-controls="canExpand(item) ? bodyId(index) : undefined"
          @click="onToggle(item)"
        >
          <span class="tool-call__name">{{ item.name }}</span>
          <span class="tool-call__status" :class="`tool-call__status--${item.status}`">
            {{ statusLabel(item) }}
          </span>
          <span v-if="item.durationMs !== undefined" class="tool-call__meta">
            {{ formatDuration(item.durationMs) }}
          </span>
          <span v-if="item.size !== undefined" class="tool-call__meta">
            {{ formatBytes(item.size) }}
          </span>
          <!-- 运行中没有结果可看：不出现"展开"字样，避免"点开却是空的"（TR-33） -->
          <span v-if="canExpand(item)" class="tool-call__toggle">
            {{ panelOf(item).open ? '收起' : '展开' }}
          </span>
        </button>

        <div v-if="canExpand(item) && panelOf(item).open" :id="bodyId(index)" class="tool-call__body">
          <p v-if="item.summary" class="tool-call__summary">{{ item.summary }}</p>
          <p v-if="item.argsDigest" class="tool-call__args">
            入参：{{ formatArgsDigest(item.argsDigest) }}
          </p>

          <p v-if="panelOf(item).loading" class="tool-call__hint">加载中…</p>
          <p v-else-if="panelOf(item).expired" class="tool-call__hint">
            内容已被临时空间清理（原 {{ formatBytes(item.artifactSize ?? 0) }}）
          </p>
          <p v-else-if="panelOf(item).error" class="tool-call__hint tool-call__hint--error">
            {{ panelOf(item).error }}
          </p>
          <pre v-else-if="displayContent(item)" class="tool-call__content">{{
            displayContent(item)
          }}</pre>
          <!-- running 不可展开，故此处只剩"终态但无内容"一种情况 -->
          <p v-else class="tool-call__hint">无结果内容</p>

          <p v-if="item.truncated" class="tool-call__hint">结果过大，仅保留了前一部分</p>
        </div>
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

/* 摘要行：观感与卡片头一致，但它是"本轮概览"而非某条调用的卡片 */
.tool-calls__summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  color: inherit;
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}

.tool-calls__summary:hover {
  background: var(--color-surface);
}

.tool-calls__latest {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.tool-calls__details {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
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

/* 运行中：没有结果可看，故不给可点暗示（不是"静默无反应"，是明确不可点，TR-33） */
.tool-call__head:disabled {
  cursor: default;
}

.tool-call__head:disabled:hover {
  background: transparent;
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

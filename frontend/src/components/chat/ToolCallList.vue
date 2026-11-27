<script setup lang="ts">
import { computed, useId } from 'vue'

import { useToolPanels, type ToolPanelState } from '../../composables/useToolPanels'
import { formatBytes, formatDurationMs } from '../../utils/format'
import {
  formatArgsDigest,
  isToolCallFinished,
  summarizeToolCalls,
  toolDisplayName,
  toolGroupKey,
  toolStatusLabel,
  type ToolCallItem,
} from '../../utils/tool-calls'
import { emptyBodyHint, NO_HINT, resultHint } from '../../utils/tool-result-hint'
import { fallbackHint, parseProducedContent } from '../../utils/produced-content'
import type { ViewLinkTarget } from '../../utils/view-link'
import ProducedJsonView from './ProducedJsonView.vue'

const props = withDefaults(
  defineProps<{
    items: ToolCallItem[]
    /**
     * 本轮是否**仍在流式进行中**（TR-33）：只决定 `running` 的文案是"进行中"还是"未完成"。
     * 由 `MessageBubble` 从 `streaming.phase` 显式传入——MUST NOT 用"有无结果正文"之类的间接信号推断。
     */
    live?: boolean
    hideHead?: boolean
  }>(),
  { live: false, hideHead: false },
)

const emit = defineEmits<{
  'open-view': [item: ViewLinkTarget]
}>()

const panels = useToolPanels()

const uid = useId()
const detailsId = `${uid}-details`
const bodyId = (index: number): string => `${uid}-body-${index}`

const stats = computed(() => summarizeToolCalls(props.items))
const latest = computed<ToolCallItem | null>(() => props.items[props.items.length - 1] ?? null)
const foldable = computed(() => props.items.length > 1)
const groupKey = computed(() => toolGroupKey(props.items))
const detailsOpen = computed(() => foldable.value && panels.isDetailsOpen(groupKey.value))
const detailsVisible = computed(() => !foldable.value || detailsOpen.value)

function toggleDetails(): void {
  panels.setDetailsOpen(groupKey.value, !detailsOpen.value)
}

function canExpand(item: ToolCallItem): boolean {
  return isToolCallFinished(item.status)
}

function statusLabel(item: ToolCallItem): string {
  return toolStatusLabel(item.status, props.live)
}

function panelOf(item: ToolCallItem): ToolPanelState {
  return panels.panelOf(item.callId)
}

function onToggle(item: ToolCallItem): void {
  if (!canExpand(item)) return
  const panel = panelOf(item)
  panel.open = !panel.open
}

function displayContent(item: ToolCallItem): string {
  return item.content ?? ''
}

/** 结果正文的展示视图（结构化解析 + 降级提示） */
interface ResultView {
  structured: boolean
  value: unknown
  /** 降级提示（`''` = 不提示） */
  hint: string
}

const EMPTY_RESULT_VIEW: ResultView = { structured: false, value: null, hint: '' }

const resultViews = computed(() => {
  const views = new Map<string, ResultView>()
  for (const item of props.items) {
    if (!panelOf(item).open) continue
    const parsed = parseProducedContent(displayContent(item) || null)
    views.set(item.callId, {
      structured: parsed.structured,
      value: parsed.value,
      hint: fallbackHint(parsed.reason),
    })
  }
  return views
})

function parsedOf(item: ToolCallItem): ResultView {
  return resultViews.value.get(item.callId) ?? EMPTY_RESULT_VIEW
}

function toggleRaw(item: ToolCallItem): void {
  const panel = panelOf(item)
  panel.raw = !panel.raw
}

const bodyHints = computed(() => {
  const hints = new Map<string, string>()
  for (const item of props.items) {
    const hint = resultHint(item)
    if (hint !== '') hints.set(item.callId, hint)
  }
  return hints
})

function bodyHintOf(item: ToolCallItem): string {
  return bodyHints.value.get(item.callId) ?? NO_HINT
}

const emptyHints = computed(() => {
  const hints = new Map<string, string>()
  for (const item of props.items) {
    const hint = emptyBodyHint(item, props.live)
    if (hint !== '') hints.set(item.callId, hint)
  }
  return hints
})

function emptyHintOf(item: ToolCallItem): string {
  return emptyHints.value.get(item.callId) ?? NO_HINT
}
</script>

<template>
  <div v-if="items.length" class="tool-calls">
    <p v-if="!hideHead" class="tool-calls__head" data-test="tool-counts">
      本轮 {{ stats.total }} 次调用 · 报错 {{ stats.errors }} 次
    </p>

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
      <span class="tool-call__name" :title="latest.name">{{ toolDisplayName(latest) }}</span>
      <span class="tool-call__status" :class="`tool-call__status--${latest.status}`">
        {{ statusLabel(latest) }}
      </span>
      <span v-if="latest.durationMs !== undefined" class="tool-call__meta">
        {{ formatDurationMs(latest.durationMs) }}
      </span>
      <span class="tool-call__toggle">{{ detailsOpen ? '收起明细' : '查看明细' }}</span>
    </button>

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
          <span class="tool-call__name" :title="item.name">{{ toolDisplayName(item) }}</span>
          <span class="tool-call__status" :class="`tool-call__status--${item.status}`">
            {{ statusLabel(item) }}
          </span>
          <span v-if="item.durationMs !== undefined" class="tool-call__meta">
            {{ formatDurationMs(item.durationMs) }}
          </span>
          <span v-if="item.size !== undefined" class="tool-call__meta">
            {{ formatBytes(item.size) }}
          </span>
          <span v-if="canExpand(item)" class="tool-call__toggle">
            {{ panelOf(item).open ? '收起' : '展开' }}
          </span>
        </button>

        <div
          v-if="canExpand(item) && panelOf(item).open"
          :id="bodyId(index)"
          class="tool-call__body"
        >
          <p v-if="item.summary" class="tool-call__summary">{{ item.summary }}</p>
          <p v-if="item.argsDigest" class="tool-call__args">
            入参：{{ formatArgsDigest(item.argsDigest) }}
          </p>

          <template v-if="displayContent(item)">
            <button
              v-if="parsedOf(item).structured"
              type="button"
              class="tool-call__view-toggle"
              @click="toggleRaw(item)"
            >
              {{ panelOf(item).raw ? '按结构化查看' : '按原始 JSON 查看' }}
            </button>
            <div
              v-if="parsedOf(item).structured && !panelOf(item).raw"
              class="tool-call__structured"
            >
              <ProducedJsonView
                :value="parsedOf(item).value"
                @open-view="emit('open-view', $event)"
              />
            </div>
            <pre v-else class="tool-call__content">{{ displayContent(item) }}</pre>
            <p v-if="parsedOf(item).hint" class="tool-call__hint">{{ parsedOf(item).hint }}</p>
          </template>
          <p v-else-if="emptyHintOf(item)" class="tool-call__hint">{{ emptyHintOf(item) }}</p>
          <p v-else-if="!bodyHintOf(item)" class="tool-call__hint">无结果内容</p>

          <p v-if="bodyHintOf(item)" class="tool-call__hint">{{ bodyHintOf(item) }}</p>
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

.tool-calls__summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-tool-border);
  border-radius: var(--radius-md);
  background: var(--color-tool-bg);
  color: var(--color-tool-text);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}

.tool-calls__summary:hover {
  background: var(--color-tool-bg-hover);
}

.tool-calls__latest {
  color: var(--color-tool-text-muted);
  font-size: var(--font-size-xs);
}

.tool-calls__details {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tool-call {
  border: 1px solid var(--color-tool-border);
  border-radius: var(--radius-md);
  background: var(--color-tool-bg);
  color: var(--color-tool-text);
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
  background: var(--color-tool-bg-hover);
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
  color: var(--color-tool-text-muted);
}

.tool-call__status--running {
  color: var(--color-tool-status-running);
}

.tool-call__status--success {
  color: var(--color-tool-status-success);
}

.tool-call__status--error {
  color: var(--color-tool-status-error);
}

.tool-call__meta {
  color: var(--color-tool-text-muted);
  font-size: var(--font-size-xs);
}

.tool-call__toggle {
  margin-left: auto;
  color: var(--color-tool-link);
  font-size: var(--font-size-xs);
}

.tool-call__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-top: 1px solid var(--color-tool-border);
}

.tool-call__summary,
.tool-call__args,
.tool-call__hint {
  color: var(--color-tool-text-muted);
  font-size: var(--font-size-xs);
}

.tool-call__content {
  max-height: 320px;
  margin: 0;
  padding: var(--space-2);
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--color-tool-body-bg);
  color: var(--color-tool-body-text);
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-xs);
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-call__structured {
  --color-bg-subtle: var(--color-tool-body-bg);
  --color-border: var(--color-tool-border);
  --color-text-muted: var(--color-tool-text-muted);
  --color-primary: var(--color-tool-link);

  max-height: 320px;
  padding: var(--space-2);
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--color-tool-body-bg);
  color: var(--color-tool-body-text);
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-xs);
}

.tool-call__view-toggle {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-tool-link);
  font: inherit;
  font-size: var(--font-size-xs);
  text-decoration: underline;
  cursor: pointer;
}
</style>

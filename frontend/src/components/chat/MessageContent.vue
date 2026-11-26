<script setup lang="ts">
import { computed } from 'vue'

import { parseMarkdown, type InlineRun, type Piece } from '../../utils/markdown'
import { buildSegments, findMatches, type ContentSegment } from '../../utils/segments'
import MessageCodeBlock from './MessageCodeBlock.vue'
import MessageSegments from './MessageSegments.vue'

const props = withDefaults(
  defineProps<{
    content: string
    keyword?: string
    matchIndexBase?: number
  }>(),
  { keyword: '', matchIndexBase: 0 },
)

const emit = defineEmits<{ 'open-link': [href: string] }>()

interface ViewRun {
  tag: string
  code: boolean
  red: boolean
  segments: ContentSegment[]
}

/**
 * 渲染用块。字段**一律存在**（不适用的留空）：模板里就不必对联合类型做收窄，
 * 少一层"kind 收窄写错 → 静默渲染成空"的风险。
 */
interface ViewBlock {
  kind: 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'table' | 'rule'
  level: number
  ordered: boolean
  runs: ViewRun[]
  items: ViewRun[][]
  language: string
  code: ContentSegment[]
  header: ViewRun[][]
  rows: ViewRun[][][]
}

const matches = computed(() => findMatches(props.content, props.keyword))

function matchesBefore(offset: number): number {
  const ranges = matches.value
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (ranges[middle].start < offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function segmentsOf(piece: Piece, href?: string): ContentSegment[] {
  const base = props.matchIndexBase + matchesBefore(piece.start)
  const segments = buildSegments(piece.text, props.keyword, base)
  return href === undefined ? segments : segments.map((segment) => ({ ...segment, href }))
}

function runTag(run: InlineRun): string {
  switch (run.kind) {
    case 'strong':
      return 'strong'
    case 'em':
      return 'em'
    case 'code':
      return 'code'
    default:
      return 'span'
  }
}

function viewRuns(runs: InlineRun[]): ViewRun[] {
  return runs.map((run) => ({
    tag: runTag(run),
    code: run.kind === 'code',
    red: run.kind === 'red',
    segments: segmentsOf(run, run.kind === 'link' ? run.href : undefined),
  }))
}

function runClass(run: ViewRun): Record<string, boolean> {
  return { 'message-content__code': run.code, 'message-content__red': run.red }
}

function emptyBlock(kind: ViewBlock['kind']): ViewBlock {
  return {
    kind,
    level: 0,
    ordered: false,
    runs: [],
    items: [],
    language: '',
    code: [],
    header: [],
    rows: [],
  }
}

const blocks = computed<ViewBlock[]>(() =>
  parseMarkdown(props.content).map((block) => {
    const view = emptyBlock(block.kind)
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
        view.runs = viewRuns(block.runs)
        if (block.kind === 'heading') {
          view.level = block.level
        }
        break
      case 'quote':
        view.runs = viewRuns(block.runs)
        break
      case 'list':
        view.ordered = block.ordered
        view.items = block.items.map(viewRuns)
        break
      case 'code':
        view.language = block.language
        view.code = segmentsOf(block.piece)
        break
      case 'table':
        view.header = block.header.map(viewRuns)
        view.rows = block.rows.map((row) => row.map(viewRuns))
        break
      default:
        break
    }
    return view
  }),
)

function blockTag(block: ViewBlock): string {
  if (block.kind === 'heading') {
    return `h${Math.min(block.level + 2, 6)}`
  }
  return block.kind === 'quote' ? 'blockquote' : 'p'
}

function blockClass(block: ViewBlock): string {
  if (block.kind === 'heading') {
    return block.level <= 2
      ? 'message-content__heading'
      : 'message-content__heading message-content__heading--minor'
  }
  return block.kind === 'quote' ? 'message-content__quote' : 'message-content__text'
}
</script>

<template>
  <div class="message-content">
    <template v-for="(block, index) in blocks" :key="index">
      <MessageCodeBlock
        v-if="block.kind === 'code'"
        :language="block.language"
        :segments="block.code"
        @open-link="emit('open-link', $event)"
      />

      <hr v-else-if="block.kind === 'rule'" class="message-content__rule" />

      <div v-else-if="block.kind === 'table'" class="message-content__table-wrap">
        <table class="message-content__table">
          <thead>
            <tr>
              <th v-for="(cell, cellIndex) in block.header" :key="cellIndex" scope="col">
                <template v-for="(run, runIndex) in cell" :key="runIndex">
                  <component :is="run.tag" :class="runClass(run)">
                    <MessageSegments
                      :segments="run.segments"
                      @open-link="emit('open-link', $event)"
                    />
                  </component>
                </template>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                <template v-for="(run, runIndex) in cell" :key="runIndex">
                  <component :is="run.tag" :class="runClass(run)">
                    <MessageSegments
                      :segments="run.segments"
                      @open-link="emit('open-link', $event)"
                    />
                  </component>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul v-else-if="block.kind === 'list' && !block.ordered" class="message-content__list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex" class="message-content__item">
          <template v-for="(run, runIndex) in item" :key="runIndex">
            <component :is="run.tag" :class="runClass(run)">
              <MessageSegments :segments="run.segments" @open-link="emit('open-link', $event)" />
            </component>
          </template>
        </li>
      </ul>

      <ol v-else-if="block.kind === 'list'" class="message-content__list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex" class="message-content__item">
          <template v-for="(run, runIndex) in item" :key="runIndex">
            <component :is="run.tag" :class="runClass(run)">
              <MessageSegments :segments="run.segments" @open-link="emit('open-link', $event)" />
            </component>
          </template>
        </li>
      </ol>

      <component :is="blockTag(block)" v-else :class="blockClass(block)">
        <template v-for="(run, runIndex) in block.runs" :key="runIndex">
          <component :is="run.tag" :class="runClass(run)">
            <MessageSegments :segments="run.segments" @open-link="emit('open-link', $event)" />
          </component>
        </template>
      </component>
    </template>
  </div>
</template>

<style scoped>
.message-content {
  margin: 0;
  overflow-wrap: anywhere;
  line-height: 1.7;
}

.message-content__text,
.message-content__heading,
.message-content__quote,
.message-content__item {
  white-space: pre-wrap;
}

.message-content__text {
  margin: 0;
}

.message-content__heading {
  margin: var(--space-3) 0 var(--space-1);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.message-content__heading--minor {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.message-content__list {
  margin: var(--space-1) 0;
  padding-left: var(--space-5);
}

.message-content__item + .message-content__item {
  margin-top: var(--space-1);
}

.message-content__quote {
  margin: var(--space-2) 0;
  padding-left: var(--space-3);
  border-left: 2px solid var(--color-border);
  color: var(--color-text-secondary);
}

.message-content__rule {
  margin: var(--space-3) 0;
  border: 0;
  border-top: 1px solid var(--color-border);
}

.message-content__table-wrap {
  margin: var(--space-2) 0;
  overflow-x: auto;
}

.message-content__table {
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.message-content__table th,
.message-content__table td {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  text-align: left;
  white-space: nowrap;
}

.message-content__table th {
  background: var(--color-bg-subtle);
  font-weight: 600;
}

.message-content__code {
  padding: 0 4px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-family: var(--font-family-mono);
  font-size: 0.92em;
}

/* 红字强调（`==文本==`）：颜色 + 字重双通道，避免"仅靠颜色传达信息"（宪章原则四） */
.message-content__red {
  color: #cf1322;
  font-weight: 600;
}
</style>

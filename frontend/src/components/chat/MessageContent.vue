<script setup lang="ts">
/**
 * 消息正文渲染（T038；2026-10-16 起支持最小 Markdown 子集）
 *
 * 链路：`utils/markdown.ts` 把正文解析成块级序列 → 每个"可高亮片段"经
 * `utils/segments.ts` 切成 text/link/mark → `MessageSegments` 落成 DOM
 * （高亮与外链样式只在那一个文件里定义）；代码块另走 `MessageCodeBlock`（等宽 + 复制）。
 *
 * **搜索高亮的序号连续性**（改 Markdown 最容易踩坏的地方）：每个片段的全局命中序号
 * ＝`matchIndexBase` ＋该片段在**原文**中之前已出现的命中数。`useSessionSearch` 的命中
 * 总数按**原文**统计（`countMatches`），两边必须同源；片段携带的 `start` 偏移正是为此。
 *
 * 外链 MUST 直接跳转且不进右侧预览区（FR-045 / V-10）：由 `MessageSegments` 统一处理，
 * 点击同时派发 `open-link` 供上层兜底。
 */
import { computed } from 'vue'

import { parseMarkdown, type InlineRun, type Piece } from '../../utils/markdown'
import { buildSegments, findMatches, type ContentSegment } from '../../utils/segments'
import MessageCodeBlock from './MessageCodeBlock.vue'
import MessageSegments from './MessageSegments.vue'

const props = withDefaults(
  defineProps<{
    /** 正文 */
    content: string
    /** 搜索关键词（空串不高亮） */
    keyword?: string
    /** 本消息内首个命中的全局序号（跨消息累计） */
    matchIndexBase?: number
  }>(),
  { keyword: '', matchIndexBase: 0 },
)

const emit = defineEmits<{ 'open-link': [href: string] }>()

/** 行内片段的渲染单元：套哪层标签 + 切好的分段 */
interface ViewRun {
  tag: string
  code: boolean
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
  header: ContentSegment[][]
  rows: ContentSegment[][][]
}

/** 原文中的全部命中（升序）：用来把"片段偏移"换算成全局命中序号 */
const matches = computed(() => findMatches(props.content, props.keyword))

/** 片段之前已有多少个命中（区间升序 ⇒ 二分） */
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

/**
 * 片段 → 分段（外链 + 搜索命中），序号与原文口径一致。
 *
 * Markdown 链接（`[标签](地址)`）的地址在这里**补到分段上**，而不是另起一层 `<a>`：
 * `MessageSegments` 已支持"高亮 + 外链"叠加的形态（`type='mark'` 且带 `href`），
 * 复用这条路，链接标签里的命中就自然变成可点的高亮。
 */
function segmentsOf(piece: Piece, href?: string): ContentSegment[] {
  const base = props.matchIndexBase + matchesBefore(piece.start)
  const segments = buildSegments(piece.text, props.keyword, base)
  return href === undefined ? segments : segments.map((segment) => ({ ...segment, href }))
}

/** 行内片段套哪层标签（链接由分段层渲染成 `<a>`，这里只负责 `<strong>/<em>/<code>`） */
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
    segments: segmentsOf(run, run.kind === 'link' ? run.href : undefined),
  }))
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
        view.header = block.header.map((cell) => segmentsOf(cell))
        view.rows = block.rows.map((row) => row.map((cell) => segmentsOf(cell)))
        break
      default:
        break
    }
    return view
  }),
)

/** 段落 / 标题 / 引用共用一个分支，靠标签与类名区分 */
function blockTag(block: ViewBlock): string {
  if (block.kind === 'heading') {
    // 正文层级压到 h3~h5：气泡里的标题不该和页面结构抢 h1/h2
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
      <!-- 代码块：等宽 + 横向滚动 + 一键复制 -->
      <MessageCodeBlock
        v-if="block.kind === 'code'"
        :language="block.language"
        :segments="block.code"
        @open-link="emit('open-link', $event)"
      />

      <hr v-else-if="block.kind === 'rule'" class="message-content__rule" />

      <!-- 表格：单元格不做行内解析（故意的取舍，见 `utils/markdown.ts` 头部说明） -->
      <div v-else-if="block.kind === 'table'" class="message-content__table-wrap">
        <table class="message-content__table">
          <thead>
            <tr>
              <th v-for="(cell, cellIndex) in block.header" :key="cellIndex" scope="col">
                <MessageSegments :segments="cell" @open-link="emit('open-link', $event)" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                <MessageSegments :segments="cell" @open-link="emit('open-link', $event)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul v-else-if="block.kind === 'list' && !block.ordered" class="message-content__list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex" class="message-content__item">
          <template v-for="(run, runIndex) in item" :key="runIndex">
            <component :is="run.tag" :class="{ 'message-content__code': run.code }">
              <MessageSegments :segments="run.segments" @open-link="emit('open-link', $event)" />
            </component>
          </template>
        </li>
      </ul>

      <ol v-else-if="block.kind === 'list'" class="message-content__list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex" class="message-content__item">
          <template v-for="(run, runIndex) in item" :key="runIndex">
            <component :is="run.tag" :class="{ 'message-content__code': run.code }">
              <MessageSegments :segments="run.segments" @open-link="emit('open-link', $event)" />
            </component>
          </template>
        </li>
      </ol>

      <!-- 段落 / 标题 / 引用：同一套行内渲染，标签与类名由 `blockTag`/`blockClass` 决定 -->
      <component :is="blockTag(block)" v-else :class="blockClass(block)">
        <template v-for="(run, runIndex) in block.runs" :key="runIndex">
          <component :is="run.tag" :class="{ 'message-content__code': run.code }">
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
  /* 长 URL / 长标识符不许撑破气泡 */
  overflow-wrap: anywhere;
  line-height: 1.7;
}

/* 保留正文里的手动换行（与 Markdown 改造前的观感一致：agent 常按行排布要点） */
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

/* 表格横向滚动而不是撑破气泡（列多的排产表是常态） */
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

/* 行内代码 */
.message-content__code {
  padding: 0 4px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-family: var(--font-family-mono);
  font-size: 0.92em;
}
</style>

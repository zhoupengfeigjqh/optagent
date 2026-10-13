<script setup lang="ts">
/**
 * 回答正文之后的**视图入口行**（2026-10-10，`TR-45`~`TR-48`）
 *
 * 解决的问题：工具结果里常有"能点开看明细"的地址（`viewUrl`），但它是**结果文本里的
 * 死字符串**——用户看得见、点不动；让模型在回答里转写一遍又不可靠（正文与记录无绑定）。
 * 故由运行时把地址抽成 sidecar 随记录下发，这里在**正文之后**渲染成可点入口。
 *
 * 位置（`MessageBubble` 装配）：`MessageContent` 之后、状态提示与 `MessageActions` 之前。
 * 它是"正文的附件"，不是"对消息的操作"，因此**不并入**操作区。
 *
 * 取值：该条消息**全部**工具调用的 `view_links` 并集（`collectToolViewLinks`），
 * 归一化与去重交给 `utils/view-link.ts`（唯一实现，含"不推断名称"的降级链）。
 *
 * 空态：没有任何合法链接时**整行不渲染**——无 DOM 即无间距，界面与改动前一致（`TR-48`）。
 * 流式期自然为空（结果还没产生），无需额外分支。
 */
import { computed, ref } from 'vue'

import type { ViewLink } from '../../api/types'
import {
  VIEW_LINK_DISPLAY_MAX,
  toViewLinkEntries,
  viewLinkLabel,
  viewLinkTitle,
} from '../../utils/view-link'

const props = withDefaults(
  defineProps<{
    /** 记录里的视图链接（服务给的原值，未归一化） */
    links?: ViewLink[]
  }>(),
  { links: () => [] },
)

const emit = defineEmits<{
  /** 外部地址点击：由上层直跳新窗口，不进预览区（V-10，与 `MessageContent` 同口径） */
  'open-link': [href: string]
}>()

/** 归一化 + 跨工具去重（纯函数，`computed` 缓存：宪章原则五） */
const entries = computed(() => toViewLinkEntries(props.links))

/** 溢出展开态：瞬态、不持久化（刷新/切会话回到收起态） */
const expanded = ref(false)

const visible = computed(() =>
  expanded.value ? entries.value : entries.value.slice(0, VIEW_LINK_DISPLAY_MAX),
)
/** 被折叠的条数：MUST 让用户看得见，不静默丢弃（`TR-47`） */
const hiddenCount = computed(() => entries.value.length - visible.value.length)

function onLinkClick(href: string): void {
  emit('open-link', href)
}
</script>

<template>
  <div v-if="entries.length" class="message-view-links" data-test="view-links">
    <span class="message-view-links__label">打开视图：</span>

    <a
      v-for="entry in visible"
      :key="entry.href"
      class="message-view-link"
      :href="entry.href"
      target="_blank"
      rel="noopener noreferrer"
      :title="viewLinkTitle(entry)"
      @click.prevent="onLinkClick(entry.href)"
    >
      {{ viewLinkLabel(entry) }}
    </a>

    <button
      v-if="hiddenCount > 0"
      type="button"
      class="message-view-links__more"
      :aria-expanded="false"
      data-test="view-links-more"
      @click="expanded = true"
    >
      另有 {{ hiddenCount }} 个
    </button>
    <button
      v-else-if="expanded && entries.length > VIEW_LINK_DISPLAY_MAX"
      type="button"
      class="message-view-links__more"
      :aria-expanded="true"
      @click="expanded = false"
    >
      收起
    </button>
  </div>
</template>

<style scoped>
.message-view-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.message-view-links__label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* 可点性 MUST NOT 只靠颜色传达（宪章原则四）：边框 + 悬停变色 + 可见焦点环 */
.message-view-link {
  max-width: 100%;
  padding: 2px var(--space-3);
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-view-link:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-subtle);
}

.message-view-link:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.message-view-links__more {
  padding: 2px var(--space-2);
  border: none;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: var(--font-size-xs);
  text-decoration: underline;
  cursor: pointer;
}
</style>

<script setup lang="ts">
/**
 * 分段渲染（2026-10-16，自 `MessageContent` 抽出）
 *
 * 把 `ContentSegment[]` 落成 DOM：纯文本 / 搜索高亮 `<mark>` / 外链 `<a>`。
 * **抽出来的唯一理由是样式与语义只能有一份**：正文、代码块、表格单元格都要渲染 mark，
 * 各自持有一份 `.mark` 样式必然漂移；`data-match-index` 与 `data-active-match`
 * 的约定（`MessageList` 据此定位当前命中）也随之集中在此。
 *
 * 外链 MUST 直接跳转且不进右侧预览区（FR-045 / V-10）：`target="_blank"` +
 * `rel="noopener noreferrer"`，点击同时派发 `open-link` 供上层兜底处理。
 */
import type { ContentSegment } from '../../utils/segments'

defineProps<{ segments: ContentSegment[] }>()

const emit = defineEmits<{ 'open-link': [href: string] }>()

function onLinkClick(segment: ContentSegment): void {
  if (segment.href) {
    emit('open-link', segment.href)
  }
}
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <!-- 链接（可能同时是搜索命中） -->
    <a
      v-if="segment.href"
      class="message-content__link"
      :href="segment.href"
      target="_blank"
      rel="noopener noreferrer"
      @click.prevent="onLinkClick(segment)"
    >
      <mark
        v-if="segment.type === 'mark'"
        class="message-content__mark"
        :data-match-index="segment.matchIndex"
      >
        {{ segment.text }}
      </mark>
      <template v-else>{{ segment.text }}</template>
    </a>

    <!-- 搜索命中 -->
    <mark
      v-else-if="segment.type === 'mark'"
      class="message-content__mark"
      :data-match-index="segment.matchIndex"
    >
      {{ segment.text }}
    </mark>

    <!-- 纯文本 -->
    <template v-else>{{ segment.text }}</template>
  </template>
</template>

<style scoped>
.message-content__link {
  color: var(--color-primary);
  text-decoration: underline;
}

.message-content__mark {
  background: #fff3a3;
  color: inherit;
  border-radius: 2px;
}

.message-content__mark[data-active-match='true'] {
  background: #ffcf4d;
  outline: 2px solid var(--color-primary);
}
</style>

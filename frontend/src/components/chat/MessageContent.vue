<script setup lang="ts">
/**
 * 消息正文渲染（T038）
 *
 * 纯文本渲染（`white-space: pre-wrap`），不引入 Markdown 库。
 * 分段由 `utils/segments.ts` 一次性派生并以 `computed` 缓存（宪章原则五）。
 * 外链 MUST 直接跳转且不进右侧预览区（FR-045 / V-10）：`target="_blank"` +
 * `rel="noopener noreferrer"`，点击同时派发 `open-link` 供上层兜底处理。
 */
import { computed } from 'vue'

import { buildSegments, type ContentSegment } from '../../utils/segments'

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

const segments = computed(() => buildSegments(props.content, props.keyword, props.matchIndexBase))

function onLinkClick(segment: ContentSegment): void {
  if (segment.href) {
    emit('open-link', segment.href)
  }
}
</script>

<template>
  <p class="message-content">
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
      <span v-else>{{ segment.text }}</span>
    </template>
  </p>
</template>

<style scoped>
.message-content {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}

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

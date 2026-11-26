<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ViewLink } from '../../api/types'
import {
  VIEW_LINK_DISPLAY_MAX,
  toViewLinkEntries,
  toViewLinkTarget,
  viewLinkLabel,
  viewLinkTitle,
  type ViewLinkEntry,
  type ViewLinkTarget,
} from '../../utils/view-link'

const props = withDefaults(
  defineProps<{
    links?: ViewLink[]
  }>(),
  { links: () => [] },
)

const emit = defineEmits<{
  'open-view': [item: ViewLinkTarget]
}>()

const entries = computed(() => toViewLinkEntries(props.links))

const expanded = ref(false)

const visible = computed(() =>
  expanded.value ? entries.value : entries.value.slice(0, VIEW_LINK_DISPLAY_MAX),
)
const hiddenCount = computed(() => entries.value.length - visible.value.length)

function onLinkClick(entry: ViewLinkEntry): void {
  emit('open-view', toViewLinkTarget(entry))
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
      @click.prevent="onLinkClick(entry)"
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

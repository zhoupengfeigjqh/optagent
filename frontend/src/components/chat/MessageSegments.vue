<script setup lang="ts">
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

    <mark
      v-else-if="segment.type === 'mark'"
      class="message-content__mark"
      :data-match-index="segment.matchIndex"
    >
      {{ segment.text }}
    </mark>

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

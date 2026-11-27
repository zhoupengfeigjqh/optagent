<script setup lang="ts">
import type { AgentStarter } from '../../api/types'
import SuggestionCard from './SuggestionCard.vue'

withDefaults(
  defineProps<{
    welcome?: string
    starters?: AgentStarter[]
    agentSelected?: boolean
    busy?: boolean
  }>(),
  { welcome: '', starters: () => [], agentSelected: false, busy: false },
)

/**
 * 只上抛选中，不做"能不能发"的判定：`agentSelected` / `busy` 只负责置灰，
 * 同一判据在父级 `onStarterClick` 已有唯一实现——写两遍迟早一处漏改。
 */
const emit = defineEmits<{ select: [starter: AgentStarter] }>()
</script>

<template>
  <div class="chat-hero">
    <div class="chat-hero__inner">
      <h1 class="chat-hero__title">{{ welcome || '开始新的对话' }}</h1>
      <p v-if="!agentSelected" class="chat-hero__desc">
        请先选择数字人，再使用下方的问题快速开始。
      </p>
      <p v-else-if="starters.length === 0" class="chat-hero__desc">
        在下方输入消息，即可开启新的会话。
      </p>

      <ul v-if="starters.length > 0" class="chat-hero__starters">
        <li v-for="(starter, index) in starters" :key="index">
          <SuggestionCard
            :text="starter.prompt"
            :disabled="!agentSelected || busy"
            :data-test="`chat-starter-${index}`"
            @select="emit('select', starter)"
          />
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.chat-hero {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  text-align: center;
  padding: var(--space-4);
  overflow-y: auto;
}

.chat-hero__inner {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.chat-hero__title {
  font-size: var(--font-size-xl);
  font-weight: 600;
}

.chat-hero__desc {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* 卡片本体（`.suggestion-card`）由 `SuggestionCard.vue` 自带：首屏与回答下方共用同一枚卡片，
   样式也必须在同一处（FR-012），故这里只留栅格 */
.chat-hero__starters {
  width: 100%;
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--space-2);
}
</style>

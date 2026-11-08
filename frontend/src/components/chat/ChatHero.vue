<script setup lang="ts">
/**
 * 新建对话页的首屏引导（004；自 `ChatPanel.vue` 拆分，宪章原则二）。
 *
 * 纯展示 + 一次上抛：欢迎语与问题卡片全部来自当前数字人（`welcome` / `starters`），
 * 点击哪张卡片就把该卡片交给父级发起对话——本组件不碰发送链路。
 * 存量旧数字人没有结构化 SOUL 时 `welcome` 为空，退回既有空状态文案（不白屏）。
 */
import type { AgentStarter } from '../../api/types'
import SuggestionCard from './SuggestionCard.vue'

withDefaults(
  defineProps<{
    /** 当前数字人的首屏欢迎语；为空 → 退回原空状态文案 */
    welcome?: string
    /** 问题卡片：全部平铺展示 */
    starters?: AgentStarter[]
    /** 是否已选定数字人（未选 → 提示先选择，卡片置灰） */
    agentSelected?: boolean
    /** 本轮是否进行中（置灰卡片；**是否真的发起新轮由父级判定**） */
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
        在下方输入消息，即可开始本轮求解。
      </p>

      <ul v-if="starters.length > 0" class="chat-hero__starters">
        <li v-for="(starter, index) in starters" :key="index">
          <!-- 与回答下方的下一步动作卡片**同一枚卡片**（FR-012）：两处必须同源同形，
               否则就是引入了第二套视觉体系。关联工具不在此展示（它只用于生成隐藏引导，
               `exposed_name` 亦是内部实现细节，对业务用户无意义） -->
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
  /* 问题实例全部平铺，可能很多：超出时整块滚动，不挤压输入区 */
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
  /* 首屏**多列紧凑**（2026-10-12 产品口径）：一行可放多张、按内容自动铺满整行，
     纵向高度随列数成比例下降。与回答下方的下一步动作卡片（单列）**刻意不同**——
     两处共用同一枚卡片（FR-012），但栅格各自定义 */
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--space-2);
}
</style>

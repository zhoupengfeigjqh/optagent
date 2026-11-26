<script setup lang="ts">
withDefaults(
  defineProps<{
    agentName?: string | null
  }>(),
  { agentName: null },
)
</script>

<template>
  <div class="agent-summary">
    <p v-if="agentName === null" class="agent-summary__hint">请选择数字人</p>
    <p v-else class="agent-summary__name">{{ agentName }}</p>
  </div>
</template>

<style scoped>
.agent-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.agent-summary__name {
  font-size: var(--font-size-md);
  font-weight: 600;
  line-height: var(--line-height-base);
}

.agent-summary__hint {
  color: var(--color-status-error);
  font-size: var(--font-size-md);
  line-height: var(--line-height-base);
  font-weight: 600;
}
</style>

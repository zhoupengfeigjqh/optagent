<script setup lang="ts">
/**
 * MCP 工具清单（`FR-045`）：展示每个工具的用途与入参说明，**有界返回**。
 */
import type { McpToolInfo } from '../../api/types'

const props = defineProps<{
  tools: McpToolInfo[]
  truncated: boolean
  /** 工具清单不可得时的可读原因（`FR-009`：不静默省略） */
  errorMessage?: string | null
}>()
</script>

<template>
  <section class="mcp-tool-list" aria-label="MCP 工具清单">
    <p v-if="props.errorMessage" class="mcp-tool-list__error" role="alert">
      工具清单不可得：{{ props.errorMessage }}
    </p>

    <p v-else-if="props.tools.length === 0" class="muted">该服务未声明任何工具。</p>

    <ul v-else class="mcp-tool-list__items">
      <li v-for="tool in props.tools" :key="tool.name" class="mcp-tool-list__item">
        <p class="mcp-tool-list__name mono">{{ tool.name }}</p>
        <p class="mcp-tool-list__desc">{{ tool.description || '（无说明）' }}</p>
        <details class="mcp-tool-list__params">
          <summary>入参说明</summary>
          <pre class="mono">{{ JSON.stringify(tool.parameters, null, 2) }}</pre>
        </details>
      </li>
    </ul>

    <p v-if="props.truncated" class="field__hint">工具数量超过上限，仅显示前若干项。</p>
  </section>
</template>

<style scoped>
.mcp-tool-list__error {
  margin: 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.mcp-tool-list__items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mcp-tool-list__item + .mcp-tool-list__item {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.mcp-tool-list__name {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.mcp-tool-list__desc {
  margin: var(--space-1) 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.mcp-tool-list__params summary {
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.mcp-tool-list__params pre {
  margin: var(--space-1) 0 0;
  padding: var(--space-2);
  background: var(--color-bg-muted);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  overflow-x: auto;
}
</style>

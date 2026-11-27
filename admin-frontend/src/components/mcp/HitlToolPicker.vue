<script setup lang="ts">
import type { McpToolInfo } from '../../api/types'

const props = defineProps<{
  tools: McpToolInfo[]
  selected: string[]
  orphans: string[]
  /** 清单不可得 → 回退手填（此时不渲染复选框） */
  manualFallback: boolean
  manualText: string
  truncated: boolean
}>()

const emit = defineEmits<{
  (e: 'update:selected', value: string[]): void
  (e: 'update:manualText', value: string): void
}>()

function toggle(name: string, checked: boolean): void {
  const next = new Set(props.selected)
  if (checked) next.add(name)
  else next.delete(name)
  emit('update:selected', [...next])
}
</script>

<template>
  <div class="field">
    <span class="field__label">需确认的工具</span>

    <div
      v-if="!manualFallback"
      class="mcp-config-form__tools"
      role="group"
      aria-label="需确认的工具清单"
    >
      <label v-for="tool in tools" :key="tool.name" class="mcp-config-form__tool">
        <input
          type="checkbox"
          :value="tool.name"
          :checked="selected.includes(tool.name)"
          @change="toggle(tool.name, ($event.target as HTMLInputElement).checked)"
        />
        <span class="mcp-config-form__tool-name mono">{{ tool.name }}</span>
        <span v-if="tool.description" class="mcp-config-form__tool-desc">{{
          tool.description
        }}</span>
      </label>

      <label
        v-for="orphan in orphans"
        :key="`orphan:${orphan}`"
        class="mcp-config-form__tool mcp-config-form__tool--orphan"
      >
        <input
          type="checkbox"
          :value="orphan"
          :checked="selected.includes(orphan)"
          @change="toggle(orphan, ($event.target as HTMLInputElement).checked)"
        />
        <span class="mcp-config-form__tool-name mono">{{ orphan }}</span>
        <span class="mcp-config-form__tool-desc">
          （已保存，当前服务清单中未包含；可能是清单截断或服务改版）
        </span>
      </label>
    </div>

    <textarea
      v-else
      id="mcp-confirmation-tools"
      :value="manualText"
      rows="3"
      placeholder="工具名不含服务前缀，例如：&#10;query_price&#10;create_order"
      @input="emit('update:manualText', ($event.target as HTMLTextAreaElement).value)"
    />

    <span class="field__hint">
      勾选的工具被调用前会弹出参数确认窗。
      <template v-if="truncated">清单被截断显示，完整清单以服务端为准。</template>
    </span>
  </div>
</template>

<style scoped>
.mcp-config-form__tools {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 260px;
  overflow-y: auto;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.mcp-config-form__tool {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  cursor: pointer;
}

.mcp-config-form__tool-name {
  flex-shrink: 0;
}

.mcp-config-form__tool-desc {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.mcp-config-form__tool--orphan .mcp-config-form__tool-desc {
  color: var(--color-status-warning);
}
</style>

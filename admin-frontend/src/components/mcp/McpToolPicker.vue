<script setup lang="ts">
import type { McpToolInfo } from '../../api/types'

const props = defineProps<{
  tools: McpToolInfo[]
  selected: string[]
  /** 服务工具数超过展示上限（父级据探测结果传入） */
  truncated: boolean
}>()

const emit = defineEmits<{ (e: 'update:selected', value: string[]): void }>()

function toggle(name: string, checked: boolean): void {
  const next = new Set(props.selected)
  if (checked) next.add(name)
  else next.delete(name)
  emit('update:selected', [...next])
}

function selectAll(): void {
  emit(
    'update:selected',
    props.tools.map((tool) => tool.name),
  )
}

function clearAll(): void {
  emit('update:selected', [])
}
</script>

<template>
  <div class="mcp-tool-picker">
    <div class="mcp-tool-picker__head">
      <span class="field__label">可见工具（{{ selected.length }} / {{ tools.length }}）</span>
      <span class="mcp-tool-picker__actions">
        <button type="button" class="btn" data-test="select-all" @click="selectAll">全选</button>
        <button type="button" class="btn" data-test="clear-all" @click="clearAll">清空</button>
      </span>
    </div>

    <ul class="mcp-tool-picker__list" role="group" aria-label="该服务可见的工具">
      <li v-for="tool in tools" :key="tool.name">
        <label class="mcp-tool-picker__tool">
          <input
            type="checkbox"
            data-test="tool"
            :value="tool.name"
            :checked="selected.includes(tool.name)"
            @change="toggle(tool.name, ($event.target as HTMLInputElement).checked)"
          />
          <span v-if="tool.label" class="mcp-tool-picker__title">{{ tool.label }}</span>
          <span class="mono mcp-tool-picker__name">{{ tool.name }}</span>
          <span v-if="tool.description" class="mcp-tool-picker__desc">{{ tool.description }}</span>
        </label>
      </li>
    </ul>

    <p v-if="truncated" class="field__hint">
      该服务工具数超过上限，仅显示前若干项；未显示的工具无法被勾选。
    </p>
  </div>
</template>

<style scoped>
.mcp-tool-picker__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.mcp-tool-picker__actions {
  display: flex;
  gap: var(--space-2);
}

/* 工具清单：自身滚动，避免几十个工具把弹窗撑破 */
.mcp-tool-picker__list {
  margin: 0;
  padding: 0;
  max-height: 40vh;
  overflow-y: auto;
  list-style: none;
}

.mcp-tool-picker__tool {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.mcp-tool-picker__name {
  flex-shrink: 0;
}

.mcp-tool-picker__title {
  flex-shrink: 0;
  font-weight: 600;
}

.mcp-tool-picker__desc {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}
</style>

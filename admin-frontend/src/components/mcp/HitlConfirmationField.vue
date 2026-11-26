<script setup lang="ts">
import type { McpToolInfo } from '../../api/types'
import HitlToolPicker from './HitlToolPicker.vue'

const props = defineProps<{
  mode: 'never' | 'always' | 'custom'
  tools: string[]
  /** custom 且清单不可得时的手填文本 */
  manualText: string
  catalog: McpToolInfo[]
  orphans: string[]
  manualFallback: boolean
  truncated: boolean
}>()

const emit = defineEmits<{
  (e: 'update:mode', value: 'never' | 'always' | 'custom'): void
  (e: 'update:tools', value: string[]): void
  (e: 'update:manualText', value: string): void
}>()

function onModeChange(event: Event): void {
  emit('update:mode', (event.target as HTMLSelectElement).value as 'never' | 'always' | 'custom')
}
</script>

<template>
  <label class="field" for="mcp-confirmation-mode">
    <span class="field__label">确认范围</span>
    <select id="mcp-confirmation-mode" :value="mode" @change="onModeChange">
      <option value="never">无需确认（默认，直接执行）</option>
      <option value="always">该服务全部工具都需确认</option>
      <option value="custom">仅指定工具需确认</option>
    </select>
  </label>

  <HitlToolPicker
    v-if="mode === 'custom'"
    :tools="catalog"
    :selected="props.tools"
    :orphans="orphans"
    :manual-fallback="manualFallback"
    :manual-text="manualText"
    :truncated="truncated"
    @update:selected="emit('update:tools', $event)"
    @update:manual-text="emit('update:manualText', $event)"
  />
</template>

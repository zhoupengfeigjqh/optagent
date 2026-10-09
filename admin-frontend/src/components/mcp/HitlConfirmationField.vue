<script setup lang="ts">
/**
 * 「调用人工确认（HITL）」的确认范围与工具清单（2026-10-08 从 `McpCallConfigForm` 拆出，
 * 该文件触了 500 行门禁，宪章原则二）。
 *
 * 只承载**界面**：模式选择 + 需确认的工具（复用 `HitlToolPicker`）。
 * 「切换模式后清空/丢弃清单外的规则参数」属**提交语义**的级联，留在父级一处判据里。
 */
import type { McpToolInfo } from '../../api/types'
import HitlToolPicker from './HitlToolPicker.vue'

const props = defineProps<{
  mode: 'never' | 'always' | 'custom'
  /** 已勾选的工具名（custom 模式） */
  tools: string[]
  /** custom 且清单不可得时的手填文本 */
  manualText: string
  /** 服务当前工具清单（探测结果） */
  catalog: McpToolInfo[]
  /** 已保存但当前清单里没有的工具名 */
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

<script setup lang="ts">
/**
 * 内置工具选择器（`FR-011`、`FR-013`）。
 *
 * 取值范围**只能是平台统一清单**（此处即运行环境只读投影的目录），
 * 因此界面上无法"手输一个不存在的工具名"。
 * 已保存但已下线的引用会作为**失效项**单独列出并标注（`FR-013`），
 * 而不是静默消失——"配了等于没配"正是规格要避免的。
 */
import { computed } from 'vue'
import type { BuiltinTool } from '../../api/types'
import CheckboxList from '../common/CheckboxList.vue'
import type { CheckboxOption } from '../common/checkbox-option'

const props = defineProps<{
  tools: BuiltinTool[]
  modelValue: string[]
  /** 目录不可读时的可读原因（`ADM_RUNTIME_UNREACHABLE`）：此时保存含工具的配置会被拒绝 */
  errorMessage?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const options = computed<CheckboxOption[]>(() =>
  props.tools.map((tool) => ({
    value: tool.name,
    label: tool.label,
    description: tool.description_template,
    badge: tool.writable ? '可写' : '只读',
  })),
)

const known = computed(() => new Set(props.tools.map((t) => t.name)))
const orphans = computed(() => props.modelValue.filter((name) => !known.value.has(name)))
</script>

<template>
  <div class="tool-selector">
    <p v-if="errorMessage" class="tool-selector__error" role="alert">{{ errorMessage }}</p>
    <!-- 占位符说明（原"内置工具目录"卡片合并于此，2026-09-15）：避免把花括号误认为渲染失败 -->
    <p class="tool-selector__note">
      说明中的花括号（如 <code>{示例路径}</code>、<code>{可用目录}</code>、<code>{会话标识}</code>）
      是占位符，部署到具体用户后才会替换为真实取值；目录由运行环境提供，平台只读。
    </p>
    <CheckboxList
    legend="启用的内置工具"
    :options="options"
    :model-value="modelValue"
    :orphans="orphans"
    search-placeholder="按名称或说明搜索工具…"
    empty-text="运行环境未提供任何内置工具（请确认运行环境可达）"
    @update:model-value="emit('update:modelValue', $event)"
  />
  </div>
</template>

<style scoped>
.tool-selector__error {
  margin: 0 0 var(--space-2);
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.tool-selector__note {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>

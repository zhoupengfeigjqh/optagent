<!--
  异步工具选择（R11，`contracts/admin-api.md` §3.3 的 `async_tools`）。

  交互与 HITL 的「需确认的工具」同一范式：
  - 有工具清单 → 复选框多选（清单来自平台对该服务的最近一次探测）；
  - 清单不可得（服务未启动 / 探测失败）→ 回退**手填**，每行一个工具名
    —— 服务抖动不该让配置改不了（与保存期"只校验语法、不校验清单"同一取向）；
  - 已保存但当前清单没有的工具 → **保留展示**，不静默丢弃（可能是清单截断或服务改版）。

  独立成组件而非并入 `McpCallConfigForm.vue`：后者已接近 500 行硬门禁（原则二）。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { McpToolInfo } from '../../api/types'

const props = defineProps<{
  /** 已声明的异步工具名（该服务的**原始**工具名，不含服务前缀） */
  modelValue: string[]
  /** 服务当前工具清单；为空表示清单不可得 */
  tools: McpToolInfo[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>()

/** 清单不可得 → 回退手填（服务未启动/探测失败时管理员仍要能改配置） */
const manualFallback = computed(() => props.tools.length === 0)

/** 已声明、但当前清单里已没有的工具：保留展示，不静默丢弃 */
const orphanTools = computed(() =>
  props.modelValue.filter((name) => !props.tools.some((t) => t.name === name)),
)

/** 手填文本（每行一个）；与 `modelValue` 保持同步，切回多选视图时不丢内容 */
const manualText = ref(props.modelValue.join('\n'))
watch(
  () => props.modelValue,
  (value) => {
    manualText.value = value.join('\n')
  },
)

function toggle(name: string, checked: boolean): void {
  emit(
    'update:modelValue',
    checked
      ? [...new Set([...props.modelValue, name])]
      : props.modelValue.filter((n) => n !== name),
  )
}

/** 手填 → 去空白、丢弃空行、去重后再上报（与保存期口径一致，避免提交就被拒） */
function onManualInput(value: string): void {
  manualText.value = value
  emit('update:modelValue', [
    ...new Set(
      value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    ),
  ])
}
</script>

<template>
  <div class="async-tools">
    <!-- 有清单：复选框多选 -->
    <div
      v-if="!manualFallback"
      class="async-tools__list"
      role="group"
      aria-label="异步工具清单"
    >
      <label v-for="tool in tools" :key="tool.name" class="async-tools__item">
        <input
          type="checkbox"
          :checked="modelValue.includes(tool.name)"
          @change="toggle(tool.name, ($event.target as HTMLInputElement).checked)"
        />
        <span class="async-tools__name mono">{{ tool.name }}</span>
        <span v-if="tool.description" class="async-tools__desc">{{ tool.description }}</span>
      </label>

      <label
        v-for="name in orphanTools"
        :key="`orphan:${name}`"
        class="async-tools__item async-tools__item--orphan"
      >
        <input
          type="checkbox"
          :checked="true"
          @change="toggle(name, ($event.target as HTMLInputElement).checked)"
        />
        <span class="async-tools__name mono">{{ name }}</span>
        <span class="async-tools__desc">
          （已保存，当前服务清单中未包含；可能是清单截断或服务改版）
        </span>
      </label>
    </div>

    <!-- 清单不可得：回退手填，每行一个 -->
    <textarea
      v-else
      :value="manualText"
      rows="3"
      aria-label="异步工具名（每行一个）"
      placeholder="工具名不含服务前缀，例如：&#10;submit_job"
      @input="onManualInput(($event.target as HTMLTextAreaElement).value)"
    />
  </div>
</template>

<style scoped>
.async-tools__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 8px;
}

.async-tools__item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  cursor: pointer;
}

.async-tools__item--orphan {
  color: var(--color-text-muted);
}

.async-tools__name {
  font-family: monospace;
}

.async-tools__desc {
  font-size: 0.85em;
  color: var(--color-text-muted);
}

textarea {
  width: 100%;
  font: inherit;
}
</style>

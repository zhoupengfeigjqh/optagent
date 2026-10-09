<!--
  异步工具选择（R11，`contracts/admin-api.md` §3.3 的 `async_tools`）。

  **只列"支持异步"的工具**（2026-10-03 产品决定）：判据 = 该工具的入参 schema
  `properties` 里声明了 `resultUrl`（与运行期注入逻辑同一判据，见 `utils/async-tool.ts`）。
  不含该参数的工具**一律不展示**——勾了也不会生效（运行期只产生一条告警），列出来只会误导。

  **过滤后为空**（清单可得但没有任何工具声明 `resultUrl`）→ 单行提示
  「当前没有异步计算工具」，与「URL铸造参数设置」的空态同一呈现（`field__hint`）。

  四条边界（缺一会让"少列"退化成"看不见"）：
  1. **清单不可得**（服务未启动/探测失败）→ 回退**手填**，并给出 `toolsError` 原因
     —— 服务抖动不该让配置改不了（与保存期"只校验语法、不校验清单"同一取向）；
  2. **已声明但不在可选范围内**（服务后来去掉了 `resultUrl`，或该工具已下线）→
     **仍保留展示并可直接取消**，不静默丢弃：否则它会在运行期持续告警而管理员无从取消；
  3. **清单被截断**（`toolsTruncated`）→ 未展示的工具无从判断，故同时给出手填入口；
  4. **忙态不锁控件**：本组件不接收 `busy`/`disabled`（契约 §0.5 原则 ③）。

  独立成组件而非并入 `McpCallConfigForm.vue`：后者已接近 500 行硬门禁（原则二）。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { McpToolInfo } from '../../api/types'
import { hasResultUrl } from '../../utils/async-tool'

const props = withDefaults(
  defineProps<{
    /** 已声明的异步工具名（该服务的**原始**工具名，不含服务前缀） */
    modelValue: string[]
    /** 服务当前工具清单；为空表示清单不可得 */
    tools: McpToolInfo[]
    /** 清单不可得时的可读原因（服务不可达等）；用于把手填回退说清楚 */
    toolsError?: string | null
    /** 清单是否被截断（截断时未展示的工具无从判断，需保留手填） */
    toolsTruncated?: boolean
  }>(),
  { toolsError: null, toolsTruncated: false },
)

const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>()

/** 支持异步的工具：入参 schema 声明了 `resultUrl`——**只展示这些** */
const capableTools = computed(() => props.tools.filter((tool) => hasResultUrl(tool.parameters)))

/** 清单不可得 → 回退手填（服务未启动/探测失败时管理员仍要能改配置） */
const manualFallback = computed(() => props.tools.length === 0)
/** 是否给出手填逃生门：清单不可得，或清单被截断（未展示的工具无从判断） */
const showManual = computed(() => manualFallback.value || props.toolsTruncated)

/**
 * 已声明、但**不在可选范围内**的工具：保留展示，不静默丢弃。
 *
 * 包含两类：该工具已不在清单里（服务改版/清单截断），或它存在但没声明 `resultUrl`
 * （服务去掉了该参数）。两种情况下声明都不会生效，需让管理员看得见并一键取消。
 */
const declaredOutOfScope = computed(() =>
  props.modelValue.filter((name) => !capableTools.value.some((tool) => tool.name === name)),
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
    <!-- 有清单：只列支持异步（声明了 resultUrl）的工具 -->
    <template v-if="!manualFallback">
      <div
        v-if="capableTools.length > 0"
        class="async-tools__list"
        role="group"
        aria-label="异步工具清单"
      >
        <label v-for="tool in capableTools" :key="tool.name" class="async-tools__item">
          <input
            type="checkbox"
            :checked="modelValue.includes(tool.name)"
            @change="toggle(tool.name, ($event.target as HTMLInputElement).checked)"
          />
          <span class="async-tools__name mono">{{ tool.name }}</span>
          <span v-if="tool.description" class="async-tools__desc">{{ tool.description }}</span>
        </label>
      </div>
      <!-- 过滤后为空：与「URL铸造参数设置」的空态同一呈现（`field__hint` 单行提示） -->
      <p v-else class="field__hint">当前没有异步计算工具</p>

      <!-- 已声明但不在可选范围内：保留展示，可取消（否则会持续告警却无从取消） -->
      <div v-if="declaredOutOfScope.length > 0" class="async-tools__out-of-scope">
        <label
          v-for="name in declaredOutOfScope"
          :key="`declared:${name}`"
          class="async-tools__item async-tools__item--orphan"
        >
          <input
            type="checkbox"
            :checked="true"
            @change="toggle(name, ($event.target as HTMLInputElement).checked)"
          />
          <span class="async-tools__name mono">{{ name }}</span>
          <span class="async-tools__desc">
            （已声明，但该工具当前未声明 resultUrl 或不在清单中——声明不会生效，建议取消）
          </span>
        </label>
      </div>
    </template>

    <!-- 清单不可得 / 被截断：手填逃生门（每行一个） -->
    <textarea
      v-if="showManual"
      class="async-tools__manual"
      :value="manualText"
      rows="3"
      aria-label="异步工具名（每行一个）"
      placeholder="工具名不含服务前缀，例如：&#10;submit_job"
      @input="onManualInput(($event.target as HTMLTextAreaElement).value)"
    />

    <p v-if="manualFallback && toolsError" class="async-tools__error">
      工具清单不可得：{{ toolsError }}
    </p>
    <p v-else-if="toolsTruncated" class="async-tools__error">
      工具清单被截断显示：未展示的工具若支持异步，可用上方手填补充（完整清单以服务端为准）。
    </p>
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
  font-family: var(--font-family-mono, monospace);
}

.async-tools__desc {
  font-size: 0.85em;
  color: var(--color-text-muted);
}

.async-tools__error {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: var(--line-height-base);
}

.async-tools__out-of-scope {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.async-tools__manual {
  width: 100%;
  margin-top: 8px;
  font: inherit;
}
</style>

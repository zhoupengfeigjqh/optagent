<script setup lang="ts">
/**
 * 数字人明细与切换面板（T066，FR-035 / FR-036 / FR-037）
 *
 * 基于 `BaseDialog`：焦点陷阱与 Esc 关闭由原生 `<dialog>` 提供。
 * - 详情区默认展示**当前选中**数字人；点击候选名称可**只读预览**其他数字人
 *   （描述/技能/已启用工具/MCP 清单取自 `candidates`，不额外发请求、不触发切换）
 * - 预览态展示「预览中」标识与「切换到此数字人」按钮；预览是只读操作，**不受**会话进行中限制
 * - 有进行中的会话（`switchingDisabled`）→ **切换**按钮置灰、`aria-disabled` 并说明原因（V-14）
 * - 切换请求进行中（`busy`）→ 禁止重复点击
 * - 切换为**单次覆盖式选中**（无需先退出），由 `useAgents.switchTo` 落库，成功提示由该 composable 给出；
 *   会话不绑定数字人，切换后的新数字人在**下一轮消息**生效（FR-014 / FR-037 修订）
 */
import { computed, ref, watch } from 'vue'

import type { DigitalHuman } from '../../api/types'
import BaseButton from '../common/BaseButton.vue'
import BaseDialog from '../common/BaseDialog.vue'

const props = withDefaults(
  defineProps<{
    /** 是否展开 */
    open?: boolean
    /** 当前数字人详情 */
    current?: DigitalHuman | null
    /** 可切换列表 */
    candidates?: DigitalHuman[]
    /** 会话进行中 → 置灰（FR-036） */
    switchingDisabled?: boolean
    /** 切换请求进行中 */
    busy?: boolean
  }>(),
  {
    open: false,
    current: null,
    candidates: () => [],
    switchingDisabled: false,
    busy: false,
  },
)

const emit = defineEmits<{
  close: []
  switch: [agentName: string]
}>()

/** 预览中的数字人名称；`null` = 详情区展示当前选中 */
const previewName = ref<string | null>(null)

/** 面板关闭时复位；切换成功后（`current` 变为被预览者）自动收敛回当前视图 */
watch(
  () => [props.open, props.current?.agent_name] as const,
  ([open, currentName]) => {
    if (!open || previewName.value === currentName) {
      previewName.value = null
    }
  },
)

/** 预览对象：从已就绪的候选详情中按名称取用 */
const previewAgent = computed<DigitalHuman | null>(() => {
  if (previewName.value === null) {
    return null
  }
  return props.candidates.find((item) => item.agent_name === previewName.value) ?? null
})

/** 详情区展示对象：预览优先，否则当前选中 */
const displayed = computed<DigitalHuman | null>(() => previewAgent.value ?? props.current)

/** 是否处于「预览其他数字人」状态（预览对象即当前数字人时不作预览处理） */
const previewing = computed(
  () => previewAgent.value !== null && previewAgent.value.agent_name !== props.current?.agent_name,
)

const canSwitch = computed(() => !props.switchingDisabled && !props.busy)
const disabledReason = computed(() =>
  props.switchingDisabled ? '会话进行中，无法切换数字人' : null,
)

function isCurrent(name: string): boolean {
  return props.current?.agent_name === name
}

function isPreviewing(name: string): boolean {
  return previewing.value && previewName.value === name
}

/** 点击候选名称：预览该数字人；点击当前项则回到当前视图（只读，不发请求） */
function onPreview(name: string): void {
  previewName.value = isCurrent(name) ? null : name
}

function onSwitch(name: string): void {
  if (!canSwitch.value || isCurrent(name)) {
    return
  }
  emit('switch', name)
}
</script>

<template>
  <BaseDialog class="agent-panel" :open="open" title="数字人" @close="emit('close')">
    <section class="agent-panel__detail">
      <p v-if="displayed === null" class="agent-panel__hint">尚未选择数字人</p>

      <template v-else>
        <div v-if="previewing" class="agent-panel__preview-bar">
          <span class="agent-panel__preview-badge">预览中</span>
          <span class="agent-panel__hint agent-panel__preview-hint">未选中，仅查看配置</span>
          <BaseButton
            variant="primary"
            size="sm"
            :disabled="!canSwitch"
            :disabled-reason="disabledReason"
            @click="onSwitch(displayed.agent_name)"
          >
            切换到此数字人
          </BaseButton>
        </div>

        <h3 class="agent-panel__name">{{ displayed.agent_name }}</h3>
        <p class="agent-panel__description">{{ displayed.soul || '暂无描述' }}</p>

        <h4 class="agent-panel__section">技能</h4>
        <ul v-if="displayed.skills.length > 0" class="agent-panel__list">
          <li v-for="skill in displayed.skills" :key="skill.name">
            {{ skill.name }}：{{ skill.description }}
          </li>
        </ul>
        <p v-else class="agent-panel__hint">暂无技能</p>

        <h4 class="agent-panel__section">已启用工具</h4>
        <ul
          v-if="displayed.enabled_tools.length > 0"
          class="agent-panel__list agent-panel__list--inline"
        >
          <li v-for="tool in displayed.enabled_tools" :key="tool" class="agent-panel__tool">
            {{ tool }}
          </li>
        </ul>
        <p v-else class="agent-panel__hint">暂无已启用工具</p>

        <h4 class="agent-panel__section">MCP 服务</h4>
        <ul v-if="displayed.mcp_servers.length > 0" class="agent-panel__list">
          <li v-for="server in displayed.mcp_servers" :key="server.name">
            {{ server.name }}（{{ server.transport }}）
          </li>
        </ul>
        <p v-else class="agent-panel__hint">未挂载 MCP 服务</p>
      </template>
    </section>

    <section class="agent-panel__candidates">
      <h4 class="agent-panel__section">可切换的数字人（点击名称查看配置）</h4>

      <ul v-if="candidates.length > 0" class="agent-panel__list">
        <li
          v-for="candidate in candidates"
          :key="candidate.agent_name"
          class="agent-panel__candidate"
        >
          <button
            type="button"
            class="agent-panel__candidate-name"
            :class="{
              'agent-panel__candidate-name--previewing': isPreviewing(candidate.agent_name),
            }"
            :aria-pressed="isPreviewing(candidate.agent_name)"
            :title="`查看 ${candidate.agent_name} 的配置`"
            @click="onPreview(candidate.agent_name)"
          >
            {{ candidate.agent_name }}
          </button>
          <BaseButton
            size="sm"
            :disabled="!canSwitch || isCurrent(candidate.agent_name)"
            :disabled-reason="disabledReason"
            @click="onSwitch(candidate.agent_name)"
          >
            {{ isCurrent(candidate.agent_name) ? '当前' : '切换' }}
          </BaseButton>
        </li>
      </ul>
      <p v-else class="agent-panel__hint">暂无可切换的数字人</p>
    </section>
  </BaseDialog>
</template>

<style scoped>
.agent-panel__detail,
.agent-panel__candidates {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.agent-panel__candidates {
  margin-top: var(--space-5);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.agent-panel__name {
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.agent-panel__description {
  white-space: pre-wrap;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.agent-panel__section {
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.agent-panel__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.agent-panel__list--inline {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.agent-panel__tool {
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
}

.agent-panel__candidate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.agent-panel__candidate-name {
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}

.agent-panel__candidate-name:hover {
  background: var(--color-bg-subtle);
}

.agent-panel__candidate-name--previewing {
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 600;
}

.agent-panel__preview-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
}

.agent-panel__preview-badge {
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: var(--font-size-sm);
}

.agent-panel__preview-hint {
  flex: 1;
}

.agent-panel__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>

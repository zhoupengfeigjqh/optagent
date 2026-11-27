<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { DigitalHuman } from '../../api/types'
import BaseButton from '../common/BaseButton.vue'
import BaseDialog from '../common/BaseDialog.vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    current?: DigitalHuman | null
    candidates?: DigitalHuman[]
    /** 禁止切换（一轮回答进行中）→ 置灰（FR-015 / FR-036） */
    switchingDisabled?: boolean
    /**
     * 禁止切换的**原因文案**（由 `useAgents.switchingDisabledReason` 给出）。
     * 缺省时回落到通用文案，保证"禁用必有解释"。
     */
    switchingDisabledReason?: string | null
    busy?: boolean
  }>(),
  {
    open: false,
    current: null,
    candidates: () => [],
    switchingDisabled: false,
    switchingDisabledReason: null,
    busy: false,
  },
)

const emit = defineEmits<{
  close: []
  switch: [agentName: string]
}>()

const previewName = ref<string | null>(null)

watch(
  () => [props.open, props.current?.agent_name] as const,
  ([open, currentName]) => {
    if (!open || previewName.value === currentName) {
      previewName.value = null
    }
  },
)

const previewAgent = computed<DigitalHuman | null>(() => {
  if (previewName.value === null) {
    return null
  }
  return props.candidates.find((item) => item.agent_name === previewName.value) ?? null
})

/** 详情区展示对象：预览优先，否则当前选中 */
const displayed = computed<DigitalHuman | null>(() => previewAgent.value ?? props.current)

const previewing = computed(
  () => previewAgent.value !== null && previewAgent.value.agent_name !== props.current?.agent_name,
)

const canSwitch = computed(() => !props.switchingDisabled && !props.busy)

/**
 * 禁用原因提示的元素 id：按钮以 `aria-describedby` 关联它。
 *
 * 仅靠 `title` 不足以让辅助技术稳定播报（且触屏无悬停），故原因必须**同时**是
 * DOM 里的可读文本（FR-015 的"可读提示"）。
 */
const REASON_ID = 'agent-panel-switch-blocked'

/**
 * 禁止切换的原因（禁用态必有解释，FR-015）。
 *
 * 文案来自 `useAgents.switchingDisabledReason`（判定与文案的唯一实现）；
 * 缺省（调用方未传）回落到通用文案，避免出现"置灰但说不出为什么"。
 */
const disabledReason = computed(() => {
  if (!props.switchingDisabled) return null
  return props.switchingDisabledReason ?? '会话进行中，无法切换数字人'
})

const displayedIntro = computed<string>(() => {
  const intro = displayed.value?.intro?.trim() ?? ''
  if (intro !== '') return intro
  return (
    (displayed.value?.soul ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  )
})

function isCurrent(name: string): boolean {
  return props.current?.agent_name === name
}

function isPreviewing(name: string): boolean {
  return previewing.value && previewName.value === name
}

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
            :aria-describedby="disabledReason ? REASON_ID : undefined"
            @click="onSwitch(displayed.agent_name)"
          >
            切换到此数字人
          </BaseButton>
        </div>

        <h3 class="agent-panel__name">{{ displayed.agent_name }}</h3>
        <p class="agent-panel__description">{{ displayedIntro || '暂无简介' }}</p>

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
            {{ server.name }}
          </li>
        </ul>
        <p v-else class="agent-panel__hint">未挂载 MCP 服务</p>
      </template>
    </section>

    <section class="agent-panel__candidates">
      <h4 class="agent-panel__section">可切换的数字人（点击名称查看配置）</h4>

      <p
        v-if="disabledReason"
        :id="REASON_ID"
        class="agent-panel__hint agent-panel__blocked"
        role="status"
      >
        {{ disabledReason }}
      </p>

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
            :aria-describedby="disabledReason ? REASON_ID : undefined"
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

/* 禁用原因：与"提示"同色但用左侧竖线强调——用户必须能读到"为什么不能切" */
.agent-panel__blocked {
  padding-left: var(--space-2);
  border-left: 2px solid var(--color-warning, var(--color-border));
  color: var(--color-text-secondary);
}
</style>

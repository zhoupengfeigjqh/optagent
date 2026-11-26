<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BuiltinTool, McpServiceListItem, SoulDesign, SoulStarter } from '../../api/types'
import { SOUL_LIMITS, emptySoulDesign } from '../../constants/agent-design'
import TagInput from '../common/TagInput.vue'
import QuickStartDialog from './QuickStartDialog.vue'

const props = defineProps<{
  modelValue: SoulDesign
  enabledTools: string[]
  builtinTools: BuiltinTool[]
  mountedServices: string[]
  mcpServices: McpServiceListItem[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: SoulDesign): void
}>()

const quickStartOpen = ref(false)

/** 兜底空结构：防止上游传入残缺对象（如手工构造的测试数据）时模板取值报错 */
const soul = computed<SoulDesign>(() => props.modelValue ?? emptySoulDesign())

const introEmpty = computed(() => soul.value.intro.trim() === '')
const missionEmpty = computed(() => soul.value.mission.trim() === '')

function patch(partial: Partial<SoulDesign>): void {
  emit('update:modelValue', { ...soul.value, ...partial })
}

function onQuickStartSave(value: { welcome: string; starters: SoulStarter[] }): void {
  patch({ welcome: value.welcome, starters: value.starters })
}

function onHintCountChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  const valid =
    input.value.trim() !== '' &&
    Number.isInteger(value) &&
    value >= SOUL_LIMITS.nextActionHintsMin &&
    value <= SOUL_LIMITS.nextActionHintsMax
  if (!valid) {
    input.value = String(soul.value.next_action_hints_count)
    return
  }
  if (value !== soul.value.next_action_hints_count) patch({ next_action_hints_count: value })
}

/**
 * 意图聚焦开关（013）：**关闭时顺带关闭下一步动作提示**——两者是依赖关系
 * （下一步动作提示依赖意图聚焦，见 `normalizeSoulDesign` 的门控），不能留在
 * 界面上留下"意图聚焦关着、下一步动作提示却开着"的死配置。
 */
function onIntentFocusChange(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  if (!checked) patch({ intent_focus: false, next_action_hints: false })
  else patch({ intent_focus: true })
}

const FOCUS_DEPTH_OPTIONS = [
  { value: SOUL_LIMITS.focusDepthMin, label: '0 阶（只聚焦本身）' },
  { value: 1, label: '1 阶（向上一跳 / 向下一跳）' },
  { value: SOUL_LIMITS.focusDepthMax, label: '2 阶（向上两跳 / 向下两跳）' },
] as const

function onFocusDepthChange(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  const valid =
    Number.isInteger(value) &&
    value >= SOUL_LIMITS.focusDepthMin &&
    value <= SOUL_LIMITS.focusDepthMax
  if (!valid || value === soul.value.intent_focus_depth) return
  patch({ intent_focus_depth: value })
}
</script>

<template>
  <div class="soul-editor">
    <label class="field" for="soul-intro">
      <span class="field__label">
        角色简介<span class="field__required" aria-hidden="true">*</span>
        <span class="soul-editor__scope">只给前台</span>
      </span>
      <textarea
        id="soul-intro"
        :value="soul.intro"
        rows="2"
        :maxlength="SOUL_LIMITS.intro"
        :aria-required="true"
        :aria-invalid="introEmpty"
        placeholder="例如：专注订单交付风险排查的助理，能读订单表、抽取单据图片。"
        @input="patch({ intro: ($event.target as HTMLTextAreaElement).value })"
      />
      <span class="field__hint">
        数字人切换面板里展示给用户的身份说明。
        {{ soul.intro.length }} / {{ SOUL_LIMITS.intro }} 字
        <span v-if="introEmpty">（当前为空，保存会被拒绝）</span>
      </span>
    </label>

    <label class="field" for="soul-mission">
      <span class="field__label">
        主要使命<span class="field__required" aria-hidden="true">*</span>
        <span class="soul-editor__scope soul-editor__scope--prompt">进系统提示词</span>
      </span>
      <textarea
        id="soul-mission"
        :value="soul.mission"
        rows="8"
        :maxlength="SOUL_LIMITS.mission"
        :aria-required="true"
        :aria-invalid="missionEmpty"
        placeholder="例如：你的职责是帮助业务人员发现订单交付环节的风险，给出可执行的跟单建议……"
        @input="patch({ mission: ($event.target as HTMLTextAreaElement).value })"
      />
      <span class="field__hint">
        模型的人格主体，直接进入系统提示词。
        {{ soul.mission.length }} / {{ SOUL_LIMITS.mission }} 字
        <span v-if="missionEmpty">（当前为空，保存会被拒绝）</span>
      </span>
    </label>

    <div class="field">
      <span class="field__label">
        能力标签
        <span class="soul-editor__scope soul-editor__scope--prompt">进系统提示词</span>
      </span>
      <TagInput
        :model-value="soul.capability_tags"
        :max-items="SOUL_LIMITS.listItems"
        :max-length="SOUL_LIMITS.capabilityTagLength"
        placeholder="输入能力标签后回车，例如：订单排程"
        @update:model-value="patch({ capability_tags: $event })"
      />
    </div>

    <div class="field">
      <span class="field__label">
        绝对禁止
        <span class="soul-editor__scope soul-editor__scope--prompt">进系统提示词</span>
      </span>
      <TagInput
        :model-value="soul.forbidden"
        :max-items="SOUL_LIMITS.listItems"
        :max-length="SOUL_LIMITS.listItemLength"
        placeholder="输入禁止事项后回车，例如：不得编造订单号"
        @update:model-value="patch({ forbidden: $event })"
      />
    </div>

    <label class="field" for="soul-extra">
      <span class="field__label">
        补充说明
        <span class="soul-editor__scope soul-editor__scope--prompt">进系统提示词</span>
      </span>
      <textarea
        id="soul-extra"
        :value="soul.prompt_extra"
        rows="3"
        :maxlength="SOUL_LIMITS.promptExtra"
        placeholder="可选。放不进上面几项、但仍要告诉模型的话，例如：回答先给结论，再列依据。"
        @input="patch({ prompt_extra: ($event.target as HTMLTextAreaElement).value })"
      />
      <span class="field__hint">
        可选。{{ soul.prompt_extra.length }} / {{ SOUL_LIMITS.promptExtra }} 字
      </span>
    </label>

    <fieldset class="soul-editor__quick-start">
      <legend class="field__label">
        快速上手<span class="field__required" aria-hidden="true">*</span>
        <span class="soul-editor__scope">只给前台</span>
      </legend>
      <p class="field__hint">
        新建对话页展示的欢迎语与问题卡片；点击卡片即发起一轮对话。
        <strong>这些内容不会进入系统提示词。</strong>
      </p>
      <ul class="soul-editor__summary">
        <li>首屏欢迎语：{{ soul.welcome ? soul.welcome : '（未设置）' }}</li>
        <li>问题实例：{{ soul.starters.length }} 条</li>
      </ul>
      <button type="button" class="btn" data-test="open-quick-start" @click="quickStartOpen = true">
        编辑快速上手
      </button>
    </fieldset>

    <fieldset class="soul-editor__intent-focus">
      <legend class="field__label">
        意图聚焦
        <span class="soul-editor__scope">运行环境开关</span>
      </legend>
      <p class="field__hint" data-test="intent-focus-group-hint">
        本区四项都是运行环境开关，且都以「开启意图聚焦」为前提。关闭意图聚焦时：
        输入重写与术语替换的已选值保留（重新开启即恢复），下一步动作提示则会被一并关闭。
      </p>
      <label class="soul-editor__switch">
        <input
          type="checkbox"
          data-test="intent-focus"
          :checked="soul.intent_focus === true"
          @change="onIntentFocusChange"
        />
        是否开启意图聚焦
      </label>
      <p class="field__hint" data-test="intent-focus-hint">
        每一轮对话在生成回答之前先做一次意图判定，把最相关的工具或技能作为本轮规划重点（注意：有本体技能时阶数配置才生效！）。
      </p>
      <div
        class="soul-editor__depth"
        :class="{ 'soul-editor__depth--off': soul.intent_focus !== true }"
        role="radiogroup"
        aria-labelledby="soul-focus-depth-label"
      >
        <span id="soul-focus-depth-label" class="soul-editor__depth-label">聚焦阶数</span>
        <label
          v-for="option in FOCUS_DEPTH_OPTIONS"
          :key="option.value"
          class="soul-editor__depth-option"
        >
          <input
            type="radio"
            name="soul-focus-depth"
            :data-test="`intent-focus-depth-${option.value}`"
            :value="option.value"
            :checked="soul.intent_focus_depth === option.value"
            :disabled="soul.intent_focus !== true"
            @change="onFocusDepthChange"
          />
          {{ option.label }}
        </label>
        <p class="field__hint" data-test="intent-focus-depth-hint">
          以命中的本体行为所属概念为起点，上游方向进聚焦提示，
          下游方向进下一步动作提示；两侧各自最多走该阶数跳。
          缺省 0 阶 = 只聚焦本身。
        </p>
      </div>
      <label class="soul-editor__switch">
        <input
          type="checkbox"
          data-test="input-rewrite"
          :checked="soul.input_rewrite === true"
          :disabled="soul.intent_focus !== true"
          @change="patch({ input_rewrite: ($event.target as HTMLInputElement).checked })"
        />
        输入重写
      </label>
      <p class="field__hint" data-test="input-rewrite-hint">
        出现"上述结果 / 它 / 该单据"这类指代时，先据上文把它改写成语义自足的一句话，
        再用改写结果做技能与本体聚焦。改写只影响本轮聚焦，用户消息与历史仍是原话。
      </p>
      <label class="soul-editor__switch">
        <input
          type="checkbox"
          data-test="term-normalize"
          :checked="soul.term_normalize === true"
          :disabled="soul.intent_focus !== true"
          @change="patch({ term_normalize: ($event.target as HTMLInputElement).checked })"
        />
        术语替换
      </label>
      <p class="field__hint" data-test="term-normalize-hint">
        仅当该数字人拥有本体术语映射集时，开启本功能才会生效
      </p>
      <label class="soul-editor__switch">
        <input
          type="checkbox"
          data-test="task-planning"
          :checked="soul.task_planning === true"
          :disabled="soul.intent_focus !== true"
          @change="patch({ task_planning: ($event.target as HTMLInputElement).checked })"
        />
        任务规划
      </label>
      <p class="field__hint" data-test="task-planning-hint">
        需同时开启意图聚焦。开启后本轮先产出 1~3 步计划，再逐步收窄可用工具执行；
        未勾选即该数字人零规划调用。
      </p>

      <label class="soul-editor__switch">
        <input
          type="checkbox"
          data-test="next-action-hints"
          :checked="soul.next_action_hints === true"
          :disabled="soul.intent_focus !== true"
          @change="patch({ next_action_hints: ($event.target as HTMLInputElement).checked })"
        />
        是否开启下一步动作提示
      </label>
      <label
        class="soul-editor__count"
        :class="{ 'soul-editor__count--off': soul.next_action_hints !== true || soul.intent_focus !== true }"
        for="soul-next-action-hints-count"
      >
        <span>每轮最多提示条数</span>
        <input
          id="soul-next-action-hints-count"
          data-test="next-action-hints-count"
          type="number"
          :min="SOUL_LIMITS.nextActionHintsMin"
          :max="SOUL_LIMITS.nextActionHintsMax"
          step="1"
          :value="soul.next_action_hints_count"
          :disabled="soul.next_action_hints !== true || soul.intent_focus !== true"
          @change="onHintCountChange"
        />
        <span class="field__hint">
          可填 {{ SOUL_LIMITS.nextActionHintsMin }}~{{ SOUL_LIMITS.nextActionHintsMax }} 的整数，
          缺省 {{ SOUL_LIMITS.nextActionHintsDefault }} 条。
        </span>
      </label>
    </fieldset>

    <QuickStartDialog
      v-model:open="quickStartOpen"
      :welcome="soul.welcome"
      :starters="soul.starters"
      :enabled-tools="enabledTools"
      :builtin-tools="builtinTools"
      :mounted-services="mountedServices"
      :mcp-services="mcpServices"
      @save="onQuickStartSave"
    />
  </div>
</template>

<style scoped>
.soul-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.soul-editor__scope {
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm, 4px);
  font-size: var(--font-size-xs, 12px);
  font-weight: 400;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted, #f2f4f8);
}

.soul-editor__scope--prompt {
  color: var(--color-primary, #2f6fed);
  background: var(--color-primary-subtle, #eaf1ff);
}

.soul-editor__quick-start {
  border: 1px solid var(--color-border, #dfe3ea);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}

.soul-editor__intent-focus {
  border: 1px solid var(--color-border, #dfe3ea);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}

.soul-editor__switch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}

.soul-editor__count {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
  cursor: pointer;
}

.soul-editor__count input {
  width: 6em;
}

/* 关闭开关时：条数输入**置灰且不可填写**（`disabled` 由模板控制），
   行内文字与手型一并弱化——让"这个数字当前不生效"一眼可见 */
.soul-editor__count input:disabled {
  color: var(--color-text-muted);
  background: var(--color-bg-muted, #f2f4f8);
  cursor: not-allowed;
}

.soul-editor__count--off {
  cursor: default;
  color: var(--color-text-muted);
}

.soul-editor__count .field__hint {
  flex-basis: 100%;
}

.soul-editor__depth {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.soul-editor__depth-label {
  color: var(--color-text-secondary);
}

.soul-editor__depth-option {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  cursor: pointer;
}

.soul-editor__depth-option input:disabled {
  cursor: not-allowed;
}

.soul-editor__depth--off {
  color: var(--color-text-muted);
}

.soul-editor__depth--off .soul-editor__depth-option {
  cursor: default;
}

.soul-editor__depth .field__hint {
  flex-basis: 100%;
}

.soul-editor__summary {
  margin: var(--space-2) 0;
  padding-left: var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>

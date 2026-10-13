<script setup lang="ts">
/**
 * SOUL 编辑器（004：结构化）。
 *
 * 五个字段分两类，界面上明确标出归属：
 *
 * | 字段 | 归属 |
 * |---|---|
 * | 角色简介 | **只给前台**：数字人切换面板展示 |
 * | 首屏欢迎语 / 问题实例 | **只给前台**：新建对话页的引导（经「快速上手」弹窗编辑） |
 * | 主要使命 / 能力标签 / 绝对禁止 / 补充说明 | **进系统提示词** |
 * | 下一步动作提示（007） | **运行环境开关**：只写进 SOUL.md 的 frontmatter，由运行环境读取 |
 *
 * 这么分是因为运行环境只把 SOUL.md 的**正文**当作系统提示词
 * （frontmatter 承载展示数据），界面上说清归属，管理员才不会把展示文案
 * 误当提示词写、或反之。
 */
import { computed, ref } from 'vue'
import type { BuiltinTool, McpServiceListItem, SoulDesign, SoulStarter } from '../../api/types'
import { SOUL_LIMITS, emptySoulDesign } from '../../constants/agent-design'
import TagInput from '../common/TagInput.vue'
import QuickStartDialog from './QuickStartDialog.vue'

const props = defineProps<{
  modelValue: SoulDesign
  /** 该数字人已启用的内置工具（快速上手的工具候选） */
  enabledTools: string[]
  builtinTools: BuiltinTool[]
  /** 该数字人已挂载的 MCP 服务名 */
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

/**
 * 条数输入（`type="number"`，min / max 与初值共用 `SOUL_LIMITS`）。
 *
 * **拒绝式，与后端同口径**：只有 1~6 的整数才上抛；其余（空 / 小数 / 越界 / 手输字母）
 * 一律**把输入框弹回当前值**、不产生改动——既避免"界面显示 7、产物写 3"这类错配，
 * 也不为一次误输入打断保存（保存期后端仍会独立拒绝非法值）。
 */
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
      <button
        type="button"
        class="btn"
        data-test="open-quick-start"
        @click="quickStartOpen = true"
      >
        编辑快速上手
      </button>
    </fieldset>

    <!-- 007：运行期开关。它既不属于"只给前台"也不属于"进系统提示词"，而是**只写进
         SOUL.md 的 frontmatter**、由运行环境当作功能开关读取，故单独成区并写明去向，
         避免管理员误以为它会影响模型行为 -->
    <fieldset class="soul-editor__next-steps">
      <legend class="field__label">
        下一步动作提示
        <span class="soul-editor__scope">运行环境开关</span>
      </legend>
      <label class="soul-editor__switch">
        <input
          type="checkbox"
          data-test="next-action-hints"
          :checked="soul.next_action_hints === true"
          @change="patch({ next_action_hints: ($event.target as HTMLInputElement).checked })"
        />
        是否开启下一步动作提示
      </label>
      <!-- 开关的**参数**：关闭时**置灰且不可填写**（`disabled`），但**不回退数值**——
           管理员先前填的数字被保留，再次打开即恢复，不必重填（它只在开启时才写进产物） -->
      <label
        class="soul-editor__count"
        :class="{ 'soul-editor__count--off': soul.next_action_hints !== true }"
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
          :disabled="soul.next_action_hints !== true"
          @change="onHintCountChange"
        />
        <span class="field__hint">
          可填 {{ SOUL_LIMITS.nextActionHintsMin }}~{{ SOUL_LIMITS.nextActionHintsMax }} 的整数，
          缺省 {{ SOUL_LIMITS.nextActionHintsDefault }} 条；关闭开关时该数值保留、不写进产物。
        </span>
      </label>
      <p class="field__hint" data-test="next-action-hints-hint">
        开启后，该数字人每一轮回答的下方会出现最多 {{ soul.next_action_hints_count }} 条可点击的下一步动作卡片（点击即经确认发起下一轮）。
        关闭则部署后该功能消失：<strong>产物里不会写这个键</strong>，运行环境不会为此多做一次模型调用。
      </p>
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

.soul-editor__next-steps {
  border: 1px solid var(--color-border, #dfe3ea);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}

/* 布尔开关：原生 checkbox（与 `ScenarioFieldDialog` 的「必填」同款），
   整行可点——点击文字也能切换，不必精确命中那个小方块 */
.soul-editor__switch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}

/* 开关的条数参数：与开关同区、紧随其后；`disabled` 由模板按开关状态控制 */
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

.soul-editor__summary {
  margin: var(--space-2) 0;
  padding-left: var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>

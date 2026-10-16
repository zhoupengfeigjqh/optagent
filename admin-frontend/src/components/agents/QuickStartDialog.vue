<script setup lang="ts">
/**
 * 「快速上手」编辑弹窗（004）。
 *
 * 编辑两个**只给前台、不进模型**的字段：
 * - **首屏欢迎语**：新建对话页中间展示；
 * - **问题实例**：新建对话页平铺的卡片，点击即把 `prompt` 作为用户消息发出；
 *   每条可关联工具（内置工具 + 已挂载 MCP 服务的可见工具），生成的引导文本
 *   **对用户不可见**，只在那一轮追加进系统提示词。
 *
 * 用原生 `<dialog>` + `showModal()`（与 `ConfirmDialog` 同范式：焦点陷阱、
 * `aria-modal`、Esc 关闭由浏览器提供）。
 *
 * 弹窗内改的是**本地副本**，点「确定」才提交——点取消时草稿不受影响。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { BuiltinTool, McpServiceListItem, SoulStarter, SoulStarterTool } from '../../api/types'
import { SOUL_LIMITS } from '../../constants/agent-design'

const props = defineProps<{
  open: boolean
  welcome: string
  starters: SoulStarter[]
  /** 该数字人**已启用**的内置工具（关联工具的候选范围） */
  enabledTools: string[]
  builtinTools: BuiltinTool[]
  /** 该数字人**已挂载**的 MCP 服务名 */
  mountedServices: string[]
  mcpServices: McpServiceListItem[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'save', value: { welcome: string; starters: SoulStarter[] }): void
}>()

/** 工具候选（含展示用的中文名与所属分组） */
interface ToolOption {
  tool: SoulStarterTool
  label: string
}

const dialogEl = ref<HTMLDialogElement | null>(null)
const localWelcome = ref('')
const localStarters = ref<SoulStarter[]>([])
let restoreFocusTo: HTMLElement | null = null

/** 内置工具候选：只列**已启用**的（未启用的工具运行时没注册给模型，引导它没有意义） */
const builtinOptions = computed<ToolOption[]>(() =>
  props.enabledTools.map((name) => {
    const meta = props.builtinTools.find((tool) => tool.name === name)
    return { tool: { kind: 'builtin', name }, label: meta ? `${meta.label}（${name}）` : name }
  }),
)

/** MCP 候选：按**已挂载服务**分组，每组只列该服务的可见工具（`allowed_tools`） */
const mcpGroups = computed(() =>
  props.mountedServices.map((service) => {
    const meta = props.mcpServices.find((item) => item.name === service)
    return {
      service,
      options: (meta?.allowed_tools ?? []).map<ToolOption>((name) => ({
        tool: { kind: 'mcp', service, name },
        label: name,
      })),
    }
  }),
)

function toolKey(tool: SoulStarterTool): string {
  return tool.kind === 'builtin' ? `builtin:${tool.name}` : `mcp:${tool.service}:${tool.name}`
}

function isSelected(starter: SoulStarter, tool: SoulStarterTool): boolean {
  const key = toolKey(tool)
  return starter.tools.some((item) => toolKey(item) === key)
}

function toggleTool(starterIndex: number, tool: SoulStarterTool): void {
  const starter = localStarters.value[starterIndex]
  if (!starter) return
  if (isSelected(starter, tool)) {
    starter.tools = starter.tools.filter((item) => toolKey(item) !== toolKey(tool))
    return
  }
  if (starter.tools.length >= SOUL_LIMITS.toolsPerStarter) return
  starter.tools = [...starter.tools, tool]
}

function addStarter(): void {
  if (localStarters.value.length >= SOUL_LIMITS.starters) return
  localStarters.value.push({ prompt: '', tools: [] })
}

function removeStarter(index: number): void {
  localStarters.value.splice(index, 1)
}

function confirm(): void {
  emit('save', {
    welcome: localWelcome.value.trim(),
    // 空问题不提交（后端也会拒绝空 prompt，这里先过滤掉"加了一行却没填"的情况）
    starters: localStarters.value
      .map((starter) => ({ prompt: starter.prompt.trim(), tools: [...starter.tools] }))
      .filter((starter) => starter.prompt !== ''),
  })
  emit('update:open', false)
}

function requestClose(): void {
  emit('update:open', false)
}

function openDialog(): void {
  const el = dialogEl.value
  if (!el) return
  restoreFocusTo = (document.activeElement as HTMLElement | null) ?? null
  // jsdom 早期版本没有 showModal：降级为设置 open 属性，保证行为可测
  if (typeof el.showModal === 'function') {
    if (!el.open) el.showModal()
  } else {
    el.setAttribute('open', '')
  }
}

function closeDialog(): void {
  const el = dialogEl.value
  if (el) {
    if (typeof el.close === 'function' && el.open) el.close()
    else el.removeAttribute('open')
  }
  restoreFocusTo?.focus?.()
  restoreFocusTo = null
}

/** `cancel` 事件由 Esc 触发：阻止浏览器默认关闭，统一走 `update:open` 流程 */
function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

watch(
  () => props.open,
  async (isOpen) => {
    await nextTick()
    if (!isOpen) {
      closeDialog()
      return
    }
    // 打开时从 props 拷贝一份可编辑副本（取消即丢弃）
    localWelcome.value = props.welcome
    localStarters.value = props.starters.map((starter) => ({
      prompt: starter.prompt,
      tools: starter.tools.map((tool) => ({ ...tool })),
    }))
    openDialog()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  const el = dialogEl.value
  if (el && typeof el.close === 'function' && el.open) el.close()
})
</script>

<template>
  <dialog
    ref="dialogEl"
    class="quick-start"
    data-test="quick-start-dialog"
    aria-labelledby="quick-start-title"
    @cancel="onCancel"
  >
    <div class="quick-start__body">
      <h2 id="quick-start-title" class="quick-start__title">快速上手</h2>
      <p class="field__hint">
        以下内容只用于新建对话页的展示与引导，<strong>不会进入系统提示词</strong>。
      </p>

      <label class="field" for="quick-start-welcome">
        <span class="field__label">
          首屏欢迎语<span class="field__required" aria-hidden="true">*</span>
        </span>
        <textarea
          id="quick-start-welcome"
          :value="localWelcome"
          rows="2"
          :maxlength="SOUL_LIMITS.welcome"
          placeholder="例如：你好，我是生产计划助手，告诉我你想看哪批订单。"
          @input="localWelcome = ($event.target as HTMLTextAreaElement).value"
        />
        <span class="field__hint">{{ localWelcome.length }} / {{ SOUL_LIMITS.welcome }} 字</span>
      </label>

      <fieldset class="quick-start__starters">
        <legend class="field__label">
          问题实例（{{ localStarters.length }} / {{ SOUL_LIMITS.starters }}）
        </legend>
        <p class="field__hint">
          全部平铺显示在新建对话页，点击即发起一轮对话。可为每条关联工具：
          生成的引导文本对用户不可见，只在那一轮追加进系统提示词。
        </p>

        <!--
          一条问题实例 = 一行「序号 - 问题内容 - 移除」+ 可折叠的关联工具。
          标签文字让位给输入框（横排后没有空间），改用 `aria-label` + placeholder 承载，
          无障碍不降级（原则四）。
        -->
        <div
          v-for="(starter, index) in localStarters"
          :key="index"
          class="quick-start__item"
          data-test="quick-start-item"
        >
          <div class="quick-start__row">
            <span class="quick-start__item-index" aria-hidden="true">{{ index + 1 }}</span>
            <textarea
              v-model="starter.prompt"
              class="quick-start__prompt"
              rows="1"
              :maxlength="SOUL_LIMITS.starterPrompt"
              :aria-label="`第 ${index + 1} 条问题内容`"
              placeholder="例如：帮我梳理昨天订单的交付风险"
            />
            <button
              type="button"
              class="btn btn--danger"
              :aria-label="`删除第 ${index + 1} 条问题实例`"
              :data-test="`quick-start-remove-${index}`"
              @click="removeStarter(index)"
            >
              移除
            </button>
          </div>

          <!--
            关联工具默认收起（多数问题无需挂工具）；`summary` 上带上已选计数，
            收起时也不会丢失"这条挂了工具"的信息。用原生 `<details>` 实现，不引库。
          -->
          <details class="quick-start__tools">
            <summary class="quick-start__tools-summary">
              关联工具（已选 {{ starter.tools.length }} / {{ SOUL_LIMITS.toolsPerStarter }}）
            </summary>

            <p class="field__hint">可不选，可多选，最多 {{ SOUL_LIMITS.toolsPerStarter }} 个。</p>

            <div v-if="builtinOptions.length > 0" class="quick-start__tool-group">
              <p class="quick-start__group-title">内置工具</p>
              <label
                v-for="option in builtinOptions"
                :key="`b-${option.tool.name}`"
                class="quick-start__tool"
              >
                <input
                  type="checkbox"
                  :checked="isSelected(starter, option.tool)"
                  :data-test="`quick-start-tool-${index}-${option.tool.name}`"
                  @change="toggleTool(index, option.tool)"
                />
                <span>{{ option.label }}</span>
              </label>
            </div>

            <div v-for="group in mcpGroups" :key="group.service" class="quick-start__tool-group">
              <p class="quick-start__group-title">MCP · {{ group.service }}</p>
              <p v-if="group.options.length === 0" class="field__hint">
                该服务没有可见工具（未配置工具白名单）。
              </p>
              <label
                v-for="option in group.options"
                :key="`m-${group.service}-${option.tool.name}`"
                class="quick-start__tool"
              >
                <input
                  type="checkbox"
                  :checked="isSelected(starter, option.tool)"
                  @change="toggleTool(index, option.tool)"
                />
                <span>{{ option.label }}</span>
              </label>
            </div>

            <p v-if="builtinOptions.length === 0 && mcpGroups.length === 0" class="field__hint">
              当前没有可关联的工具——先在「内置工具」「MCP 服务」两个分区里启用/挂载。
            </p>
          </details>
        </div>

        <p v-if="localStarters.length === 0" class="field__hint">还没有问题实例。</p>

        <button
          type="button"
          class="btn"
          data-test="quick-start-add"
          :disabled="localStarters.length >= SOUL_LIMITS.starters"
          @click="addStarter"
        >
          + 添加一条问题实例
        </button>
      </fieldset>

      <div class="quick-start__actions">
        <button type="button" class="btn" data-test="quick-start-cancel" @click="requestClose">
          取消
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-test="quick-start-confirm"
          @click="confirm"
        >
          确定
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.quick-start {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 720px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.quick-start::backdrop {
  background: var(--color-overlay);
}

.quick-start__body {
  padding: var(--space-5);
  max-height: 80vh;
  overflow-y: auto;
}

.quick-start__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.quick-start__starters {
  margin-top: var(--space-4);
  border: none;
  padding: 0;
}

.quick-start__item {
  border: 1px solid var(--color-border, #dfe3ea);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-2);
}

/* 「序号 - 问题内容 - 移除」同一行 */
.quick-start__row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.quick-start__item-index {
  flex: none;
  min-width: 1.5em;
  /* 与 textarea 首行文字对齐（textarea 的 padding + border，见 base.css） */
  padding-top: calc(var(--space-2) + 1px);
  text-align: right;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.quick-start__prompt {
  flex: 1;
  min-width: 0;
}

.quick-start__tools {
  margin-top: var(--space-2);
}

.quick-start__tools-summary {
  list-style-position: inside;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.quick-start__tool-group {
  margin-top: var(--space-2);
}

.quick-start__group-title {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.quick-start__tool {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-right: var(--space-3);
  font-size: var(--font-size-sm);
}

.quick-start__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>

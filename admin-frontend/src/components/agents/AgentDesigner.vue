<script setup lang="ts">
/**
 * 数字人设计器（`FR-016`、`FR-017`、`FR-053`）。
 *
 * 五类配置以**分区（页签）**承载，导航深度不超过两级（列表 ↔ 设计器）。
 * 保存失败时错误在 `aria-live` 区域播报（`FR-009`、原则四）。
 *
 * 实现注记：把 composable 返回的 ref **解构为顶层绑定**再在模板中使用，
 * 以保证模板侧得到正确解包（嵌套在普通对象里的 ref 不会被模板自动解包）。
 */
import { computed, ref, watch } from 'vue'
import type { AgentDesign, BuiltinTool, ErrorInfo, McpServiceListItem, SkillListItem } from '../../api/types'
import { deleteAgent } from '../../api/agents'
import { AGENT_DESIGN_TABS, NEW_AGENT_SENTINEL } from '../../constants/agent-design'
import { useAgentDesign } from '../../composables/useAgentDesign'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import TabsNav from '../common/TabsNav.vue'
import McpSelector from './McpSelector.vue'
import ScenarioEditor from './ScenarioEditor.vue'
import SkillSelector from './SkillSelector.vue'
import SoulEditor from './SoulEditor.vue'
import ToolSelector from './ToolSelector.vue'

const props = defineProps<{
  name: string
  design: AgentDesign | null
  builtinTools: BuiltinTool[]
  builtinToolsError: unknown
  mcpServices: McpServiceListItem[]
  skills: SkillListItem[]
  initialTab: string | null
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'saved', design: AgentDesign): void
  (e: 'deleted', name: string): void
  (e: 'error', message: string): void
}>()

const editor = useAgentDesign()
const { draft, saving, loading } = editor
/** 重命名以避免与 props.design 混淆；模板中会自动解包 */
const saveError = editor.error

const tab = ref<string>(props.initialTab ?? AGENT_DESIGN_TABS[0].id)
const confirmBack = ref(false)
/** 删除确认（删除**不可恢复**，且被用户关联时会被服务端拒绝） */
const confirmDelete = ref(false)
const deleting = ref(false)

const isNew = computed(() => props.name === NEW_AGENT_SENTINEL)
const title = computed(() => (isNew.value ? '新建数字人' : `设计数字人：${props.name}`))

/** 失效引用提示（`FR-013`）：后端保存时也会拒绝，这里只是提前暴露 */
const builtinToolsErrorMessage = computed<string | null>(() => {
  const err = props.builtinToolsError as ErrorInfo | null
  if (!err) return null
  return `内置工具目录不可读，无法确认工具引用是否有效；保存含工具的配置会被拒绝（${err.code}）`
})

/* ---- 显式 setter：避免在模板里对 ref 属性做赋值 ---- */
function setName(value: string): void {
  draft.value.name = value
}
function setSoul(value: string): void {
  draft.value.soul = value
}
function setTools(value: string[]): void {
  draft.value.enabled_tools = value
}
function setMcpServices(value: string[]): void {
  draft.value.mcp_services = value
}
function setSkills(value: string[]): void {
  draft.value.skills = value
}
function setScenario(value: { scenario: string; data_prep_dirs: string[] }): void {
  draft.value.scenario = value
}

async function bootstrap(): Promise<void> {
  if (isNew.value) {
    editor.resetToNew()
    return
  }
  await editor.load(props.name)
}

watch(
  () => props.name,
  () => {
    tab.value = props.initialTab ?? AGENT_DESIGN_TABS[0].id
    void bootstrap()
  },
  { immediate: true },
)

watch(
  () => props.design,
  (next) => {
    // 列表预取到的设计态可直接复用，避免二次请求
    if (next && next.name === props.name) {
      editor.saved.value = next
      editor.revision.value = next.revision
    }
  },
)

async function onSave(): Promise<void> {
  const saved = await editor.save()
  if (saved) {
    emit('saved', saved)
    return
  }
  const err = editor.error.value
  emit('error', err ? `保存失败（${err.code}）` : '保存失败')
}

function requestBack(): void {
  if (editor.dirty.value) {
    confirmBack.value = true
    return
  }
  emit('back')
}

/** 删除入口：破坏性操作，先弹确认（文案里讲明"不可恢复"） */
function requestDelete(): void {
  confirmDelete.value = true
}

/**
 * 删除当前数字人。
 *
 * 服务端在**被用户关联**时会拒绝（`FR-021`、`AGENT_IN_USE`）——不在这里自行判断，
 * 直接把可读原因交给上层播报，避免前后端两套判定。
 */
async function doDelete(): Promise<void> {
  if (deleting.value) return
  deleting.value = true
  try {
    await deleteAgent(props.name)
    emit('deleted', props.name)
  } catch (err) {
    const info = err as ErrorInfo
    emit('error', `删除失败（${info.code}）：${info.message}`)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section class="agent-designer" aria-labelledby="agent-designer-title">
    <header class="agent-designer__header">
      <button type="button" class="btn" @click="requestBack">← 返回列表</button>
      <h2 id="agent-designer-title" class="agent-designer__title">{{ title }}</h2>
      <span class="agent-designer__actions">
        <!-- 删除属破坏性操作：红色按钮，且在「保存」左侧（避免与主操作混淆） -->
        <button
          v-if="!isNew"
          type="button"
          class="btn btn--danger"
          :disabled="deleting"
          @click="requestDelete"
        >
          {{ deleting ? '删除中…' : '删除' }}
        </button>
        <button type="button" class="btn btn--primary" :disabled="saving" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </span>
    </header>

    <p v-if="loading" role="status">加载中…</p>

    <label class="field" for="agent-name">
      <span class="field__label">
        数字人名称<span class="field__required" aria-hidden="true">*</span>
      </span>
      <input
        id="agent-name"
        type="text"
        :value="draft.name"
        placeholder="例如：生产计划助手"
        @input="setName(($event.target as HTMLInputElement).value)"
      />
      <span class="field__hint">不得含路径分隔符或 “..”，且不可与既有数字人重名。</span>
    </label>

    <ErrorNotice :error="saveError" title="保存未完成" />

    <TabsNav v-model="tab" :tabs="[...AGENT_DESIGN_TABS]" label="数字人设计分区">
      <SoulEditor v-if="tab === 'soul'" :model-value="draft.soul" @update:model-value="setSoul" />

      <template v-else-if="tab === 'tools'">
        <ToolSelector
          :tools="builtinTools"
          :model-value="draft.enabled_tools"
          :error-message="builtinToolsErrorMessage"
          @update:model-value="setTools"
        />
      </template>

      <McpSelector
        v-else-if="tab === 'mcp'"
        :services="mcpServices"
        :model-value="draft.mcp_services"
        @update:model-value="setMcpServices"
      />

      <SkillSelector
        v-else-if="tab === 'skills'"
        :skills="skills"
        :model-value="draft.skills"
        @update:model-value="setSkills"
      />

      <ScenarioEditor v-else :model-value="draft.scenario" @update:model-value="setScenario" />
    </TabsNav>

    <ConfirmDialog
      v-model:open="confirmBack"
      title="放弃未保存的修改？"
      message="当前设计态有未保存的改动，返回列表将丢弃这些改动。"
      confirm-label="放弃并返回"
      danger
      @confirm="emit('back')"
    />

    <!-- 删除不可恢复：必须先讲明后果（被用户关联时服务端会拒绝，届时给出可读原因） -->
    <ConfirmDialog
      v-model:open="confirmDelete"
      data-test="agent-delete-dialog"
      title="删除该数字人？"
      :message="`数字人「${props.name}」的设计态将被删除，删除后无法恢复。若它已被用户关联，需先解除关联；已分发到运行环境的目录会在下次部署时清除。`"
      confirm-label="删除"
      danger
      @confirm="doDelete"
    />
  </section>
</template>

<style scoped>
.agent-designer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.agent-designer__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.agent-designer__actions {
  display: flex;
  gap: var(--space-2);
}
</style>

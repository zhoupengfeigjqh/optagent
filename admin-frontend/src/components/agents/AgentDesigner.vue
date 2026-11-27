<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  AgentDeletionImpact,
  AgentDesign,
  AgentScenario,
  BuiltinTool,
  ErrorInfo,
  McpServiceListItem,
  SkillListItem,
  SoulDesign,
} from '../../api/types'
import type { OntologyCandidate } from '../../api/ontologies'
import { deleteAgent, getAgentDeletionImpact } from '../../api/agents'
import { AGENT_DESIGN_TABS, NEW_AGENT_SENTINEL } from '../../constants/agent-design'
import { useAgentDesign } from '../../composables/useAgentDesign'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import TabsNav from '../common/TabsNav.vue'
import McpSelector from './McpSelector.vue'
import OntologySelector from './OntologySelector.vue'
import ScenarioEditor from './ScenarioEditor.vue'
import SkillSelector from './SkillSelector.vue'
import SoulEditor from './SoulEditor.vue'
import ToolSelector from './ToolSelector.vue'

const props = defineProps<{
  name: string
  design: AgentDesign | null
  /**
   * 新建初值（`FR-015`，2026-10-09）：由「新建数字人」弹窗给出——
   * 名称必填，复制源可选（选定即以该数字人的五类配置为模板）。
   *
   * `null` 表示未经弹窗进入的兜底路径（如直接访问 `agents/__new__`）：
   * 此时退回全空草稿，行为与改造前一致。
   */
  initial: { name: string; copyFrom: string | null } | null
  builtinTools: BuiltinTool[]
  /** 工具目录不可读的原因（§5.6 的 `builtin_tools_error`）；`null` = 可读 */
  builtinToolsError: string | null
  mcpServices: McpServiceListItem[]
  skills: SkillListItem[]
  ontologies: OntologyCandidate[]
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
/** 删除影响面：待失效的注册链接数与被关联用户（判定在服务端，前端只负责展示） */
const deleteImpact = ref<AgentDeletionImpact | null>(null)

const isNew = computed(() => props.name === NEW_AGENT_SENTINEL)
const title = computed(() => (isNew.value ? '新建数字人' : `设计数字人：${props.name}`))

const builtinToolsErrorMessage = computed<string | null>(() => {
  const reason = props.builtinToolsError
  if (!reason) return null
  return `内置工具目录不可读（${reason}），无法确认工具引用是否有效；保存含工具的配置会被拒绝`
})

/* ---- 显式 setter：避免在模板里对 ref 属性做赋值 ---- */
/*
 * 注：名称**没有 setter**——`FR-015` 规定名称在创建时经弹窗确定、创建后不可修改，
 * 设计器内为只读展示（见模板）。`draft.name` 只由 `resetToCopy` / `load` 写入。
 */
function setSoul(value: SoulDesign): void {
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
function setOntologies(value: string[]): void {
  draft.value.ontologies = value
}
function setScenario(value: AgentScenario): void {
  draft.value.scenario = value
}

async function bootstrap(): Promise<void> {
  if (isNew.value) {
    const seed = props.initial
    if (!seed) {
      editor.resetToNew()
      return
    }
    // 预填：名称 + （可选的）复制源。复制失败会**降级为空草稿并保留名称**，
    const failure = await editor.resetToCopy(seed.name, seed.copyFrom)
    if (failure) emit('error', failure)
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

/**
 * 删除确认文案：把删除的连带影响讲在确认之前。
 *
 * - 已被用户关联 → 服务端必然拒绝，先告知并给出解除关联的指引；
 * - 有未撤销的注册链接 → 会随删除**级联撤销**（记录保留但立即失效），条数由服务端给出；
 * - 影响面取不到时不阻断：退回通用文案，仍以服务端判定为准（不在前端复刻规则）。
 */
const deleteMessage = computed(() => {
  const parts = [
    `数字人「${props.name}」的设计态与注册服务编码将被删除，删除后无法恢复；已分发到运行环境的目录会在下次部署时清除。`,
  ]
  const linkedUsers = deleteImpact.value?.linked_users ?? []
  if (linkedUsers.length > 0) {
    parts.push(`该数字人已被用户关联（${linkedUsers.join('、')}），服务端会拒绝删除，请先解除关联。`)
  }
  const activeLinks = deleteImpact.value?.active_register_links ?? 0
  if (activeLinks > 0) {
    parts.push(
      `请注意，本次删除会有 ${activeLinks} 条注册链接失效（链接记录保留，但立即无法再用于注册）。`,
    )
  }
  return parts.join('')
})

/** 删除入口：先取影响面再弹确认（破坏性操作，文案里讲明"不可恢复"） */
async function requestDelete(): Promise<void> {
  deleteImpact.value = null
  try {
    deleteImpact.value = await getAgentDeletionImpact(props.name)
  } catch {
    // 影响面是提示性信息，取不到不阻断删除；真正的删除仍由服务端校验
  }
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
      <span class="field__label">数字人名称</span>
      <input
        id="agent-name"
        type="text"
        :value="draft.name"
        readonly
        aria-readonly="true"
        data-test="agent-name"
      />
      <span class="field__hint">名称在「新建数字人」时确定，创建后不可修改。</span>
    </label>

    <ErrorNotice :error="saveError" title="保存未完成" />

    <TabsNav v-model="tab" :tabs="[...AGENT_DESIGN_TABS]" label="数字人设计分区">
      <SoulEditor
        v-if="tab === 'soul'"
        :model-value="draft.soul"
        :enabled-tools="draft.enabled_tools"
        :builtin-tools="builtinTools"
        :mounted-services="draft.mcp_services"
        :mcp-services="mcpServices"
        @update:model-value="setSoul"
      />

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

      <OntologySelector
        v-else-if="tab === 'ontologies'"
        :ontologies="ontologies"
        :model-value="draft.ontologies"
        @update:model-value="setOntologies"
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

    <ConfirmDialog
      v-model:open="confirmDelete"
      data-test="agent-delete-dialog"
      title="删除该数字人？"
      :message="deleteMessage"
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

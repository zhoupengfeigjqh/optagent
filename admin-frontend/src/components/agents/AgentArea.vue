<script setup lang="ts">
/**
 * 数字人设计功能区（US1）。
 *
 * 两级导航：列表 ↔ 设计器（`FR-053`）。一级导航固定 4 项，本区内部深度不超过两级；
 * `tab` 承载配置分区（SOUL / 内置工具 / MCP 服务 / SKILL / 本体 / 文件空间场景），
 * 不构成第三级导航。
 */
import { onMounted, ref, watch } from 'vue'
import { getAgent, getAgentCatalog, listAgents } from '../../api/agents'
import type { OntologyCandidate } from '../../api/ontologies'
import type {
  AgentDesign,
  AgentListItem,
  BuiltinTool,
  McpServiceListItem,
  Paged,
  SkillListItem,
} from '../../api/types'
import { buildPath } from '../../router'
import { NEW_AGENT_SENTINEL } from '../../constants/agent-design'
import AgentCardList from './AgentCardList.vue'
import AgentDesigner from './AgentDesigner.vue'
import CreateAgentDialog from './CreateAgentDialog.vue'

const props = defineProps<{ detail: string | null; tab: string | null }>()
const emit = defineEmits<{
  (e: 'navigate', path: string): void
  (e: 'announce', text: string): void
}>()

/** 列表态 */
const page = ref(1)
const list = ref<Paged<AgentListItem> | null>(null)
const listError = ref<unknown>(null)
const listLoading = ref(false)

/** 编辑器依赖的统一清单（`FR-019`：三类引用只能从清单中选择） */
const builtinTools = ref<BuiltinTool[]>([])
/** 工具目录不可读的原因（`null` = 可读）；MCP / SKILL 候选不受此影响 */
const builtinToolsError = ref<string | null>(null)
const mcpServices = ref<McpServiceListItem[]>([])
const skills = ref<SkillListItem[]>([])
/** 本体候选（`§5.6`）：身份投影，不含正文 */
const ontologies = ref<OntologyCandidate[]>([])

const design = ref<AgentDesign | null>(null)

/** 「新建数字人」弹窗开关（`FR-015`：新建先经弹窗采集名称与可选复制源） */
const createOpen = ref(false)
/**
 * 弹窗确认后的**新建初值**（名称 + 可选复制源），供设计器预填草稿。
 *
 * 用组件内状态而非 URL：新建草稿本来就不落盘、刷新即丢，而把用户输入的
 * 名称塞进地址栏会让 URL 与草稿状态互相不同步（设计器内改名后地址栏不跟着变）。
 */
const pendingNew = ref<{ name: string; copyFrom: string | null } | null>(null)

function onNewAgentConfirmed(payload: { name: string; copyFrom: string | null }): void {
  pendingNew.value = payload
  emit('navigate', buildPath({ name: 'agents', detail: NEW_AGENT_SENTINEL }))
}

/** 离开设计器（返回列表）即丢弃"待预填"意图，避免复用到下一次进入 */
function backToList(): void {
  pendingNew.value = null
  emit('navigate', buildPath({ name: 'agents' }))
}

function onDeleted(name: string): void {
  pendingNew.value = null
  emit('announce', `数字人 ${name} 已删除`)
  // 删掉后没有可编辑的对象了：退回列表（列表会重新拉取，卡片随之消失）
  emit('navigate', buildPath({ name: 'agents' }))
}

/**
 * 取候选清单（§5.6，2026-10-17）。
 *
 * 改为一次性全量：原先直接调三张卡片列表并只取 `page=1`，库里第 9 个 SKILL / MCP
 * 服务会**静默缺席**（服务端页大小写死 8 条）。工具不可读的降级原因由端点带回，
 * 不拖累另外两类候选。
 */
async function loadCatalog(): Promise<void> {
  builtinToolsError.value = null
  try {
    const catalog = await getAgentCatalog()
    builtinTools.value = catalog.builtin_tools
    builtinToolsError.value = catalog.builtin_tools_error
    mcpServices.value = catalog.mcp_services
    skills.value = catalog.skills
    ontologies.value = catalog.ontologies
  } catch (err) {
    // 整体不可用（平台自身故障）：各类候选都取不到，提示保存会被拒绝
    builtinToolsError.value = err instanceof Error ? err.message : String(err)
  }
}

async function loadList(): Promise<void> {
  listLoading.value = true
  listError.value = null
  try {
    list.value = await listAgents(page.value)
  } catch (err) {
    listError.value = err
  } finally {
    listLoading.value = false
  }
}

async function loadDesign(name: string): Promise<void> {
  design.value = null
  if (name === NEW_AGENT_SENTINEL) return
  try {
    design.value = await getAgent(name)
  } catch (err) {
    listError.value = err
  }
}

onMounted(() => {
  void loadCatalog()
  if (props.detail) void loadDesign(props.detail)
  else void loadList()
})

watch(
  () => props.detail,
  (name) => {
    if (name) void loadDesign(name)
    else {
      design.value = null
      void loadList()
    }
  },
)
</script>

<template>
  <section class="agent-area">
    <AgentDesigner
      v-if="detail"
      :name="detail"
      :design="design"
      :initial="pendingNew"
      :builtin-tools="builtinTools"
      :builtin-tools-error="builtinToolsError"
      :mcp-services="mcpServices"
      :skills="skills"
      :ontologies="ontologies"
      :initial-tab="tab"
      @back="backToList"
      @saved="
        (saved) => {
          design = saved
          emit('announce', `数字人 ${saved.name} 已保存`)
        }
      "
      @deleted="onDeleted"
      @error="(message) => emit('announce', message)"
    />
    <template v-else>
      <AgentCardList
        :items="list?.items ?? []"
        :total="list?.total ?? 0"
        :page="page"
        :loading="listLoading"
        :error="listError as never"
        @update:page="
          (next) => {
            page = next
            void loadList()
          }
        "
        @open="(name) => emit('navigate', buildPath({ name: 'agents', detail: name }))"
        @create="createOpen = true"
      />

      <CreateAgentDialog v-model:open="createOpen" @confirm="onNewAgentConfirmed" />
    </template>
  </section>
</template>

<script setup lang="ts">
/**
 * 数字人设计功能区（US1）。
 *
 * 两级导航：列表 ↔ 设计器（`FR-053`）。一级导航固定 4 项，本区内部深度不超过两级；
 * `tab` 承载五类配置的分区，不构成第三级导航。
 */
import { onMounted, ref, watch } from 'vue'
import { getAgent, listAgents } from '../../api/agents'
import { listBuiltinTools } from '../../api/builtin-tools'
import { http } from '../../api/http'
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
const builtinToolsError = ref<unknown>(null)
const mcpServices = ref<McpServiceListItem[]>([])
const skills = ref<SkillListItem[]>([])

const design = ref<AgentDesign | null>(null)

async function loadCatalog(): Promise<void> {
  builtinToolsError.value = null
  const [tools, mcp, skill] = await Promise.allSettled([
    listBuiltinTools(),
    http.get<Paged<McpServiceListItem>>('/api/admin/mcp/services', { page: 1 }),
    http.get<Paged<SkillListItem>>('/api/admin/skills', { page: 1 }),
  ])
  if (tools.status === 'fulfilled') builtinTools.value = tools.value.items
  else builtinToolsError.value = tools.reason
  if (mcp.status === 'fulfilled') mcpServices.value = mcp.value.items
  if (skill.status === 'fulfilled') skills.value = skill.value.items
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
      :builtin-tools="builtinTools"
      :builtin-tools-error="builtinToolsError"
      :mcp-services="mcpServices"
      :skills="skills"
      :initial-tab="tab"
      @back="emit('navigate', buildPath({ name: 'agents' }))"
      @saved="
        (saved) => {
          design = saved
          emit('announce', `数字人 ${saved.name} 已保存`)
        }
      "
      @deleted="
        (name) => {
          emit('announce', `数字人 ${name} 已删除`)
          // 删掉后没有可编辑的对象了：退回列表（列表会重新拉取，卡片随之消失）
          emit('navigate', buildPath({ name: 'agents' }))
        }
      "
      @error="(message) => emit('announce', message)"
    />
    <AgentCardList
      v-else
      :items="list?.items ?? []"
      :total="list?.total ?? 0"
      :page="page"
      :loading="listLoading"
      :error="(listError as never)"
      @update:page="
        (next) => {
          page = next
          void loadList()
        }
      "
      @open="(name) => emit('navigate', buildPath({ name: 'agents', detail: name }))"
      @create="emit('navigate', buildPath({ name: 'agents', detail: NEW_AGENT_SENTINEL }))"
    />
  </section>
</template>

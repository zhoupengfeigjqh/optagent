<script setup lang="ts">
/**
 * MCP 服务详情（`FR-044`、`FR-045`、`FR-046`、`FR-048`、`FR-051`）。
 *
 * 页签：服务启停 / 调用配置 / 工具清单 / 运行日志 / 调用统计。
 * - 服务启停页展示编排原始声明（只读投影，`FR-043`），启停按钮在其下方；
 * - 调用配置页内嵌连通性测试（按表单当前值探测，改完地址即可就近验证）；
 * - 关闭正被引用的服务时 MUST 先提示受影响数字人并二次确认（`FR-051`）——
 * 该引用查询**只在管理员点击关闭之后**才发起。
 */
import { computed, ref } from 'vue'
import { fetchReferences } from '../../api/deploy'
import { useMcpServices } from '../../composables/useMcpServices'
import type { ErrorInfo, McpServiceConfigPayload, McpServiceDetail, ReferenceItem } from '../../api/types'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import StatusBadge from '../common/StatusBadge.vue'
import TabsNav from '../common/TabsNav.vue'
import McpLogViewer from './McpLogViewer.vue'
import McpCallConfigForm from './McpCallConfigForm.vue'
import McpStatsTable from './McpStatsTable.vue'
import McpToolList from './McpToolList.vue'

const props = defineProps<{
  service: McpServiceDetail | null
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'changed'): void
  (e: 'announce', text: string): void
}>()

const m = useMcpServices()
const tab = ref('config')
const pendingStop = ref(false)
const affected = ref<ReferenceItem[]>([])

const TABS = [
  { id: 'runtime', label: '服务启停' },
  { id: 'config', label: '调用配置' },
  { id: 'tools', label: '工具清单' },
  { id: 'logs', label: '运行日志' },
  { id: 'stats', label: '调用统计' },
]

const name = computed(() => props.service?.name ?? '')

async function onSave(payload: Omit<McpServiceConfigPayload, 'revision'>): Promise<void> {
  // 显式传入当前详情的 revision：本组件的 composable 实例从未 loadDetail，
  // 不传的话 saveConfig 会因 detail 为空而静默失败（已修复的接线缺陷）
  const affectedAgents = await m.saveConfig(name.value, payload, props.service?.revision)
  if (affectedAgents === null) {
    emit('announce', '保存失败，请查看错误原因')
    return
  }
  emit(
    'announce',
    affectedAgents.length > 0
      ? `已保存；${affectedAgents.length} 个引用该服务的数字人将在下次部署时生效`
      : '已保存调用配置',
  )
  emit('changed')
}

async function start(): Promise<void> {
  if (await m.setRunning(name.value, true)) {
    emit('announce', `服务 ${name.value} 已启动`)
    emit('changed')
  }
}

/** 关闭前先取受影响清单（FR-051） */
async function requestStop(): Promise<void> {
  try {
    affected.value = (await fetchReferences('mcp_service', name.value)).affected
  } catch {
    affected.value = []
  }
  pendingStop.value = true
}

async function confirmStop(): Promise<void> {
  if (await m.setRunning(name.value, false)) {
    emit('announce', `服务 ${name.value} 已关闭`)
    emit('changed')
  }
  pendingStop.value = false
}
</script>

<template>
  <section class="mcp-detail" aria-labelledby="mcp-detail-title">
    <header class="mcp-detail__header">
      <button type="button" class="btn" @click="emit('back')">← 返回列表</button>
      <h2 id="mcp-detail-title" class="mcp-detail__title">
        {{ name || '加载中…' }}
        <StatusBadge v-if="props.service" :status="props.service.status" />
        <StatusBadge
          v-if="props.service && !props.service.in_compose"
          status="abnormal"
          label="不在编排中"
          tone="error"
        />
      </h2>
    </header>

    <ErrorNotice :error="m.error.value ?? props.error" title="操作未完成" />

    <template v-if="props.service">
      <TabsNav v-model="tab" :tabs="TABS" label="MCP 服务详情分区">
        <!-- 服务启停：编排原始声明（只读投影 FR-043）在上，启停按钮在下 -->
        <div v-if="tab === 'runtime'" class="mcp-detail__runtime">
          <p class="mcp-detail__declaration-hint">
            编排文件（<code class="mono">docker-compose.yml</code>）中的原始声明——
            镜像、环境变量或端口的修改请编辑编排文件本身。
          </p>
          <pre class="mono mcp-detail__declaration">{{ JSON.stringify(props.service.compose_declaration, null, 2) }}</pre>

          <div class="mcp-detail__actions">
            <button type="button" class="btn" :disabled="m.busy.value" @click="start">启动</button>
            <button type="button" class="btn btn--danger" :disabled="m.busy.value" @click="requestStop">
              关闭
            </button>
          </div>
        </div>

        <!-- 调用配置：编辑表单（内含"发起测试"，按表单当前值探测，无需先保存；结果弹窗展示） -->
        <div v-else-if="tab === 'config'" class="mcp-detail__config">
          <McpCallConfigForm
            :service="props.service"
            :busy="m.busy.value"
            @save="onSave"
            @announce="emit('announce', $event)"
          />
        </div>

        <McpToolList
          v-else-if="tab === 'tools'"
          :tools="props.service.tools"
          :truncated="props.service.tools_truncated"
          :error-message="props.service.tools_error ?? null"
        />

        <McpLogViewer v-else-if="tab === 'logs'" :service-name="name" />

        <div v-else-if="tab === 'stats'">
          <McpStatsTable :groups="m.statsGroups.value" :available="m.statsAvailable.value" :only="name" />
          <button type="button" class="btn" @click="m.loadStats()">刷新统计</button>
        </div>
      </TabsNav>
    </template>

    <ConfirmDialog
      v-model:open="pendingStop"
      title="关闭该 MCP 服务？"
      :message="
        affected.length > 0
          ? `该服务正被 ${affected.length} 个数字人引用，关闭后它们的工具调用会失败。`
          : '该服务当前未被任何数字人引用。'
      "
      confirm-label="关闭服务"
      danger
      @confirm="confirmStop"
    >
      <ul v-if="affected.length > 0">
        <li v-for="(item, index) in affected" :key="index">
          <span class="mono">{{ item.user_id }}</span> 的 <span class="mono">{{ item.agent_name }}</span>
        </li>
      </ul>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.mcp-detail__header {
  margin-bottom: var(--space-4);
}

.mcp-detail__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-lg);
}

.mcp-detail__actions {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.mcp-detail__declaration-hint {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.mcp-detail__declaration {
  margin: 0 0 var(--space-4);
  padding: var(--space-2);
  background: var(--color-bg-muted);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  overflow-x: auto;
}
</style>

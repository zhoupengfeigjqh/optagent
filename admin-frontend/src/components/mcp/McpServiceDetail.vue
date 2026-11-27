<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchReferences } from '../../api/deploy'
import { useMcpServices } from '../../composables/useMcpServices'
import type {
  ErrorInfo,
  McpServiceConfigInput,
  McpServiceDetail,
  ReferenceItem,
} from '../../api/types'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import TabsNav from '../common/TabsNav.vue'
import McpCallConfigForm from './McpCallConfigForm.vue'
import McpStatsTable from './McpStatsTable.vue'
import McpToolList from './McpToolList.vue'

const props = defineProps<{
  openedName: string
  service: McpServiceDetail | null
  loading: boolean
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'changed', revision?: number): void
  (e: 'deleted', name: string): void
  (e: 'reload'): void
  (e: 'reprobe'): void
  (e: 'announce', text: string): void
}>()

const m = useMcpServices()
const tab = ref('config')
const pendingDelete = ref(false)
const affected = ref<ReferenceItem[]>([])
const configForm = ref<InstanceType<typeof McpCallConfigForm> | null>(null)
const savedHeaders = ref<Record<string, string> | null>(null)

/** 切换服务即清掉上一次的保存回执，避免把 A 服务的掩码展示成 B 服务的 */
watch(
  () => props.openedName,
  () => {
    savedHeaders.value = null
  },
)

const TABS = [
  { id: 'config', label: '调用配置' },
  { id: 'tools', label: '工具清单' },
  { id: 'stats', label: '调用统计' },
]

const name = computed(() => props.service?.name ?? props.openedName)
/** 动作区在"加载中"也要渲染（只是禁用）：避免按钮在数据到达时突然出现造成布局跳动 */
const showActions = computed(() => props.service !== null || props.loading)

watch(tab, (next) => {
  if (next === 'stats' && props.service) void m.loadStats()
})

function requestSave(): void {
  const form = configForm.value
  if (!form) return
  const submitted = form.submit()
  if (!submitted && tab.value !== 'config') {
    emit('announce', '保存未完成：调用配置里有校验错误，请切到「调用配置」页签查看并修正')
  }
}

async function onSubmit(config: McpServiceConfigInput): Promise<void> {
  const result = await m.saveConfig(name.value, config, props.service?.revision)
  if (result === null) {
    emit('announce', '保存失败，请查看错误原因')
    return
  }
  savedHeaders.value = result.maskedHeaders
  emit(
    'announce',
    result.affected.length > 0
      ? `已保存；${result.affected.length} 个引用该服务的数字人将在下次部署时生效`
      : '已保存调用配置',
  )
  emit('changed', result.revision)
}

/**
 * 自动测试一次（由 `McpArea` 在创建成功后调用）。
 *
 * 转发到表单的 `runTest()`：探测用的是**表单当前值**，与点按钮完全一致，
 * 不新增第二条测试路径（否则"按钮测的"与"自动测的"会出现两套口径）。
 */
async function runTest(): Promise<void> {
  await configForm.value?.runTest()
}

defineExpose({ runTest })

function onReprobe(): void {
  emit('announce', '正在重新探测工具清单…')
  emit('reprobe')
}

async function requestDelete(): Promise<void> {
  try {
    affected.value = (await fetchReferences('mcp_service', name.value)).affected
  } catch {
    affected.value = []
  }
  pendingDelete.value = true
}

async function confirmDelete(): Promise<void> {
  const ok = await m.removeService(name.value)
  pendingDelete.value = false
  if (ok) {
    emit('announce', `MCP 服务 ${name.value} 已删除`)
    emit('deleted', name.value)
  }
}
</script>

<template>
  <section class="mcp-detail" aria-labelledby="mcp-detail-title">
    <header class="mcp-detail__header">
      <div class="mcp-detail__heading">
        <button type="button" class="btn" @click="emit('back')">← 返回列表</button>
        <h2 id="mcp-detail-title" class="mcp-detail__title">{{ name }}</h2>
      </div>

      <div v-if="showActions" class="mcp-detail__actions">
        <button
          type="button"
          class="btn btn--danger"
          data-test="delete"
          :disabled="props.service === null || m.busy.value"
          @click="requestDelete"
        >
          删除服务
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-test="save"
          :disabled="props.service === null || m.busy.value"
          @click="requestSave"
        >
          {{ m.busy.value ? '保存中…' : '保存调用配置' }}
        </button>
      </div>
    </header>

    <ErrorNotice :error="m.error.value ?? props.error" title="操作未完成" />

    <template v-if="props.service">
      <TabsNav v-model="tab" :tabs="TABS" label="MCP 服务详情分区">
        <div v-show="tab === 'config'" class="mcp-detail__config">
          <McpCallConfigForm
            ref="configForm"
            :service="props.service"
            :busy="m.busy.value"
            :headers-override="savedHeaders"
            @submit="onSubmit"
            @announce="emit('announce', $event)"
          />
        </div>

        <McpToolList
          v-show="tab === 'tools'"
          :tools="props.service.tools"
          :allowed-tools="props.service.allowed_tools"
          :missing-tools="props.service.missing_tools"
          :truncated="props.service.tools_truncated"
          :error-message="props.service.tools_error ?? null"
          :busy="props.loading"
          @reprobe="onReprobe"
        />

        <div v-show="tab === 'stats'">
          <McpStatsTable
            :groups="m.statsGroups.value"
            :available="m.statsAvailable.value"
            :only="name"
          />
          <button type="button" class="btn" @click="m.loadStats()">刷新统计</button>
        </div>
      </TabsNav>
    </template>

    <p v-else-if="props.loading" class="mcp-detail__loading" role="status" aria-live="polite">
      正在读取调用配置与工具清单…（工具清单需要连接该 MCP 服务，慢服务请稍候）
    </p>

    <div v-else class="mcp-detail__failed">
      <p>未能读取该服务的配置。</p>
      <button type="button" class="btn" data-test="retry" @click="emit('reload')">重试</button>
    </div>

    <ConfirmDialog
      v-model:open="pendingDelete"
      title="删除该 MCP 服务？"
      :message="
        affected.length > 0
          ? `该服务正被 ${affected.length} 个数字人引用，删除后它们将引用失效，重新部署时会阻止部署。`
          : '该服务当前未被任何数字人引用。'
      "
      confirm-label="删除服务"
      danger
      @confirm="confirmDelete"
    >
      <ul v-if="affected.length > 0">
        <li v-for="(item, index) in affected" :key="index">
          <span class="mono">{{ item.user_id }}</span> 的
          <span class="mono">{{ item.agent_name }}</span>
        </li>
      </ul>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.mcp-detail__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
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
  align-items: center;
  gap: var(--space-2);
}

.mcp-detail__loading {
  color: var(--color-text-secondary);
}

.mcp-detail__failed {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.mcp-detail__failed p {
  margin: 0;
  color: var(--color-text-secondary);
}
</style>

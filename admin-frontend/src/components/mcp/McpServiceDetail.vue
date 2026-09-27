<script setup lang="ts">
/**
 * MCP 服务详情（`FR-044`、`FR-045`；2026-09-27 改版）。
 *
 * 页签：调用配置 / 工具清单 / 调用统计。同时承担**新建**（`isNew`）与编辑：
 * - 新建态只有"调用配置"，提交走 `POST /api/admin/mcp/services`；
 * - 编辑态保存走 `PUT`，响应里的 `affected_agents` 用于告知影响面；
 * - 删除前 MUST 先列出受影响数字人并二次确认（原"关闭前提示引用"的能力迁移到删除）。
 *
 * **已下架**：服务启停页（含编排原始声明）与运行日志页——平台不再读容器运行态。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { fetchReferences } from '../../api/deploy'
import { useMcpServices } from '../../composables/useMcpServices'
import type {
  ErrorInfo,
  McpServiceDetail,
  McpServiceSubmitPayload,
  ReferenceItem,
} from '../../api/types'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import TabsNav from '../common/TabsNav.vue'
import McpCallConfigForm from './McpCallConfigForm.vue'
import McpStatsTable from './McpStatsTable.vue'
import McpToolList from './McpToolList.vue'

const props = defineProps<{
  /** 编辑态的服务详情；新建态为 `null` */
  service: McpServiceDetail | null
  isNew: boolean
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'back'): void
  /**
   * 已发生变更，父级需刷新卡片列表。
   *
   * - **保存调用配置**：带上保存响应里的新 `revision` → 父级**原地更新**、不重载详情（契约 §0.5 ②）；
   * - **其他**（`revision` 缺省）：状态已变但没有新版本号，父级需**重载详情**。
   */
  (e: 'changed', revision?: number): void
  /** 新建成功：父级导航到该服务的详情路径 */
  (e: 'created', name: string): void
  /** 删除成功：父级退回列表 */
  (e: 'deleted', name: string): void
  (e: 'announce', text: string): void
}>()

const m = useMcpServices()
const tab = ref('config')
const pendingDelete = ref(false)
const affected = ref<ReferenceItem[]>([])
/** 调用配置表单：页头的「保存调用配置 / 创建服务」通过它的 `submit()` 触发（含本地校验） */
const configForm = ref<InstanceType<typeof McpCallConfigForm> | null>(null)

const TABS = [
  { id: 'config', label: '调用配置' },
  { id: 'tools', label: '工具清单' },
  { id: 'stats', label: '调用统计' },
]

const name = computed(() => props.service?.name ?? '')
/** 新建态只有一个页签（尚未保存的服务没有工具清单与统计） */
const visibleTabs = computed(() => (props.isNew ? TABS.slice(0, 1) : TABS))

watch(
  () => props.isNew,
  (isNew) => {
    if (isNew) tab.value = 'config'
  },
)

// 进入「调用统计」才取数（省一次请求；此前该页签首次进入是空的，需手动点「刷新统计」）
watch(tab, (next) => {
  if (next === 'stats' && !props.isNew) void m.loadStats()
})

/**
 * 页头右上角的「保存调用配置 / 创建服务」。
 *
 * 动作在页头、**校验与提交仍走表单自身路径**（`submit()` 先本地校验再 emit `submit`），
 * 避免两套判据。先切回「调用配置」页签：让管理员看到被保存的内容与校验报错落在哪。
 */
async function requestSave(): Promise<void> {
  tab.value = 'config'
  await nextTick()
  configForm.value?.submit()
}

async function onSubmit(payload: McpServiceSubmitPayload): Promise<void> {
  if (props.isNew) {
    const saved = await m.createService({ ...payload.config, name: payload.name })
    if (saved === null) {
      emit('announce', '创建失败，请查看错误原因')
      return
    }
    emit('announce', `MCP 服务 ${saved.name} 已创建`)
    emit('created', saved.name)
    return
  }

  // 显式传入当前详情的 revision：本组件的 composable 实例从未 loadDetail，
  // 不传的话 saveConfig 会因 detail 为空而静默失败（已修复的接线缺陷）
  const result = await m.saveConfig(name.value, payload.config, props.service?.revision)
  if (result === null) {
    emit('announce', '保存失败，请查看错误原因')
    return
  }
  emit(
    'announce',
    result.affected.length > 0
      ? `已保存；${result.affected.length} 个引用该服务的数字人将在下次部署时生效`
      : '已保存调用配置',
  )
  // 带上新 revision：父级据此原地更新，**不重载详情**——详情页的表单草稿
  // 与工具清单因此都不被扰动（契约 §0.5 原则 ①②）
  emit('changed', result.revision)
}

/** 删除前先取受影响清单（§7.1） */
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
        <h2 id="mcp-detail-title" class="mcp-detail__title">
          {{ isNew ? '新建 MCP 服务' : name || '加载中…' }}
        </h2>
      </div>

      <!-- 页面级动作放右上角：删除、保存/创建（2026-09-27 产品要求） -->
      <div v-if="isNew || props.service" class="mcp-detail__actions">
        <button
          v-if="!isNew"
          type="button"
          class="btn btn--danger"
          :disabled="m.busy.value"
          @click="requestDelete"
        >
          删除服务
        </button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="m.busy.value"
          @click="requestSave"
        >
          {{ m.busy.value ? (isNew ? '创建中…' : '保存中…') : isNew ? '创建服务' : '保存调用配置' }}
        </button>
      </div>
    </header>

    <ErrorNotice :error="m.error.value ?? props.error" title="操作未完成" />

    <template v-if="isNew || props.service">
      <TabsNav v-model="tab" :tabs="visibleTabs" label="MCP 服务详情分区">
        <!--
          配置面板用 `v-show` **常驻**（不随页签卸载）：
          ① 页头右上角的保存按钮在任意页签都可用；
          ② 切到别的页签再回来，**未保存的编辑不会丢**（表单草稿锚定服务标识，契约 §0.5 原则 ①）。
        -->
        <div v-show="tab === 'config'" class="mcp-detail__config">
          <McpCallConfigForm
            ref="configForm"
            :service="props.service"
            :is-new="isNew"
            :busy="m.busy.value"
            @submit="onSubmit"
            @announce="emit('announce', $event)"
          />
        </div>

        <McpToolList
          v-if="props.service"
          v-show="tab === 'tools'"
          :tools="props.service.tools"
          :truncated="props.service.tools_truncated"
          :error-message="props.service.tools_error ?? null"
        />

        <div v-show="tab === 'stats'">
          <McpStatsTable :groups="m.statsGroups.value" :available="m.statsAvailable.value" :only="name" />
          <button type="button" class="btn" @click="m.loadStats()">刷新统计</button>
        </div>
      </TabsNav>
    </template>

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
          <span class="mono">{{ item.user_id }}</span> 的 <span class="mono">{{ item.agent_name }}</span>
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

/* 页面级动作（删除 / 保存），右对齐 */
.mcp-detail__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>

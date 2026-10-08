<script setup lang="ts">
/**
 * MCP 服务详情（`FR-044`、`FR-045`；2026-09-27 改版，09-28 加加载态）。
 *
 * 页签：调用配置 / 工具清单 / 调用统计。**只服务已登记的服务**（新建走 `McpCreateDialog`）：
 * - 保存走 `PUT`，响应里的 `affected_agents` 用于告知影响面；
 * - 删除前 MUST 先列出受影响数字人并二次确认（原"关闭前提示引用"的能力迁移到删除）；
 * - 暴露 `runTest()` 供 `McpArea` 在「创建成功后自动测试一次」时调用——
 *   与用户点「发起测试」**同一条路径**（同一套结果弹窗与播报）。
 *
 * **加载态（2026-09-28）**：详情接口会**同步探测**该服务以取工具清单（慢服务可达数秒），
 * 故 `openedName`（路由参数）与 `loading` 单独传入：**一进详情就用已知服务名显示标题与
 * 加载提示**，MUST NOT 让管理员对着"没反应"的列表干等（原则五"反馈 ≤100ms"、原则九
 * "等待与降级可感知"）。加载中页头动作 MUST 禁用——此时 `revision` 尚未到手，
 * 点保存只会静默不生效。
 *
 * **已下架**：服务启停页（含编排原始声明）与运行日志页——平台不再读容器运行态。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { fetchReferences } from '../../api/deploy'
import { useMcpServices } from '../../composables/useMcpServices'
import type { ErrorInfo, McpServiceConfigInput, McpServiceDetail, ReferenceItem } from '../../api/types'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import TabsNav from '../common/TabsNav.vue'
import McpCallConfigForm from './McpCallConfigForm.vue'
import McpStatsTable from './McpStatsTable.vue'
import McpToolList from './McpToolList.vue'

const props = defineProps<{
  /** 当前打开的服务名（路由参数）：使**加载中**也能显示正确标题 */
  openedName: string
  /** 服务详情；尚未加载完成（或加载失败）时为 `null` */
  service: McpServiceDetail | null
  /** 详情正在读取（含后端对 MCP 服务的实时探测，慢服务可达数秒） */
  loading: boolean
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
  /** 删除成功：父级退回列表 */
  (e: 'deleted', name: string): void
  /** 详情读取失败后用户点「重试」：父级重新拉取 */
  (e: 'reload'): void
  (e: 'announce', text: string): void
}>()

const m = useMcpServices()
const tab = ref('config')
const pendingDelete = ref(false)
const affected = ref<ReferenceItem[]>([])
/** 调用配置表单：页头的「保存调用配置」通过它的 `submit()` 触发（含本地校验） */
const configForm = ref<InstanceType<typeof McpCallConfigForm> | null>(null)
/**
 * 最近一次保存响应里的**掩码请求头**（2026-10-08）：透传给表单，让"刚改完的令牌"
 * 立刻以新掩码显示（保存后不重载详情，见 `onSubmit` 注释）。
 */
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

/**
 * 当前打开的服务名：详情到手前用路由参数（标题因此**加载中即可读**），
 * 到手后以服务端返回为准（两者一致，取后者是为了"以服务端为准"的单一来源）。
 */
const name = computed(() => props.service?.name ?? props.openedName)
/** 动作区在"加载中"也要渲染（只是禁用）：避免按钮在数据到达时突然出现造成布局跳动 */
const showActions = computed(() => props.service !== null || props.loading)

// 进入「调用统计」才取数（省一次请求；此前该页签首次进入是空的，需手动点「刷新统计」）
watch(tab, (next) => {
  if (next === 'stats' && props.service) void m.loadStats()
})

/**
 * 页头右上角的「保存调用配置」。
 *
 * 动作在页头、**校验与提交仍走表单自身路径**（`submit()` 先本地校验再 emit `submit`），
 * 避免两套判据。先切回「调用配置」页签：让管理员看到被保存的内容与校验报错落在哪。
 */
async function requestSave(): Promise<void> {
  tab.value = 'config'
  await nextTick()
  configForm.value?.submit()
}

async function onSubmit(config: McpServiceConfigInput): Promise<void> {
  // 显式传入当前详情的 revision：本组件的 composable 实例从未 loadDetail，
  // 不传的话 saveConfig 会因 detail 为空而静默失败（已修复的接线缺陷）
  const result = await m.saveConfig(name.value, config, props.service?.revision)
  if (result === null) {
    emit('announce', '保存失败，请查看错误原因')
    return
  }
  // 请求头（2026-10-08）：保存响应带的是**掩码**，透传给表单就地刷新展示
  // （不重载详情——重载会连带触发一次 MCP 实时探测，扰乱表单草稿与清单分支）
  savedHeaders.value = result.maskedHeaders
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

/**
 * 「工具清单」页签的「重新探测」：与「读取失败重试」**同一条路径**——重取详情，
 * 后端详情接口会现连服务拿最新清单。解决"打开详情时服务还不可达 → 空清单一直
 * 冻在页面上，而『发起测试』每次都现连、看着是通的"的信息差（2026-10-02）。
 */
function onReprobe(): void {
  emit('announce', '正在重新探测工具清单…')
  emit('reload')
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
        <h2 id="mcp-detail-title" class="mcp-detail__title">{{ name }}</h2>
      </div>

      <!-- 页面级动作放右上角：删除、保存（2026-09-27 产品要求）；加载中禁用（2026-09-28） -->
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
        <!--
          配置面板用 `v-show` **常驻**（不随页签卸载）：
          ① 页头右上角的保存按钮在任意页签都可用；
          ② 切到别的页签再回来，**未保存的编辑不会丢**（表单草稿锚定服务标识，契约 §0.5 原则 ①）。
        -->
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
          <McpStatsTable :groups="m.statsGroups.value" :available="m.statsAvailable.value" :only="name" />
          <button type="button" class="btn" @click="m.loadStats()">刷新统计</button>
        </div>
      </TabsNav>
    </template>

    <!-- 加载中：明确告知"在等什么"，而不是让管理员对着没反应的界面干等（原则九） -->
    <p v-else-if="props.loading" class="mcp-detail__loading" role="status" aria-live="polite">
      正在读取调用配置与工具清单…（工具清单需要连接该 MCP 服务，慢服务请稍候）
    </p>

    <!-- 读取失败：停在详情页给出原因与重试，而不是默默退回列表（让"点不开"变得可解释） -->
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

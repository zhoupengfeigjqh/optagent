<script setup lang="ts">
/**
 * 异常项汇总（`FR-055`、`SC-016`，落在数字人部署功能区内）。
 *
 * 硬要求：**一次视图内**列出全部引用了失效对象的数字人及其所属用户，
 * 并可跳转到对应编辑位置——MUST NOT 要求管理员逐个翻查。
 *
 * 界面名称为「异常项汇总」（2026-09-16 十一次调整去掉了"全局"二字，避免与
 * "仅部署勾选用户"的局部视角混淆）；规格条款名仍是"全局异常项汇总"。
 *
 * 编辑跳转路径由服务端返回模板（`edit_path`）拼出，前端不硬编码路由（原则七）。
 */
import { computed, onMounted, ref } from 'vue'
import { fetchAnomalies } from '../../api/deploy'
import type { AnomalyResponse, ErrorInfo } from '../../api/types'
import EmptyState from '../common/EmptyState.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import StatusBadge from '../common/StatusBadge.vue'

const emit = defineEmits<{
  (e: 'navigate', path: string): void
}>()

const data = ref<AnomalyResponse | null>(null)
const loading = ref(false)
const error = ref<ErrorInfo | null>(null)

const CATEGORY_LABEL: Record<string, string> = {
  builtin_tool: '内置工具',
  mcp_service: 'MCP 服务',
  skill: 'SKILL',
}

const items = computed(() => data.value?.items ?? [])

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await fetchAnomalies(50)
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    loading.value = false
  }
}

/** 由服务端返回的路径模板拼出编辑跳转地址 */
function editPathOf(agentName: string, category: string): string {
  const template = data.value?.edit_path ?? '/agents/{agent_name}?tab={category}'
  return template
    .replace('{agent_name}', encodeURIComponent(agentName))
    .replace('{category}', encodeURIComponent(category))
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="anomaly-summary" aria-label="异常项汇总">
    <div class="anomaly-summary__header">
      <h3 class="anomaly-summary__title">异常项汇总</h3>
      <button type="button" class="btn" :disabled="loading" @click="load">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <ErrorNotice :error="error" title="异常项汇总加载失败" />

    <p v-if="loading" role="status">加载中…</p>

    <EmptyState
      v-else-if="items.length === 0 && !error"
      title="没有异常项"
      description="当前所有数字人引用的工具、服务与 SKILL 均有效。"
    />

    <template v-else-if="items.length > 0">
      <p class="field__hint" aria-live="polite">
        共 {{ data?.total ?? 0 }} 项失效引用，已在本视图内全部列出。
      </p>
      <table class="anomaly-summary__table">
        <caption class="visually-hidden">全部失效引用及其所属用户与数字人</caption>
        <thead>
          <tr>
            <th scope="col">用户</th>
            <th scope="col">数字人</th>
            <th scope="col">类别</th>
            <th scope="col">失效对象</th>
            <th scope="col">说明</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in items" :key="index">
            <td>{{ item.user_id || '（未关联）' }}</td>
            <td class="mono">{{ item.agent_name }}</td>
            <td>
              <StatusBadge status="abnormal" :label="CATEGORY_LABEL[item.category] ?? item.category" tone="error" />
            </td>
            <td class="mono">{{ item.target_name }}</td>
            <td>{{ item.detail }}</td>
            <td>
              <button
                type="button"
                class="btn"
                :aria-label="`跳转到数字人 ${item.agent_name} 的编辑位置`"
                @click="emit('navigate', editPathOf(item.agent_name, item.category))"
              >
                去修复
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="data?.truncated" class="field__hint">结果被截断，请缩小范围后重试。</p>
    </template>
  </section>
</template>

<style scoped>
.anomaly-summary__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.anomaly-summary__title {
  margin: 0;
  font-size: var(--font-size-md);
}

.anomaly-summary__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.anomaly-summary__table th,
.anomaly-summary__table td {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  text-align: left;
  vertical-align: top;
}
</style>

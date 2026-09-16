<script setup lang="ts">
/**
 * 部署历史（`FR-033`、`SC-008`）：可追溯到时间、涉及对象与结果。
 *
 * 两条界面口径（2026-09-16 十三次调整）：
 * - **每页固定 5 条**：历史是持续追加的日志，整表铺开会把页面撑得极长；翻页在
 *   **已拉取到的**记录内进行（服务端有界返回最近 100 条，即最多 20 页）；
 * - **展开行看部署明细**：结果列只能说"部分成功/失败"，而"失败的是哪个用户、
 *   哪些数字人、为什么失败"必须能就地看到。这些数据**本就在历史记录里**
 *   （`users[]` / `manifest_diff`），此前只是没有呈现——故不另设详情接口。
 *   展开**单开**（同时只展开一行），翻页后自动收起；
 *   「明细」操作列置于**最右**（失败数之后，2026-09-16 十四次调整）。
 */
import { computed, ref, watch } from 'vue'
import type { DeployHistoryItem, DeployManifestDiffEntry, DeployUserResult } from '../../api/types'
import EmptyState from '../common/EmptyState.vue'
import StatusBadge from '../common/StatusBadge.vue'

const props = defineProps<{
  items: DeployHistoryItem[]
  /** 服务端有界返回（`FR-006`）：为真即"还有更早的记录没有拉取" */
  truncated?: boolean
}>()

/** 每页条数：固定值，界面只翻页（MUST NOT 由用户调整） */
const PAGE_SIZE = 5

const RESULT_LABEL: Record<string, string> = {
  succeeded: '全部成功',
  partial: '部分成功',
  failed: '失败',
}

const RESULT_TONE: Record<string, 'success' | 'warning' | 'error'> = {
  succeeded: 'success',
  partial: 'warning',
  failed: 'error',
}

const page = ref(1)
/** 当前展开的那一条；`null` = 全部收起 */
const expandedId = ref<string | null>(null)

const totalPages = computed(() =>
  props.items.length === 0 ? 0 : Math.ceil(props.items.length / PAGE_SIZE),
)

const pageItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return props.items.slice(start, start + PAGE_SIZE)
})

const summaryText = computed(() =>
  totalPages.value > 1
    ? `共 ${props.items.length} 条，第 ${page.value} / ${totalPages.value} 页`
    : `共 ${props.items.length} 条`,
)

// 记录被重新拉取后页码可能越界（如历史被清理过）→ 收敛到最后一页，不出现空白页
watch(
  () => props.items.length,
  (length) => {
    const last = length === 0 ? 1 : Math.ceil(length / PAGE_SIZE)
    if (page.value > last) page.value = last
  },
)

// 新记录插在**最前**（倒序）→ 拉到新数据就回到第 1 页并收起展开行，否则新记录看不见
watch(
  () => props.items[0]?.id,
  (next, previous) => {
    if (previous !== undefined && next !== previous) {
      page.value = 1
      expandedId.value = null
    }
  },
)

function toggle(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}

function go(target: number): void {
  if (target < 1 || target > Math.max(1, totalPages.value)) return
  page.value = target
  expandedId.value = null
}

/** 某个用户结果里的数字人名单（按动作分组：写入 / 从运行环境下架） */
function agentNames(user: DeployUserResult, action: 'written' | 'removed'): string[] {
  return (user.agents ?? []).filter((agent) => agent.action === action).map((agent) => agent.name)
}

/** 校验结论：`passed` 为假时**带上错误项数**，只说"未通过"无法定位问题规模 */
function validationText(item: DeployHistoryItem): string {
  if (!item.validation) return '校验结果未记录'
  return item.validation.passed
    ? '校验通过'
    : `校验未通过（${item.validation.error_count} 项）`
}

/** 差异项一行文字：用户 / 数字人：可读说明（缺说明时回退到差异类型） */
function diffText(diff: DeployManifestDiffEntry): string {
  const target = diff.target ? ` / ${diff.target}` : ''
  return `${diff.user_id}${target}：${diff.detail || diff.kind}`
}
</script>

<template>
  <section class="deploy-history" aria-label="部署历史">
    <header class="deploy-history__header">
      <h3 class="deploy-history__title">部署历史</h3>
      <p class="deploy-history__summary" aria-live="polite">{{ summaryText }}</p>
    </header>

    <EmptyState
      v-if="props.items.length === 0"
      title="还没有部署记录"
      description="执行一次「部署生效」后，这里会记录时间、涉及对象与结果。"
    />

    <template v-else>
      <table class="deploy-history__table">
        <caption class="visually-hidden">
          部署记录第 {{ page }} 页（每页 {{ PAGE_SIZE }} 条，共 {{ props.items.length }} 条）
        </caption>
        <thead>
          <tr>
            <th scope="col">时间</th>
            <th scope="col">操作者</th>
            <th scope="col">目标运行形态</th>
            <th scope="col">结果</th>
            <th scope="col">用户数</th>
            <th scope="col">失败数</th>
            <th scope="col">明细</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="item in pageItems" :key="item.id">
            <tr class="deploy-history__row">
              <td>{{ item.deployed_at }}</td>
              <td>{{ item.operator }}</td>
              <td class="mono">{{ item.target_runtime_form }}</td>
              <td>
                <StatusBadge
                  :status="item.result === 'succeeded' ? 'ok' : 'failed'"
                  :label="RESULT_LABEL[item.result] ?? item.result"
                  :tone="RESULT_TONE[item.result] ?? 'neutral'"
                />
              </td>
              <td>{{ item.user_count }}</td>
              <td>{{ item.error_count }}</td>
              <td>
                <button
                  type="button"
                  class="btn deploy-history__toggle"
                  :aria-expanded="expandedId === item.id"
                  :aria-controls="`deploy-history-detail-${item.id}`"
                  @click="toggle(item.id)"
                >
                  {{ expandedId === item.id ? '收起' : '展开' }}
                  <span class="visually-hidden">部署明细（{{ item.deployed_at }}）</span>
                </button>
              </td>
            </tr>

            <!-- 部署明细：逐用户结果（含失败原因）与本次差异项 -->
            <tr v-if="expandedId === item.id" class="deploy-history__detail-row">
              <td colspan="7">
                <div :id="`deploy-history-detail-${item.id}`" class="deploy-history__detail">
                  <p class="deploy-history__detail-summary">
                    目标运行形态 <span class="mono">{{ item.target_runtime_form }}</span>；涉及
                    {{ item.user_count }} 个用户（失败 {{ item.error_count }} 个）；{{
                      validationText(item)
                    }}；本次差异 {{ (item.manifest_diff ?? []).length }} 条
                  </p>

                  <p v-if="!item.users || item.users.length === 0" class="card__meta">
                    这条记录没有逐用户明细（早期版本写入的记录），失败原因请查服务端日志。
                  </p>

                  <ul v-else class="deploy-history__users">
                    <li
                      v-for="user in item.users"
                      :key="user.user_id"
                      class="deploy-history__user"
                    >
                      <p class="deploy-history__user-head">
                        <span class="mono">{{ user.user_id }}</span>
                        <StatusBadge
                          :status="user.ok ? 'ok' : 'failed'"
                          :label="user.ok ? '部署成功' : '部署失败'"
                          :tone="user.ok ? 'success' : 'error'"
                        />
                      </p>
                      <p v-if="!user.ok" class="deploy-history__error">
                        <span class="deploy-history__error-label">失败原因：</span>{{ user.error ?? '未记录原因' }}
                      </p>
                      <p class="deploy-history__agents">
                        <template v-if="agentNames(user, 'written').length > 0">
                          写入（{{ agentNames(user, 'written').length }}）：
                          <span class="mono">{{ agentNames(user, 'written').join('、') }}</span>
                        </template>
                        <template v-else>写入：无（该用户本次没有数字人产物）</template>
                      </p>
                      <p v-if="agentNames(user, 'removed').length > 0" class="deploy-history__agents">
                        下架（{{ agentNames(user, 'removed').length }}）：
                        <span class="mono">{{ agentNames(user, 'removed').join('、') }}</span>
                      </p>
                    </li>
                  </ul>

                  <template v-if="(item.manifest_diff ?? []).length > 0">
                    <p class="deploy-history__detail-title">
                      差异项（{{ (item.manifest_diff ?? []).length }} 条）
                    </p>
                    <ul class="deploy-history__diffs">
                      <li v-for="(diff, index) in item.manifest_diff ?? []" :key="index" class="mono">
                        {{ diffText(diff) }}
                      </li>
                    </ul>
                  </template>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <nav v-if="totalPages > 1" class="deploy-history__pager" aria-label="部署历史分页">
        <button
          type="button"
          class="btn"
          :disabled="page <= 1"
          :aria-label="`上一页（当前第 ${page} 页）`"
          @click="go(page - 1)"
        >
          上一页
        </button>
        <span class="deploy-history__page-indicator" aria-live="polite">
          第 {{ page }} / {{ totalPages }} 页
        </span>
        <button
          type="button"
          class="btn"
          :disabled="page >= totalPages"
          :aria-label="`下一页（当前第 ${page} 页）`"
          @click="go(page + 1)"
        >
          下一页
        </button>
      </nav>

      <p v-if="props.truncated" class="field__hint">
        仅显示最近 {{ props.items.length }} 条记录（服务端有界返回），更早的记录未拉取。
      </p>
    </template>
  </section>
</template>

<style scoped>
.deploy-history__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.deploy-history__title {
  margin: 0;
  font-size: var(--font-size-md);
}

.deploy-history__summary {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.deploy-history__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.deploy-history__table th,
.deploy-history__table td {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  text-align: left;
}

.deploy-history__toggle {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
}

/* 展开行整行铺满（colspan）；背景与正文区分，避免明细被当成又一行记录 */
.deploy-history__detail-row td {
  background: var(--color-bg-subtle);
  vertical-align: top;
}

.deploy-history__detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.deploy-history__detail-summary,
.deploy-history__detail-title {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.deploy-history__detail-title {
  font-weight: 600;
}

.deploy-history__users,
.deploy-history__diffs {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.deploy-history__user {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.deploy-history__user-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-weight: 600;
}

.deploy-history__error {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-status-error);
  overflow-wrap: anywhere;
}

.deploy-history__error-label {
  font-weight: 600;
}

.deploy-history__agents {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.deploy-history__diffs li {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.deploy-history__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.deploy-history__page-indicator {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
</style>

<script setup lang="ts">
/**
 * 调用统计表（`FR-049`、`FR-050`）。
 *
 * 硬要求（`FR-009`）：运行环境不可达时 MUST 显示**「未知」而非 0**——
 * 0 是"确实没调用过"的确定结论，与"读不到"是两回事。
 *
 * 明细列（2026-09-16 十四次调整）：最右一列可**展开**看该服务**按用户**的调用
 * 次数（成功/失败分列）。数据本就在统计响应的 `users[]` 里（运行环境从事件
 * 明细聚合），**不另设详情端点**；展开**单开**（同时只展开一行）。
 */
import { ref } from 'vue'
import type { McpStatsItem, McpStatsUser } from '../../api/types'

const props = defineProps<{
  items: McpStatsItem[]
  /** 统计是否可得；为 false 时全部数值显示为"未知" */
  available: boolean
  /** 只显示某个服务的统计（服务详情页用） */
  only?: string
}>()

/** 当前展开的服务名；`null` = 全部收起（与部署历史同口径：单开） */
const expandedName = ref<string | null>(null)

function rows(): McpStatsItem[] {
  const list = props.only ? props.items.filter((i) => i.name === props.only) : props.items
  return list
}

function toggle(name: string): void {
  expandedName.value = expandedName.value === name ? null : name
}

/** 明细里的用户标识：`null` 是升级前的历史事件（未记录归属），不静默留白 */
function userLabel(user: McpStatsUser): string {
  return user.user_id ?? '（未归属·升级前记录）'
}

function valueOf(text: string | number | null | undefined): string {
  if (!props.available) return '未知'
  if (text === null || text === undefined) return '—'
  return String(text)
}

/** 时间窗单元格：格式"成功/总数"；旧数据无 windows 时显示"—" */
function windowCell(item: McpStatsItem, key: 'h24' | 'd7' | 'd30' | 'd365'): string {
  if (!props.available) return '未知'
  const w = item.windows?.[key]
  if (!w) return '—'
  return `${w.ok}/${w.total}`
}
</script>

<template>
  <section class="mcp-stats" aria-label="MCP 调用统计">
    <p v-if="!props.available" class="mcp-stats__unknown" role="status">
      运行环境不可达，调用统计**未知**（MUST NOT 以 0 冒充）。
    </p>

    <table class="mcp-stats__table">
      <caption class="visually-hidden">按服务的 MCP 工具调用次数（含时间窗与按用户明细）</caption>
      <thead>
        <tr>
          <th scope="col">服务</th>
          <th scope="col">最近24h</th>
          <th scope="col">最近7天</th>
          <th scope="col">最近30天</th>
          <th scope="col">最近一年</th>
          <th scope="col">累计（成功/失败）</th>
          <th scope="col">最近调用时间</th>
          <th scope="col">明细</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows().length === 0">
          <td colspan="8" class="muted">
            {{ props.available ? '尚无任何调用记录' : '未知' }}
          </td>
        </tr>
        <template v-for="item in rows()" :key="item.name">
          <tr>
            <td class="mono">{{ item.name }}</td>
            <td>{{ windowCell(item, 'h24') }}</td>
            <td>{{ windowCell(item, 'd7') }}</td>
            <td>{{ windowCell(item, 'd30') }}</td>
            <td>{{ windowCell(item, 'd365') }}</td>
            <td>{{ valueOf(item.calls_ok) }} / {{ valueOf(item.calls_failed) }}</td>
            <td>{{ valueOf(item.last_called_at ?? '从未调用') }}</td>
            <td>
              <button
                type="button"
                class="btn mcp-stats__toggle"
                :aria-expanded="expandedName === item.name"
                :aria-controls="`mcp-stats-detail-${item.name}`"
                @click="toggle(item.name)"
              >
                {{ expandedName === item.name ? '收起' : '展开' }}
                <span class="visually-hidden">按用户明细（{{ item.name }}）</span>
              </button>
            </td>
          </tr>

          <!-- 按用户明细：数据本就在统计响应的 users[] 里，不另设详情端点 -->
          <tr v-if="expandedName === item.name" class="mcp-stats__detail-row">
            <td colspan="8">
              <div :id="`mcp-stats-detail-${item.name}`" class="mcp-stats__detail">
                <p v-if="!item.users || item.users.length === 0" class="mcp-stats__detail-empty">
                  该服务暂无按用户明细（事件明细已超出一年的保留期，或调用发生在按用户统计升级之前）。
                </p>
                <ul v-else class="mcp-stats__users">
                  <li v-for="user in item.users" :key="user.user_id ?? '（未归属）'" class="mcp-stats__user">
                    <span class="mono">{{ userLabel(user) }}</span>
                    <span>
                      成功 {{ user.calls_ok }} / 失败 {{ user.calls_failed }}（共
                      {{ user.calls_total }} 次）
                    </span>
                    <span class="mcp-stats__user-last">最近 {{ user.last_called_at ?? '—' }}</span>
                  </li>
                </ul>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="props.available && props.only && rows().length === 0">
          <td colspan="8" class="muted">该服务从未被调用过（统计为 0）。</td>
        </tr>
      </tbody>
    </table>
    <p class="mcp-stats__note">
      时间窗单元格格式：<code class="mono">成功/总数</code>；事件明细保留一年，按用户明细同口径。
    </p>
  </section>
</template>

<style scoped>
.mcp-stats__unknown {
  margin: 0 0 var(--space-2);
  color: var(--color-status-warning);
  font-size: var(--font-size-sm);
}

.mcp-stats__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.mcp-stats__table th,
.mcp-stats__table td {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  text-align: left;
}

.mcp-stats__toggle {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
}

/* 展开行整行铺满（colspan）；背景与正文区分，避免明细被当成又一行记录（与部署历史同口径） */
.mcp-stats__detail-row td {
  background: var(--color-bg-subtle);
  vertical-align: top;
}

.mcp-stats__detail-empty {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.mcp-stats__users {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mcp-stats__user {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--font-size-xs);
}

.mcp-stats__user-last {
  color: var(--color-text-secondary);
}

.mcp-stats__note {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>

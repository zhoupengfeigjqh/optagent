<script setup lang="ts">
/**
 * 账户授权详情（2026-11-27 交互收敛）。
 *
 * **授权 = 关联**：`users.agents[]` 就是该账户"已授权的数字人"，
 * 不存在另一套独立的授权记录。因此本弹窗列出平台内**全部已设计的数字人**。
 *
 * **勾选只是草稿**：勾选 / 取消勾选只改本地草稿，不写库；点「授权」→ 二次确认 →
 * 才把草稿整体写回 `agents[]`；点「退出」直接关闭，草稿丢弃、不产生任何写入。
 * （2026-11-27 之前是"勾选即写"，点错一下就已经生效，没有反悔余地。）
 *
 * **授权不等于生效**：授权只决定"允许部署什么"，真正下发到运行环境要靠用户列表的
 * 「部署」按钮（`POST /api/admin/deploy`）。界面必须把这句话讲清楚。
 */
import { computed, ref, watch } from 'vue'
import { listAllAgents } from '../../api/agents'
import { fetchManifest } from '../../api/manifest'
import type { AgentListItem, ErrorInfo, UserListItem } from '../../api/types'
import { updateUser } from '../../api/users'
import { agentCheckboxOptions } from '../agents/agent-options'
import BaseDialog from '../common/BaseDialog.vue'
import CheckboxList from '../common/CheckboxList.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  open: boolean
  user: UserListItem | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'changed'): void
  (e: 'announce', text: string): void
}>()

const agents = ref<AgentListItem[]>([])
/** 已生效的授权（服务端 `agents[]`），保存成功后才更新 */
const authorized = ref<string[]>([])
/** 草稿勾选：确认之前一切都不落库，「退出」即丢弃 */
const draft = ref<string[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref<ErrorInfo | null>(null)
/** 二次确认弹窗开关 */
const confirming = ref(false)

const options = computed(() => agentCheckboxOptions(agents.value))

/** 已授权但设计态已不存在（数字人被删）的项：交给 CheckboxList 单独提示并可移除 */
const orphans = computed(() => {
  const known = new Set(agents.value.map((agent) => agent.name))
  return draft.value.filter((name) => !known.has(name))
})

const added = computed(() => draft.value.filter((name) => !authorized.value.includes(name)))
const removed = computed(() => authorized.value.filter((name) => !draft.value.includes(name)))
const dirty = computed(() => added.value.length > 0 || removed.value.length > 0)

const confirmMessage = computed(() => {
  const name = props.user?.display_name || props.user?.user_id || ''
  const parts = [`账户「${name}」的授权将更新为 ${draft.value.length} 个数字人。`]
  if (added.value.length > 0) parts.push(`新增授权：${added.value.join('、')}。`)
  if (removed.value.length > 0) parts.push(`关闭授权：${removed.value.join('、')}。`)
  parts.push('确认后立即写入授权清单；仍需点击该账户的「部署」才会下发到运行环境。')
  return parts.join('')
})

async function load(): Promise<void> {
  error.value = null
  confirming.value = false
  const current = props.user?.agents.map((agent) => agent.name) ?? []
  authorized.value = current
  draft.value = [...current]
  loading.value = true
  try {
    agents.value = await listAllAgents()
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    loading.value = false
  }
}

/** 勾选只改草稿：不写库，避免"点错一下就已经生效" */
function onToggle(next: string[]): void {
  draft.value = next
}

function requestGrant(): void {
  if (!dirty.value || saving.value) return
  confirming.value = true
}

/** 退出：丢弃草稿并关闭，不产生任何写入 */
function exitWithoutSaving(): void {
  draft.value = [...authorized.value]
  error.value = null
  emit('update:open', false)
}

async function confirmGrant(): Promise<void> {
  const user = props.user
  if (!user) return
  const next = [...draft.value]
  saving.value = true
  error.value = null
  try {
    // 版本号现取现用：清单刚变更过就换版本，用旧版本会 409
    const { revision } = await fetchManifest()
    await updateUser(user.user_id, next, revision)
    authorized.value = next
    emit('announce', `授权已生效：共 ${next.length} 个数字人；点击该账户的「部署」后下发到运行环境`)
    emit('changed')
  } catch (err) {
    // 失败时草稿保留，管理员可重试或直接退出（不落库）
    error.value = err as ErrorInfo
  } finally {
    saving.value = false
  }
}

watch(
  () => [props.open, props.user?.user_id] as const,
  ([open], previous) => {
    const opened = open && (previous === undefined || previous[0] !== true)
    if (opened) void load()
  },
  { immediate: true },
)
</script>

<template>
  <BaseDialog
    :open="open"
    title="授权详情"
    :width="640"
    @update:open="emit('update:open', $event)"
  >
    <template v-if="open">
      <div class="grant-detail__summary">
        <span>账户</span>
        <strong>{{ user?.display_name || user?.user_id || '—' }}</strong>
        <span class="mono">{{ user?.phone || '未绑定手机号' }}</span>
        <span>已授权 {{ authorized.length }} / 共 {{ agents.length }} 个数字人</span>
        <span v-if="dirty" class="grant-detail__dirty">待确认 {{ draft.length }} 个</span>
      </div>

      <p class="grant-detail__hint">
        勾选 / 取消勾选只修改<strong>草稿</strong>；点「<strong>授权</strong>」并二次确认后才写入该账户的关联清单，
        点「<strong>退出</strong>」直接放弃本次改动。授权只决定"允许使用什么"，还需在用户列表点击
        <strong>「部署」</strong>才会下发到运行环境。
      </p>

      <!-- 错误与清单并列呈现：写入失败时清单必须还在，管理员才能看清现状并重试 -->
      <ErrorNotice v-if="error" :error="error" title="授权变更未完成" />
      <p v-if="loading" class="grant-detail__empty" role="status">数字人清单加载中…</p>
      <p v-else-if="agents.length === 0" class="grant-detail__empty">
        平台内还没有已设计的数字人，请先在「数字人设计」功能区创建。
      </p>
      <template v-else>
        <CheckboxList
          legend="可授权的数字人"
          :options="options"
          :model-value="draft"
          :orphans="orphans"
          search-placeholder="按数字人名或描述搜索…"
          empty-text="没有匹配的数字人"
          @update:model-value="onToggle"
        />
        <p v-if="saving" class="grant-detail__saving" role="status">正在保存授权变更…</p>
      </template>
    </template>

    <template #footer>
      <button type="button" class="btn" :disabled="saving" @click="exitWithoutSaving">退出</button>
      <button
        type="button"
        class="btn btn--primary"
        :disabled="!dirty || saving"
        :title="dirty ? '确认后写入授权清单' : '尚未改动，无需授权'"
        @click="requestGrant"
      >
        {{ saving ? '保存中…' : '授权' }}
      </button>
    </template>
  </BaseDialog>

  <ConfirmDialog
    v-model:open="confirming"
    data-test="grant-confirm"
    title="确认授权变更？"
    :message="confirmMessage"
    confirm-label="确认授权"
    @confirm="confirmGrant"
  />
</template>

<style scoped>
.grant-detail__summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.grant-detail__summary strong {
  color: var(--color-text);
}

.grant-detail__dirty {
  border-radius: var(--radius-sm);
  padding: 1px 7px;
  background: var(--color-status-warning-bg);
  color: var(--color-status-warning);
  font-size: var(--font-size-xs);
}

.grant-detail__hint {
  margin: var(--space-3) 0;
  padding: var(--space-3);
  border: 1px solid #d8e5fd;
  border-radius: var(--radius-sm);
  background: var(--color-primary-subtle);
  color: #33507e;
  font-size: var(--font-size-xs);
  line-height: 1.7;
}

.grant-detail__empty {
  margin: 0;
  padding: var(--space-5) 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.grant-detail__saving {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>

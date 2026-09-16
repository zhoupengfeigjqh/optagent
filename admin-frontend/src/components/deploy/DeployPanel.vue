<script setup lang="ts">
/**
 * 部署面板（`FR-027`、`FR-057`）。
 *
 * 职责：目标运行形态可见 → **本次范围**（部署对象在「用户与关联数字人」页勾选）
 * → 校验预检（**一次性列出全部错误项**）→ 部署触发 → 结果明细。
 *
 * 两条硬约束：
 * 1. **未勾选任何用户 → 既不能预检、也不能部署**（空选择绝不能落回服务端
 *    "缺省 = 全部用户"的语义，那会变成误部署全平台）；
 * 2. 勾选或目标形态**任一变化即作废上一次预检**，避免"用 A 的结论部署 B"。
 */
import { computed, onMounted, watch } from 'vue'
import { useDeploy } from '../../composables/useDeploy'
import ErrorNotice from '../common/ErrorNotice.vue'
import StatusBadge from '../common/StatusBadge.vue'
import RuntimeFormSwitch from './RuntimeFormSwitch.vue'

const props = defineProps<{
  /** 部署对象（在「用户与关联数字人」页勾选） */
  selectedUserIds: string[]
}>()

const emit = defineEmits<{
  (e: 'navigate', path: string): void
  (e: 'announce', text: string): void
  (e: 'deployed'): void
}>()

const d = useDeploy()

const hasTarget = computed(() => props.selectedUserIds.length > 0)
const canDeploy = computed(
  () => hasTarget.value && d.validated.value && d.validationErrors.value.length === 0,
)
/** 范围文案：让管理员确认"这次动的是谁" */
const scopeLabel = computed(() =>
  hasTarget.value ? `已选用户：${nameList(props.selectedUserIds)}` : '尚未选择用户',
)

onMounted(() => {
  void d.loadSettings()
})

// 勾选变化 → 上一次预检结论作废（服务端部署时也会重新校验，但界面不能给假承诺）
watch(
  () => props.selectedUserIds,
  () => d.invalidateValidation(),
)

async function onValidate(): Promise<void> {
  await d.validate(props.selectedUserIds)
  const count = d.validationErrors.value.length
  const scope = scopeLabel.value
  emit(
    'announce',
    count === 0
      ? `部署前校验通过（范围：${scope}）`
      : `部署前校验未通过，共 ${count} 项错误（范围：${scope}）`,
  )
}

async function onDeploy(): Promise<void> {
  const scope = scopeLabel.value
  const ok = await d.deploy(props.selectedUserIds)
  emit('announce', ok ? `部署已完成（范围：${scope}）` : '部署未完成，请查看错误明细')
  if (ok) emit('deployed')
}

async function onSwitch(form: string): Promise<void> {
  await d.switchForm(form)
}

/** 范围文案里的用户名清单：最多列 3 个，其余折叠为"等 N 个"（避免撑爆标题） */
function nameList(userIds: string[]): string {
  if (userIds.length <= 3) return userIds.join('、')
  return `${userIds.slice(0, 3).join('、')} 等 ${userIds.length} 个`
}
</script>

<template>
  <section class="deploy-panel" aria-label="部署生效">
    <RuntimeFormSwitch
      :current="d.settings.value?.target_runtime_form ?? '—'"
      :forms="d.forms.value"
      @switch="onSwitch"
      @announce="emit('announce', $event)"
    />

    <!-- 本次范围：部署对象在「用户与关联数字人」页的卡片上勾选（未勾选则两个按钮都不可用） -->
    <p class="deploy-panel__scope" role="status" aria-live="polite">
      本次范围：<strong>{{ scopeLabel }}</strong>
      <span v-if="!hasTarget" class="muted">
        （请在下方「用户与关联」中勾选要部署的用户；未勾选时不能校验、也不能部署）
      </span>
      <span v-else class="muted">（变更勾选或目标运行形态后需重新校验）</span>
    </p>

    <div class="deploy-panel__actions">
      <button
        type="button"
        class="btn"
        :disabled="!hasTarget || d.validating.value"
        @click="onValidate"
      >
        {{ d.validating.value ? '校验中…' : '校验预检' }}
      </button>
      <button
        type="button"
        class="btn btn--primary"
        :disabled="d.deploying.value || !canDeploy"
        @click="onDeploy"
      >
        {{ d.deploying.value ? '部署中…' : '部署生效' }}
      </button>
      <span v-if="!hasTarget" class="muted">请先勾选部署对象</span>
      <span v-else-if="!d.validated.value" class="muted">请先执行校验预检</span>
    </div>

    <ErrorNotice :error="d.error.value" title="部署未完成" />

    <!-- 校验结果：一次性列出全部错误项（SC-020） -->
    <div v-if="d.validated.value" class="deploy-panel__validation" role="status" aria-live="polite">
      <p v-if="d.validationErrors.value.length === 0" class="deploy-panel__ok">
        <StatusBadge status="ok" label="校验通过" />
        全部用户与数字人的配置均通过部署前校验。
      </p>
      <template v-else>
        <p class="deploy-panel__fail">
          <StatusBadge status="failed" :label="`校验未通过（${d.validationErrors.value.length} 项）`" />
          部署已被阻止，**运行环境零写入**。以下为全部错误项：
        </p>
        <table class="deploy-panel__table">
          <caption class="visually-hidden">部署前校验错误清单</caption>
          <thead>
            <tr>
              <th scope="col">用户</th>
              <th scope="col">数字人</th>
              <th scope="col">类别</th>
              <th scope="col">原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in d.validationErrors.value" :key="index">
              <td>{{ item.user_id || '—' }}</td>
              <td>{{ item.agent_name || '—' }}</td>
              <td>{{ item.category }}</td>
              <td>{{ item.message }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <!-- 部署结果 -->
    <div v-if="d.result.value" class="deploy-panel__result" aria-live="polite">
      <h3>部署结果</h3>
      <p class="field__hint">
        目标运行形态：{{ d.result.value.target_runtime_form }}；已在部署历史中记录（id
        {{ d.result.value.history_id }}）。
      </p>
      <ul>
        <li v-for="user in d.result.value.users" :key="user.user_id">
          <StatusBadge :status="user.ok ? 'ok' : 'failed'" :label="user.ok ? '成功' : '失败'" />
          <span class="mono">{{ user.user_id }}</span>
          <span v-if="user.ok" class="muted">
            写入 {{ user.agents.filter((a) => a.action === 'written').length }} 个、
            移除 {{ user.agents.filter((a) => a.action === 'removed').length }} 个
          </span>
          <span v-else class="deploy-panel__error">{{ user.error }}</span>
        </li>
      </ul>

      <template v-if="d.result.value.manifest_diff.length > 0">
        <h4>本次部署的差异</h4>
        <ul>
          <li v-for="(diff, index) in d.result.value.manifest_diff" :key="index">
            {{ (diff as Record<string, string>).detail ?? JSON.stringify(diff) }}
          </li>
        </ul>
      </template>
    </div>

  </section>
</template>

<style scoped>
.deploy-panel {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.deploy-panel__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-4) 0;
}

.deploy-panel__scope {
  margin: var(--space-4) 0 0;
  font-size: var(--font-size-sm);
}

.deploy-panel__validation,
.deploy-panel__result {
  margin-top: var(--space-4);
}

.deploy-panel__ok,
.deploy-panel__fail {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
}

.deploy-panel__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.deploy-panel__table th,
.deploy-panel__table td {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  text-align: left;
  vertical-align: top;
}

.deploy-panel__error {
  color: var(--color-status-error);
}
</style>

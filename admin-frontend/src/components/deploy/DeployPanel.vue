<script setup lang="ts">
/**
 * 部署面板（`FR-026`）。
 *
 * 职责：**本次范围**（部署对象在「用户与关联数字人」页勾选）→ 部署触发 → 结果明细。
 *
 * 硬约束：**未勾选任何用户 → 不能部署**（空选择绝不能落回服务端
 * "缺省 = 全部用户"的语义，那会变成误部署全平台）。
 *
 * **2026-09-27**：「目标运行形态」随 MCP 单一连接地址下架，本面板不再有形态切换。
 * **2026-11-23**：部署前预检下架（设计态在保存时已完成同口径校验），
 * 「校验预检」按钮与错误清单表一并移除——勾选后直接部署。
 */
import { computed } from 'vue'
import { useDeploy } from '../../composables/useDeploy'
import { diffText } from '../../utils/deploy-diff'
import ErrorNotice from '../common/ErrorNotice.vue'
import StatusBadge from '../common/StatusBadge.vue'

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
/** 范围文案：让管理员确认"这次动的是谁" */
const scopeLabel = computed(() =>
  hasTarget.value ? `已选用户：${nameList(props.selectedUserIds)}` : '尚未选择用户',
)

async function onDeploy(): Promise<void> {
  const scope = scopeLabel.value
  const ok = await d.deploy(props.selectedUserIds)
  emit('announce', ok ? `部署已完成（范围：${scope}）` : '部署未完成，请查看错误明细')
  if (ok) emit('deployed')
}

/** 范围文案里的用户名清单：最多列 3 个，其余折叠为"等 N 个"（避免撑爆标题） */
function nameList(userIds: string[]): string {
  if (userIds.length <= 3) return userIds.join('、')
  return `${userIds.slice(0, 3).join('、')} 等 ${userIds.length} 个`
}
</script>

<template>
  <section class="deploy-panel" aria-label="部署生效">
    <!-- 本次范围：部署对象在「用户与关联数字人」页的卡片上勾选（未勾选则按钮不可用） -->
    <p class="deploy-panel__scope" role="status" aria-live="polite">
      本次范围：<strong>{{ scopeLabel }}</strong>
      <span v-if="!hasTarget" class="muted">
        （请在下方「用户与关联」中勾选要部署的用户；未勾选时不能部署）
      </span>
      <span v-else class="muted">（勾选后点击「部署生效」）</span>
    </p>

    <div class="deploy-panel__actions">
      <button
        type="button"
        class="btn btn--primary"
        :disabled="d.deploying.value || !hasTarget"
        @click="onDeploy"
      >
        {{ d.deploying.value ? '部署中…' : '部署生效' }}
      </button>
      <span v-if="!hasTarget" class="muted">请先勾选部署对象</span>
    </div>

    <ErrorNotice :error="d.error.value" title="部署未完成">
      <!-- 整批 404 的原因必须可定位：`ADM_USER_NOT_FOUND` 的文案是通用码，
           具体是哪几个用户由服务端 `details.user_ids` 下发（2026-10-20） -->
      <p v-if="d.unknownUserIds.value.length > 0" class="deploy-panel__unknown">
        勾选列表中已不存在的用户：
        <span class="mono">{{ d.unknownUserIds.value.join('、') }}</span>
        。请取消勾选后重新部署。
      </p>
    </ErrorNotice>

    <!-- 部署结果 -->
    <div v-if="d.result.value" class="deploy-panel__result" aria-live="polite">
      <h3>部署结果</h3>
      <p class="field__hint">已在部署历史中记录（id {{ d.result.value.history_id }}）。</p>
      <ul>
        <li v-for="user in d.result.value.users" :key="user.user_id">
          <StatusBadge :status="user.ok ? 'ok' : 'failed'" :label="user.ok ? '成功' : '失败'" />
          <span class="mono">{{ user.user_id }}</span>
          <span v-if="user.ok" class="muted">
            写入 {{ user.agents.filter((a) => a.action === 'written').length }} 个、 移除
            {{ user.agents.filter((a) => a.action === 'removed').length }} 个
          </span>
          <span v-else class="deploy-panel__error">{{ user.error }}</span>
        </li>
      </ul>

      <template v-if="d.result.value.manifest_diff.length > 0">
        <h4>本次部署的差异</h4>
        <ul>
          <li v-for="(diff, index) in d.result.value.manifest_diff" :key="index">
            {{ diffText(diff) }}
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

.deploy-panel__result {
  margin-top: var(--space-4);
}

.deploy-panel__error {
  color: var(--color-status-error);
}

.deploy-panel__unknown {
  margin: 0;
  font-size: var(--font-size-sm);
}
</style>

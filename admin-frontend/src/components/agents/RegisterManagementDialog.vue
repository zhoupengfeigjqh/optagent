<script setup lang="ts">
/**
 * 注册管理弹窗（2026-11-27 由「生成注册链接」改造，2026-11-28 补充复用语义）。
 *
 * 语义（重要）：
 * - **打开时先读取该服务编码下仍然有效的链接**：有则直接展示复用，不新建；
 * - 只有"没有有效链接"时才需要点「生成链接」——生成永远是显式动作，
 *   避免"点开看一眼就多一条链接"；
 * - 展示中的链接只在这里复制/打开，历史链接的查看/关闭走「停止注册」弹窗；
 * - 复制入口只保留底部「复制链接」（原行内「复制」与它重复，已删）。
 *
 * 链接本身对应 `agent_services.code`：没有服务编码的数字人无法生成链接（提示先开通）。
 */
import { computed, ref, watch } from 'vue'
import { createRegisterLink, listRegisterLinks } from '../../api/account'
import type {
  AgentListItem,
  AgentServiceItem,
  ErrorInfo,
  RegisterLinkCreated,
  RegisterLinkItem,
} from '../../api/types'
import { PUBLIC_REGISTER_PATH } from '../../constants/entries'
import { copyToClipboard } from '../../utils/clipboard'
import { formatDateTime } from '../../utils/datetime'
import { latestActiveLink } from '../../utils/register-link'
import BaseDialog from '../common/BaseDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import RegisterLinkListDialog from './RegisterLinkListDialog.vue'

const props = defineProps<{
  open: boolean
  agent: AgentListItem | null
  service: AgentServiceItem | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'announce', text: string): void
}>()

/** 展示中的链接：可能来自「本次生成」，也可能来自「打开时读到的既有有效链接」 */
interface DisplayLink {
  token: string
  /** 生成时后端返回的完整链接；既有链接列表不返回，由 `fullUrl` 按同一规则拼装 */
  url: string | null
  expires_at: string | null
}

const ttl = ref<'7d' | '30d' | 'forever'>('7d')
/** 当前展示的链接（历史链接在「停止注册」里） */
const link = ref<DisplayLink | null>(null)
/** true = 展示的是打开时读到的既有有效链接（不是本次生成） */
const reused = ref(false)
const busy = ref(false)
/** 打开时读取既有有效链接中 */
const loading = ref(false)
/** 读取既有链接失败（不阻塞生成，仅提示） */
const lookupFailed = ref(false)
const error = ref<ErrorInfo | null>(null)
const manualCopyUrl = ref('')
/** 「停止注册」弹窗（链接列表 + 选择性关闭） */
const listOpen = ref(false)

const fullUrl = computed(() => {
  const current = link.value
  if (!current) return ''
  const configuredOrigin = (import.meta.env.VITE_PUBLIC_FRONTEND_ORIGIN ?? '').replace(/\/+$/, '')
  if (configuredOrigin) {
    return `${configuredOrigin}${PUBLIC_REGISTER_PATH}?link=${encodeURIComponent(current.token)}`
  }
  if (current.url && /^https?:\/\//i.test(current.url)) return current.url
  const origin = import.meta.env.DEV ? 'http://localhost:5173' : window.location.origin
  return `${origin}${PUBLIC_REGISTER_PATH}?link=${encodeURIComponent(current.token)}`
})

const expireLabel = computed(() => {
  if (!link.value) return '—'
  return link.value.expires_at ? formatDateTime(link.value.expires_at) : '长期有效'
})

const fieldLabel = computed(() => (reused.value ? '已有有效链接' : '本次生成的链接'))

const emptyHint = computed(() => {
  if (loading.value) return '正在读取已有链接…'
  if (lookupFailed.value) return '未能读取已有链接，可点「生成链接」新建'
  return '当前没有有效链接，点「生成链接」新建'
})

function toDisplayLink(item: RegisterLinkItem): DisplayLink {
  return { token: item.token, url: null, expires_at: item.expires_at }
}

/**
 * 读取该服务编码下最新的一条**有效**链接（未撤销且未过期）。
 *
 * 有效则直接展示复用；没有则清空，等用户显式生成。读取失败时保留当前展示，
 * 只标记 `lookupFailed`，避免误把已经展示的链接清掉。
 */
async function refreshExisting(): Promise<void> {
  if (!props.service) {
    link.value = null
    reused.value = false
    return
  }
  loading.value = true
  lookupFailed.value = false
  try {
    const { items } = await listRegisterLinks(props.service.code)
    const latest = latestActiveLink(items)
    link.value = latest ? toDisplayLink(latest) : null
    reused.value = Boolean(latest)
  } catch {
    lookupFailed.value = true
  } finally {
    loading.value = false
  }
}

/** 显式生成（打开弹窗不触发） */
async function generate(): Promise<void> {
  if (!props.service || busy.value || loading.value) return
  busy.value = true
  error.value = null
  manualCopyUrl.value = ''
  try {
    const expiresIn =
      ttl.value === 'forever' ? null : ttl.value === '30d' ? 30 * 86_400 : 7 * 86_400
    const created: RegisterLinkCreated = await createRegisterLink(props.service.code, expiresIn)
    link.value = { token: created.token, url: created.url, expires_at: created.expires_at }
    reused.value = false
    lookupFailed.value = false
    emit('announce', '注册链接已生成，可复制或打开注册页')
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    busy.value = false
  }
}

async function copy(): Promise<void> {
  if (!fullUrl.value) return
  if (await copyToClipboard(fullUrl.value)) {
    manualCopyUrl.value = ''
    emit('announce', '注册链接已复制到剪贴板')
  } else {
    manualCopyUrl.value = fullUrl.value
    emit('announce', '浏览器未允许自动复制，请手动复制链接')
  }
}

function openRegisterPage(): void {
  if (!fullUrl.value) return
  window.open(fullUrl.value, '_blank', 'noopener,noreferrer')
}

/** 停止注册：打开链接列表，可单条关闭或一次性全部关闭 */
function openStopRegistration(): void {
  if (!props.service) return
  listOpen.value = true
}

function selectManualCopy(event: Event): void {
  if (event.target instanceof HTMLInputElement) event.target.select()
}

watch(
  () => [props.open, props.agent?.name, props.service?.code] as const,
  ([open], previous) => {
    const opened = open && (previous === undefined || previous[0] !== true)
    if (!opened) return
    ttl.value = '7d'
    link.value = null
    reused.value = false
    lookupFailed.value = false
    error.value = null
    manualCopyUrl.value = ''
    // 只提示缺失，不自动生成、不自动打开二级弹窗
    if (!props.service) {
      error.value = { code: 'AGENT_SERVICE_MISSING', message: '该数字人尚未配置注册服务' }
      return
    }
    // 已有有效链接则直接展示，不新建
    void refreshExisting()
  },
  { immediate: true },
)

/** 从「停止注册」返回后刷新：被关闭的链接不应继续展示 */
watch(listOpen, (open, previous) => {
  if (previous && !open && props.open) void refreshExisting()
})
</script>

<template>
  <BaseDialog
    :open="open"
    title="注册管理"
    :width="560"
    show-close
    @update:open="emit('update:open', $event)"
  >
    <template v-if="open">
      <div class="register-mgmt__meta">
        <span>数字人</span>
        <strong>{{ agent?.name ?? '—' }}</strong>
      </div>
      <div class="register-mgmt__meta">
        <span>链接标识</span>
        <strong class="mono">{{ service?.code ?? '未配置' }}</strong>
      </div>
      <div class="register-mgmt__meta">
        <span>有效期</span>
        <select v-model="ttl" class="register-mgmt__ttl" :disabled="busy || loading">
          <option value="7d">7 天</option>
          <option value="30d">30 天</option>
          <option value="forever">长期有效</option>
        </select>
        <span v-if="link" class="register-mgmt__ttl-note">
          当前链接有效至 {{ expireLabel }}（重新生成时按此选项）
        </span>
      </div>

      <ErrorNotice
        v-if="error && error.code !== 'AGENT_SERVICE_MISSING'"
        class="register-mgmt__error"
        :error="error"
        title="注册链接生成失败"
      />
      <p v-else-if="error" class="register-mgmt__notice" role="alert">
        {{ error.message }}。请先在账号服务配置中建立与该数字人的绑定。
      </p>

      <p class="register-mgmt__field-label">{{ fieldLabel }}</p>
      <div class="register-mgmt__link-row">
        <input
          :value="busy ? '正在生成…' : fullUrl"
          readonly
          class="register-mgmt__link-input"
          :placeholder="emptyHint"
          aria-label="注册链接"
        />
      </div>

      <div v-if="manualCopyUrl" class="register-mgmt__manual" role="alert">
        <p>浏览器未允许自动复制，请选中下方链接手动复制：</p>
        <input
          :value="manualCopyUrl"
          readonly
          class="mono"
          @focus="selectManualCopy"
          @click="selectManualCopy"
        />
      </div>

      <div class="register-mgmt__hint">
        <template v-if="reused">
          打开时已读到该数字人的有效链接，<strong>直接展示复用，无需重新生成</strong>。
        </template>
        <template v-else>
          当前没有有效链接，点下方「生成链接」新建（本弹窗<strong>不会自动创建</strong>）。
        </template>
        历史链接可点「停止注册」查看状态并逐条或一次性关闭（关闭后立即失效，已注册用户不受影响）。
        <template v-if="link">链接有效至 {{ expireLabel }}。</template>
      </div>
    </template>

    <template #footer>
      <button type="button" class="btn" :disabled="!service || busy || loading" @click="generate">
        {{ link ? '重新生成' : '生成链接' }}
      </button>
      <button type="button" class="btn" :disabled="!fullUrl" @click="copy">复制链接</button>
      <button type="button" class="btn" :disabled="!fullUrl" @click="openRegisterPage">
        打开注册页面
      </button>
      <button
        type="button"
        class="btn btn--danger"
        :disabled="!service"
        title="查看全部注册链接并可关闭（停止注册）"
        @click="openStopRegistration"
      >
        停止注册
      </button>
    </template>
  </BaseDialog>

  <RegisterLinkListDialog
    v-model:open="listOpen"
    :agent-name="agent?.name ?? ''"
    :service-code="service?.code ?? null"
    @announce="emit('announce', $event)"
  />
</template>

<style scoped>
.register-mgmt__meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 32px;
  font-size: var(--font-size-sm);
}

.register-mgmt__meta > span {
  width: 72px;
  color: var(--color-text-muted);
}

.register-mgmt__meta > strong {
  font-weight: 600;
}

.register-mgmt__ttl {
  width: 140px;
  height: 32px;
  padding: 0 var(--space-2);
}

.register-mgmt__meta > span.register-mgmt__ttl-note {
  width: auto;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.register-mgmt__error,
.register-mgmt__notice {
  margin-top: var(--space-3);
}

.register-mgmt__notice {
  padding: var(--space-3);
  border: 1px solid #d8e5fd;
  border-radius: var(--radius-md);
  background: var(--color-primary-subtle);
  color: #33507e;
  font-size: var(--font-size-sm);
}

.register-mgmt__field-label {
  margin: var(--space-4) 0 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.register-mgmt__link-row {
  display: flex;
  gap: var(--space-2);
}

.register-mgmt__link-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.register-mgmt__manual {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid #f3ddb0;
  border-radius: var(--radius-md);
  background: var(--color-status-warning-bg);
  color: var(--color-status-warning);
  font-size: var(--font-size-xs);
}

.register-mgmt__manual p {
  margin: 0 0 var(--space-2);
}

.register-mgmt__manual input {
  width: 100%;
}

.register-mgmt__hint {
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1px solid #d8e5fd;
  border-radius: var(--radius-md);
  background: var(--color-primary-subtle);
  color: #33507e;
  font-size: var(--font-size-xs);
  line-height: 1.7;
}

@media (max-width: 560px) {
  .register-mgmt__link-row {
    flex-direction: column;
  }
}
</style>

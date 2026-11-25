<script setup lang="ts">
/**
 * 数字人注册链接弹窗。
 *
 * 打开时按当前数字人对应的服务生成一条 7 天有效链接；管理员可改选 30 天或长期后
 * 重新生成。复制失败时展示只读输入框供手动复制，避免静默失败。
 */
import { computed, ref, watch } from 'vue'
import { createRegisterLink } from '../../api/account'
import type {
  AgentListItem,
  AgentServiceItem,
  ErrorInfo,
  RegisterLinkCreated,
} from '../../api/types'
import { PUBLIC_REGISTER_PATH } from '../../constants/entries'
import { copyToClipboard } from '../../utils/clipboard'
import BaseDialog from '../common/BaseDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  open: boolean
  agent: AgentListItem | null
  service: AgentServiceItem | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'announce', text: string): void
}>()

const ttl = ref<'7d' | '30d' | 'forever'>('7d')
const created = ref<RegisterLinkCreated | null>(null)
const busy = ref(false)
const error = ref<ErrorInfo | null>(null)
const manualCopyUrl = ref('')

const fullUrl = computed(() => {
  if (!created.value) return ''
  const configuredOrigin = (import.meta.env.VITE_PUBLIC_FRONTEND_ORIGIN ?? '').replace(/\/+$/, '')
  if (configuredOrigin) {
    return `${configuredOrigin}${PUBLIC_REGISTER_PATH}?link=${encodeURIComponent(created.value.token)}`
  }
  if (/^https?:\/\//i.test(created.value.url)) return created.value.url
  const origin = import.meta.env.DEV ? 'http://localhost:5173' : window.location.origin
  return `${origin}${PUBLIC_REGISTER_PATH}?link=${encodeURIComponent(created.value.token)}`
})

const expireLabel = computed(() => {
  if (!created.value) return '—'
  return created.value.expires_at ? formatDate(created.value.expires_at) : '长期有效'
})

function formatDate(value: string): string {
  const date = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function generate(): Promise<void> {
  if (!props.service || busy.value) return
  busy.value = true
  error.value = null
  manualCopyUrl.value = ''
  try {
    const expiresIn =
      ttl.value === 'forever' ? null : ttl.value === '30d' ? 30 * 86_400 : 7 * 86_400
    created.value = await createRegisterLink(props.service.code, expiresIn)
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

function selectManualCopy(event: Event): void {
  if (event.target instanceof HTMLInputElement) event.target.select()
}

watch(
  () => [props.open, props.agent?.name, props.service?.code] as const,
  ([open], previous) => {
    const opened = open && (previous === undefined || previous[0] !== true)
    if (!opened) return
    ttl.value = '7d'
    created.value = null
    error.value = null
    manualCopyUrl.value = ''
    if (props.service) void generate()
    else error.value = { code: 'AGENT_SERVICE_MISSING', message: '该数字人尚未配置注册服务' }
  },
  { immediate: true },
)
</script>

<template>
  <BaseDialog
    :open="open"
    title="生成注册链接"
    :width="560"
    @update:open="emit('update:open', $event)"
  >
    <template v-if="open">
      <div class="register-link-dialog__meta">
        <span>数字人</span>
        <strong>{{ agent?.name ?? '—' }}</strong>
      </div>
      <div class="register-link-dialog__meta">
        <span>链接标识</span>
        <strong class="mono">{{ service?.code ?? '未配置' }}</strong>
      </div>
      <div class="register-link-dialog__meta">
        <span>有效期</span>
        <select v-model="ttl" class="register-link-dialog__ttl" :disabled="busy">
          <option value="7d">7 天</option>
          <option value="30d">30 天</option>
          <option value="forever">长期有效</option>
        </select>
      </div>

      <ErrorNotice
        v-if="error && error.code !== 'AGENT_SERVICE_MISSING'"
        class="register-link-dialog__error"
        :error="error"
        title="注册链接生成失败"
      />
      <p v-else-if="error" class="register-link-dialog__notice" role="alert">
        {{ error.message }}。请先在账号服务配置中建立与该数字人的绑定。
      </p>

      <p class="register-link-dialog__field-label">专属注册链接</p>
      <div class="register-link-dialog__link-row">
        <input
          :value="busy ? '正在生成…' : fullUrl"
          readonly
          class="register-link-dialog__link-input"
          placeholder="选择有效期后生成链接"
          aria-label="专属注册链接"
        />
        <button type="button" class="btn btn--primary" :disabled="!fullUrl || busy" @click="copy">
          复制
        </button>
      </div>

      <div v-if="manualCopyUrl" class="register-link-dialog__manual" role="alert">
        <p>浏览器未允许自动复制，请选中下方链接手动复制：</p>
        <input
          :value="manualCopyUrl"
          readonly
          class="mono"
          @focus="selectManualCopy"
          @click="selectManualCopy"
        />
      </div>

      <div class="register-link-dialog__hint">
        用户通过该链接进入注册页后会自动绑定当前数字人，注册成功即获得使用权限，无需后台审批。
        <span v-if="created">链接有效至 {{ expireLabel }}。</span>
      </div>
    </template>

    <template #footer>
      <button type="button" class="btn" :disabled="!service || busy" @click="generate">
        {{ created ? '重新生成' : '生成链接' }}
      </button>
      <button type="button" class="btn btn--primary" :disabled="!fullUrl" @click="copy">
        复制链接
      </button>
      <button type="button" class="btn btn--link" :disabled="!fullUrl" @click="openRegisterPage">
        打开注册页面
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.register-link-dialog__meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 32px;
  font-size: var(--font-size-sm);
}

.register-link-dialog__meta > span {
  width: 72px;
  color: var(--color-text-muted);
}

.register-link-dialog__meta > strong {
  font-weight: 600;
}

.register-link-dialog__ttl {
  width: 140px;
  height: 32px;
  padding: 0 var(--space-2);
}

.register-link-dialog__error,
.register-link-dialog__notice {
  margin-top: var(--space-3);
}

.register-link-dialog__notice {
  padding: var(--space-3);
  border: 1px solid #d8e5fd;
  border-radius: var(--radius-md);
  background: var(--color-primary-subtle);
  color: #33507e;
  font-size: var(--font-size-sm);
}

.register-link-dialog__field-label {
  margin: var(--space-4) 0 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.register-link-dialog__link-row {
  display: flex;
  gap: var(--space-2);
}

.register-link-dialog__link-input {
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

.register-link-dialog__manual {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid #f3ddb0;
  border-radius: var(--radius-md);
  background: var(--color-status-warning-bg);
  color: var(--color-status-warning);
  font-size: var(--font-size-xs);
}

.register-link-dialog__manual p {
  margin: 0 0 var(--space-2);
}

.register-link-dialog__manual input {
  width: 100%;
}

.register-link-dialog__hint {
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
  .register-link-dialog__link-row {
    flex-direction: column;
  }
}
</style>

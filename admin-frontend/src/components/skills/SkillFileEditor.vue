<script setup lang="ts">
/**
 * 技能文件编辑区（2026-09-16：全部文件可编辑，含 `references/` 等附件）。
 *
 * 与 `SkillFileTree` 配合：树负责选文件，本组件负责**看与改**。
 * 三种"不给编辑"的情形必须说清楚原因，而不是留白或给一个点了会丢数据的入口：
 * - 二进制文件：不预览、不编辑（如需替换请重新打包 ZIP 覆盖安装）；
 * - 超出编辑上限（256KB）：只显示前 256KB，**不提供编辑**——否则保存即丢掉未显示的部分；
 * - 加载中/失败：可读提示。
 *
 * 保存带上**读取时的内容哈希**：服务端发现内容已被他处修改即拒绝（不静默覆盖），
 * 此时界面提示并提供「重新加载最新内容」。
 *
 * 保存**不可逆**（2026-09-16 产品决定：撤销"编辑快照"，库中不保留任何副本）→
 * 保存前 MUST 二次确认并把这条后果讲明。
 */
import { computed, ref, watch } from 'vue'
import { saveSkillFile } from '../../api/skills'
import type { ErrorInfo, SkillFileContent, SkillFileSaved } from '../../api/types'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  file: SkillFileContent | null
  loading: boolean
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'saved', saved: SkillFileSaved): void
  (e: 'reload'): void
  (e: 'update:dirty', dirty: boolean): void
}>()

/** 编辑草稿（与服务端内容分离，便于"放弃"） */
const draft = ref('')
/**
 * 已保存内容的基准。
 *
 * **不复用 `props.file.content`**：父组件在保存后会就地把大小/哈希写回同一个对象
 * （不换对象、故意不触发 `watch`），若以 props 为基准，"刚保存完"会被误判成"
 * 仍有未保存修改"。基准随"换文件/重新加载"（`props.file` 换对象）才重置。
 */
const baseline = ref('')
const saving = ref(false)
const saveError = ref<ErrorInfo | null>(null)
/** 保存成功提示（`role="status"`） */
const savedNotice = ref('')
/** 保存二次确认：保存是覆盖式的、平台不留副本，必须先讲明"无法恢复" */
const confirmSave = ref(false)

const editable = computed(() => props.file?.editable === true)
const dirty = computed(() => editable.value && draft.value !== baseline.value)
/** 冲突：内容已被他处修改（需要重新读取，而不是盲目再存） */
const conflicted = computed(() => saveError.value?.code === 'ADM_CONFIG_REVISION_CONFLICT')

watch(
  () => props.file,
  (next) => {
    baseline.value = next?.content ?? ''
    draft.value = baseline.value
    saveError.value = null
    savedNotice.value = ''
  },
  { immediate: true },
)

watch(dirty, (value) => emit('update:dirty', value), { immediate: true })

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * 保存入口：先弹二次确认，确认后才真正写库。
 *
 * 保存**不可逆**——库中该文件的当前内容会被直接覆盖，平台不保留任何副本
 * （原先的"编辑快照"退路已按产品决定移除）。所以这一步 MUST 由管理员明确确认，
 * 而不是点一下就把内容换掉。
 */
function requestSave(): void {
  if (!dirty.value || saving.value) return
  confirmSave.value = true
}

async function save(): Promise<void> {
  const file = props.file
  if (!file || !dirty.value || saving.value) return
  saving.value = true
  saveError.value = null
  savedNotice.value = ''
  try {
    const saved = await saveSkillFile(file.name, file.path, draft.value, file.hash)
    // 基准前移：保存后不应再显示"未保存"
    baseline.value = draft.value
    savedNotice.value = `已保存（${formatSize(saved.size)}）`
    emit('saved', saved)
  } catch (err) {
    saveError.value = err as ErrorInfo
  } finally {
    saving.value = false
  }
}

function discard(): void {
  draft.value = baseline.value
  saveError.value = null
  savedNotice.value = ''
}
</script>

<template>
  <section class="skill-file-editor" aria-label="文件内容">
    <ErrorNotice :error="props.error" title="读取文件失败" />

    <p v-if="props.loading" class="muted" role="status">加载中…</p>

    <template v-else-if="props.file">
      <header class="skill-file-editor__head">
        <span class="mono">{{ props.file.path }}</span>
        <span class="skill-file-editor__size">{{ formatSize(props.file.size) }}</span>
        <span v-if="editable" class="skill-file-editor__badge">可编辑</span>
        <span v-else class="skill-file-editor__badge">只读</span>
        <span v-if="dirty" class="skill-file-editor__dirty">未保存</span>

        <span class="skill-file-editor__actions">
          <button
            v-if="editable"
            type="button"
            class="btn btn--primary"
            :disabled="!dirty || saving"
            @click="requestSave"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>
          <button v-if="editable" type="button" class="btn" :disabled="!dirty || saving" @click="discard">
            放弃修改
          </button>
        </span>
      </header>

      <ErrorNotice :error="saveError" title="保存未完成" />
      <button
        v-if="conflicted"
        type="button"
        class="btn skill-file-editor__reload"
        @click="emit('reload')"
      >
        重新加载最新内容
      </button>
      <p v-if="savedNotice" class="skill-file-editor__saved" role="status">{{ savedNotice }}</p>

      <p v-if="props.file.binary" class="skill-file-editor__notice" role="status">
        二进制文件，不提供预览与在线编辑（如需替换请重新打包 ZIP 覆盖安装）。
      </p>

      <template v-else-if="editable">
        <textarea
          v-model="draft"
          class="skill-file-editor__textarea mono"
          aria-label="文件内容"
          spellcheck="false"
        ></textarea>
        <p v-if="props.file.truncated" class="skill-file-editor__notice" role="status">
          内容超出编辑上限（256KB），仅显示前 256KB。
        </p>
      </template>

      <template v-else>
        <pre class="skill-file-editor__body mono">{{ props.file.content ?? '' }}</pre>
        <p class="skill-file-editor__notice" role="status">
          内容超出在线编辑上限（256KB），不提供在线编辑；如需修改请改用 ZIP 覆盖安装。
        </p>
      </template>
    </template>

    <p v-else class="muted">请从左侧选择一个文件。</p>

    <!-- 保存不可逆（库中不留副本）：确认后才真正写库 -->
    <ConfirmDialog
      v-model:open="confirmSave"
      data-test="save-dialog"
      title="保存后无法恢复"
      :message="`将直接覆盖库中 ${props.file?.path ?? '该文件'} 的当前内容，平台不保留任何副本；保存后无法撤销，也找不回上一次的内容。`"
      confirm-label="确认保存"
      danger
      @confirm="save"
    />
  </section>
</template>

<style scoped>
.skill-file-editor {
  min-width: 0;
}

.skill-file-editor__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  font-size: var(--font-size-sm);
}

.skill-file-editor__size {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.skill-file-editor__badge {
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.skill-file-editor__dirty {
  font-size: var(--font-size-xs);
  color: var(--color-status-warning);
}

.skill-file-editor__actions {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
}

.skill-file-editor__reload {
  margin-bottom: var(--space-2);
}

.skill-file-editor__saved {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-status-success);
}

.skill-file-editor__textarea,
.skill-file-editor__body {
  width: 100%;
  min-height: 54vh;
  margin: 0;
  padding: var(--space-3);
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  resize: vertical;
}

.skill-file-editor__body {
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.skill-file-editor__notice {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-status-warning);
}
</style>

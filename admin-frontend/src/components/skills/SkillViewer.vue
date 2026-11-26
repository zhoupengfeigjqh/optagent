<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchReferences } from '../../api/deploy'
import { deleteSkill, fetchSkillFile } from '../../api/skills'
import type {
  ErrorInfo,
  ReferenceItem,
  SkillDetail,
  SkillFileContent,
  SkillFileSaved,
} from '../../api/types'
import { skillDisplayName, skillHasAlias } from '../../utils/skill-name'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import FileTree from '../common/FileTree.vue'
import SkillFileEditor from './SkillFileEditor.vue'

const props = defineProps<{
  skill: SkillDetail | null
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'deleted'): void
  (e: 'updated', saved: SkillFileSaved): void
}>()

const selected = ref('SKILL.md')
const fileContent = ref<SkillFileContent | null>(null)
const fileLoading = ref(false)
const fileError = ref<ErrorInfo | null>(null)
const localError = ref<ErrorInfo | null>(null)
const affected = ref<ReferenceItem[]>([])
const confirmDelete = ref(false)

const readOnly = computed(() => props.skill?.origin?.kind === 'onto_market')

const title = computed(() => skillDisplayName(props.skill) || '加载中…')
const hasAlias = computed(() => skillHasAlias(props.skill))

const dirty = ref(false)
const pending = ref<{ kind: 'file'; path: string } | { kind: 'back' } | null>(null)

const detailContent = computed(() => props.skill?.content ?? '')

async function selectFile(path: string): Promise<void> {
  selected.value = path
  fileError.value = null
  if (path === 'SKILL.md') {
    // 详情里已有正文：直接用，避免多余请求
    fileContent.value = {
      name: props.skill?.name ?? '',
      path: 'SKILL.md',
      size: detailContent.value.length,
      binary: false,
      truncated: false,
      content: detailContent.value,
      hash: props.skill?.content_hash ?? '',
      editable: true,
    }
    return
  }

  if (!props.skill) return
  fileLoading.value = true
  try {
    fileContent.value = await fetchSkillFile(props.skill.name, path)
  } catch (err) {
    fileError.value = err as ErrorInfo
    fileContent.value = null
  } finally {
    fileLoading.value = false
  }
}

/** 切换文件：有未保存修改时先确认（MUST NOT 静默丢弃） */
function requestSelect(path: string): void {
  if (dirty.value && path !== selected.value) {
    pending.value = { kind: 'file', path }
    return
  }
  void selectFile(path)
}

function requestBack(): void {
  if (dirty.value) {
    pending.value = { kind: 'back' }
    return
  }
  emit('back')
}

function applyPending(): void {
  const action = pending.value
  pending.value = null
  if (!action) return
  if (action.kind === 'back') emit('back')
  else void selectFile(action.path)
}

function onSaved(saved: SkillFileSaved): void {
  const current = fileContent.value
  if (current && current.path === saved.path) {
    current.size = saved.size
    current.hash = saved.hash
  }
  emit('updated', saved)
}

watch(
  () => props.skill,
  (next) => {
    if (!next) return
    const keep = next.files.some((file) => file.path === selected.value)
    void selectFile(keep ? selected.value : 'SKILL.md')
  },
  { immediate: true },
)

async function requestDelete(): Promise<void> {
  if (!props.skill) return
  localError.value = null
  try {
    affected.value = (await fetchReferences('skill', props.skill.name)).affected
  } catch (err) {
    localError.value = err as ErrorInfo
    return
  }
  confirmDelete.value = true
}

async function doDelete(): Promise<void> {
  if (!props.skill) return
  try {
    await deleteSkill(props.skill.name)
    emit('deleted')
  } catch (err) {
    localError.value = err as ErrorInfo
  } finally {
    confirmDelete.value = false
  }
}
</script>

<template>
  <section class="skill-viewer" aria-labelledby="skill-viewer-title">
    <header class="skill-viewer__header">
      <button type="button" class="btn" @click="requestBack">← 返回列表</button>
      <div class="skill-viewer__title">
        <h2 id="skill-viewer-title">{{ title }}</h2>
        <p v-if="hasAlias" class="skill-viewer__alias mono">{{ props.skill?.name }}</p>
      </div>
      <button type="button" class="btn" :disabled="!props.skill" @click="requestDelete">
        删除
      </button>
    </header>

    <ErrorNotice :error="localError ?? props.error" title="操作未完成" />

    <template v-if="props.skill">
      <dl class="skill-viewer__meta">
        <dt>描述</dt>
        <dd>{{ props.skill.description }}</dd>
        <dt>来源</dt>
        <dd>{{ props.skill.source }}</dd>
        <dt>安装 / 更新</dt>
        <dd>{{ props.skill.installed_at }} / {{ props.skill.updated_at }}</dd>
        <dt>修改方式</dt>
        <dd class="muted">
          <template v-if="readOnly">
            <strong>本体市场导入的技能为只读</strong>：它是市场快照，MUST NOT 在线编辑。
            内容如需更新，请在「从本体市场导入」窗口中对该技能执行「更新」（以市场现版本整包替换）；
            更新后引用了它的数字人需<strong>重新部署</strong>才会生效。
          </template>
          <template v-else>
            技能内所有文件（含 references/ 等附件）都可在线编辑并保存；保存只改技能库，
            引用了它的数字人需<strong>重新部署</strong>后才会生效。
          </template>
        </dd>
      </dl>

      <div class="skill-viewer__body">
        <FileTree
          class="skill-viewer__tree"
          label="技能文件"
          :files="props.skill.files"
          :selected="selected"
          @select="requestSelect"
        />
        <SkillFileEditor
          v-if="!readOnly"
          class="skill-viewer__editor"
          :file="fileContent"
          :loading="fileLoading"
          :error="fileError"
          @saved="onSaved"
          @reload="selectFile(selected)"
          @update:dirty="dirty = $event"
        />
        <div v-else class="skill-viewer__editor skill-viewer__readonly">
          <p v-if="fileLoading" class="skill-viewer__readonly-note" role="status">加载中…</p>
          <ErrorNotice v-else-if="fileError" :error="fileError" title="文件读取失败" />
          <template v-else-if="fileContent?.content">
            <p class="skill-viewer__readonly-note muted">
              {{ fileContent.path }} · 只读（{{ fileContent.size }} 字节<template
                v-if="fileContent.truncated"
                >，已截断</template
              >）
            </p>
            <pre class="skill-viewer__readonly-pre">{{ fileContent.content }}</pre>
          </template>
          <p v-else class="skill-viewer__readonly-note muted" role="status">
            该文件无法以内联文本展示（二进制或超出预览上限）。
          </p>
        </div>
      </div>
    </template>

    <ConfirmDialog
      v-model:open="confirmDelete"
      title="删除该 SKILL？"
      :message="
        affected.length > 0
          ? `该 SKILL 正被 ${affected.length} 个数字人引用，删除后这些数字人会变为异常态。`
          : '该 SKILL 当前未被任何数字人引用。'
      "
      confirm-label="删除"
      danger
      @confirm="doDelete"
    >
      <ul v-if="affected.length > 0">
        <li v-for="(item, index) in affected" :key="index">
          <span class="mono">{{ item.user_id }}</span> 的
          <span class="mono">{{ item.agent_name }}</span>
        </li>
      </ul>
    </ConfirmDialog>

    <ConfirmDialog
      data-test="discard-dialog"
      :open="pending !== null"
      title="放弃未保存的修改？"
      message="当前文件有未保存的修改，继续操作会丢失这些修改。"
      confirm-label="放弃修改"
      danger
      @update:open="
        (value: boolean) => {
          if (!value) pending = null
        }
      "
      @confirm="applyPending"
    />
  </section>
</template>

<style scoped>
.skill-viewer__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.skill-viewer__title {
  flex: 1;
  min-width: 0;
}

.skill-viewer__header h2 {
  margin: 0;
  font-size: var(--font-size-lg);
}

.skill-viewer__alias {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.skill-viewer__meta {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-1) var(--space-3);
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-sm);
}

.skill-viewer__meta dt {
  color: var(--color-text-muted);
}

.skill-viewer__meta dd {
  margin: 0;
}

.skill-viewer__body {
  display: grid;
  grid-template-columns: minmax(180px, 260px) 1fr;
  gap: var(--space-4);
  align-items: start;
}

@media (max-width: 720px) {
  .skill-viewer__body {
    grid-template-columns: 1fr;
  }
}

.skill-viewer__readonly-note {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
}

.skill-viewer__readonly-pre {
  margin: 0;
  padding: var(--space-3);
  max-height: 60vh;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { deleteOntology, type OntologyDetail } from '../../api/ontologies'
import type { ErrorInfo } from '../../api/types'
import { ontologyDisplayName, ontologyNameOf, ontologyScenarioOf } from '../../utils/ontology-name'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import FileTree from '../common/FileTree.vue'

const props = defineProps<{
  ontology: OntologyDetail | null
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'deleted'): void
}>()

const ONTOLOGY_PATH = 'ontology.yaml'
const SECURITIES_PATH = 'securities.yaml'

const confirmDelete = ref(false)
const deleting = ref(false)
const localError = ref<ErrorInfo | null>(null)
const selected = ref(ONTOLOGY_PATH)

const displayName = computed<string>(() =>
  props.ontology ? ontologyDisplayName(props.ontology) : '本体详情',
)

const files = computed<Array<{ path: string; size: number }>>(() => {
  const target = props.ontology
  if (!target) return []
  return [
    { path: ONTOLOGY_PATH, size: target.size },
    { path: SECURITIES_PATH, size: target.securities_size },
  ]
})

const current = computed<{ path: string; size: number; text: string }>(() => {
  const target = props.ontology
  if (!target) return { path: selected.value, size: 0, text: '' }
  return selected.value === SECURITIES_PATH
    ? { path: SECURITIES_PATH, size: target.securities_size, text: target.securities_content }
    : { path: ONTOLOGY_PATH, size: target.size, text: target.content }
})

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

const metaRows = computed<Array<{ label: string; value: string }>>(() => {
  const target = props.ontology
  if (!target) return []
  const meta = target.metadata
  const text = (value: string | number | null | undefined): string =>
    value === null || value === undefined || value === '' ? '—' : String(value)
  return [
    { label: '场景', value: `${text(ontologyScenarioOf(target))}（ID ${text(meta.scenario_id)}）` },
    { label: '本体', value: `${text(ontologyNameOf(target))}（ID ${text(meta.ontology_id)}）` },
    { label: '创建时间', value: text(meta.created_at) },
    { label: '部署版本', value: text(meta.deployed_version) },
    { label: '来源', value: '本体市场' },
    { label: '安装 / 更新', value: `${target.installed_at} / ${target.updated_at}` },
    { label: '文件', value: 'ontology.yaml + securities.yaml（均已同步）' },
  ]
})

async function remove(): Promise<void> {
  const target = props.ontology
  if (!target || deleting.value) return
  deleting.value = true
  localError.value = null
  try {
    await deleteOntology(ontologyScenarioOf(target), ontologyNameOf(target))
    confirmDelete.value = false
    emit('deleted')
  } catch (err) {
    confirmDelete.value = false
    localError.value = err as ErrorInfo
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section class="ontology-viewer" aria-labelledby="ontology-viewer-title">
    <header class="ontology-viewer__header">
      <button type="button" class="btn" data-test="back" @click="emit('back')">← 返回列表</button>
      <h2 id="ontology-viewer-title">{{ displayName }}</h2>
      <button
        type="button"
        class="btn"
        data-test="delete"
        :disabled="deleting || ontology === null"
        @click="confirmDelete = true"
      >
        删除
      </button>
    </header>

    <ErrorNotice :error="localError ?? error" title="操作未完成" />

    <template v-if="ontology">
      <dl class="ontology-viewer__meta">
        <template v-for="row in metaRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
        <dt>修改方式</dt>
        <dd class="muted">
          <strong>本体是市场快照，平台只读</strong>：MUST NOT 在线编辑任何本体文件。
          内容如需更新，请在「从本体市场导入」窗口对该本体执行「更新」（以市场现版本整体替换）；
          已部署的数字人不受影响（本体不参与部署物化）。
        </dd>
      </dl>

      <div class="ontology-viewer__body">
        <FileTree
          label="本体文件"
          :files="files"
          :selected="selected"
          @select="selected = $event"
        />

        <section class="ontology-viewer__panel" aria-label="文件内容">
          <header class="ontology-viewer__head" data-test="file-head">
            <span class="mono">{{ current.path }}</span>
            <span class="ontology-viewer__size">{{ formatSize(current.size) }}</span>
            <span class="ontology-viewer__badge">只读</span>
          </header>
          <pre class="ontology-viewer__pre mono" data-test="file-content">{{ current.text }}</pre>
        </section>
      </div>
    </template>

    <ConfirmDialog
      v-model:open="confirmDelete"
      danger
      :title="`删除本体 ${displayName}`"
      :message="`将同时删除库内的 ${ontologyScenarioOf(ontology)}/${ontologyNameOf(ontology)}/ 目录（ontology.yaml 与 securities.yaml）；如需恢复，可从本体市场重新导入。`"
      confirm-label="删除"
      @confirm="remove"
    />
  </section>
</template>

<style scoped>
.ontology-viewer__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.ontology-viewer__header h2 {
  flex: 1;
  margin: 0;
  font-size: var(--font-size-lg);
}

.ontology-viewer__meta {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-1) var(--space-3);
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-sm);
}

.ontology-viewer__meta dt {
  color: var(--color-text-muted);
}

.ontology-viewer__meta dd {
  margin: 0;
}

.ontology-viewer__body {
  display: grid;
  grid-template-columns: minmax(180px, 260px) 1fr;
  gap: var(--space-4);
  align-items: start;
}

@media (max-width: 720px) {
  .ontology-viewer__body {
    grid-template-columns: 1fr;
  }
}

.ontology-viewer__panel {
  min-width: 0;
}

.ontology-viewer__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  font-size: var(--font-size-sm);
}

.ontology-viewer__size {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.ontology-viewer__badge {
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.ontology-viewer__pre {
  width: 100%;
  min-height: 54vh;
  max-height: 60vh;
  margin: 0;
  padding: var(--space-3);
  overflow: auto;
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>

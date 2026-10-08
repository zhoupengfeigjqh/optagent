<script setup lang="ts">
/**
 * 本体详情：元数据 + 左侧文件列表 + 右侧**只读**文件正文（2026-10-03）。
 *
 * **形态与 `SkillViewer` 逐项对齐**（用户要求"和 skill 设计里的模式一样"，故样式与结构
 * 都照抄，不做自创变体）：同一个 `common/FileTree` 做左侧列表；元数据用同样的两列 `dl`
 * （`120px 1fr`、无边框）；右侧面板照 `SkillFileEditor` 的只读形态——
 * `mono 路径 + 小字大小 + 带边框徽标`一行头部，正文 `pre` 用同一套字号/圆角/最小高度。
 *
 * 口径：
 * - 本体文件恒在根层、最多两个：`ontology.yaml`（必需）与 `securities.yaml`
 *   （行为安全管控，可选）；**只有实际同步到库里的文件才出现在左侧列表**；
 * - 两个文件的全文**都随详情响应返回**（契约 §10.2），因此切换文件是纯前端行为，
 *   **不额外发请求**（与 SKILL 详情逐文件请求不同：本体没有编辑通道，无需按需取）；
 * - **只读**：本组件 MUST NOT 出现任何输入控件（`input`/`textarea`/`contenteditable`）
 *   与保存按钮——平台没有编辑本体的能力，界面也不该给出错觉；
 * - 不做语法高亮（`research.md` D5）；
 * - 删除是破坏性操作，走 `ConfirmDialog` 二次确认（目录整体移除）；本体
 *   **不被数字人引用**，故无需引用清单（区别于 SKILL 的 `FR-042`）。
 */
import { computed, ref, watch } from 'vue'
import { deleteOntology, type OntologyDetail } from '../../api/ontologies'
import type { ErrorInfo } from '../../api/types'
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
/** 当前选中文件（默认本体正文，与 SKILL 详情默认 `SKILL.md` 同一取向） */
const selected = ref(ONTOLOGY_PATH)

/** 左侧文件列表：只列实际存在的文件（未同步安全管控时只有一行） */
const files = computed<Array<{ path: string; size: number }>>(() => {
  const target = props.ontology
  if (!target) return []
  const list = [{ path: ONTOLOGY_PATH, size: target.size }]
  if (target.securities_content !== null) {
    list.push({ path: SECURITIES_PATH, size: target.securities_size })
  }
  return list
})

/** 选中文件的正文与大小（两个文件都在详情里，无需再取） */
const current = computed<{ path: string; size: number; text: string }>(() => {
  const target = props.ontology
  if (!target) return { path: selected.value, size: 0, text: '' }
  return selected.value === SECURITIES_PATH
    ? { path: SECURITIES_PATH, size: target.securities_size, text: target.securities_content ?? '' }
    : { path: ONTOLOGY_PATH, size: target.size, text: target.content }
})

/** 大小的人类可读格式（与 `SkillFileEditor` 同一函数口径） */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** 元数据行（缺项显示 `—`；与 SKILL 详情同为「两列 dl」的呈现形态） */
const metaRows = computed<Array<{ label: string; value: string }>>(() => {
  const target = props.ontology
  if (!target) return []
  const meta = target.metadata
  const text = (value: string | number | null | undefined): string =>
    value === null || value === undefined || value === '' ? '—' : String(value)
  return [
    { label: '场景', value: `${target.scenario}（ID ${text(meta.scenario_id)}）` },
    { label: '本体', value: `${target.name}（ID ${text(meta.ontology_id)}）` },
    { label: '创建时间', value: text(meta.created_at) },
    { label: '部署版本', value: text(meta.deployed_version) },
    { label: '来源', value: target.source },
    { label: '安装 / 更新', value: `${target.installed_at} / ${target.updated_at}` },
    {
      label: '文件',
      value: target.has_securities
        ? 'ontology.yaml + securities.yaml（均已同步）'
        : '仅 ontology.yaml（市场侧未配置安全管控）',
    },
  ]
})

// 详情换了对象（刷新后）时：当前选中的安全管控文件若已不存在，回落到本体正文
watch(
  () => props.ontology,
  (next) => {
    if (!next) return
    if (selected.value === SECURITIES_PATH && next.securities_content === null) {
      selected.value = ONTOLOGY_PATH
    }
  },
)

async function remove(): Promise<void> {
  const target = props.ontology
  if (!target || deleting.value) return
  deleting.value = true
  localError.value = null
  try {
    await deleteOntology(target.ontology_dir, target.scenario)
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
      <h2 id="ontology-viewer-title">{{ ontology?.name ?? '本体详情' }}</h2>
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
      :title="`删除本体 ${ontology?.name ?? ''}`"
      :message="`将同时删除库内的 ${ontology?.ontology_dir ?? ''}/ 目录（ontology.yaml${
        ontology?.has_securities ? ' 与 securities.yaml' : ''
      }）；如需恢复，可从本体市场重新导入。`"
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

/* 元数据：与 SKILL 详情同一口径（两列、无边框） */
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

/* 左侧文件列表 + 右侧文件正文（与 SKILL 详情同一栅格） */
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

/* 右侧面板：照 `SkillFileEditor` 的只读形态（头一行 + 等宽正文） */
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

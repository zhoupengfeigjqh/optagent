<script setup lang="ts">
/**
 * SKILL 详情：元数据 + 左侧文件树 + 右侧**文件编辑区**（2026-09-16）。
 *
 * - `SKILL.md` 与 `references/`、`scripts/` 等**全部文件可在编辑**；
 * - 保存只改**共享技能库**：引用了该 SKILL 的数字人 MUST 重新部署才会拿到新版本，
 *   因此保存后要**明确提示**（否则会出现"我改了但数字人没变"的困惑）；
 * - **未保存的修改不能悄悄丢**：切换文件或返回列表前先确认；
 * - 删除前 MUST 经 `§7.1` 取出受影响的数字人清单并二次确认（`FR-042`）——
 *   该查询**只在管理员触发删除之后**才发起（引用关系不做常驻浏览视图）。
 */
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
  /** 文件已保存：详情与列表需要刷新（描述可能随 SKILL.md 变化） */
  (e: 'updated', saved: SkillFileSaved): void
}>()

/** 当前选中文件（默认 SKILL.md） */
const selected = ref('SKILL.md')
const fileContent = ref<SkillFileContent | null>(null)
const fileLoading = ref(false)
const fileError = ref<ErrorInfo | null>(null)
const localError = ref<ErrorInfo | null>(null)
const affected = ref<ReferenceItem[]>([])
const confirmDelete = ref(false)

/**
 * 本体市场来源的技能**只读**（2026-10-03 产品决定，`FR-062`）。
 *
 * 它是市场快照：内容只能经「从本体市场导入」窗口的**更新**整体替换，
 * 在线编辑会悄悄偏离市场版本、并让 `origin.hash` 失去"市场是否变化"的判据意义。
 * 后端 `SkillLibraryService.writeFile` 已硬拦截（`ADM_SKILL_READ_ONLY`），
 * 这里只是不给编辑入口——**两层都要有**，界面不渲染编辑器，服务端才是权威。
 */
const readOnly = computed(() => props.skill?.origin?.kind === 'onto_market')

/** 编辑区是否有未保存的修改（由 `SkillFileEditor` 回传） */
const dirty = ref(false)
/** 待执行的意图（切换文件 / 返回列表）——仅在用户确认"放弃修改"后才落地 */
const pending = ref<{ kind: 'file'; path: string } | { kind: 'back' } | null>(null)

/** SKILL.md 正文已随详情返回，不必再请求一次 */
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

/** 返回列表：同样先确认未保存的修改 */
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

/**
 * 保存成功：更新大小与新哈希，并通知上层刷新（描述/大小可能已变）。
 *
 * 这里**就地改字段、不换对象**：`SkillFileEditor` 以"`file` 换对象"作为
 * "重新加载"的信号，换对象会把编辑区草稿重置；就地更新则保留草稿与"已保存"状态。
 */
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
    // 保存后的刷新沿用当前选中项（若该文件已不在，则回到 SKILL.md）
    const keep = next.files.some((file) => file.path === selected.value)
    void selectFile(keep ? selected.value : 'SKILL.md')
  },
  { immediate: true },
)

/** 打开删除确认：**先**查受影响清单，再展示确认框（FR-042） */
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
      <h2 id="skill-viewer-title">{{ props.skill?.name ?? '加载中…' }}</h2>
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
        <!-- 可编辑来源：编辑器；本体市场来源：只读展示（无输入控件、无保存按钮） -->
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
          <span class="mono">{{ item.user_id }}</span> 的 <span class="mono">{{ item.agent_name }}</span>
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

.skill-viewer__header h2 {
  flex: 1;
  margin: 0;
  font-size: var(--font-size-lg);
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

/* 只读视图（本体市场来源）：等宽全文 + 自身滚动，无任何编辑控件 */
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

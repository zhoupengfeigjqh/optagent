/**
 * `@` 引用空间文件（FR-014~FR-019）
 *
 * 展示层与提交层分离：
 * - **展示层**：输入框文本中插入 `@文件名`（可读、可编辑）
 * - **提交层**：`references` 为结构化 `{dir, filename}[]`，发送时作为 `attachments` 提交（FR-016）
 *
 * 关键规则：
 * - 单条消息 ≤ 10 个引用，超限拒绝并提示（FR-017、V-02）
 * - 文本中的 `@文件名` 被删除 → 面板收起且引用同步移除
 * - 发送前校验引用仍存在（`missingReferences()`），不存在则提示且不发送（FR-018、V-15）
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { FileReference } from '../api/types'
import { SPACE_DIRECTORIES, type SpaceDirectory } from '../constants/directories'
import { MAX_REFERENCES_PER_MESSAGE } from '../constants/limits'
import { useSession } from './useAppSession'
import type { WorkspaceStore } from './useWorkspace'
import type { ToastStore } from './useToast'

/** `@` 面板阶段。 */
export type MentionStage = 'dir' | 'file'

/** 构造参数。 */
export interface MentionDeps {
  workspace: WorkspaceStore
  toast?: ToastStore
}

/** `@` 引用 composable 契约。 */
export interface FileMentionStore {
  open: Ref<boolean>
  stage: Ref<MentionStage>
  activeDir: Ref<string | null>
  activeIndex: Ref<number>
  references: Readonly<Ref<FileReference[]>>
  /** 目录列表（与三处 UI 同源，SC-021） */
  directories: readonly SpaceDirectory[]
  /** 当前阶段的可选项列表 */
  files: ComputedRef<{ filename: string }[]>
  optionCount: ComputedRef<number>
  maxReached: ComputedRef<boolean>
  /** 文本/光标变化时检测 `@` 触发与引用同步 */
  handleInput(text: string, caret: number): void
  /** 选择目录 → 进入文件阶段（FR-015） */
  pickDir(dir: string): void
  /** 选择文件 → 加入引用；超限返回 `false` 并提示 */
  pickFile(reference: FileReference): boolean
  /** 键盘上下移动 */
  move(delta: number): void
  /** 收起面板（不清空引用） */
  close(): void
  /** 移除引用并同步文本 */
  remove(reference: FileReference): void
  /** 发送后清空 */
  reset(): void
  /** 提交载荷（结构化数组，FR-016） */
  buildAttachments(): FileReference[]
  /** 已失效的引用（发送前校验用，V-15） */
  missingReferences(): FileReference[]
}

/** `@` 触发检测：光标前紧邻的 `@` 且其后无空白。 */
const TRIGGER_PATTERN = /(?:^|\s)@[^\s@]*$/

/** 展示层引用标记。 */
export function mentionToken(reference: FileReference): string {
  return `@${reference.filename}`
}

/**
 * 提交前移除正文中的 `@文件名` 展示标记（FR-016）。
 *
 * 后端 `content` MUST NOT 含引用文本（引用以结构化 `attachments` 提交），
 * 因此发送前把标记替换为空格并规整空白；结果为空的场景由调用方拦下并提示。
 */
export function stripMentionTokens(
  text: string,
  references: readonly FileReference[],
): string {
  let result = text
  for (const reference of references) {
    result = result.split(mentionToken(reference)).join(' ')
  }
  return result.replace(/\s+/g, ' ').trim()
}

/** 创建 `@` 引用状态。 */
export function createFileMentionStore(deps: MentionDeps): FileMentionStore {
  const open = ref(false)
  const stage = ref<MentionStage>('dir')
  const activeDir = ref<string | null>(null)
  const activeIndex = ref(0)
  const references = ref<FileReference[]>([])

  const files = computed<{ filename: string }[]>(() => {
    const dir = activeDir.value
    if (!dir) {
      return []
    }
    return deps.workspace.filesOf(dir).map((file) => ({ filename: file.filename }))
  })

  const optionCount = computed(() =>
    stage.value === 'dir' ? SPACE_DIRECTORIES.length : files.value.length,
  )

  const maxReached = computed(() => references.value.length >= MAX_REFERENCES_PER_MESSAGE)

  function close(): void {
    open.value = false
    stage.value = 'dir'
    activeDir.value = null
    activeIndex.value = 0
  }

  function handleInput(text: string, caret: number): void {
    // 引用同步：文本中已不存在 `@文件名` 的引用一律移除（US4 场景 8）
    const remaining = references.value.filter((reference) => text.includes(mentionToken(reference)))
    if (remaining.length !== references.value.length) {
      references.value = remaining
    }

    const beforeCaret = text.slice(0, Math.max(0, caret))
    if (!TRIGGER_PATTERN.test(beforeCaret)) {
      if (open.value) {
        close()
      }
      return
    }

    if (!open.value) {
      open.value = true
      stage.value = 'dir'
      activeDir.value = null
    }
    activeIndex.value = 0
  }

  function pickDir(dir: string): void {
    activeDir.value = dir
    stage.value = 'file'
    activeIndex.value = 0
    // 目录内文件可能刚上传，进入文件阶段时刷新清单
    if (!deps.workspace.loading.value) {
      void deps.workspace.load()
    }
  }

  function pickFile(reference: FileReference): boolean {
    if (maxReached.value) {
      deps.toast?.push('error', `单条消息最多引用 ${MAX_REFERENCES_PER_MESSAGE} 个文件`)
      return false
    }
    const duplicated = references.value.some(
      (item) => item.dir === reference.dir && item.filename === reference.filename,
    )
    if (duplicated) {
      return false
    }
    references.value = [...references.value, reference]
    return true
  }

  function move(delta: number): void {
    const count = optionCount.value
    if (count <= 0) {
      activeIndex.value = 0
      return
    }
    activeIndex.value = (activeIndex.value + delta + count) % count
  }

  function remove(reference: FileReference): void {
    references.value = references.value.filter(
      (item) => !(item.dir === reference.dir && item.filename === reference.filename),
    )
  }

  function reset(): void {
    references.value = []
    close()
  }

  function buildAttachments(): FileReference[] {
    return references.value.map((item) => ({ dir: item.dir, filename: item.filename }))
  }

  function missingReferences(): FileReference[] {
    return references.value.filter((reference) => !deps.workspace.exists(reference))
  }

  return {
    open,
    stage,
    activeDir,
    activeIndex,
    references,
    directories: SPACE_DIRECTORIES,
    files,
    optionCount,
    maxReached,
    handleInput,
    pickDir,
    pickFile,
    move,
    close,
    remove,
    reset,
    buildAttachments,
    missingReferences,
  }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useFileMention(): FileMentionStore {
  return useSession().mention
}

/**
 * `@` 引用空间文件（FR-014~FR-019 + 003 三空间级联）
 *
 * 展示层与提交层分离：
 * - **展示层**：输入框文本中插入 `@文件名`（可读、可编辑）
 * - **提交层**：`references` 为结构化 `{dir, filename}[]`，发送时作为 `attachments` 提交（FR-016）
 *
 * 级联导航（三空间，**点击**下钻，悬停不展开）：
 * - 一级：数据准备 / 共享空间 / 临时空间（来自 workspace 接口，前端无目录常量）
 * - 点击数据准备 → 二级 scenario 子目录；点击子目录 → 三级文件
 * - 点击共享/临时空间 → 直接出文件列
 *
 * 关键规则：
 * - 单条消息 ≤ 10 个引用，超限拒绝并提示（FR-017、V-02）
 * - 文本中的 `@文件名` 被删除 → 面板收起且引用同步移除
 * - 发送前校验引用仍存在（`missingReferences()`），不存在则提示且不发送（FR-018、V-15）
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { FileReference, WorkspaceDir, WorkspaceSpace } from '../api/types'
import { MAX_REFERENCES_PER_MESSAGE } from '../constants/limits'
import { isFlatSpace, spaceSubDirs } from '../utils/space'
import { useSession } from './useAppSession'
import type { WorkspaceStore } from './useWorkspace'
import type { ToastStore } from './useToast'

/** 级联面板当前聚焦的列。 */
export type MentionColumn = 'space' | 'dir' | 'file'

/** 构造参数。 */
export interface MentionDeps {
  workspace: WorkspaceStore
  toast?: ToastStore
}

/** `@` 引用 composable 契约。 */
export interface FileMentionStore {
  open: Ref<boolean>
  /** 三空间树（workspace 同源） */
  spaces: ComputedRef<WorkspaceSpace[]>
  /** 当前聚焦列 */
  column: Ref<MentionColumn>
  /** 已选空间名（数据准备展开二级后/扁平空间选中后有值） */
  activeSpace: Ref<string | null>
  /** 已选目录（相对路径，如 数据准备/生产计划、共享空间） */
  activeDir: Ref<string | null>
  /** 当前列的键盘高亮索引 */
  activeIndex: Ref<number>
  references: Readonly<Ref<FileReference[]>>
  /** 二级列的可选目录（仅数据准备；其余空间为空） */
  dirs: ComputedRef<WorkspaceDir[]>
  /** 三级列的文件清单 */
  files: ComputedRef<{ filename: string }[]>
  maxReached: ComputedRef<boolean>
  /** 文本/光标变化时检测 `@` 触发与引用同步 */
  handleInput(text: string, caret: number): void
  /** 点击空间：数据准备进二级目录列，其余直接出文件列 */
  pickSpace(space: string): void
  /** 点击二级目录 → 出文件列 */
  pickDir(dir: string): void
  /** 选择文件 → 加入引用；超限返回 `false` 并提示 */
  pickFile(reference: FileReference): boolean
  /** 键盘上下移动（当前列内循环） */
  move(delta: number): void
  /** 回车确认当前高亮项：空间/目录列下钻，文件列选中；返回选中的引用（非文件列返回 null） */
  confirmActive(): FileReference | null
  /** 回退一列（文件 → 数据准备的目录列或空间列；目录 → 空间列） */
  back(): void
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
  const column = ref<MentionColumn>('space')
  const activeSpace = ref<string | null>(null)
  const activeDir = ref<string | null>(null)
  const activeIndex = ref(0)
  const references = ref<FileReference[]>([])

  const spaces = computed<WorkspaceSpace[]>(() => deps.workspace.spaces.value)

  // 二级列只列数据准备的子目录；扁平空间（共享/临时）不设二级列，直接出文件
  const dirs = computed<WorkspaceDir[]>(() => {
    const space = spaces.value.find((item) => item.name === activeSpace.value)
    return space ? spaceSubDirs(space) : []
  })

  const files = computed<{ filename: string }[]>(() => {
    const dir = activeDir.value
    if (!dir) return []
    return deps.workspace.filesOf(dir).map((file) => ({ filename: file.filename }))
  })

  const maxReached = computed(() => references.value.length >= MAX_REFERENCES_PER_MESSAGE)

  function currentOptions(): unknown[] {
    if (column.value === 'space') return spaces.value
    if (column.value === 'dir') return dirs.value
    return files.value
  }

  function close(): void {
    open.value = false
    column.value = 'space'
    activeSpace.value = null
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
      column.value = 'space'
      activeSpace.value = null
      activeDir.value = null
      // 目录内文件可能刚上传，展开面板时刷新清单
      if (!deps.workspace.loading.value) {
        void deps.workspace.load()
      }
    }
    activeIndex.value = 0
  }

  function pickSpace(space: string): void {
    activeSpace.value = space
    const target = deps.workspace.spaces.value.find((item) => item.name === space)
    if (target && isFlatSpace(target)) {
      // 共享/临时空间：直接出文件列
      activeDir.value = space
      column.value = 'file'
    } else {
      activeDir.value = null
      column.value = 'dir'
    }
    activeIndex.value = 0
  }

  function pickDir(dir: string): void {
    activeDir.value = dir
    column.value = 'file'
    activeIndex.value = 0
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
    const count = currentOptions().length
    if (count <= 0) {
      activeIndex.value = 0
      return
    }
    activeIndex.value = (activeIndex.value + delta + count) % count
  }

  function confirmActive(): FileReference | null {
    if (column.value === 'space') {
      const space = spaces.value[activeIndex.value]
      if (space) pickSpace(space.name)
      return null
    }
    if (column.value === 'dir') {
      const dir = dirs.value[activeIndex.value]
      if (dir) pickDir(dir.dir)
      return null
    }
    const file = files.value[activeIndex.value]
    if (file && activeDir.value !== null) {
      return { dir: activeDir.value, filename: file.filename }
    }
    return null
  }

  function back(): void {
    if (column.value === 'file') {
      // 扁平空间无目录列，直接回空间列
      column.value = dirs.value.length > 0 ? 'dir' : 'space'
      if (column.value === 'space') activeSpace.value = null
      activeDir.value = null
    } else if (column.value === 'dir') {
      column.value = 'space'
      activeSpace.value = null
    }
    activeIndex.value = 0
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
    spaces,
    column,
    activeSpace,
    activeDir,
    activeIndex,
    references,
    dirs,
    files,
    maxReached,
    handleInput,
    pickSpace,
    pickDir,
    pickFile,
    move,
    confirmActive,
    back,
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

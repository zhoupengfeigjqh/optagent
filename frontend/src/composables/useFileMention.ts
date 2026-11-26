
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import type { FileReference, WorkspaceDir, WorkspaceSpace } from '../api/types'
import { MAX_REFERENCES_PER_MESSAGE } from '../constants/limits'
import { isFlatSpace, spaceSubDirs } from '../utils/space'
import { useSession } from './useAppSession'
import { useThreadBuckets } from './useThreadBuckets'
import type { WorkspaceStore } from './useWorkspace'
import type { ToastStore } from './useToast'

export type MentionColumn = 'space' | 'dir' | 'file'

export interface MentionDeps {
  workspace: WorkspaceStore
  toast?: ToastStore
  /**
   * 当前会话（`null` = 视图态新对话，尚未建会话）。
   *
   * 2026-11-17（023 v1.4）：引用**按会话分桶**。原先引用是全局单例、草稿却是按会话的，
   * 于是"在会话 1 粘了文件没发、切到会话 2 再粘同名文件"会被已不可见的旧引用占名，
   * 硬生生多出一个 `(1)`；更糟的是那个看不见的引用还会跟着下一条消息发出去。
   */
  thread?: () => string | null
}

export interface FileMentionStore {
  open: Ref<boolean>
  caret: Ref<number>
  spaces: ComputedRef<WorkspaceSpace[]>
  column: Ref<MentionColumn>
  activeSpace: Ref<string | null>
  /** 已选目录（相对路径，如 数据准备/生产计划、临时空间） */
  activeDir: Ref<string | null>
  activeIndex: Ref<number>
  references: Readonly<Ref<FileReference[]>>
  dirs: ComputedRef<WorkspaceDir[]>
  files: ComputedRef<{ filename: string }[]>
  maxReached: ComputedRef<boolean>
  handleInput(text: string, nextCaret: number): void
  pickSpace(space: string): void
  pickDir(dir: string): void
  pickFile(reference: FileReference): boolean
  move(delta: number): void
  confirmActive(): FileReference | null
  back(): void
  close(): void
  remove(reference: FileReference): void
  reset(): void
  buildAttachments(): FileReference[]
}

export const TRIGGER_PATTERN = /(?:^|\s)@[^\s@]*$/

export function mentionToken(reference: FileReference): string {
  return `@${reference.filename}`
}

/**
 * 提交前移除正文中的 `@文件名` 展示标记（FR-016）。
 *
 * 后端 `content` MUST NOT 含引用文本（引用以结构化 `attachments` 提交），
 * 因此发送前把标记替换为空格并规整空白；结果为空的场景由调用方拦下并提示。
 */
export function stripMentionTokens(text: string, references: readonly FileReference[]): string {
  let result = text
  for (const reference of references) {
    result = result.split(mentionToken(reference)).join(' ')
  }
  return result.replace(/\s+/g, ' ').trim()
}

export function createFileMentionStore(deps: MentionDeps): FileMentionStore {
  const open = ref(false)
  const caret = ref(0)
  const column = ref<MentionColumn>('space')
  const activeSpace = ref<string | null>(null)
  const activeDir = ref<string | null>(null)
  const activeIndex = ref(0)
  const references = ref<FileReference[]>([])

  if (deps.thread !== undefined) {
    const buckets = useThreadBuckets(
      references,
      () => [] as FileReference[],
      (value) => value.length === 0,
    )
    watch(
      () => deps.thread?.() ?? null,
      (next, previous) => {
        // 直接接管给新会话，别当成切换抹掉（否则发送失败时胶囊会凭空消失）
        if (previous === null && next !== null) {
          buckets.move(null, next)
          return
        }
        buckets.stash(previous)
        references.value = buckets.take(next)
      },
    )
  }

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
    caret.value = 0
    column.value = 'space'
    activeSpace.value = null
    activeDir.value = null
    activeIndex.value = 0
  }

  function handleInput(text: string, nextCaret: number): void {
    const remaining = references.value.filter((reference) => text.includes(mentionToken(reference)))
    if (remaining.length !== references.value.length) {
      references.value = remaining
    }

    const beforeCaret = text.slice(0, Math.max(0, nextCaret))
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
      if (!deps.workspace.loading.value) {
        void deps.workspace.load()
      }
    }
    caret.value = nextCaret
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

  return {
    open,
    caret,
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
  }
}

export function useFileMention(): FileMentionStore {
  return useSession().mention
}

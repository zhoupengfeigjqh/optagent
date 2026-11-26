import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { FileReference, WorkspaceDir, WorkspaceSpace } from '../api/types'
import { isFlatSpace, spaceSubDirs } from '../utils/space'
import { TRIGGER_PATTERN, type MentionColumn } from './useFileMention'
import type { WorkspaceStore } from './useWorkspace'

export interface PathInsertDeps {
  workspace: WorkspaceStore
}

export interface PathInsertStore {
  open: Ref<boolean>
  activeField: Ref<string | null>
  caret: Ref<number>
  spaces: ComputedRef<WorkspaceSpace[]>
  column: Ref<MentionColumn>
  activeSpace: Ref<string | null>
  /** 已选目录（相对路径，如 数据准备/生产计划、临时空间） */
  activeDir: Ref<string | null>
  activeIndex: Ref<number>
  dirs: ComputedRef<WorkspaceDir[]>
  files: ComputedRef<{ filename: string }[]>
  loading: ComputedRef<boolean>
  handleInput(field: string, text: string, caret: number): void
  pickSpace(space: string): void
  pickDir(dir: string): void
  pickFile(reference: FileReference): string
  move(delta: number): void
  confirmActive(): string | null
  back(): void
  close(): void
  reset(): void
}

export function relativePathOf(reference: FileReference): string {
  return `${reference.dir}/${reference.filename}`
}

export function createPathInsertStore(deps: PathInsertDeps): PathInsertStore {
  const open = ref(false)
  const activeField = ref<string | null>(null)
  const caret = ref(0)
  const column = ref<MentionColumn>('space')
  const activeSpace = ref<string | null>(null)
  const activeDir = ref<string | null>(null)
  const activeIndex = ref(0)

  const spaces = computed<WorkspaceSpace[]>(() => deps.workspace.spaces.value)
  const loading = computed<boolean>(() => deps.workspace.loading.value)

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

  function handleInput(field: string, text: string, nextCaret: number): void {
    if (open.value && activeField.value !== field) close()

    const beforeCaret = text.slice(0, Math.max(0, nextCaret))
    if (!TRIGGER_PATTERN.test(beforeCaret)) {
      if (open.value) close()
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
    activeField.value = field
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

  function pickFile(reference: FileReference): string {
    const path = relativePathOf(reference)
    close()
    return path
  }

  function move(delta: number): void {
    const count = currentOptions().length
    if (count <= 0) {
      activeIndex.value = 0
      return
    }
    activeIndex.value = (activeIndex.value + delta + count) % count
  }

  function confirmActive(): string | null {
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
      return pickFile({ dir: activeDir.value, filename: file.filename })
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

  function reset(): void {
    close()
    activeField.value = null
    caret.value = 0
  }

  return {
    open,
    activeField,
    caret,
    spaces,
    column,
    activeSpace,
    activeDir,
    activeIndex,
    dirs,
    files,
    loading,
    handleInput,
    pickSpace,
    pickDir,
    pickFile,
    move,
    confirmActive,
    back,
    close,
    reset,
  }
}

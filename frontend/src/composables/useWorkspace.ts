
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { FilesApi } from '../api/files'
import type {
  ErrorInfo,
  FileReference,
  WorkspaceDir,
  WorkspaceFile,
  WorkspaceSpace,
} from '../api/types'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

export interface WorkspaceDeps {
  files: FilesApi
  toast: ToastStore
}

export function uploadExtensionsOfDir(
  dirs: readonly WorkspaceDir[],
  dir: string,
): readonly string[] {
  return dirs.find((item) => item.dir === dir)?.upload_extensions ?? []
}

export interface WorkspaceStore {
  spaces: Readonly<Ref<WorkspaceSpace[]>>
  scenario: Readonly<Ref<string>>
  dirs: ComputedRef<WorkspaceDir[]>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  expandedSpaces: Readonly<Ref<readonly string[]>>
  expandedDirs: Readonly<Ref<readonly string[]>>
  load(): Promise<void>
  filesOf(dir: string): WorkspaceFile[]
  labelOf(dir: string): string
  uploadExtensionsOf(dir: string): readonly string[]
  exists(reference: FileReference): boolean
  registerFile(file: { dir: string; filename: string; size: number }): void
  toggleSpace(name: string): void
  toggleDir(dir: string): void
  remove(reference: FileReference): Promise<boolean>
}

export function createWorkspaceStore(deps: WorkspaceDeps): WorkspaceStore {
  const spaces = ref<WorkspaceSpace[]>([])
  const scenario = ref('')
  const loading = ref(false)
  const error = ref<ErrorInfo | null>(null)
  const expandedSpaces = ref<readonly string[]>([])
  const expandedDirs = ref<readonly string[]>([])

  const dirs = computed<WorkspaceDir[]>(() => spaces.value.flatMap((space) => space.dirs))

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const response = await deps.files.workspace()
      spaces.value = response.spaces
      scenario.value = response.scenario
    } catch (cause) {
      error.value = toErrorInfo(cause)
      spaces.value = []
      scenario.value = ''
    } finally {
      loading.value = false
    }
  }

  function filesOf(dir: string): WorkspaceFile[] {
    return dirs.value.find((item) => item.dir === dir)?.files ?? []
  }

  function labelOf(dir: string): string {
    return dirs.value.find((item) => item.dir === dir)?.label ?? dir.split('/').pop() ?? dir
  }

  /**
   * 该**目录**允许的上传扩展名（2026-10-13：粒度由空间级下放到目录级）。
   *
   * 前端**不再自行按空间反查**，避免与服务端出现第二套口径；实现见模块级
   * `uploadExtensionsOfDir`（与 `UploadMenu` 共用）。
   */
  function uploadExtensionsOf(dir: string): readonly string[] {
    return uploadExtensionsOfDir(dirs.value, dir)
  }

  function exists(reference: FileReference): boolean {
    return filesOf(reference.dir).some((file) => file.filename === reference.filename)
  }

  function registerFile(file: { dir: string; filename: string; size: number }): void {
    const known = spaces.value.some((space) => space.dirs.some((item) => item.dir === file.dir))
    if (!known) {
      return
    }
    spaces.value = spaces.value.map((space) => ({
      ...space,
      dirs: space.dirs.map((item) => {
        if (item.dir !== file.dir) {
          return item
        }
        if (item.files.some((existing) => existing.filename === file.filename)) {
          return item
        }
        return {
          ...item,
          files: [
            ...item.files,
            { filename: file.filename, size: file.size, updated_at: new Date().toISOString() },
          ],
        }
      }),
    }))
  }

  function toggleSpace(name: string): void {
    expandedSpaces.value = expandedSpaces.value.includes(name)
      ? expandedSpaces.value.filter((item) => item !== name)
      : [...expandedSpaces.value, name]
  }

  function toggleDir(dir: string): void {
    expandedDirs.value = expandedDirs.value.includes(dir)
      ? expandedDirs.value.filter((item) => item !== dir)
      : [...expandedDirs.value, dir]
  }

  function dropFromCache(reference: FileReference): void {
    spaces.value = spaces.value.map((space) => ({
      ...space,
      dirs: space.dirs.map((item) =>
        item.dir === reference.dir
          ? { ...item, files: item.files.filter((file) => file.filename !== reference.filename) }
          : item,
      ),
    }))
  }

  async function remove(reference: FileReference): Promise<boolean> {
    try {
      await deps.files.remove(reference.dir, reference.filename)
    } catch (cause) {
      deps.toast.push('error', toUserMessage(toErrorInfo(cause)))
      return false
    }
    dropFromCache(reference)
    deps.toast.push('success', `已删除 ${reference.filename}`)
    return true
  }

  return {
    spaces,
    scenario,
    dirs,
    loading,
    error,
    expandedSpaces,
    expandedDirs,
    load,
    filesOf,
    labelOf,
    uploadExtensionsOf,
    exists,
    registerFile,
    toggleSpace,
    toggleDir,
    remove,
  }
}

export function useWorkspace(): WorkspaceStore {
  return useSession().workspace
}

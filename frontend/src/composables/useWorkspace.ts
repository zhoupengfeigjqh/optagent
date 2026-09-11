/**
 * 工作空间文件（FR-031、FR-019）
 *
 * 后端 `GET /api/files/workspace` 固定返回全部 9 个白名单目录。
 * 本 composable 仍会**按 `constants/directories.ts` 的顺序与集合归一化**：
 * 缺失目录补为空目录、未知目录丢弃、顺序固定——保证三处 UI 口径一致（SC-021）。
 */

import { ref, type Ref } from 'vue'

import type { FilesApi } from '../api/files'
import type { FileReference, WorkspaceDir, WorkspaceFile } from '../api/types'
import { SPACE_DIRECTORIES } from '../constants/directories'
import { toErrorInfo } from '../utils/error-message'
import type { ErrorInfo } from '../api/types'
import { useSession } from './useAppSession'

/** 构造参数。 */
export interface WorkspaceDeps {
  files: FilesApi
}

/** 工作空间 composable 契约。 */
export interface WorkspaceStore {
  dirs: Readonly<Ref<WorkspaceDir[]>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  /** 拉取工作空间清单 */
  load(): Promise<void>
  /** 取某目录的文件（未知目录返回空数组） */
  filesOf(dir: string): WorkspaceFile[]
  /** 引用存在性校验（FR-018、V-15） */
  exists(reference: FileReference): boolean
}

/** 创建空白工作空间（9 个空目录，用于加载前占位）。 */
export function emptyWorkspace(): WorkspaceDir[] {
  return SPACE_DIRECTORIES.map((item) => ({ dir: item.dir, files: [] }))
}

/** 创建工作空间状态。 */
export function createWorkspaceStore(deps: WorkspaceDeps): WorkspaceStore {
  const dirs = ref<WorkspaceDir[]>(emptyWorkspace())
  const loading = ref(false)
  const error = ref<ErrorInfo | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const response = await deps.files.workspace()
      dirs.value = normalize(response.dirs)
    } catch (cause) {
      error.value = toErrorInfo(cause)
      // 失败时保持 9 个空目录，避免界面塌陷
      dirs.value = emptyWorkspace()
    } finally {
      loading.value = false
    }
  }

  function filesOf(dir: string): WorkspaceFile[] {
    return dirs.value.find((item) => item.dir === dir)?.files ?? []
  }

  function exists(reference: FileReference): boolean {
    return filesOf(reference.dir).some((file) => file.filename === reference.filename)
  }

  return { dirs, loading, error, load, filesOf, exists }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useWorkspace(): WorkspaceStore {
  return useSession().workspace
}

/** 按白名单归一化后端返回的目录清单。 */
function normalize(source: WorkspaceDir[]): WorkspaceDir[] {
  const byDir = new Map(source.map((item) => [item.dir, item.files ?? []]))
  return SPACE_DIRECTORIES.map((item) => ({
    dir: item.dir,
    files: byDir.get(item.dir) ?? [],
  }))
}

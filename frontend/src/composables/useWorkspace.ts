/**
 * 工作空间文件（FR-031、FR-019、US8）
 *
 * 后端 `GET /api/files/workspace` 固定返回全部 9 个白名单目录。
 * 本 composable 仍会**按 `constants/directories.ts` 的顺序与集合归一化**：
 * 缺失目录补为空目录、未知目录丢弃、顺序固定——保证三处 UI 口径一致（SC-021）。
 *
 * 另外承载文件空间的**列表侧状态与动作**：
 * - 分组的折叠展开（默认全部收起，本次会话内保持——面板收起再打开不重置）
 * - 删除文件（`shared` 只读由后端兜底拒绝）
 */

import { ref, type Ref } from 'vue'

import type { FilesApi } from '../api/files'
import type { ErrorInfo, FileReference, WorkspaceDir, WorkspaceFile } from '../api/types'
import { SPACE_DIRECTORIES } from '../constants/directories'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

/** 构造参数。 */
export interface WorkspaceDeps {
  files: FilesApi
  toast: ToastStore
}

/** 工作空间 composable 契约。 */
export interface WorkspaceStore {
  dirs: Readonly<Ref<WorkspaceDir[]>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  /** 已展开的目录名（默认空数组 = 9 个分组全部收起），本次会话内保持 */
  expandedDirs: Readonly<Ref<readonly string[]>>
  /** 拉取工作空间清单 */
  load(): Promise<void>
  /** 取某目录的文件（未知目录返回空数组） */
  filesOf(dir: string): WorkspaceFile[]
  /** 引用存在性校验（FR-018、V-15） */
  exists(reference: FileReference): boolean
  /** 折叠 / 展开某个目录分组 */
  toggleDir(dir: string): void
  /**
   * 删除文件。`shared` 为共享只读目录，由后端拒绝（403 `FILE_READONLY`）。
   *
   * 成功后就地移除该条目并提示；失败提示原因并返回 `false`（由调用方决定是否收敛面板）。
   */
  remove(reference: FileReference): Promise<boolean>
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
  /** 折叠状态：空数组即"全部收起"（默认值），不持久化到 storage，仅存活于本次会话 */
  const expandedDirs = ref<readonly string[]>([])

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

  function toggleDir(dir: string): void {
    expandedDirs.value = expandedDirs.value.includes(dir)
      ? expandedDirs.value.filter((item) => item !== dir)
      : [...expandedDirs.value, dir]
  }

  async function remove(reference: FileReference): Promise<boolean> {
    try {
      await deps.files.remove(reference.dir, reference.filename)
    } catch (cause) {
      deps.toast.push('error', toUserMessage(toErrorInfo(cause)))
      return false
    }

    // 就地移除即可：删除只影响单个目录，重拉全量反而会丢掉折叠状态之外的滚动位置
    dirs.value = dirs.value.map((item) =>
      item.dir === reference.dir
        ? { ...item, files: item.files.filter((file) => file.filename !== reference.filename) }
        : item,
    )
    deps.toast.push('success', `已删除 ${reference.filename}`)
    return true
  }

  return { dirs, loading, error, expandedDirs, load, filesOf, exists, toggleDir, remove }
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

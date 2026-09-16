/**
 * 工作空间文件（003 三空间改造）
 *
 * 后端 `GET /api/files/workspace` 返回三级树：空间 → 子目录 → 文件，
 * 附场景名与每空间策略（agent_writable / upload_extensions）。
 * 目录集合与展示名完全以后端为准（scenario.json 定义），前端不保留任何目录常量。
 *
 * 文件空间视角＝**当前选中的数字人**：场景随数字人存放，故切换数字人后可见目录清单会变，
 * `useAppSession` 的 `onSwitched` 会重新 `load()`。未选中数字人 → 409 AGENT_NOT_SELECTED；
 * 选中但该数字人未配置场景 → 503 SCENARIO_NOT_CONFIGURED；两种错误都经 error 透出给界面。
 *
 * 另外承载文件空间的**列表侧状态与动作**：
 * - 两级折叠展开（空间 → 数据准备子目录；默认全部收起，本次会话内保持——面板收起再打开不重置）
 * - 删除文件（共享空间只读由后端兜底拒绝；目录项 `deletable` 供界面隐藏入口）
 */

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

/** 构造参数。 */
export interface WorkspaceDeps {
  files: FilesApi
  toast: ToastStore
}

/** 工作空间 composable 契约。 */
export interface WorkspaceStore {
  /** 三空间树（加载前/失败为空数组） */
  spaces: Readonly<Ref<WorkspaceSpace[]>>
  /** 场景名（未加载/未配置为空串） */
  scenario: Readonly<Ref<string>>
  /** 扁平化的全部目录（树组件/文件查找用） */
  dirs: ComputedRef<WorkspaceDir[]>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  /** 已展开的空间名（默认空数组 = 全部收起），本次会话内保持 */
  expandedSpaces: Readonly<Ref<readonly string[]>>
  /** 已展开的二级目录路径（默认空数组 = 全部收起），本次会话内保持 */
  expandedDirs: Readonly<Ref<readonly string[]>>
  /** 拉取工作空间清单 */
  load(): Promise<void>
  /** 取某目录的文件（未知目录返回空数组） */
  filesOf(dir: string): WorkspaceFile[]
  /** 取目录展示名（未知目录回退为路径最后一段） */
  labelOf(dir: string): string
  /** 取目录所属空间允许的上传扩展名（未知目录返回空数组） */
  uploadExtensionsOf(dir: string): readonly string[]
  /** 目录内文件是否可删除（共享空间只读） */
  deletableOf(dir: string): boolean
  /** 引用存在性校验（FR-018、V-15） */
  exists(reference: FileReference): boolean
  /** 折叠 / 展开某个空间（一级） */
  toggleSpace(name: string): void
  /** 折叠 / 展开某个二级目录分组 */
  toggleDir(dir: string): void
  /**
   * 删除文件。共享空间为只读，由后端拒绝（403 `FILE_READONLY`）。
   *
   * 成功后就地移除该条目并提示；失败提示原因并返回 `false`（由调用方决定是否收敛面板）。
   */
  remove(reference: FileReference): Promise<boolean>
}

/** 创建工作空间状态。 */
export function createWorkspaceStore(deps: WorkspaceDeps): WorkspaceStore {
  const spaces = ref<WorkspaceSpace[]>([])
  const scenario = ref('')
  const loading = ref(false)
  const error = ref<ErrorInfo | null>(null)
  /** 一级折叠状态（空间）：空数组即"全部收起"（默认值），仅存活于本次会话 */
  const expandedSpaces = ref<readonly string[]>([])
  /** 二级折叠状态（数据准备子目录）：同上 */
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
      // 失败（含 scenario 未配置 503）时清空，界面按错误态/空态呈现
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

  function spaceOf(dir: string): WorkspaceSpace | undefined {
    return spaces.value.find((space) => space.dirs.some((item) => item.dir === dir))
  }

  function uploadExtensionsOf(dir: string): readonly string[] {
    return spaceOf(dir)?.upload_extensions ?? []
  }

  function deletableOf(dir: string): boolean {
    return dirs.value.find((item) => item.dir === dir)?.deletable ?? false
  }

  function exists(reference: FileReference): boolean {
    return filesOf(reference.dir).some((file) => file.filename === reference.filename)
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

  async function remove(reference: FileReference): Promise<boolean> {
    try {
      await deps.files.remove(reference.dir, reference.filename)
    } catch (cause) {
      deps.toast.push('error', toUserMessage(toErrorInfo(cause)))
      return false
    }

    // 就地移除即可：删除只影响单个目录，重拉全量反而会丢掉折叠状态之外的滚动位置
    spaces.value = spaces.value.map((space) => ({
      ...space,
      dirs: space.dirs.map((item) =>
        item.dir === reference.dir
          ? { ...item, files: item.files.filter((file) => file.filename !== reference.filename) }
          : item,
      ),
    }))
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
    deletableOf,
    exists,
    toggleSpace,
    toggleDir,
    remove,
  }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useWorkspace(): WorkspaceStore {
  return useSession().workspace
}

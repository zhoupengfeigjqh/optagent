/**
 * HITL 弹窗参数 `@` 路径插入（`useFileMention` 的"路径插入"姊妹实现）。
 *
 * 与 `useFileMention`（对话引用）的语义差异：
 * - **无引用登记**：选中文件直接产出 user-data 相对路径文本，由调用方写入参数字段值；
 *   无 attachments 组装、无数量上限、无正文标记清理
 * - **展示/提交分离在组件层**：输入框的值即提交值（相对路径，后端 file_args 铸造/沙箱
 *   解析口径一致）；结构化文件卡片由 InteractionDialog 按值反查 workspace 渲染
 *
 * 状态机（三级级联 + 键盘导航）与 `MentionPicker` 的驱动协议和 useFileMention 一致，
 * 面板组件与 workspace 数据源直接共享。同一时刻只服务一个字段（切字段自动收起）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { FileReference, WorkspaceDir, WorkspaceSpace } from '../api/types'
import { isFlatSpace, spaceSubDirs } from '../utils/space'
import { TRIGGER_PATTERN, type MentionColumn } from './useFileMention'
import type { WorkspaceStore } from './useWorkspace'

/** 构造参数。 */
export interface PathInsertDeps {
  workspace: WorkspaceStore
}

/** `@` 路径插入状态契约。 */
export interface PathInsertStore {
  open: Ref<boolean>
  /** 当前激活的参数字段名（同一时刻只服务一个字段） */
  activeField: Ref<string | null>
  /** 最近一次输入的光标位置：选中后替换 [触发起点, 光标) 的 `@查询词` 段 */
  caret: Ref<number>
  /** 三空间树（workspace 同源） */
  spaces: ComputedRef<WorkspaceSpace[]>
  /** 当前聚焦列 */
  column: Ref<MentionColumn>
  activeSpace: Ref<string | null>
  /** 已选目录（相对路径，如 数据准备/生产计划、共享空间） */
  activeDir: Ref<string | null>
  /** 当前列的键盘高亮索引 */
  activeIndex: Ref<number>
  /** 二级列的可选目录（仅数据准备；其余空间为空） */
  dirs: ComputedRef<WorkspaceDir[]>
  /** 三级列的文件清单 */
  files: ComputedRef<{ filename: string }[]>
  loading: ComputedRef<boolean>
  /** 输入/光标变化时检测 `@` 触发；记录字段与光标。切字段自动收起。 */
  handleInput(field: string, text: string, caret: number): void
  /** 点击空间：数据准备进二级目录列，其余直接出文件列 */
  pickSpace(space: string): void
  /** 点击二级目录 → 出文件列 */
  pickDir(dir: string): void
  /** 选中文件：关闭面板，返回应插入的相对路径文本 */
  pickFile(reference: FileReference): string
  /** 键盘上下移动（当前列内循环） */
  move(delta: number): void
  /** 回车/→ 确认当前高亮项：空间/目录列下钻，文件列完成选中（返回插入路径，其余列返回 null） */
  confirmActive(): string | null
  /** 回退一列（文件 → 数据准备的目录列或空间列；目录 → 空间列） */
  back(): void
  /** 收起面板 */
  close(): void
  /** 弹窗切换/卸载时清空 */
  reset(): void
}

/** 引用 → user-data 相对路径（与后端 file_args 铸造/沙箱解析的口径一致）。 */
export function relativePathOf(reference: FileReference): string {
  return `${reference.dir}/${reference.filename}`
}

/** 创建 `@` 路径插入状态（弹窗组件级，随 dialog 实例创建，不入会话上下文）。 */
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
    // 切字段自动收起（再按新字段的文本决定是否重新触发）
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
      // 目录内文件可能刚上传，展开面板时刷新清单
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

/**
 * 空间目录白名单（唯一来源）
 *
 * 与后端 `agent-backend/src/domain/dirs.ts` 同口径，共 9 个：
 * 7 个业务目录 + 共享目录 `shared` + 临时空间 `tmp`。
 *
 * 三处 UI MUST 引用本模块，不得各自硬编码（FR-009 / FR-014 / FR-031、SC-021）：
 * 1. 加号上传入口（`UploadMenu.vue`）
 * 2. `@` 引用面板（`MentionPicker.vue`）
 * 3. 文件空间列表（`WorkspaceFileTree.vue`，右栏面板列表态）
 */

/** 空间目录条目：`dir` 为提交给后端的值，`label` 为界面展示名。 */
export interface SpaceDirectory {
  /** 目录名（提交给后端的 `dir` 值） */
  readonly dir: string
  /** 界面展示名（与 `dir` 相同者保留供将来本地化） */
  readonly label: string
}

/** 7 个业务目录，顺序与后端 `BUSINESS_DIRS` 一致。 */
export const BUSINESS_DIRS = [
  '生产计划',
  '产线信息',
  '切换时间',
  '求解时间',
  '产线电价',
  '目标优先级',
  '使用规则',
] as const

/** 共享空间目录名。 */
export const SHARED_DIR = 'shared'

/** 临时空间目录名。 */
export const TMP_DIR = 'tmp'

/** 9 个空间目录（顺序固定），三处 UI 的唯一目录来源。 */
export const SPACE_DIRECTORIES: readonly SpaceDirectory[] = Object.freeze([
  ...BUSINESS_DIRS.map((dir) => Object.freeze({ dir, label: dir })),
  Object.freeze({ dir: SHARED_DIR, label: '共享空间' }),
  Object.freeze({ dir: TMP_DIR, label: '临时空间' }),
])

/** 9 个目录名的只读集合，供 O(1) 白名单校验。 */
export const SPACE_DIRECTORY_NAMES: ReadonlySet<string> = new Set(
  SPACE_DIRECTORIES.map((item) => item.dir),
)

/** 判断给定目录名是否属于白名单（大小写敏感，后端为精确匹配）。 */
export function isSpaceDirectory(dir: string): boolean {
  return SPACE_DIRECTORY_NAMES.has(dir)
}

/** 取目录展示名；未知目录回退为目录名本身。 */
export function directoryLabel(dir: string): string {
  return SPACE_DIRECTORIES.find((item) => item.dir === dir)?.label ?? dir
}

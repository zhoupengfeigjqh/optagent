/**
 * 全局限制常量
 *
 * 数值来源：`spec.md`（FR-010、FR-017、FR-039、FR-040、FR-048）、
 * `data-model.md`（§2、§3、§10、§16）与 `contracts/backend-api.md`（§5.1、§5.4）。
 * 前端与后端保持同口径，避免两侧各自硬编码。
 */


/** 单文件上传上限（字节）：5MB（全项目统一约束，与后端 UPLOAD_MAX_MB 对齐）。 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** 单文件上传上限（用于文案）：5MB。 */
export const MAX_UPLOAD_MB = 5



/** 单条消息允许引用的文件数上限。 */
export const MAX_REFERENCES_PER_MESSAGE = 10


export const HISTORY_DEFAULT_LIMIT = 10

export const HISTORY_EXPANDED_LIMIT = 100


export const MESSAGE_PAGE_SIZE = 50

/** 会话详情单页消息条数上限（后端最大 200）。 */
export const MESSAGE_PAGE_MAX = 200


export const TOAST_MAX_VISIBLE = 3

/** 提示自动消失时长（毫秒）。 */
export const TOAST_DURATION_MS = 4000


export const STORAGE_PREFIX = 'optagent.'

export const STORAGE_KEY_MODEL = `${STORAGE_PREFIX}model`

export const STORAGE_KEY_THINKING = `${STORAGE_PREFIX}thinking`

/**
 * 当前会话缓存键（002 特性）：刷新后恢复上次会话，URL `?thread=` 优先、本键兜底。
 * 见 `utils/thread-restore.ts`。
 */
export const STORAGE_KEY_THREAD = `${STORAGE_PREFIX}thread`

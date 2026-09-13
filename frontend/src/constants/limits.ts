/**
 * 全局限制常量
 *
 * 数值来源：`spec.md`（FR-010、FR-017、FR-039、FR-040、FR-048）、
 * `data-model.md`（§2、§3、§10、§16）与 `contracts/backend-api.md`（§5.1、§5.4）。
 * 前端与后端保持同口径，避免两侧各自硬编码。
 */

/* ---------- 上传（FR-010、contracts §5.1） ---------- */

/** 单文件上传上限（字节）：50MB。 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** 单文件上传上限（用于文案）：50MB。 */
export const MAX_UPLOAD_MB = 50

/** 允许上传的扩展名白名单（小写，含点）。 */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  '.csv', '.xlsx', '.txt', '.json', '.pdf',
  // 图片：供 OCR 识别与内联预览
  '.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif', '.tif', '.tiff',
] as const

/* ---------- 文件引用（FR-017、SC-019） ---------- */

/** 单条消息允许引用的文件数上限。 */
export const MAX_REFERENCES_PER_MESSAGE = 10

/* ---------- 历史会话（FR-039、FR-040、SC-014） ---------- */

/** 历史列表默认展示条数（前端切片）。 */
export const HISTORY_DEFAULT_LIMIT = 10

/** 点击"更多"后的展示条数（前端切片）。 */
export const HISTORY_EXPANDED_LIMIT = 100

/* ---------- 会话详情分页（contracts §3.3） ---------- */

/** 会话详情单页消息条数（后端默认 50）。 */
export const MESSAGE_PAGE_SIZE = 50

/** 会话详情单页消息条数上限（后端最大 200）。 */
export const MESSAGE_PAGE_MAX = 200

/* ---------- 预览（FR-048、contracts §5.4） ---------- */

/** 内联预览大小上限（MB），超限引导下载。 */
export const PREVIEW_MAX_MB = 10

/* ---------- 提示（D14） ---------- */

/** 同一时刻最多展示的提示条数。 */
export const TOAST_MAX_VISIBLE = 3

/** 提示自动消失时长（毫秒）。 */
export const TOAST_DURATION_MS = 4000

/* ---------- 本地偏好存储（plan.md 存储段） ---------- */

/** `sessionStorage` 键名前缀。 */
export const STORAGE_PREFIX = 'optagent.'

/** 当前模型缓存键。 */
export const STORAGE_KEY_MODEL = `${STORAGE_PREFIX}model`

/** 思考开关缓存键。 */
export const STORAGE_KEY_THINKING = `${STORAGE_PREFIX}thinking`

/**
 * 错误码 → 中文文案映射（唯一映射表，D13 / V-12）
 *
 * 后端统一错误体为 `{ error: { code, message } }`；前端**不直接展示**后端 `message`
 * （面向开发者且不稳定），一律按 `code` 分派。未知码回退通用文案并保留原码。
 *
 * 部分错误码在不同场景语义不同（`contracts/backend-api.md` §7 差异 6）：
 * 例如 `FILE_TOO_LARGE` 在上传时说"超过 5MB"，在预览时说"文件过大，请下载查看"。
 * 因此提供 `context` 参数给出场景化文案，不写死单一解释。
 *
 * D13 唯一例外：`FILE_SCHEMA_INVALID`（上传表头/字段校验）的问题清单是后端按文件
 * 动态生成的（缺哪些表头、哪行哪个字段类型不符），按码分派无法承载——该码直接
 * 透传后端 `details`（逐条问题的中文清单），不套固定文案。
 */

import type { ErrorInfo } from '../api/types'

/** 错误展示场景。 */
export type ErrorMessageContext =
  | 'default'
  | 'create-thread'
  | 'send-message'
  | 'upload'
  | 'preview'

/** 通用兜底文案。 */
const GENERIC_MESSAGE = '请求失败，请稍后重试'

/** 基础映射（与场景无关的通用口径）。 */
const BASE_MESSAGES: Readonly<Record<string, string>> = {
  // 会话
  THREAD_NOT_FOUND: '会话不存在或已被删除',
  MESSAGE_NOT_FOUND: '消息不存在或已被删除',
  THREAD_RUN_ACTIVE: '该会话已有进行中的回复',
  THREAD_BUSY_LIMIT: '系统繁忙，请稍后重试',
  // 数字人
  AGENT_NOT_SELECTED: '请先选择数字人',
  AGENT_NOT_FOUND: '数字人不存在或配置异常',
  POOL_EXHAUSTED: '系统繁忙，请稍后重试',
  // 模型
  MODEL_NOT_FOUND: '所选模型不可用，请重新选择',
  // 文件
  FILE_REF_NOT_FOUND: '引用的文件不存在，请重新选择',
  FILE_TOO_LARGE: '文件超过 5MB',
  FILE_NOT_FOUND: '文件不存在或已被清理',
  FILE_READONLY: '共享空间为只读目录，不支持删除',
  UPLOAD_DIR_FORBIDDEN: '该目录不允许访问',
  TMP_WRITE_FAILED: '临时空间写入失败，请重试',
  VALIDATION_FAILED: '参数不合法',
  // HITL 工具调用人工确认
  SCHEMA_VALIDATION_FAILED: '参数校验未通过，请检查填写内容',
  INTERACTION_NOT_FOUND: '该调用确认已失效，请让数字人重新发起',
  INTERACTION_EXPIRED: '确认等待已超时，请让数字人重新发起',
  // 服务端 / 网络
  INTERNAL_ERROR: '系统繁忙，请稍后重试',
  SERVICE_UNAVAILABLE: '系统繁忙，请稍后重试',
  NETWORK_ERROR: '网络异常，请检查连接后重试',
}

/** 场景化覆盖（优先级高于基础映射）。 */
const CONTEXT_MESSAGES: Readonly<
  Partial<Record<ErrorMessageContext, Readonly<Record<string, string>>>>
> = {
  'send-message': {
    // 并发上限（同一用户活跃回复 ≥ 3，跨数字人累计）——创建接口不限制会话总数
    THREAD_BUSY_LIMIT: '系统繁忙，请稍后重试',
  },
  upload: {
    VALIDATION_FAILED: '文件格式不支持',
    FILE_TOO_LARGE: '文件超过 5MB',
    UPLOAD_DIR_FORBIDDEN: '该目录不允许上传',
  },
  preview: {
    FILE_TOO_LARGE: '文件过大，请下载查看',
    FILE_NOT_FOUND: '文件不存在或已被清理',
    UPLOAD_DIR_FORBIDDEN: '该目录不支持预览',
    VALIDATION_FAILED: '参数非法',
  },
}

/**
 * 把错误信息翻译为用户可读的中文文案。
 *
 * @param error 后端错误体（`null` / `undefined` 视为未知错误）
 * @param context 展示场景，决定同码不同义的文案
 */
export function toUserMessage(
  error: ErrorInfo | null | undefined,
  context: ErrorMessageContext = 'default',
): string {
  const code = error?.code
  if (!code) {
    return GENERIC_MESSAGE
  }

  // D13 唯一例外（见文件头注释）：FILE_SCHEMA_INVALID 的问题清单按文件动态生成，
  // 按码分派无法承载——透传后端 details（逐条问题，换行展示）
  if (code === 'FILE_SCHEMA_INVALID') {
    const details = error.details
    if (
      Array.isArray(details) &&
      details.length > 0 &&
      details.every((item) => typeof item === 'string')
    ) {
      return (details as string[]).join('\n')
    }
    return '上传表不符合该目录的字段约束'
  }

  const scoped = CONTEXT_MESSAGES[context]?.[code]
  if (scoped) {
    return scoped
  }

  const base = BASE_MESSAGES[code]
  if (base) {
    return base
  }

  // 未知码：通用文案 + 保留原码，便于排查
  return `${GENERIC_MESSAGE}（${code}）`
}

/**
 * 把任意抛出物归一为 `ErrorInfo`（供状态存储与文案映射使用）。
 *
 * - `ApiError`（含 `code`）→ 原样保留后端错误码
 * - 其他 `Error`（多为网络层异常）→ `NETWORK_ERROR`
 * - 其他类型 → `INTERNAL_ERROR`
 */
export function toErrorInfo(error: unknown): ErrorInfo {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown; details?: unknown }
    if (typeof record.code === 'string' && record.code !== '') {
      return {
        code: record.code,
        message: typeof record.message === 'string' ? record.message : '',
        // 透传结构化问题清单（FILE_SCHEMA_INVALID 用），其余场景忽略
        details: record.details,
      }
    }
  }

  if (error instanceof Error) {
    return { code: 'NETWORK_ERROR', message: error.message }
  }

  return { code: 'INTERNAL_ERROR', message: '' }
}

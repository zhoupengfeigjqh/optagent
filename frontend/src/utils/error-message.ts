
import type { ErrorInfo } from '../api/types'

export type ErrorMessageContext =
  'default' | 'create-thread' | 'send-message' | 'upload' | 'preview'

/** 通用兜底文案。 */
const GENERIC_MESSAGE = '请求失败，请稍后重试'

const BASE_MESSAGES: Readonly<Record<string, string>> = {
  THREAD_NOT_FOUND: '会话不存在或已被删除',
  MESSAGE_NOT_FOUND: '消息不存在或已被删除',
  THREAD_RUN_ACTIVE: '该会话已有进行中的回复',
  THREAD_BUSY_LIMIT: '系统繁忙，请稍后重试',
  AGENT_NOT_SELECTED: '请先选择数字人',
  AGENT_NOT_FOUND: '数字人不存在或配置异常',
  // 009：数字人已被移除/未对该用户关联（陈旧上下文）→ 说明"为什么失败"并给出下一步动作
  AGENT_NOT_AVAILABLE: '该数字人已不可用，请重新选择数字人',
  POOL_EXHAUSTED: '系统繁忙，请稍后重试',
  MODEL_NOT_FOUND: '所选模型不可用，请重新选择',
  FILE_REF_NOT_FOUND: '引用的文件不存在，请重新选择',
  FILE_TOO_LARGE: '文件超过 5MB',
  FILE_NOT_FOUND: '文件不存在或已被清理',
  FILE_NAME_CONFLICT: '同名文件过多，请先整理目录后重试',
  UPLOAD_DIR_FORBIDDEN: '该目录不允许访问',
  TMP_WRITE_FAILED: '临时空间写入失败，请重试',
  VALIDATION_FAILED: '参数不合法',
  SCHEMA_VALIDATION_FAILED: '参数校验未通过，请检查填写内容',
  INTERACTION_NOT_FOUND: '该调用确认已失效，请让数字人重新发起',
  INTERACTION_EXPIRED: '确认等待已超时，请让数字人重新发起',
  INTERNAL_ERROR: '系统繁忙，请稍后重试',
  SERVICE_UNAVAILABLE: '系统繁忙，请稍后重试',
  NETWORK_ERROR: '网络异常，请检查连接后重试',
  // 登录与注册（024 / 028）
  ADM_INVALID_CREDENTIALS: '账号或密码错误',
  ADM_UNAUTHENTICATED: '登录已失效，请重新登录',
  ADM_INVALID_LINK: '注册链接无效或已过期，请联系管理员重新获取',
  ADM_PHONE_TAKEN: '该手机号已注册，请直接登录',
  // 2026-10-27：运行环境新增的两个"非崩溃"失败码（此前会走兜底把内部码曝给用户）
  PROMPT_BUILD_FAILED: '读取会话上下文失败，请重试',
  HISTORY_WRITE_FAILED: '本轮内容未能保存，请重试',
  FILE_SIGN_INVALID: '文件链接已失效，请重新打开',
  SCENARIO_NOT_CONFIGURED: '场景未配置，请联系管理员',
  RUN_CANCELLED: '本轮已停止',
  LLM_UNAVAILABLE: '模型服务暂时不可用，请稍后重试',
  LLM_RATE_LIMITED: '模型调用过于频繁，请稍后重试',
  LLM_INSUFFICIENT_BALANCE: '模型账户余额不足，请联系管理员充值',
  LLM_UNAUTHORIZED: '模型凭证无效或无权限，请联系管理员检查 API Key',
  LLM_CONTEXT_TOO_LONG: '本轮上下文过长，请精简输入或新开会话',
}

const CONTEXT_MESSAGES: Readonly<
  Partial<Record<ErrorMessageContext, Readonly<Record<string, string>>>>
> = {
  'send-message': {
    // 并发上限（同一用户活跃回复 ≥ 3，跨数字人累计）——创建接口不限制会话总数
    THREAD_BUSY_LIMIT: '系统繁忙，请稍后重试',
    // 009 FR-052：降级必须用户可感知——发消息被拒时明确"数字人已不可用 + 怎么办"
    AGENT_NOT_AVAILABLE: '当前数字人已不可用，请选择其他数字人后重试',
  },
  'create-thread': {
    AGENT_NOT_AVAILABLE: '当前数字人已不可用，请重新选择数字人',
  },
  upload: {
    VALIDATION_FAILED: '文件格式不支持',
    FILE_TOO_LARGE: '文件超过 5MB',
    UPLOAD_DIR_FORBIDDEN: '该目录不允许上传',
    // 同名候选名用尽（012）：不是"格式不支持"，必须给出可操作的下一步
    FILE_NAME_CONFLICT: '同名文件过多，请先整理目录后重试',
  },
  preview: {
    FILE_TOO_LARGE: '文件过大，请下载查看',
    FILE_NOT_FOUND: '文件不存在或已被清理',
    UPLOAD_DIR_FORBIDDEN: '该目录不支持预览',
    VALIDATION_FAILED: '参数非法',
  },
}

export function toUserMessage(
  error: ErrorInfo | null | undefined,
  context: ErrorMessageContext = 'default',
): string {
  const code = error?.code
  if (!code) {
    return GENERIC_MESSAGE
  }

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

  // 展示的是后端生成的**逐条原因**（details），不是后端 `message`；缺失时给固定兜底。
  if (code === 'ONTOLOGY_RULE_DENIED') {
    const details = error.details
    if (
      Array.isArray(details) &&
      details.length > 0 &&
      details.every((item) => typeof item === 'string')
    ) {
      return (details as string[]).join('\n')
    }
    return '本体行为未通过规则校验，本轮已中止'
  }

  const scoped = CONTEXT_MESSAGES[context]?.[code]
  if (scoped) {
    return scoped
  }

  const base = BASE_MESSAGES[code]
  if (base) {
    return base
  }

  return `${GENERIC_MESSAGE}（${code}）`
}

export function formatErrorDiagnostics(error: ErrorInfo | null | undefined): string | null {
  if (!error) {
    return null
  }

  const parts: string[] = []
  if (typeof error.upstream_status === 'number') {
    parts.push(`上游 ${error.upstream_status}`)
  }
  if (error.upstream_type) {
    parts.push(`上游类型 ${error.upstream_type}`)
  }
  if (error.request_id) {
    parts.push(`请求 ID ${error.request_id}`)
  }
  if (parts.length === 0) {
    return null
  }

  return error.code ? [error.code, ...parts].join(' · ') : parts.join(' · ')
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown; details?: unknown }
    if (typeof record.code === 'string' && record.code !== '') {
      return {
        code: record.code,
        message: typeof record.message === 'string' ? record.message : '',
        details: record.details,
      }
    }
  }

  if (error instanceof Error) {
    return { code: 'NETWORK_ERROR', message: error.message }
  }

  return { code: 'INTERNAL_ERROR', message: '' }
}

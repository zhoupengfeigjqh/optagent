/**
 * 错误码常量与中文文案映射表（唯一映射表）。
 *
 * 与 `contracts/admin-api.md` §0.4 的 **24 个**错误码逐行对应：
 * 4 个复用既有码 + 20 个 `ADM_` 前缀码。前端 MUST NOT 直接展示后端 `message`
 * （面向开发者且不稳定），一律按 `code` 分派。
 *
 * 未知码回退通用文案并**保留原码**，便于排查。
 */

/** 全部错误码常量（与契约 §0.4 一一对应） */
export const ADMIN_ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  ADM_AGENT_NAME_TAKEN: 'ADM_AGENT_NAME_TAKEN',
  ADM_AGENT_IN_USE: 'ADM_AGENT_IN_USE',
  ADM_AGENT_INVALID_REF: 'ADM_AGENT_INVALID_REF',
  ADM_AGENT_NOT_FOUND: 'ADM_AGENT_NOT_FOUND',

  ADM_SKILL_NAME_TAKEN: 'ADM_SKILL_NAME_TAKEN',
  ADM_SKILL_ARCHIVE_INVALID: 'ADM_SKILL_ARCHIVE_INVALID',
  ADM_SKILL_ARCHIVE_UNSAFE: 'ADM_SKILL_ARCHIVE_UNSAFE',
  ADM_SKILL_NOT_FOUND: 'ADM_SKILL_NOT_FOUND',

  ADM_MCP_SERVICE_NOT_FOUND: 'ADM_MCP_SERVICE_NOT_FOUND',
  ADM_MCP_SERVICE_UNMANAGED: 'ADM_MCP_SERVICE_UNMANAGED',

  ADM_RUNTIME_FORM_NOT_CONFIGURED: 'ADM_RUNTIME_FORM_NOT_CONFIGURED',
  ADM_DEPLOY_VALIDATION_FAILED: 'ADM_DEPLOY_VALIDATION_FAILED',
  ADM_DEPLOY_TARGET_NOT_WRITABLE: 'ADM_DEPLOY_TARGET_NOT_WRITABLE',

  ADM_USER_ID_TAKEN: 'ADM_USER_ID_TAKEN',
  ADM_USER_NOT_FOUND: 'ADM_USER_NOT_FOUND',

  ADM_CONFIG_REVISION_CONFLICT: 'ADM_CONFIG_REVISION_CONFLICT',
  ADM_DOCKER_UNAVAILABLE: 'ADM_DOCKER_UNAVAILABLE',
  ADM_COMPOSE_FILE_UNREADABLE: 'ADM_COMPOSE_FILE_UNREADABLE',
  ADM_STORAGE_UNAVAILABLE: 'ADM_STORAGE_UNAVAILABLE',
  ADM_RUNTIME_UNREACHABLE: 'ADM_RUNTIME_UNREACHABLE',
} as const

/** 通用兜底文案 */
export const GENERIC_MESSAGE = '请求失败，请稍后重试'

/** 错误码 → 中文文案（与契约 §0.4 的"含义"列同口径，措辞面向管理员） */
export const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: '填写内容不合法，请检查后重试',
  NOT_FOUND: '请求的内容不存在',
  INTERNAL_ERROR: '系统繁忙，请稍后重试',
  SERVICE_UNAVAILABLE: '依赖服务暂不可用，请稍后重试',

  ADM_AGENT_NAME_TAKEN: '数字人名称已存在或非法，请换一个名称',
  ADM_AGENT_IN_USE: '该数字人已被用户关联，请先解除关联',
  ADM_AGENT_INVALID_REF: '数字人引用了清单外的内置工具／MCP 服务／SKILL',
  ADM_AGENT_NOT_FOUND: '数字人不存在或配置异常',

  ADM_SKILL_NAME_TAKEN: 'SKILL 名称与库中已有项冲突，请显式选择覆盖或取消',
  ADM_SKILL_ARCHIVE_INVALID: '压缩包格式不符：需含 SKILL.md 且元数据含 name 与 description',
  ADM_SKILL_ARCHIVE_UNSAFE: '压缩包存在安全风险（越界路径／符号链接／超出大小或层级限制）',
  ADM_SKILL_NOT_FOUND: '共享技能库中不存在该 SKILL',

  ADM_MCP_SERVICE_NOT_FOUND: 'MCP 服务不存在',
  ADM_MCP_SERVICE_UNMANAGED: '该服务不在容器编排声明内，不允许启停',

  ADM_RUNTIME_FORM_NOT_CONFIGURED: '有 MCP 服务缺少当前目标运行形态的连接地址，请先补齐',
  ADM_DEPLOY_VALIDATION_FAILED: '部署前校验未通过，已阻止部署，请按错误清单逐条修复',
  ADM_DEPLOY_TARGET_NOT_WRITABLE: '部署目标位置不可写，请检查目录权限',

  ADM_USER_ID_TAKEN: '用户标识已存在或非法，请换一个标识',
  ADM_USER_NOT_FOUND: '用户不存在',

  // 同时用于调用配置保存与技能文件保存：两者都是"内容被并发改过"，文案不偏向任一方
  ADM_CONFIG_REVISION_CONFLICT: '内容已被他处修改，请刷新后重试',
  ADM_DOCKER_UNAVAILABLE: '无法访问宿主机 Docker，请确认 Docker 已启动且 socket 已挂载',
  ADM_COMPOSE_FILE_UNREADABLE: '无法读取容器编排声明，请确认 docker-compose.yml 已挂载',
  ADM_STORAGE_UNAVAILABLE: '平台设计态存储不可写，请检查 .platform-data 目录',
  ADM_RUNTIME_UNREACHABLE: '运行环境不可达（内置工具目录／调用统计读取失败）',
}

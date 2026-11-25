/**
 * 账号域存储端口（028 阶段 2/3）：数字人服务 / 专属注册链接 / 用户授权。
 *
 * 与 `UserLinkPort`（users/sessions）平行的第三块账号域存储，同样
 * `file`（JSON 集合，`.platform-data/accounts/`）/ `mysql`（三张表）双驱动。
 *
 * 读写口径：
 * - 本端口**全部异步**——消费方只有新增路由（`auth` / `grants` /
 *   `register-links` / `agent-services`），没有 `Deployer` 那类同步消费方，
 *   无需内存投影换同步读；
 * - 语义约定由上层服务（`agent-services.ts` 等）负责，端口只做存取；
 * - 时间戳统一为 MySQL `DATETIME(3)` 字符串形态（`YYYY-MM-DD HH:MM:SS.mmm`，
 *   本地时区），file 驱动同格式——两侧展示一致、迁移无损。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

export interface AgentServiceRecord {
  /** 数字人编码（如 `DH-BOM001`），全局唯一，注册链接与授权记录引用它 */
  code: string;
  /** 展示名称 */
  name: string;
  /** 平台设计态数字人名称 = 部署落点（`.platform-data/agents/{name}.json`） */
  platform_agent_name: string;
  status: 'enabled' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface RegisterLinkRecord {
  /** 高熵 token（`randomBytes(24).toString('base64url')`），URL query 携带 */
  token: string;
  agent_code: string;
  /** 创建者（管理员 user_id）；未启用登录鉴权阶段为 null */
  created_by: string | null;
  /** 过期时间；null = 长期有效 */
  expires_at: string | null;
  /** 软撤销时间；null = 未撤销 */
  revoked_at: string | null;
  use_count: number;
  created_at: string;
}

/** 授权三态：行不存在 = 未申请（原型 `auth[rid] === 'none'`） */
export type GrantStatus = 'approved' | 'pending' | 'revoked';

export interface GrantRecord {
  user_id: string;
  agent_code: string;
  status: GrantStatus;
  source: 'register_link' | 'apply' | 'manual';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountStorePort {
  /** 启动期加载（wiring 时调用；mysql 驱动失败 = 拒绝启动） */
  init(): Promise<void>;

  /* ---- 数字人服务 ---- */
  listAgentServices(): Promise<AgentServiceRecord[]>;
  findAgentService(code: string): Promise<AgentServiceRecord | null>;
  /** upsert（按 code）；唯一冲突由调用方语义决定（create 已由上层预检） */
  saveAgentService(record: AgentServiceRecord): Promise<void>;
  removeAgentService(code: string): Promise<void>;

  /* ---- 专属注册链接 ---- */
  listRegisterLinks(): Promise<RegisterLinkRecord[]>;
  findRegisterLink(token: string): Promise<RegisterLinkRecord | null>;
  saveRegisterLink(record: RegisterLinkRecord): Promise<void>;

  /* ---- 用户 × 数字人服务授权 ---- */
  listGrants(): Promise<GrantRecord[]>;
  findGrant(userId: string, agentCode: string): Promise<GrantRecord | null>;
  /** upsert（按 `(user_id, agent_code)`） */
  saveGrant(record: GrantRecord): Promise<void>;
  /** 删除用户时级联清理其授权（mysql 侧由 FK CASCADE 兜底，file 侧必须显式做） */
  removeGrantsOfUser(userId: string): Promise<void>;
}

/* ---------------- 共享校验与工具（file / mysql 两实现与路由共用） ---------------- */

/** 数字人服务编码形态：3~32 位大写字母/数字/连字符（如 `DH-BOM001`） */
export const AGENT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

export function normalizeAgentCode(raw: unknown, field = 'agent_code'): string {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!AGENT_CODE_PATTERN.test(code)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} 须为 3~32 位大写字母/数字/连字符（如 DH-BOM001）`,
    );
  }
  return code;
}

export function requireAgentServiceName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length < 1 || raw.trim().length > 128) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '服务名称长度须为 1~128 个字符');
  }
  return raw.trim();
}

export function requirePlatformAgentName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'platform_agent_name 必填（平台设计态数字人名称）');
  }
  return raw.trim();
}

/**
 * 当前时间的 MySQL `DATETIME(3)` 字符串形态（本地时区）。
 *
 * 与连接池的 `dateStrings: true`（本地时区读出）配套，读写同一口径，
 * 避免 UTC 写入 + 本地读出的 8 小时漂移。
 */
export function nowDatetime(): string {
  const d = new Date();
  const pad = (value: number, len = 2): string => String(value).padStart(len, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** 秒数 → 未来时间戳（`DATETIME(3)` 字符串）；`null` 表示长期有效 */
export function datetimeAfter(seconds: number): string {
  const d = new Date(Date.now() + seconds * 1000);
  const pad = (value: number, len = 2): string => String(value).padStart(len, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** 时间字符串比较（同为 `YYYY-MM-DD HH:MM:SS.mmm` 形态时字典序即时间序） */
export function isExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && expiresAt <= nowDatetime();
}

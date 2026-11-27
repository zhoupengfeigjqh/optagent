/**
 * 账号域在 `.platform-data/` 下的落盘路径（**file 驱动唯一来源**）。
 *
 * 028 结构收敛（2026-11-27）：账号域统一收进 `accounts/`。此前 `users/` 与
 * `sessions/` 平铺在 `.platform-data/` 根下，与运行端 `.opt-agent/users/`
 * （`OPT_AGENT_ROOT`，另一个概念）同名，读代码时极易混淆。
 *
 * 只有 `STORAGE_DRIVER=file` 使用这些路径；`mysql` 驱动是五张表，无目录概念，
 * 故本文件**不得**被 mysql 实现引用。
 *
 * 结构迁移：`npm run migrate:accounts-layout`（复制 + 校验，**不删**旧目录）。
 */
/** 账号域根目录（`users/` · `sessions/` · 两份集合文件都挂在它下面） */
export const ACCOUNTS_DIR = 'accounts';

/** 用户主档：`accounts/users/{uid}.json`（迁移前：`users/{uid}.json`） */
export const USERS_DIR = `${ACCOUNTS_DIR}/users`;

/** 会话登记：`accounts/sessions/{uid}.json`（迁移前：`sessions/{uid}.json`） */
export const SESSIONS_DIR = `${ACCOUNTS_DIR}/sessions`;

/** 数字人服务集合（mysql：`agent_services` 表） */
export const AGENT_SERVICES_FILE = `${ACCOUNTS_DIR}/agent-services.json`;

/** 专属注册链接集合（mysql：`register_links` 表） */
export const REGISTER_LINKS_FILE = `${ACCOUNTS_DIR}/register-links.json`;

// `user-agent-grants.json` 已于 2026-11-27 随「授权 = 关联」彻底移除：
// 授权清单就是 `users.agents[]`，不再有独立授权集合，迁移脚本也一并删除。

/**
 * 结构收敛前的历史目录，仅供**迁移脚本**与启动期告警读取。
 * 业务代码 MUST NOT 再从这些路径读写（否则等于把兼容期无限延长）。
 */
export const LEGACY_USERS_DIR = 'users';
export const LEGACY_SESSIONS_DIR = 'sessions';

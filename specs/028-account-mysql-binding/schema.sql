-- =============================================================================
-- OptAgent 特性 028：账号域 MySQL 表结构
-- 分析基线：分支 ncc-1124 @ c20b79f
-- MySQL 8.0+ / InnoDB / utf8mb4
--
-- 边界：仅账号域入库。数字人设计态、SKILL、MCP、本体、部署清单与
--       meta.json 的 revision 乐观锁仍留在 admin-backend/.platform-data/。
--       2026-11-27：授权与关联合并——`users.agents[]` 既是「允许部署什么」也是
--       「授权了什么」；`user_agent_grants` 表已下线（旧库可保留作历史审计）。
-- 配套文档：同目录 方案与契约.md
-- 可重复执行：全部 CREATE ... IF NOT EXISTS + INSERT IGNORE
-- =============================================================================

CREATE DATABASE IF NOT EXISTS optagent
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE optagent;

-- -----------------------------------------------------------------------------
-- 数字人服务基本信息（编码 + 名称 + 平台落点）
-- platform_agent_name 必须等于 .platform-data/agents/{name}.json 的 name，
-- 否则授权记录无法在部署时物化，绑定即空转。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_services (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                 VARCHAR(32)     NOT NULL                COMMENT '数字人编码，如 DH-BOM001；注册链接携带',
  name                 VARCHAR(128)    NOT NULL                COMMENT '展示名称',
  platform_agent_name  VARCHAR(128)    NOT NULL                COMMENT '平台设计态数字人名称，部署落点',
  status               ENUM('enabled','disabled') NOT NULL DEFAULT 'enabled',
  created_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_agent_services_code (code),
  KEY idx_agent_services_platform (platform_agent_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数字人服务基本信息';

-- -----------------------------------------------------------------------------
-- 账号
--   user_id  = JWT sub / 运行端 .opt-agent/users/{uid} 目录名（不是手机号）
--   phone    = 登录标识；允许 NULL 且唯一索引允许多 NULL，兼容 024 存量无手机号用户
--   agents   = 授权 = 关联（2026-11-27 起唯一真相源）。
--              既决定「授权了什么」，也决定「部署什么」；工作台切换列表还需
--              与部署清单（manifest.agent_names）取交集才下发。
--   password_record = scrypt 记录 {algo,params,salt,hash}，与 domain/auth/password.ts 一一对应
--                     NULL = 不可登录（024 FR-013 口径）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            VARCHAR(64)     NOT NULL                COMMENT '内部主键，JWT sub',
  phone              VARCHAR(20)     DEFAULT NULL            COMMENT '11 位手机号；存量用户可为 NULL',
  agents             JSON            NOT NULL DEFAULT (JSON_ARRAY()) COMMENT '部署关联数字人清单（users.agents[] 投影）',
  display_name       VARCHAR(64)     NOT NULL DEFAULT ''     COMMENT '用户名',
  password_record    JSON            DEFAULT NULL            COMMENT 'scrypt 摘要；NULL = 不可登录',
  role               ENUM('admin','user') NOT NULL DEFAULT 'user',
  status             ENUM('active','disabled') NOT NULL DEFAULT 'active',
  source_agent_code  VARCHAR(32)     DEFAULT NULL            COMMENT '注册来源数字人编码',
  created_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_user_id (user_id),
  UNIQUE KEY uk_users_phone (phone),
  KEY idx_users_source (source_agent_code),
  CONSTRAINT fk_users_source FOREIGN KEY (source_agent_code)
    REFERENCES agent_services (code) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='账号';

-- -----------------------------------------------------------------------------
-- 专属注册链接（原型：数字人卡片 → 生成注册链接）
--   token   = randomBytes(24).toString('base64url')，高熵
--   有效   = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW(3))
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS register_links (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token        VARCHAR(64)     NOT NULL                COMMENT '高熵随机串，URL query 携带',
  agent_code   VARCHAR(32)     NOT NULL,
  created_by   VARCHAR(64)     DEFAULT NULL            COMMENT '管理员 user_id',
  expires_at   DATETIME(3)     DEFAULT NULL            COMMENT 'NULL = 长期有效',
  revoked_at   DATETIME(3)     DEFAULT NULL            COMMENT '软撤销',
  use_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_register_links_token (token),
  KEY idx_register_links_agent (agent_code),
  KEY idx_register_links_valid (revoked_at, expires_at),
  CONSTRAINT fk_register_links_agent FOREIGN KEY (agent_code)
    REFERENCES agent_services (code) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='专属注册链接';

-- -----------------------------------------------------------------------------
-- 用户 × 数字人服务授权：**已彻底移除**（2026-11-27）
--   授权 = 关联 = `users.agents[]`，不再有独立的授权表；仓库内也不再保留迁移脚本
--   （`grants-agents-migration` / `npm run migrate:grants-to-agents` 同批删除）。
--   旧库如已建 `user_agent_grants`，由 DBA 自行 DROP 或留档，本仓库不再读写。
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 单会话登记（替代 .platform-data/sessions/{uid}.json）
--   一个账号仅一行：登录覆盖、登出/删用户/重置密码时删除
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  user_id     VARCHAR(64)  NOT NULL,
  session_id  VARCHAR(64)  NOT NULL COMMENT 'JWT jti',
  issued_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='单会话登记（后登踢前登）';

-- -----------------------------------------------------------------------------
-- 初始化：原型 5 个数字人 → 平台现有设计态名称
-- 已核对 ncc-1124 的 admin-backend/.platform-data/agents/ 下正好是这 5 个同名文件。
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO agent_services (code, name, platform_agent_name) VALUES
  ('DH-KKB0M7', '柯昆BOM数字人', '柯昆BOM数字人'),
  ('DH-SCHED2', '生产调度测试', '生产调度测试'),
  ('DH-PLAN5',  '生产计划助手', '生产计划助手'),
  ('DH-FRESH9', '生鲜识别辅助', '生鲜识别辅助'),
  ('DH-BOM001', 'BOM数字人',   'BOM数字人');

-- -----------------------------------------------------------------------------
-- 迁移校验参考（由 scripts/migrate-to-mysql.ts 执行后再跑，人工核对）
--   基线 c20b79f 的存量：
--     .platform-data/users/     → admin.json, test007.json, test008.json, test009.json（4 个）
--     .platform-data/sessions/  → admin.json（1 个）
--   SELECT COUNT(*) FROM users;                                  -- 期望 4
--   SELECT COUNT(*) FROM sessions;                               -- 期望 1
--   授权已并入 users.agents[]：核对 `SELECT user_id, JSON_LENGTH(agents) FROM users;`
--   与工作台切换列表（需已部署）是否一致。
-- =============================================================================

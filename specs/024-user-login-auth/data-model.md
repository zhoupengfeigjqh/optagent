# 数据模型：用户登录与鉴权

**特性**：`024-user-login-auth` | **日期**：2026-11-17

## 1. 用户记录（admin-backend `.platform-data/users/{user_id}.json`）

既有文档（`UserLinkDocument`）新增 `password` 字段；`user_id` 与 `agents` 语义不变。

```jsonc
{
  "user_id": "admin",
  "agents": ["demo"],
  "password": {                       // 新增；存量用户缺失该字段 = 不可登录
    "algo": "scrypt",
    "params": { "N": 16384, "r": 8, "p": 1 },
    "salt": "<base64，随机 16 字节>",
    "hash": "<base64>"
  }
}
```

**校验规则**：

| 字段 | 规则 |
|---|---|
| `user_id` | 沿用 `isSafeName`（非空、无路径分隔符、无 `..`） |
| `password`（明文入参） | 6~128 字符、非空、不含控制字符；**只做长度与空值校验，不强制字符集复杂度**（可后续收紧） |
| `password.algo` | 仅 `scrypt`（未来可扩展 `argon2`，读取时按 `algo` 分派） |

**不变量**：
- 密码明文/可还原明文的材料（盐、哈希除外）MUST NOT 出现在任何接口响应、用户列表/详情、审计日志、错误提示（`FR-002`、`SC-006`）。
- `password` 字段 MUST NOT 被部署物化到 `.opt-agent/users/**`（部署 §6.6 只物化数字人配置）。

## 2. 登录凭据（JWT，无状态 + 每账号当前会话登记）

| claim | 值 | 说明 |
|---|---|---|
| `sub` | 用户标识 | 登录后"当前用户"身份的唯一来源 |
| `jti` | 会话标识（随机） | 单会话判定：与平台侧"当前会话"比对，不一致即被踢 |
| `iss` | `optagent-admin` | 签发方 |
| `aud` | `optagent-agent` | 受众（运行环境） |
| `iat` | 签发时间（Unix 秒） | — |
| `exp` | 过期时间（Unix 秒） | `iat + TTL`，默认 7 天，可配置 |

- 签名：HS256，共享密钥 `AUTH_SECRET`。**真源按形态各一处、两侧必须同值**（2026-11-18 收敛，方案 A）：容器形态 = `admin-backend/.env` ↔ `agent-backend/.env.local`；本地形态 = 两份 `.env.local`。`agent-backend/.env` 不再承载该变量（compose 的 env_file 顺序会让 `.env.local` 覆盖它，写在那里等于没写）。
- 载体：HttpOnly Cookie `optagent_auth`，`Path=/`，`SameSite=Lax`，`Max-Age=TTL`；不设 `Secure`（内网明文 HTTP）。
- 每账号"当前唯一会话标识"登记于 `.platform-data/sessions/{user_id}.json`；新登录覆盖旧会话（后登踢前登），登出/删除用户清除之，旧凭据随即失效。

## 3. 登录态与单会话生命周期

```text
未登录 ──登录成功──► 已登录（持有效 Cookie，且为该账号当前会话）
   ▲                      │
   │                      │ 登出 / Cookie 过期 / 401 / 被新登录踢下线（SESSION_REVOKED）
   └──────────────────────┘
```

- **探针**：`GET /api/admin/auth/me` → 200 `{ user_id }`（已登录）/ 401（未登录）。
- **单会话判定**：运行侧验签后经会话内省比对 `jti` 与平台侧"当前会话"；不一致 → 401 `SESSION_REVOKED`（"已在其它设备登录"）。
- **前端登录态**：仅内存 `useAuth` 状态 + 探针记忆化；不写 localStorage（凭据在 HttpOnly Cookie，前端不可读）。

## 4. 鉴权边界（运行侧）

| 端点类别 | 鉴权 | 身份注入 |
|---|---|---|
| 平台级只读投影：`/api/monitor/health`、`/api/monitor/agents`、`/api/builtin-tools`、`/api/mcp-call-stats` | 免鉴权（白名单） | 不注入 |
| 其余 `/api/*`（用户级：数字人、会话、文件、聊天、定时任务…） | 必须有效凭据，否则 401 | 注入 `sub` 为 `userId` |

## 5. 与既有实体关系

- **用户记录** ↔ **登录凭据**：一对一（单会话——同一账号同时只一个有效凭据，新登录覆盖旧会话）。
- **用户记录** ↔ **数字人数据域**：`sub`（即 `user_id`）决定 `users/{userId}/agents/**` 与 `users/{userId}/user-data/**` 的定位；登录后数据隔离由既有 `dirs.ts` 按 `userId` 分区自然生效，无新增实体。

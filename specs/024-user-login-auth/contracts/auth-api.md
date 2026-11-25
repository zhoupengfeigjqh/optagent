# 接口契约：登录与鉴权（auth-api）

**特性**：`024-user-login-auth` | **版本**：1.0 | **日期**：2026-11-17

本契约是登录与鉴权的**唯一契约来源**，约束 `admin-backend` / `agent-backend` / `frontend` 三侧。按宪章原则七，本文件与前端类型、后端 schema、测试用例**一一映射**，变更 MUST 四处同步。

## §0 通用约定

- 登录/探针/登出端点挂在 **admin-backend**（`/api/admin/auth/*`），由网关 `location /api/admin/` 分发。
- 请求/响应体 `application/json`；字段命名**下划线**。
- 错误体与既有完全一致：`{ error: { code, message, details? } }`。

## §1 凭据契约（Cookie + JWT）

| 项 | 值 |
|---|---|
| Cookie 名 | `optagent_auth` |
| 属性 | `HttpOnly`；`Path=/`；`SameSite=Lax`；`Max-Age=TTL`（登出/失效置 `0`）；**不设** `Secure`（内网明文 HTTP） |
| 算法 | JWT HS256，共享密钥 `AUTH_SECRET` |
| claims | `sub`（用户标识）、`jti`（会话标识，单会话判定）、`iss`=`optagent-admin`、`aud`=`optagent-agent`、`iat`、`exp` |
| 有效期 | 默认 7 天，`AUTH_TOKEN_TTL_SECONDS` 可配 |

## §2 端点

### 2.1 `POST /api/admin/auth/login`

**用途**：校验账号密码，签发登录凭据并以 HttpOnly Cookie 下发。

**请求体**：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `user_id` | string | 与 `phone` 二选一 | 非空（028 扩展前为唯一入口） |
| `phone` | string | 与 `user_id` 二选一 | 11 位手机号（028 扩展；命中后解析为 `user_id` 再验密码，`user_id` 优先） |
| `password` | string | ✅ | 6~128 字符 |

**响应 200**：`{ "user_id": "admin" }`，并 `Set-Cookie: optagent_auth=<jwt>; HttpOnly; Path=/; SameSite=Lax; Max-Age=<ttl>`。登录成功同时登记该账号"当前会话"并覆盖旧会话（后登踢前登）。**JWT `sub` 恒为 `user_id`**（不是手机号——028 D1，运行端目录划分依据）。

**错误码**：`VALIDATION_FAILED`（400，字段形状非法）、`ADM_INVALID_CREDENTIALS`（401，账号不存在/密码错误/存量无密码，**统一同一码同一文案，不枚举**）。

### 2.1.1 `POST /api/admin/auth/register`（028 扩展）

专属注册链接注册：`{ link_token, phone, display_name, password }` → **201** `{ user_id, phone, display_name, granted_agent: { code, name } }`。注册即 `approved` 授权；**不自动登录、不下发 Cookie**（与注册原型一致）。错误码：`ADM_INVALID_LINK`（400，不枚举）、`ADM_PHONE_TAKEN`（409）、`VALIDATION_FAILED`（400）。详见 `specs/028-account-mysql-binding/方案与契约.md` §4.1 与 001 契约 §13。

`GET /api/admin/auth/register-links/:token`（公开）：注册页渲染校验 → `{ agent: { code, name }, expired: false }`；无效统一 `ADM_INVALID_LINK`。

### 2.2 `GET /api/admin/auth/me`

**用途**：登录态探针（前端路由守卫的唯一来源）。

**响应 200**：`{ "user_id": "admin" }`（凭据有效）。028 扩展：响应**增** `phone` / `display_name` / `role`（`user_id` 字段保留，前端兼容）。

**错误码**：`ADM_UNAUTHENTICATED`（401，凭据缺失/无效）。

**028 扩展**：`GET /api/admin/auth/my-agents`（登录）返回当前用户已授权数字人（`{ items, pending }`，revoked 不下发），供对话工作台「切换数字人」渲染。

### 2.3 `POST /api/admin/auth/logout`

**用途**：登出，清除客户端凭据并撤销当前会话。

**响应 204**：无响应体，`Set-Cookie: optagent_auth=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`；同时清除该账号的会话登记。

**错误码**：无（幂等，未登录登出也成功）。

### 2.4 `GET /api/admin/auth/session/valid`

**用途**：会话内省（供 agent-backend 校验某会话是否仍为当前会话）。

**请求**：query `{ user_id, session_id }`。

**响应 200**：`{ "valid": true | false }`（免鉴权、只读）。

> 该端点为**服务内专用**（仅供运行侧内省），免鉴权、只读；`session_id` 为高熵随机值，作为"会话存在性 oracle"的风险可控，后续可随管理台鉴权在网关层收紧。

## §3 运行侧鉴权语义（agent-backend）

| 项 | 规定 |
|---|---|
| 白名单（免鉴权，不注入身份） | `GET /api/monitor/health`、`GET /api/monitor/agents`、`GET /api/builtin-tools`、`GET /api/mcp-call-stats`；**签名直链** `GET /api/files/raw`、`POST /api/files/put`（2026-11-18 补登：URL 即凭证，HMAC 绑定 u/p/exp，调用方是 MCP 服务容器、不带 Cookie；放行不降低安全性——签名校验在 handler 内独立完成。新增签名直链类端点 MUST 同步加入白名单） |
| 其余 `/api/*` | MUST 验签 Cookie `optagent_auth`（提取 `sub`/`jti`）→ 会话内省（1~2s 缓存）→ 仍为当前会话则注入 `sub`；缺失/无效/过期 → 401，响应 MUST NOT 含任何业务数据 |
| 被踢 | `jti` 非当前会话 → 401 `SESSION_REVOKED`（"已在其它设备登录"） |
| 内省不可达 | 放行 + 结构化告警（降级，单会话保证在平台故障窗口内临时放宽） |
| 错误码 | `UNAUTHENTICATED`（401）、`SESSION_REVOKED`（401） |
| 未配置 `AUTH_SECRET` | 鉴权钩子放行，`getCurrentUser()` 回退 `admin`（legacy 单用户回退；启动日志告警） |

## §4 错误码总表（本特性新增/启用）

| 错误码 | HTTP | 含义 | 侧 |
|---|---|---|---|
| `ADM_INVALID_CREDENTIALS` | 401 | 登录失败：账号不存在或密码错误（不枚举） | admin-backend |
| `ADM_UNAUTHENTICATED` | 401 | 凭据缺失或验签失败（`/me` 探针） | admin-backend（复用 §11 预登记） |
| `UNAUTHENTICATED` | 401 | 凭据缺失或验签失败（受保护资源） | agent-backend |
| `SESSION_REVOKED` | 401 | 会话已被新登录取代（单会话，被踢下线） | agent-backend |

## §5 前端契约

- **登录态唯一探针**：`GET /api/admin/auth/me`；路由守卫异步探针 + 记忆化。
- **401 分派**：`UNAUTHENTICATED` / `ADM_UNAUTHENTICATED` 触发"跳登录页"；`SESSION_REVOKED` 提示"已在其它设备登录"后跳登录；`ADM_INVALID_CREDENTIALS` 仅显示登录失败提示（不跳转）。
- **登出**：调 `/logout` 后清内存登录态并跳 `/login`。
- 前端 MUST NOT 读取/解析 `optagent_auth` Cookie（HttpOnly），MUST NOT 硬编码后端错误码文案（沿用 `utils/error-message.ts` 映射）。

## §6 与既有契约的登记关系

- `specs/001-digital-human-platform/contracts/admin-api.md`：§6.2 `POST /api/admin/users` 请求体新增 `password`；§9「鉴权」由"无"更新为"登录/鉴权见 auth-api"；§11 由"未实施"更新为"`ADM_UNAUTHENTICATED` 已启用（探针）"。
- `specs/001-digital-human-platform/contracts/runtime-api-delta.md`：登记运行侧鉴权语义（401 与白名单）。

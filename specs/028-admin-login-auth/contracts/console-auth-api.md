# 接口契约：管理平台登录授权（console-auth-api）

**特性**：`028-admin-login-auth` | **版本**：1.1 | **日期**：2026-11-23
**约束侧**：`admin-backend`（实现方）、`admin-frontend`（消费方）
**关系**：本文件是"管理平台（管理台）登录"的**唯一契约来源**；与 [`specs/001-digital-human-platform/contracts/admin-api.md`](../../001-digital-human-platform/contracts/admin-api.md) §11（身份与分权）、§12（登录鉴权）互为补充，与 [`specs/024-user-login-auth/contracts/auth-api.md`](../../024-user-login-auth/contracts/auth-api.md)（聊天前台业务使用者登录）**互不覆盖**。

## §0 通用约定

- 端点（均由管理服务提供，生产经网关 `location /api/admin/` 分发，**无需新增 nginx location**）：
  - `POST /api/admin/auth/admin-login` —— 管理员登录
  - `GET  /api/admin/auth/admin-me` —— 登录态探针
  - `POST /api/admin/auth/admin-logout` —— 退出登录
- **命名说明**：`admin-login` 直指"管理员登录"，与认证中心上游接口 `/api/auth/admin/login` 语义对齐但**不是同一个地址**（前者是同源平台入口，后者是服务端调用的上游）；模块名保留 `console`（控制台会话）前缀，用于与 024 的业务使用者登录区分。
- 请求/响应体 `application/json`；字段命名**下划线**（与既有管理接口一致）。
- 错误体与既有完全一致：`{ error: { code, message, details? } }`。
- 前端 MUST 按 `code` 分派文案，MUST NOT 直接展示 `message`。
- 所有端点**不受**管理接口守卫拦截（`/api/admin/auth/` 前缀放行），由端点自身校验。

## §1 凭据契约（Cookie `optagent_console`）

| 项 | 值 |
|---|---|
| Cookie 名 | `optagent_console`（**不得**与 024 的 `optagent_auth` 混用） |
| 属性 | `HttpOnly`；`Path=/`；`SameSite=Lax`；`Max-Age=<ttl>`（登出置 `0`）；**不设** `Secure`（内网明文 HTTP） |
| 令牌 | JWT HS256，密钥 = 既有 `AUTH_SECRET` |
| claims | `sub`（管理员账号）、`iss`=`optagent-admin`、`aud`=`optagent-admin-console`、`iat`、`exp` |
| 有效期 | `min(认证中心 expiresIn, AUTH_CONSOLE_TTL_SECONDS)`；上限默认 43200 秒 |
| 撤销 | 无服务端会话登记；登出即清 Cookie；不支持多端互踢 |

**与 024 的隔离**：`aud` 不同 → 024 的会话校验拒绝本凭据，本契约的校验拒绝 024 凭据；Cookie 名不同 → 同一浏览器可同时登录管理台与聊天前台，互不覆盖（规格 SC-009）。

## §2 端点

### 2.1 `POST /api/admin/auth/admin-login`

**用途**：管理员登录。校验委托认证中心（`POST {AUTH_CENTER_URL}/api/auth/admin/login`），本平台不比对密码。

**请求体**：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `username` | string | ✅ | 去空白后 1～64 字符 |
| `password` | string | ✅ | 1～128 字符 |

**上游调用**：`POST {AUTH_CENTER_URL}/api/auth/admin/login`，体 `{"username","password"}`，超时 `AUTH_CENTER_TIMEOUT_MS`（默认 5000）。

**成功（200）**：`{ "username": "admin" }`
并 `Set-Cookie: optagent_console=<jwt>; HttpOnly; Path=/; SameSite=Lax; Max-Age=<ttl>`

**失败**：

| 情形 | HTTP | code |
|---|---|---|
| 字段非法 | 400 | `VALIDATION_FAILED` |
| 认证中心 `code=401`（账号或密码错误） | 401 | `ADM_INVALID_CREDENTIALS` |
| 认证中心 `code=400` | 400 | `VALIDATION_FAILED` |
| 认证中心不可达 / 超时 / 非 JSON / 其它非 0 业务码 | 503 | `ADM_AUTH_CENTER_UNREACHABLE` |

> **不变量**：提示不区分"账号不存在"与"密码错误"（两者 MUST 返回同一 `ADM_INVALID_CREDENTIALS`）；响应、日志均不含密码；失败时**不下发** Cookie；本平台**不留存**认证中心返回的 `accessToken`（仅读取 `expiresIn` 用于确定会话上限）。

### 2.2 `GET /api/admin/auth/admin-me`

**用途**：登录态探针，前端守卫的唯一判定来源。

**成功（200）**：`{ "username": "admin" }`

**失败（401）**：`{ "error": { "code": "ADM_UNAUTHENTICATED", "message": "未登录" } }`（缺 Cookie / 验签失败 / 过期 / `aud` 不符，一律同一码）

### 2.3 `POST /api/admin/auth/admin-logout`

**用途**：退出登录（幂等）。

**成功（204）**：无响应体，`Set-Cookie: optagent_console=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`

**失败**：无（未登录登出同样 204）。**不**调用认证中心（其无管理员会话撤销接口）。

## §3 管理接口守卫（契约 §11 的落地）

| 项 | 规定 |
|---|---|
| 作用域 | 路径前缀 `/api/admin/`，**排除** `/api/admin/auth/` |
| 放行 | `OPTIONS`（CORS 预检） |
| 校验 | Cookie `optagent_console` 满足 §1 的身份校验规则 |
| 未认证 | 401，`{ error: { code: "ADM_UNAUTHENTICATED", message: "登录状态已失效，请重新登录" } }`，**不含任何业务数据** |
| 不变更 | 通过校验后，既有端点的请求/响应结构**零变化**；不新增角色判定（`ADM_FORBIDDEN` 仍预留） |
| 回滚 | 移除守卫钩子即恢复本期前行为（数据侧无残留） |

**例外说明**：`GET /api/admin/auth/session/valid`（024，供运行侧会话内省）与 024 的登录/探针/登出同在放行清单内——它们各自带语义校验，若被控制台守卫拦截会打断聊天前台登录。

## §4 前端消费契约

| 场景 | 前端行为 |
|---|---|
| 启动 | 调 `GET .../admin-me`；200 → 渲染应用外壳；401 → 登录页；网络失败 → 登录页并提示"无法校验登录状态，请重新登录" |
| 登录 | 提交前本地校验非空；请求中按钮禁用并显示"登录中"；成功后进入原目标页面 |
| 登录失败 | 按 `code` 映射文案（`ADM_INVALID_CREDENTIALS` / `ADM_AUTH_CENTER_UNREACHABLE` / `VALIDATION_FAILED`）；密码输入框内容清空，账号保留 |
| 任意业务请求 401 `ADM_UNAUTHENTICATED` | 清登录态、回登录页并提示"登录状态已失效，请重新登录"；该次操作不产生副作用 |
| 登出 | 二次确认后调 `POST .../admin-logout`，无论成功与否都清本地状态并回登录页 |

## §5 变更记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-11-23 | 1.0 | 首版：3 个端点 + Cookie/claims 契约 + `/api/admin/*` 守卫规则；认证中心契约以实测为准（HTTP 200 + 业务码） |
| 2026-11-23 | 1.1 | 端点路径按用户要求改为语义更明确的 `admin-login` / `admin-me` / `admin-logout`（原 `console/*`）；补充"平台入口 vs 认证中心上游接口"的命名说明；行为与凭据契约不变 |

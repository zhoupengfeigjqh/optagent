# 数据模型：数字人管理平台登录授权入口

**特性**：`028-admin-login-auth`　**日期**：2026-11-23　**契约**：[`contracts/console-auth-api.md`](./contracts/console-auth-api.md)

本期**不新增持久化数据**：管理员账号由认证中心持有，控制台会话是无状态签名凭据。本文件定义跨侧共享的数据形状、校验规则与状态流转，作为后端 schema / 前端类型 / 测试用例的唯一来源。

## 1. 实体

### 1.1 管理员登录请求（ConsoleLoginRequest）

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|---|---|---|---|---|
| `username` | string | ✅ | 去首尾空白后非空，长度 1～64 | 管理员账号（认证中心 `username`） |
| `password` | string | ✅ | 非空，长度 1～128 | 明文仅在传输中出现，**不落日志、不回显** |

- 前端在提交前做同一套非空校验（FR-002 / FR-014），服务端仍 MUST 独立校验（不信任前端）。
- 校验失败 → `VALIDATION_FAILED`(400)。

### 1.2 认证中心登录响应（AuthCenterLoginResponse，**外部契约，只读**）

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | number | `0` = 成功；`401` = 账号或密码错误；`400` = 参数校验失败；其它 = 未预期 |
| `message` | string | 面向开发者，**不直接展示给用户** |
| `data.accessToken` | string | 认证中心签发的管理员 JWT（`scope=admin`） |
| `data.expiresIn` | number | 有效期（秒），实测 `43200` |

- 实测：令牌用于认证中心自身管理接口会返回 `401 令牌类型不匹配`，故本平台**不使用**该令牌做后续校验（见 `research.md` D2）。

### 1.3 控制台会话（ConsoleSession，本平台签发）

| 项 | 值 |
|---|---|
| 载体 | Cookie `optagent_console`（`HttpOnly; Path=/; SameSite=Lax; Max-Age=<ttl>`） |
| 令牌 | JWT，HS256，密钥 = 既有 `AUTH_SECRET` |
| Claims | `sub`（管理员账号）、`iss`=`optagent-admin`、`aud`=`optagent-admin-console`、`iat`、`exp` |
| TTL | `min(expiresIn, AUTH_CONSOLE_TTL_SECONDS)`，上限默认 43200 秒 |
| 服务端状态 | 无（无会话登记、无撤销列表） |

**身份校验规则**（验签失败一律视为未认证，不区分原因，避免泄露细节）：

1. 令牌可验签（密钥一致、算法 HS256）；
2. `iss` = `optagent-admin` 且 `aud` = `optagent-admin-console`（据此与 024 的 `aud=optagent-agent` 凭据互不认账）；
3. `exp` 未过期；
4. `sub` 为非空字符串。

### 1.4 前端登录态（ConsoleAuthState）

| 状态 | 含义 | 界面表现 |
|---|---|---|
| `checking` | 启动探针进行中 | 居中"正在校验登录状态"（`role="status"`），不渲染任何管理内容 |
| `anonymous` | 未登录 / 已过期 / 已退出 | 只渲染登录页 |
| `authenticated` | 探针或登录成功 | 渲染应用外壳与当前功能区；外壳显示 `username` |

- `username` 仅在 `authenticated` 时有值；`anonymous` 时清空。
- 状态变更只能经由 `useConsoleAuth`（唯一来源，FR-018）。

## 2. 状态流转

```text
            启动
             │
             ▼
        ┌──────────┐   /me 200    ┌───────────────┐
        │ checking │─────────────▶│ authenticated │
        └──────────┘              └───────────────┘
             │ 401/网络失败              │        ▲
             ▼                          │ 登录成功 │
        ┌──────────┐   login 成功        │        │
        │anonymous │─────────────────────┘        │
        └──────────┘                              │
             ▲   ▲                                 │
             │   └──── 业务请求 401 ADM_UNAUTHENTICATED（过期/失效）
             │                                     │
             └──────────── 退出登录（二次确认，logout 204）
```

**约定**：

- 启动探针失败且为"网络不可达"时，按 `anonymous` 处理并在登录页提示"无法校验登录状态，请重新登录"——**不**放行（原则九：不假装正常）。
- 已 `authenticated` 时访问登录页无意义（登录页不暴露 URL），不产生"重复登录"路径。
- 退出登录幂等：未登录时调用登出也返回 204。

## 3. 服务端守卫的判定输入

| 输入 | 判定 |
|---|---|
| 请求方法 `OPTIONS` | 放行（CORS 预检） |
| 路径以 `/api/admin/auth/` 开头 | 放行（024 端点 + 本期控制台端点自身校验） |
| 路径以 `/api/admin/` 开头且无 `optagent_console` Cookie | 401 `ADM_UNAUTHENTICATED`，响应不含业务数据 |
| 同上但 Cookie 验签失败/过期/`aud` 不符 | 401 `ADM_UNAUTHENTICATED` |
| 其它路径（非 `/api/admin/`） | 不受本期守卫影响 |

## 4. 错误映射

| 触发 | HTTP | 错误码 | 前端文案 |
|---|---|---|---|
| 账号/密码字段非法 | 400 | `VALIDATION_FAILED` | 填写内容不合法，请检查后重试 |
| 认证中心判定账号或密码错误 | 401 | `ADM_INVALID_CREDENTIALS` | 账号或密码不正确，请重新输入 |
| 认证中心不可达/超时/非 JSON/其它业务码 | 503 | `ADM_AUTH_CENTER_UNREACHABLE` | 认证服务暂不可用，请稍后重试 |
| 管理接口缺凭据或凭据失效 | 401 | `ADM_UNAUTHENTICATED` | 登录状态已失效，请重新登录 |

> 文案措辞以 `admin-frontend/src/constants/error-messages.ts` 为准（前端 MUST NOT 直接展示后端 `message`）。

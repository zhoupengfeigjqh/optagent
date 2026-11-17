# 快速验证：用户登录与鉴权

**特性**：`024-user-login-auth` | **日期**：2026-11-17

本文件给出**端到端可运行验证场景**，证明登录与鉴权按预期工作。细节契约见 [contracts/auth-api.md](./contracts/auth-api.md)，数据模型见 [data-model.md](./data-model.md)。

## 前置条件

1. 四侧本地门禁已通过（各子项目 `package.json` 的单命令门禁）。
2. 环境变量已配置：
   - `admin-backend/.env(.local)`：`PLATFORM_DATA_DIR`、`OPT_AGENT_ROOT`、`AUTH_SECRET`（必填）、`AUTH_TOKEN_TTL_SECONDS`（可选）。
   - `agent-backend/.env(.local)`：`OPT_AGENT_ROOT`、`AUTH_SECRET`（**与 admin 侧一致**，可选——缺失即回退单用户模式）。
3. 服务已启动：admin-backend（`3001`）、agent-backend（`3000`）、frontend（`5173` dev / 网关 `82` prod）。

> 本地直连开发经 Vite 代理：`/api` → `3000`、`/api/admin` → `3001`（同源，Cookie 自动携带）。

## 场景 A：管理员新建用户并设置密码

1. 打开管理界面「数字人部署」→ 新建用户。
2. 填写用户标识（如 `zpf`）、勾选数字人、设置密码 `123456`（满足 6~128 位）。
3. 提交 → 创建成功；用户出现在列表。
4. 断言：`admin-backend/.platform-data/users/zpf.json` 含 `password` 字段且**无明文密码**。

## 场景 B：登录成功

```bash
# 以 cookie jar 保存凭据，供后续请求复用
curl -i -c /tmp/auth.jar -X POST http://localhost:3001/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"zpf","password":"123456"}'
```

- 期望：HTTP 200，响应体 `{"user_id":"zpf"}`；响应头含 `Set-Cookie: optagent_auth=...; HttpOnly; Path=/; SameSite=Lax; Max-Age=...`。

## 场景 C：探针与受保护请求

```bash
# 探针
curl -i -b /tmp/auth.jar http://localhost:3001/api/admin/auth/me
# 期望 200 {"user_id":"zpf"}

# 带凭据访问用户级端点（经网关或直连 agent-backend）
curl -i -b /tmp/auth.jar http://localhost:3000/api/agents
# 期望 200，且返回的是 zpf 数据域的数字人清单
```

## 场景 D：未登录被拦截（401 且不泄露业务数据）

```bash
curl -i http://localhost:3000/api/agents
curl -i http://localhost:3001/api/admin/auth/me
```

- 期望：均 401；错误码分别为 `UNAUTHENTICATED` / `ADM_UNAUTHENTICATED`；响应体仅错误 envelope，无任何业务数据。

## 场景 E：白名单放行

```bash
curl -i http://localhost:3000/api/monitor/health
curl -i http://localhost:3000/api/builtin-tools
```

- 期望：200（无需凭据，平台级只读投影）。

## 场景 F：登录失败不枚举

```bash
curl -i -X POST http://localhost:3001/api/admin/auth/login \
  -H 'Content-Type: application/json' -d '{"user_id":"不存在的账号","password":"x"}'
curl -i -X POST http://localhost:3001/api/admin/auth/login \
  -H 'Content-Type: application/json' -d '{"user_id":"zpf","password":"wrong"}'
```

- 期望：两者**同一**错误码 `ADM_INVALID_CREDENTIALS`、同一文案，无法区分账号是否存在。

## 场景 G：登出

```bash
curl -i -b /tmp/auth.jar -X POST http://localhost:3001/api/admin/auth/logout
# 期望 204 + Set-Cookie Max-Age=0
curl -i -b /tmp/auth.jar http://localhost:3000/api/agents
# 期望 401（凭据已清除）
```

## 场景 H：聊天前台页面级验证

1. 未登录直接打开聊天前台（`http://localhost:82/`）→ 被重定向到 `/login`。
2. 用 `zpf` / `123456` 登录 → 进入工作台，仅看到分配给 `zpf` 的数字人。
3. 用另一个账号（如 `admin`）登录 → 数据与 `zpf` 互不可见。
4. 点登出 → 回登录页；再访问 `/` 被拦截。

## 场景 I：登录态过期

- 临时把 `AUTH_TOKEN_TTL_SECONDS` 调小（如 5 秒）重启 admin-backend 后重登，等待过期后发起受保护请求 → 401，前端引导重新登录。

## 场景 J：互踢（后登踢前登）

```bash
# 设备 1 登录
curl -i -c /tmp/auth1.jar -X POST http://localhost:3001/api/admin/auth/login \
  -H 'Content-Type: application/json' -d '{"user_id":"zpf","password":"123456"}'
# 设备 2 用同一账号登录（覆盖旧会话）
curl -i -c /tmp/auth2.jar -X POST http://localhost:3001/api/admin/auth/login \
  -H 'Content-Type: application/json' -d '{"user_id":"zpf","password":"123456"}'
# 设备 1 再访问受保护端点 → 被踢
curl -i -b /tmp/auth1.jar http://localhost:3000/api/agents
```

- 期望：设备 2 登录后，设备 1 的后续请求返回 401 `SESSION_REVOKED`（"已在其它设备登录"）；设备 2 正常访问。

## 排障

| 症状 | 排查 |
|---|---|
| 登录成功但聊天全 401 | 两侧 `AUTH_SECRET` 不一致 → 核对 compose/.env 单密钥来源 |
| agent 侧未配 `AUTH_SECRET` 却未报 401 | 属预期回退（单用户模式）；查看 agent 启动日志的告警 |
| Cookie 不自动携带 | 确认同源访问（经网关/代理），勿直连跨端口；确认 `Path=/`、未误设 `Secure` |
| 密码明文出现在某处 | grep `password` 遍历响应与日志，核对 `FR-002` / `SC-006` |
| 被踢后仍能访问 | 检查运行侧会话内省缓存 TTL 是否 ≤2s；确认平台侧会话登记被新登录覆盖 |

## 边界提示

- 本验证在**内网明文 HTTP**下进行（Cookie 未设 `Secure`）；对外暴露前必须补 TLS 并设 `Secure`。
- 冒烟只确认"部署可用"，不作为测试结论；测试结论以四侧本地门禁为准。

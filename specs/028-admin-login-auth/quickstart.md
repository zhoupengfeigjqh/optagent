# 快速验证指南：数字人管理平台登录授权入口

**特性**：`028-admin-login-auth`　**日期**：2026-11-23
**前置**：规格 [`spec.md`](./spec.md)、契约 [`contracts/console-auth-api.md`](./contracts/console-auth-api.md)、数据模型 [`data-model.md`](./data-model.md)

本文件只描述**如何跑起来并证明功能可用**，实现细节见 `tasks.md` 与代码。

## 1. 前置条件

| 项 | 要求 |
|---|---|
| 认证中心 | `http://192.168.0.156:8999/dh-auth-center` 可达；管理员账号 `admin` / `123456` 已注册 |
| Node | ≥ 20（两端一致） |
| 本地配置 | `admin-backend/.env.local` 存在（首次：`cp .env.example .env.local`），并含：`AUTH_SECRET`（≥16 字符）、`AUTH_CENTER_URL=http://192.168.0.156:8999/dh-auth-center` |
| 测试环境 | **宿主机本地**执行（宪章原则三：容器不承担测试职责） |

## 2. 本地启动

```bash
# 终端 A：管理服务（默认 3001）
cd admin-backend
npm run dev

# 终端 B：管理界面（默认 5174，dev 期 /api/admin → 127.0.0.1:3001）
cd admin-frontend
npm run dev
# 打开 http://localhost:5174/admin/
```

## 3. 验收场景（手工，逐条对应规格用户故事）

| # | 操作 | 预期 |
|---|---|---|
| 1 | 清空 Cookie 后打开 `http://localhost:5174/admin/` | 只看到登录页（品牌区 +「管理员登录」+ 账号 + 密码 + 登录按钮），看不到任何管理内容 |
| 2 | 直接打开 `http://localhost:5174/admin/deploy?tab=history` | 先见登录页；登录成功后**落在部署页历史分区**（原路径保留） |
| 3 | 输入错误密码提交 | 提示"账号或密码不正确，请重新输入"；账号保留、密码清空；仍停留登录页 |
| 4 | 输入 `admin` / 123456 提交 | 进入管理台，页头显示当前账号与「退出登录」；5 个功能区均可正常打开 |
| 5 | 刷新页面 / 新标签页打开 `/admin/` | 保持登录，不再要求输入密码 |
| 6 | 仅用键盘：Tab → 输入账号 → Tab → 输入密码 → Enter | 可完成登录；焦点环可见；密码显隐按钮可 Tab 到并用 Enter 触发 |
| 7 | 点击「退出登录」 | 先出二次确认；确认后回到登录页；浏览器**后退**不会回到管理页面 |
| 8 | 停掉认证中心网络（或把 `AUTH_CENTER_URL` 指向不可达地址后重启服务）再登录 | 提示"认证服务暂不可用，请稍后重试"，不进入管理台 |
| 9 | 在聊天前台（`frontend`）登录同一浏览器 | 两侧登录态互不影响：退出管理台后聊天前台仍在线，反之亦然 |

## 4. 接口层验证（不依赖界面）

```bash
BASE=http://localhost:3001        # 容器形态改为 http://<host>:82
JAR=$(mktemp)

# ① 未登录访问业务接口 → 401 且无业务数据
curl -s -o /tmp/r1 -w '%{http_code}\n' $BASE/api/admin/agents   # 期望 401
cat /tmp/r1                                                     # 期望 {"error":{"code":"ADM_UNAUTHENTICATED",...}}

# ② 错误密码 → 401 ADM_INVALID_CREDENTIALS
curl -s -w '\n%{http_code}\n' -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"wrong"}' \
  $BASE/api/admin/auth/admin-login

# ③ 正确密码 → 200 且 Set-Cookie
curl -s -i -c $JAR -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"123456"}' \
  $BASE/api/admin/auth/admin-login

# ④ 带 Cookie 访问业务接口 → 200
curl -s -o /dev/null -w '%{http_code}\n' -b $JAR $BASE/api/admin/agents   # 期望 200

# ⑤ 探针 → 200 {"username":"admin"}
curl -s -b $JAR $BASE/api/admin/auth/admin-me

# ⑥ 登出 → 204，再访问业务接口 → 401
curl -s -o /dev/null -w '%{http_code}\n' -b $JAR -X POST $BASE/api/admin/auth/admin-logout
curl -s -o /dev/null -w '%{http_code}\n' -b $JAR $BASE/api/admin/agents   # 期望 401

# ⑦ 024 端点不受守卫影响（运行侧会话内省）
curl -s "$BASE/api/admin/auth/session/valid?user_id=x&session_id=y"      # 期望 200 {"valid":false}
```

## 5. 门禁命令（本地单命令，宪章原则八）

```bash
# 后端
cd admin-backend
npm run lint && npm run typecheck && npm run test && npm run test:coverage && npm run build
npm run check:contract      # 错误码四处同步（新增码必须通过）

# 前端
cd admin-frontend
npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

**通过标准**：两端全绿；`admin-frontend` 覆盖率不低于既有地板（94/92/95/94），新增模块 ≥80%；`check:contract` 通过。

## 6. 部署后冒烟（容器，非交互）

```bash
docker compose up -d --build
# 复用 §4 的 ①～⑦（BASE=http://<host>:82），全部满足预期即部署可用
```

> 该步骤只确认"部署本身成功 + 登录链路连通"，**不作为测试结论**（宪章原则三）。

## 7. 失败排查

| 现象 | 排查方向 |
|---|---|
| 登录返回 503 `ADM_AUTH_CENTER_UNREACHABLE` | 容器/宿主机到 `192.168.0.156:8999` 是否可达；`AUTH_CENTER_URL` 是否含 `/dh-auth-center` 上下文路径 |
| 登录返回 401 但密码确认正确 | 认证中心账号是否仍在；其后端日志中的业务码（400 与 401 含义不同） |
| 登录成功但业务接口仍 401 | `AUTH_SECRET` 是否被改动（签名与验签必须同值）；Cookie 是否被浏览器策略拦截（`SameSite=Lax` + 同源访问不受影响） |
| 页面一直停在"正在校验登录状态" | `/api/admin/auth/admin-me` 请求是否 5xx；Vite dev 代理是否指向 3001 |

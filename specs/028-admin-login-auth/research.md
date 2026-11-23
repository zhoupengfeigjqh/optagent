# 研究报告：数字人管理平台登录授权入口

**特性**：`028-admin-login-auth`　**日期**：2026-11-23　**对应计划**：[`plan.md`](./plan.md)

本文件记录进入设计前必须收敛的技术未知项。D1～D7 的结论直接决定了 `plan.md` 的模块划分与契约。

## D1 登录调用链路：同源中转 vs 浏览器直连

**决策**：浏览器只访问平台同源地址 `/api/admin/auth/admin-login`（及 `admin-me` / `admin-logout`），由管理后端转发到认证中心。

**实测证据**：

- `POST http://192.168.0.156:8999/dh-auth-center/api/auth/admin/login` 在带 `Origin: http://localhost:5174` 时返回 `Access-Control-Allow-Origin: http://localhost:5174`（逐字回显），预检 `OPTIONS` 返回 200 且允许 `GET,POST,PUT,DELETE,OPTIONS` 与 `content-type`。
- 说明认证中心按请求 Origin 回显放行，**未登记生产域名**（平台生产入口为 `http://<host>:82/admin/`）。

**理由**：

1. 直连依赖认证中心的 CORS 放行清单，部署域名一变就 4xx，属于把可用性绑在别人的白名单上。
2. 直连意味着 `accessToken` 必须交给前端脚本保存（`localStorage`/内存），与"凭据不得被前端脚本读取"冲突（规格 FR-006）。
3. 同源中转后，认证中心地址只存在于管理后端配置中，符合"前端 MUST NOT 硬编码后端常量"（原则七）。

**被否决**：① 浏览器直连认证中心（CORS + 令牌暴露）；② 网关直接反代认证中心（`/api/admin/` 已指向管理后端，再叠一层会把认证中心的错误体格式透给前端，破坏统一错误格式）。

## D2 认证中心契约（实测，2026-11-23）

**决策**：以响应体**业务码**判定成败，客户端集中映射错误。

**实测结果**：

| 项 | 实测值 |
|---|---|
| 请求 | `POST /dh-auth-center/api/auth/admin/login`，`Content-Type: application/json`，体 `{"username":"admin","password":"123456"}` |
| 成功响应 | HTTP 200，`{"code":0,"message":"ok","data":{"expiresIn":43200,"accessToken":"<JWT>"}}` |
| 令牌声明 | `{"sub":"admin","scope":"admin","iat":1795416717,"exp":1795459917}`（HS256，无 `iss`/`aud`） |
| 失败响应 | HTTP 200（约定"HTTP 状态码始终为 200"），`code=401` 账号或密码错误；`code=400` 参数校验失败 |
| 令牌用于其管理接口 | 实测 `GET /api/admin/users` 带 `Authorization: Bearer <token>` 返回 `{"code":401,"message":"令牌类型不匹配"}` |

**理由与影响**：

1. 登录结果 MUST 按 `code` 判定——只看 HTTP 状态会把"密码错误"当成功（规格 FR-004）。
2. 认证中心**没有**管理员令牌的内省/校验端点（接口清单仅有 `/api/services/introspect`（服务令牌）、`/api/user/me`（user 作用域）），且其管理接口不接受该令牌，因此**本平台无法、也不需要**在每次请求时代为校验认证中心令牌；控制台会话由本平台自签（D3）。
3. 凭据格式变化只需改 `infra/auth-center-client.ts` 一处 + 单测。

**被否决**：把认证中心 `accessToken` 原样下发并每次透传校验——实测不可行，且会把认证中心故障变成平台全站不可用（违反原则九的有界降级）。

## D3 控制台会话载体

**决策**：自签 HS256 JWT + 独立 HttpOnly Cookie。

| 项 | 取值 |
|---|---|
| Cookie 名 | `optagent_console`（与 024 的 `optagent_auth` 物理隔离） |
| 属性 | `HttpOnly; Path=/; SameSite=Lax; Max-Age=<ttl>`（内网明文 HTTP，不设 `Secure`，与 024 同口径） |
| 算法/密钥 | HS256，复用既有 `AUTH_SECRET`（唯一密钥来源，不新增密钥管理） |
| claims | `sub`=管理员账号、`iss`=`optagent-admin`、`aud`=`optagent-admin-console`、`iat`、`exp` |
| 有效期 | `min(认证中心 expiresIn, AUTH_CONSOLE_TTL_SECONDS)`，上限默认 43200（12h） |
| 撤销 | 无服务端会话登记：登出即清 Cookie；不支持多端互踢 |

**理由**：

- 复用 024 的签名设施（`jose` + `AUTH_SECRET`）零新增依赖（原则六）。
- 独立 `aud` 使 024 的 `verifySession`（校验 `aud=optagent-agent`）拒绝控制台令牌，反之亦然——两套凭据不会互相认账（规格 FR-012）。
- **不**复用 024 的 `SessionStore`：该存储实现"同账号后登踢前登"。若共用，管理员登录会踢掉聊天前台同名业务使用者（如账号 `admin`），直接违反 FR-012、SC-009。
- 无服务端会话登记是**明确取舍**：认证中心未提供管理员会话撤销/内省接口，本平台无法判定"令牌是否已被撤销"；与其做一个无法验证的假撤销，不如只保证本地登出即时生效，并在规格 §5 登记该限制。

**被否决**：① 复用 `optagent_auth` Cookie（会与业务使用者会话互相覆盖）；② 复用 `SessionStore`（引发跨入口踢出）；③ 服务端内存会话表（进程重启即丢失，且与"无新增存储"冲突）。

## D4 管理接口守卫的落点

**决策**：Fastify `onRequest` 钩子，作用域 `/api/admin/` 前缀，放行 `/api/admin/auth/` 与 `OPTIONS`；失败抛 `ApiError(ADM_UNAUTHENTICATED, '登录状态已失效，请重新登录')`。

**理由**：

- 契约 §11 已预设"凭据校验钩子"与"回滚 = 移除校验钩子"，本特性正是其落地；`ADM_UNAUTHENTICATED`(401) 已在四处码表冻结，无需造新码。
- 一处钩子覆盖全部既有业务端点，避免在 18 个路由文件里各写一遍（唯一职责来源）。
- 放行 `/api/admin/auth/` 的原因：024 的业务使用者登录/探针/登出/会话内省自身带语义校验，且 `agent-backend` 以无 Cookie 方式调用 `session/valid`；若被控制台守卫拦截会直接打断聊天前台登录。

**测试影响与处理**（关键成本项）：`admin-backend/tests/integration` 共 18 个 spec、250+ 处 `app.inject`。若逐处补 Cookie，改动面会远超本特性（违反"不得借机放大改动范围"）。**处理**：在 `tests/helpers/fixture.ts` 里把 `app.inject` 包一层，默认附带有效控制台会话 Cookie，并提供 `consoleSession: false` 关闭开关；守卫本身由 `console-auth.spec.ts` 的显式无 Cookie 用例验证（401 + 错误码 + 无业务数据）。

**被否决**：① 用环境变量开关默认关闭守卫（生产忘开即"假安全"）；② 只在网关做 Cookie 存在性检查（无法验签，伪造 Cookie 即绕过）；③ 逐文件补 Cookie（250 处噪音改动）。

## D5 前端守卫形态

**决策**：不新增路由名，由 `App.vue` 依据登录态渲染"登录页"或"应用外壳"；启动先探针 `GET /api/admin/auth/admin-me`。

**理由**：既有路由是自建 `History API` 解析（`src/router.ts`），其设计目标写明"不需要守卫，不引入 vue-router"；把 `/login` 塞进 `RouteName` 会污染 5 个功能区的导航模型与既有 `router.spec.ts`。未登录时保留当前 URL，登录成功后同一 URL 直接渲染原功能区，天然满足"登录后回到原本要访问的页面"（FR-005）。

**备选**：引入 vue-router（新增依赖，原则六否决）；在 `main.ts` 里挂全局前置守卫（无路由框架时无统一挂点，收益为负）。

## D6 登录态失效的统一处理

**决策**：在 `src/api/http.ts` 增加模块级 `onUnauthorized` 回调注册点，仅当 `status===401 && code==='ADM_UNAUTHENTICATED'` 时触发；由 `useConsoleAuth` 注册"清状态 + 回登录页"。

**理由**：失效可能发生在任意一次业务请求中（登录态过期），若每个调用点各写一套判断，就会重复实现并遗漏（原则二）。登录失败的 401（`ADM_INVALID_CREDENTIALS`）不触发该回调，避免登录页自身把用户"踢"一遍。

**被否决**：定时轮询探针（额外请求、过期感知有延迟）；在 `useAsync` 里处理（职责错位，`useAsync` 只管单次请求生命周期）。

## D7 超时、重试与降级口径

**决策**：不重试；`AbortController` 超时默认 5000ms（`AUTH_CENTER_TIMEOUT_MS`，≥100）。

| 失败模式 | 用户可见行为 | 可观测性 |
|---|---|---|
| 连接被拒 / DNS / 超时 | 登录页提示"认证服务暂不可用，请稍后重试"，停留在登录页 | `warn` 日志：`event=auth_center.unreachable`，含 `req_id`、耗时、原因 |
| 认证中心返回非 JSON | 同上（映射为不可用，而非"密码错误"） | 同上（附响应前 200 字符摘要，不含请求体） |
| 业务码 401 | "账号或密码不正确，请重新输入"（不区分账号是否存在） | `info` 日志：`event=auth_center.login_rejected`（不含密码） |
| 业务码 400 | "填写内容不合法"（`VALIDATION_FAILED`） | 同上 |
| 业务码其它非 0 | 按"认证服务暂不可用"处理 | `warn` 日志带业务码 |

**理由**：登录是同步交互，重试会放大等待且对密码错误无意义；有界超时 + 明确提示满足原则九；不重试也让"一次点击 = 一次登录尝试"的语义清晰（FR-014 的防重复提交）。

## D8 依赖与版本

**决策**：零新增依赖。

- 后端签名：`jose`（已在 `admin-backend/package.json`，024 引入并已记录）。
- 后端 HTTP：全局 `fetch` + `AbortController`（沿用 `src/infra/runtime-client.ts` 的既有模式）。
- 前端：仅 `vue`（表单、显隐、错误关联均用原生元素 + `<script setup>`），不引入表单校验库或 UI 库。

## D9 部署与配置

**决策**：认证中心地址/超时/会话上限三项配置进 `admin-backend` 的 `.env`（Docker 形态，入库）与 `.env.example`（本地形态样板）；容器直连内网 IP，网关**无需改动**（`/api/admin/` 已分发到 `admin-backend:3001`）。

**理由**：管理前端已通过 `/api/admin/*` 同源访问管理后端，新增端点自动被 `location /api/admin/` 覆盖，不需要新增 nginx location，也不需要改动 `docker-compose.yml` 的服务定义（`env_file` 已注入 `.env`）。

**风险登记**：容器到 `192.168.0.156:8999` 的可达性属部署环境前提；`quickstart.md` 的冒烟步骤包含一次真实登录打点，不可达会立刻暴露（503），不会静默通过。

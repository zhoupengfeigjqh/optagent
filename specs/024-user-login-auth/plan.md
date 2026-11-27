# 实施计划：用户登录与鉴权（方案 A）

- **分支**：`024-user-login-auth`
- **日期**：2026-11-17
- **规格**：[spec.md](./spec.md)
- **输入**：`specs/024-user-login-auth/spec.md`
- **说明**：采用**方案 A**（已在调研中与用户确认）——数字人管理平台是账号与密码的**唯一权威源**，登录时由平台校验密码并签发登录凭据；运行环境**不接触密码**，只对凭据验签并据此确定"当前用户"。技术栈沿用现状（TypeScript 6 / Node ≥ 20 / Fastify 5 / Vitest 5），**仅新增 `jose` 一个依赖**（JWT 签发/验签）；密码哈希用 Node 内置 `crypto.scrypt`（零依赖）。本计划的重点是**把认证做成可独立演进、可替换、可回滚的解耦模块**——平台侧负责"签发"，运行侧负责"验签"，前端负责"登录态与 401 处理"，四侧各只依赖一个稳定的凭据契约，互不侵入对方实现。

## 摘要

1. **平台侧（权威源）**：管理员新建用户时设置密码，密码以 `scrypt` 摘要存入用户记录；新增登录/登出/探针/会话内省四个端点，校验密码后签发**带有效期、可验签的登录凭据**（JWT），以 HttpOnly Cookie 下发；同时为每个账号维护"当前唯一有效会话"实现单会话（后登踢前登）。
2. **运行侧（验签）**：新增一个 `onRequest` 鉴权钩子，验签 Cookie 中的凭据并解析出"当前用户"，注入既有的 `getCurrentUser()`；未登录/凭据失效返回统一 401；平台级只读投影（监控、内置工具目录、调用统计）白名单放行。
3. **聊天前台**：新增登录页与异步路由守卫，以"当前用户探针"为登录态唯一来源；未登录拦截到登录页，401 统一跳登录。
4. **管理界面**：新建用户弹窗增加"设置密码"输入框。
5. **单会话**：同一账号同时只允许一个有效会话——登录时签发新会话覆盖旧会话；运行侧验签后经"会话内省"确认会话仍有效，被踢端收到"已在其它设备登录"。

**解耦形态（本次硬约束）**：认证能力收敛为三块模块——平台侧 `domain/auth/**`（签发 + 会话登记）、运行侧 `infra/auth.ts`（验签钩子 + 会话内省）、前端 `composables/useAuth.ts`（登录态）。三者只通过"凭据契约 + 4 个端点 + 1 个 Cookie"耦合；运行侧对平台侧仅存在**会话内省**这一条受限的运行时读依赖（不感知密码/用户记录）。删除或替换任意一块（例如未来换 Keycloak/OIDC，其 token introspection 正是同形）不影响其余两侧。

## 技术上下文

**Language/Version**：TypeScript 6 / Node.js ≥ 20，ESM（四个子项目 `package.json` 已对齐）。

**Primary Dependencies**：
- Fastify 5（HTTP 层）；`zod`（配置与入参校验，已存在）。
- **`jose`（新增，唯一新依赖）**：JWT 签发（admin-backend）与验签（agent-backend）；纯 JS、无原生编译、无平台差异。
- Node 内置 `crypto`（`scrypt` 密码哈希、`AsyncLocalStorage` 请求级身份注入）——零依赖。
- 复用：`UserLinkService`（用户记录）、`PlatformStore`（原子写入）、统一错误 envelope。

**Storage**：
- 密码只存 `.platform-data/users/{user_id}.json`（平台设计态，**不物化、不部署**到 `.opt-agent`）。
  —— 2026-11-27 起落点收敛为 `.platform-data/accounts/users/{user_id}.json`（见 028 §14）。
- 登录凭据仍**无状态**（JWT 自含身份与有效期），但新增**每账号"当前唯一会话标识"登记**（`.platform-data/sessions/{user_id}.json`，原子写入），用于单会话与后登踢前登；不引入独立会话服务/数据库。
- 无迁移动作：存量用户记录缺 `password` 字段即"不可登录"，由管理员补设（不发起批量迁移专项）。

**Testing**：Vitest 5，`npm run test` / `npm run test:integration` / `npm run test:coverage`；不依赖真实 LLM；登录/验签全部可用假密钥与内存桩驱动。

**Target Platform**：Linux 容器（部署）/ Windows 本地开发。`jose`、`crypto.scrypt` 均为纯 JS/内建，无原生模块，无平台差异（对照 `better-sqlite3` 那类已知差异，本特性不涉及）。

**Project Type**：Web 服务，**四侧同改**（`admin-backend` / `agent-backend` / `frontend` / `admin-frontend`）；`gateway` 零改动（复用 `/api/admin/*` 前缀）。

**Performance Goals**：
- 验签 + 会话内省对单次受保护请求的**额外耗时** P95 ≤ 5ms（HS256 验签为微秒级；会话内省以 1~2 秒本地缓存摊薄，缓存未命中时额外一次内网调用约 1~5ms，不计入稳态 P95）。
- 登录/探针/登出为毫秒级接口，满足既有"非流式 P95 ≤ 500ms"口径（测量口径在实现期回填）。
- 密码哈希 `scrypt` 单次 ~50~100ms（仅登录时一次），不进入稳态请求路径。

**Constraints**：
- 新增依赖**仅 `jose`**；其余一律内建能力（`crypto`、`AsyncLocalStorage`、HttpOnly Cookie）。
- 单文件 ≤ 500 行；新增模块语句覆盖率 ≥ 80%。
- 凭据契约三侧一致：Cookie 名、JWT claims、端点路径、错误码必须单一来源（见 `contracts/auth-api.md`）。
- 密码明文 MUST NOT 出现在任何响应/日志/审计（`FR-002`、`SC-006`）。

**Scale/Scope**：
- 用户量级：单机内部工具，用户数通常 < 100；登录并发极低。
- 每请求一次验签 + 一次会话内省（短缓存摊薄）；会话登记为单文件、单机内部工具，无横向扩展顾虑。

## 宪章检查（Phase 0 前）

*GATE：以下各项必须通过；不通过项必须在「复杂度跟踪」中说明。*

| 原则 | 结论 | 说明 |
|---|---|---|
| 一、中文与规格驱动 | 通过 | 规格/计划/研究/数据模型/契约/快速验证全中文；实现期回写规格修订记录 |
| 二、代码质量与模块化 | 通过 | 认证收敛为三块模块（`domain/auth/**` / `infra/auth.ts` / `useAuth.ts`），密码哈希、令牌、会话登记、服务、钩子各一文件，均 < 200 行；`getCurrentUser()` 仍为身份唯一来源 |
| 三、测试完备性 | 通过 | 新增/修改模块全部同名同目录单测；登录/验签用假密钥与内存桩，不依赖真实 LLM；四侧门禁单命令 |
| 四、无障碍 | 通过 | 登录页为新增组件，键盘导航（Tab/Enter/Esc）、`<form>` 语义、错误提示文本化，组件级键盘/读屏验证在其自身任务内完成 |
| 五、性能与一致性 | 通过 | 验签+内省 P95 ≤ 5ms（内省短缓存摊薄）；密码与会话登记原子写入沿用 `PlatformStore` 临时文件→rename；无 N+1；单会话语义由平台侧会话登记原子替换保证 |
| 六、依赖治理 | 通过 | 仅新增 `jose`（已在 research D2 记录选型理由 + 被否决替代方案）；密码哈希用内置 `scrypt`（零依赖） |
| 七、接口契约两侧同改 | 通过 | 新增 `contracts/auth-api.md` 为凭据契约唯一来源；四侧类型/错误码/端点一次同步；在 `specs/001-.../contracts/admin-api.md` §6.2/§9/§11 与 `runtime-api-delta.md` 登记差异 |
| 八、测试部署简单可控 | 通过 | 各侧复用单命令门禁；`AUTH_SECRET` 注入 compose 与 `.env`；部署后非交互冒烟确认登录→探针→401 链路 |
| 九、优雅降级与可观测 | 通过 | agent 侧 `AUTH_SECRET` 缺省即回退 legacy 单用户（可回滚）；平台内省接口暂不可达时按"放行 + 告警"降级；登录失败统一可读提示且不枚举账号；验签失败/会话失效/配置异常落结构化日志；无重试放大 |

**Phase 1 后复核**：设计未新增服务/数据库；`domain` 依赖方向仍单向（auth 不依赖 mcp/意图聚焦/工具装配）；密码不进入 `.opt-agent`；凭据契约三侧一致；仍通过。

## 解耦设计（本次核心约束）

### 依赖方向（只允许向下，三块互不引用）

```text
┌─ admin-backend ─────────────────────────────────────────────┐
│ routes/auth.ts（HTTP 端点，含会话内省）                        │
│   └─► domain/auth/service.ts（登录/探针/登出/内省编排）         │
│        ├─► domain/auth/password.ts      scrypt 哈希/校验       │
│        ├─► domain/auth/token.ts         JWT 签发/验签（jose）  │
│        ├─► domain/auth/session-store.ts 每账号当前会话登记      │
│        └─► domain/config-center/user-links.ts（只读用户记录）   │
└─────────────────────────────────────────────────────────────┘
┌─ agent-backend ─────────────────────────────────────────────┐
│ server.ts（注册 onRequest 钩子）                              │
│   └─► infra/auth.ts（验签 + 会话内省 + AsyncLocalStorage + 白名单）│
│        ├─► domain/current-user.ts（getCurrentUser 读 ALS）    │
│        └─► （HTTP）admin-backend 会话内省端点（受限读依赖）      │
└─────────────────────────────────────────────────────────────┘
┌─ frontend ──────────────────────────────────────────────────┐
│ views/LoginView.vue + router/index.ts（异步守卫）              │
│   └─► composables/useAuth.ts（登录态 + 401/被踢 跳转 + 探针记忆化）│
│        └─► api/auth.ts（login / me / logout）                  │
└─────────────────────────────────────────────────────────────┘
```

- **反向依赖为 0**：平台侧 `domain/auth` 不依赖运行侧；运行侧 `infra/auth.ts` 不依赖平台侧实现（只认 JWT 契约与共享密钥）；前端 `useAuth` 不感知密码与验签细节。
- **旁路依赖为 0**：除上述三块与各自装配点外，无其它调用点；替换认证实现只需改一块。
- **契约即边界**：三侧唯一共享的是 `contracts/auth-api.md` 定义的「Cookie 名 + JWT claims + 端点 + 错误码」；实现互不可见。

### 凭据契约（三侧共享，唯一来源 `contracts/auth-api.md`）

- **Cookie**：`optagent_auth`，HttpOnly，`Path=/`，`SameSite=Lax`，`Max-Age = TTL`（登出/失效置 0）；**不设** `Secure`（网关当前为明文 HTTP）。
- **JWT claims**：`sub`=用户标识、`jti`=会话标识（用于单会话判定）、`iss`=`optagent-admin`、`aud`=`optagent-agent`、`iat`、`exp`；HS256，共享密钥 `AUTH_SECRET`。
- **端点**：`POST /api/admin/auth/login`、`GET /api/admin/auth/me`、`POST /api/admin/auth/logout`、`GET /api/admin/auth/session/valid`（会话内省，供运行侧调用）。
- **错误码**：见契约 §错误码。

### 装配点最小改动

| 侧 | 位置 | 改动 | 量级 |
|---|---|---|---|
| admin-backend | `server.ts` | `registerAuthRoutes(routeApp, ctx, authService)` | +1 行 |
| admin-backend | `config.ts` | 新增 `authSecret`（必填）、`authTokenTtlSeconds` | +2 字段 |
| agent-backend | `server.ts` | 注册 `onRequest` 鉴权钩子（装配 `createAuthHook(config)`） | +若干行 |
| agent-backend | `current-user.ts` | `getCurrentUser()` 从 ALS 读身份（无 store 回退 `BUILTIN_ADMIN`） | 改 1 函数 |
| frontend | `router/index.ts` | 加 `/login` 路由 + 业务路由 `requiresAuth` + 异步守卫 | 改 |
| frontend | `App.vue`/`main.ts` | 启动时探针一次 | +少量 |
| admin-frontend | `UserEditor.vue` | 新建态加密码输入 | 改 |
| admin-frontend | `api/users.ts` | `createUser` 加 `password` | 改 |

**不做的事**（防止耦合回潮）：
- 不在 `agent-backend` 任何 `domain/` 业务模块里感知密码或登录（身份只经 `getCurrentUser()` 单一入口）。
- 不给 `ChatAgent`、`types.ts`、`MCP.json`、`TOOL.json` 增加权限字段。
- 不新建数据库表、不新建进程、不引入独立会话服务；单会话用平台侧轻量会话登记（文件）实现。
- 不改造 `frontend/src/utils/axios.js` / `cookie.js`（那是 `/dataApi` 排产服务的 sa-token 残留，与本次无关，避免混用 Cookie 名）。

### 与既有能力的关系

| 既有能力 | 关系 |
|---|---|
| `agent-backend` `current-user.ts` 固定 `admin` | **被接通**：从"写死单用户"改为"从验签凭据解析"，数据隔离（`dirs.ts` 已按 userId 分区）自然生效 |
| `admin-backend` `UserLinkService` | **加字段**：用户记录增加 `password`，读写路径不变（列表/详情继续不下发密码） |
| 平台鉴权 §11（`ADM_UNAUTHENTICATED`/`ADM_FORBIDDEN` 预登记） | **部分启用**：`ADM_UNAUTHENTICATED` 用于 `/me` 探针；`ADM_FORBIDDEN`（管理员角色）仍预留不启用 |
| `/dataApi` 排产服务（`axios.js`/`cookie.js`） | **无关**：不同系统、不同 Cookie 名，互不干扰 |

## Phase 0：研究与决策

- 产出：[research.md](./research.md)
- 已收敛的关键决策（D1~D13）：
  1. **D1** 身份权威源 = admin-backend（平台），运行环境只验签不碰密码（否决：agent 持密码 / agent 代理登录）；
  2. **D2** 凭据形态 = 标准 JWT（`jose`，HS256）（否决：手写 HMAC 紧凑 token、`jsonwebtoken`）；
  3. **D3** 密码哈希 = Node 内置 `crypto.scrypt`（否决：bcrypt/argon2 原生依赖、pbkdf2）；
  4. **D4** 凭据载体 = HttpOnly Cookie（`optagent_auth`）（否决：Bearer header、localStorage）；
  5. **D5** 运行侧身份注入 = `AsyncLocalStorage` + `onRequest` 钩子，`getCurrentUser()` 签名不变（否决：53 处传 req、`@fastify/request-context`）；
  6. **D6** 鉴权边界 = 用户级端点全保护，平台级只读投影白名单（monitor/builtin-tools/mcp-call-stats）开放（否决：全量保护）；
  7. **D7** 登录态探针 = `GET /api/admin/auth/me`（前端异步路由守卫唯一来源）（否决：可读 cookie 标记、纯前端本地标记）；
  8. **D8** 登录失败不枚举 = 单一 `ADM_INVALID_CREDENTIALS`（401）（否决：区分账号/密码报错）；
  9. **D9** 回滚/降级 = agent 侧 `AUTH_SECRET` 可选（缺失回退 legacy 单用户），admin 侧必填（签发方）（否决：两侧都强制）；
  10. **D10** 错误码 = agent `UNAUTHENTICATED`(401)、admin `ADM_INVALID_CREDENTIALS`(401) 新增，复用 `ADM_UNAUTHENTICATED`（否决：同码不同义）；
  11. **D11** 会话模型 = 无状态 JWT + 平台侧"每账号当前会话标识"登记；登出/新登录/删除用户即清除或覆盖该标识实现即时失效（后登踢前登）（否决：纯客户端清 Cookie——无法踢人；独立会话数据库服务——过重）；
  12. **D12** 存量用户 = 无密码不可登录，管理员补设，不批量迁移（否决：默认空密码、批量造随机密码）。
  13. **D13** 单会话实现 = 平台侧会话登记（`.platform-data/sessions/{uid}.json`）+ 运行侧"验签 + 会话内省（1~2 秒短缓存）"（否决：运行侧纯本地比对——无法跨服务；逐请求实时内省无缓存——P95 恶化）。
- 无 `NEEDS CLARIFICATION` 残留；仅新增 `jose` 一个依赖。

## Phase 1：设计与契约

- 产出：
  - [research.md](./research.md)：13 项技术决策与取舍；
  - [data-model.md](./data-model.md)：用户记录密码字段、JWT claims（含 `jti`）、活跃会话登记与状态；
  - [contracts/auth-api.md](./contracts/auth-api.md)：端点契约（含会话内省）、Cookie/JWT 契约、错误码（含"已在其它设备登录"）、鉴权边界与白名单；
  - [quickstart.md](./quickstart.md)：端到端可运行验证场景与排障命令。
- 设计复核：未新增服务/数据库；密码不进入 `.opt-agent`；凭据契约三侧一致；Phase 1 后宪章检查仍通过。

## 项目结构

### 文档（本特性）

```text
specs/024-user-login-auth/
├── plan.md                       # 本文件
├── research.md                   # Phase 0：技术决策与取舍
├── data-model.md                 # Phase 1：密码字段、凭据、状态
├── quickstart.md                 # Phase 1：可运行验证指南
├── contracts/
│   └── auth-api.md               # 端点 + Cookie/JWT + 错误码 + 鉴权边界
├── checklists/
│   └── requirements.md           # 规格质量检查表（已通过）
└── tasks.md                      # Phase 2（由 /speckit.tasks 生成）
```

### 源码（仓库根）

```text
admin-backend/
├── src/
│   ├── domain/auth/
│   │   ├── index.ts                    # 新增：auth 包唯一导出面（工厂 + 端口类型 + 错误码）
│   │   ├── password.ts                 # 新增：scrypt 哈希 + 校验（纯函数，约 70 行）
│   │   ├── token.ts                    # 新增：JWT 签发/验签 + Cookie 构造（jose，约 80 行）
│   │   ├── session-store.ts            # 新增：每账号当前会话登记（约 70 行）
│   │   └── service.ts                  # 新增：login / me / logout 编排（约 120 行）
│   ├── domain/config-center/user-links.ts   # 改：UserLinkDocument 加 password；create 收密码；视图剥离密码
│   ├── routes/auth.ts                  # 新增：4 个端点（含会话内省，约 110 行）
│   ├── routes/users.ts                 # 改：POST /api/admin/users 收密码
│   ├── config.ts                       # 改：authSecret（必填）、authTokenTtlSeconds
│   └── server.ts                       # 改：装配 authService + 注册 auth 路由
├── tests/
│   ├── unit/
│   │   ├── auth-password.spec.ts       # 新增：scrypt 往返、盐唯一、坏格式、边界长度
│   │   ├── auth-token.spec.ts          # 新增：签发/验签、claims、过期、密钥不符
│   │   ├── auth-session-store.spec.ts  # 新增：会话登记、覆盖、清除、判定当前会话
│   │   └── auth-service.spec.ts        # 新增：登录成功/失败、不枚举、探针、登出、存量无密码
│   └── integration/
│       └── auth.spec.ts                # 新增：登录→探针→受保护资源→登出 全链路（内存 store）
└── package.json                        # 改：+ jose

agent-backend/
├── src/
│   ├── infra/auth.ts                   # 新增：验签 + 会话内省 + AsyncLocalStorage + 白名单（约 180 行）
│   ├── domain/current-user.ts          # 改：getCurrentUser 读 ALS（无 store 回退 admin）
│   ├── config.ts                       # 改：authSecret（可选）
│   └── server.ts                       # 改：注册 onRequest 钩子
├── tests/
│   ├── unit/
│   │   ├── auth-hook.spec.ts           # 新增：验签、会话内省、被踢 401、白名单、ALS 注入、无密钥回退
│   │   └── current-user.spec.ts        # 新增：ALS 有/无 store 两态
│   └── integration/
│       └── auth.spec.ts                # 新增：未带凭据 401、无效凭据 401、白名单放行
└── package.json                        # 改：+ jose

frontend/
├── src/
│   ├── api/auth.ts                     # 新增：login / me / logout
│   ├── composables/useAuth.ts          # 新增：登录态 + 探针记忆化 + 401 跳转
│   ├── views/LoginView.vue             # 新增：登录页
│   └── router/index.ts                 # 改：/login 路由 + requiresAuth + 异步守卫
├── src/api/http.ts                     # 改：401 统一跳登录（排除登录端点）
├── src/api/sse.ts                      # 改：401 跳登录
└── tests/（新增：auth.spec.ts、useAuth.spec.ts、LoginView.spec.ts、router 守卫 spec）

admin-frontend/
├── src/
│   ├── components/deploy/UserEditor.vue # 改：新建态密码输入
│   ├── api/users.ts                     # 改：createUser 加 password
│   └── api/types.ts                     # 改：创建载荷加 password
└── （UserEditor.spec.ts 增补密码校验用例）

gateway/nginx.conf                       # 不变（复用 /api/admin/）
docker-compose.yml                       # 改：backend 与 admin-backend 注入 AUTH_SECRET
admin-backend/.env / agent-backend/.env(.local)  # 改：AUTH_SECRET / AUTH_TOKEN_TTL_SECONDS

specs/001-digital-human-platform/contracts/
├── admin-api.md                         # 改：§6.2 加 password、§9/§11 更新、新增 §12 登录端点
└── runtime-api-delta.md                 # 改：登记鉴权语义（401 / 白名单）
```

**结构决策**：沿用"`routes` → `domain` → `infra`"既有分层。认证在 admin-backend 收敛为 `domain/auth/**` 自洽包（哈希、令牌、服务各一文件，外部只见 `index.ts`）；在 agent-backend 收敛为 `infra/auth.ts` 单一钩子（`domain` 仍不感知 Fastify/凭据）。`getCurrentUser()` 保持为身份唯一来源，实现改动仅内部，53 处调用点零改动。

## 数据流（一次登录 → 一次受保护请求）

```text
① 登录（frontend → admin-backend）
   POST /api/admin/auth/login { user_id, password }
     └─ auth/service.login
          ├─ user-links.read(user_id)（无密码/用户不存在 → 统一 ADM_INVALID_CREDENTIALS）
          ├─ auth/password.verify(明文, 记录.password)
          ├─ 生成 session_id，auth/session-store.setCurrent(user_id, session_id)（覆盖旧会话 = 后登踢前登）
          ├─ auth/token.sign({ sub: user_id, jti: session_id, iss, aud, exp })
          └─ Set-Cookie: optagent_auth=<jwt>; HttpOnly; Path=/; SameSite=Lax; Max-Age=TTL

② 探针（frontend 路由守卫）
   GET /api/admin/auth/me（带 Cookie）
     └─ 验签 → { user_id } ｜ 无/无效 → 401 ADM_UNAUTHENTICATED

③ 受保护请求（frontend → agent-backend，浏览器自动带 Cookie）
   GET /api/agents（或任意用户级端点）
     └─ server onRequest → infra/auth.ts
          ├─ 命中白名单（monitor/builtin-tools/mcp-call-stats）→ 放行（不注入身份）
          ├─ 验签 Cookie（HS256）→ 提取 { sub, jti }
          ├─ 会话内省：GET /api/admin/auth/session/valid?user_id=sub&session_id=jti（1~2s 缓存）
          │     ├─ 仍为当前会话 → ALS.run({ userId: sub }, next)
          │     ├─ 已失效（被踢）→ 401 SESSION_REVOKED（"已在其它设备登录"）
          │     └─ 内省不可达 → 放行 + 告警（降级）
          ├─ 验签失败/缺失 → 401 UNAUTHENTICATED（不泄露业务数据）
     └─ 路由处理器 getCurrentUser().userId = ALS 中的 userId
          └─ 数据域按 users/{userId}/... 自然隔离

④ 登出 / 删除用户
   POST /api/admin/auth/logout → 清当前会话登记 + Set-Cookie Max-Age=0 → 前端回登录页
   删除用户 → 一并清除其会话登记（旧凭据即时失效）
```

## 模块职责与接口

### 1. `admin-backend/domain/auth/password.ts`（新增，纯函数，约 70 行）

- `hashPassword(plain): PasswordRecord`：`crypto.scrypt`（随机盐，参数 `N=16384, r=8, p=1`），
  返回 `{ algo: 'scrypt', params, salt, hash }`（盐与哈希 base64）。
- `verifyPassword(plain, record): boolean`：恒定比较（`crypto.timingSafeEqual`），格式非法即 `false`。
- 永不抛错（异常按 `false` 处理 + 调用方告警）。

### 2. `admin-backend/domain/auth/token.ts`（新增，约 80 行）

- `signSession(userId, secret, ttlSeconds): string`：`jose` HS256，claims `{ sub, iss, aud, iat, exp }`。
- `verifySession(token, secret): { userId }`：`jose.jwtVerify`，校验 `iss`/`aud`/`exp`，失败抛可识别错误（供 `me` 探针复用）。
- `cookieHeader(token, maxAge): string`：构造 `Set-Cookie`（HttpOnly / Path=/ / SameSite=Lax）。
- `clearCookieHeader(): string`：`Max-Age=0`。

### 3. `admin-backend/domain/auth/session-store.ts`（新增，约 70 行）

- `setCurrentSession(userId, sessionId)`：原子写入 `.platform-data/sessions/{userId}.json`（`{ user_id, session_id, issued_at }`），覆盖旧会话（= 后登踢前登）。
- `getCurrentSession(userId): string | null`：读当前会话标识，无记录返回 `null`。
- `clearSession(userId)`：删除会话记录（登出/删除用户时调用）。
- `isCurrentSession(userId, sessionId): boolean`：判定某会话是否为当前会话（供内省端点复用）。

### 4. `admin-backend/domain/auth/service.ts`（新增，约 140 行）

- `login(userId, password)`：读用户 → 验密码 → 生成 `session_id` → `setCurrentSession` → 签发；账号不存在与密码错误**统一**返回
  `ADM_INVALID_CREDENTIALS`（不枚举）；无密码的存量用户同样走该错误。
- `me(userId)`：由验签结果直接回 `{ user_id }`。
- `logout(userId)`：`clearSession` + 返回清 Cookie 头。
- `introspect(userId, sessionId)`：返回 `isCurrentSession(userId, sessionId)`。
- 密码/验签失败均落结构化日志（含 `req_id`，不含明文密码）。

### 5. `admin-backend/routes/auth.ts`（新增，约 110 行）

- `POST /api/admin/auth/login`：body `{ user_id, password }`（zod 校验）→ 200 `{ user_id }` + Cookie；登录成功同时 `setCurrentSession`。
- `GET /api/admin/auth/me`：验签 Cookie → 200 `{ user_id }` ｜ 401 `ADM_UNAUTHENTICATED`。
- `POST /api/admin/auth/logout`：清会话登记 + 204 + 清 Cookie。
- `GET /api/admin/auth/session/valid`：query `{ user_id, session_id }` → 200 `{ valid: boolean }`（供运行侧内省，免鉴权、只读）。

### 6. `agent-backend/infra/auth.ts`（新增，约 180 行）

- `createAuthHook({ secret, introspect })` → Fastify `onRequest` 钩子：
  - **白名单**（不注入身份、直接放行）：`/api/monitor/health`、`/api/monitor/agents`、
    `/api/builtin-tools`、`/api/mcp-call-stats`（平台级只读投影，admin 侧 RuntimeClient 依赖）。
  - 其余：验签 Cookie `optagent_auth`（提取 `sub`/`jti`）→ 会话内省（`introspect(sub, jti)`，1~2s 本地缓存）→ 仍有效则 `ALS.run({ userId: sub }, next)`；被踢 → 401 `SESSION_REVOKED`；内省不可达 → 放行 + 告警。
  - 验签失败/缺失 → 401 `UNAUTHENTICATED`；`secret` 未配置 → 钩子直接放行（legacy 单用户回退）。
  - 本文件**不含**用户记录、密码、业务判断（解耦红线）；只认 JWT 契约 + 内省端点契约。

### 7. `agent-backend/domain/current-user.ts`（改）

- 新增 `AsyncLocalStorage` 实例；`getCurrentUser()` 改为：先读 ALS store 的 `userId`，有则返回之；
  无 store（启动期 `ensureRootDirs` 或未配置密钥）回退 `BUILTIN_ADMIN`。
- 签名不变，53 处调用点零改动。

## 实施顺序

1. **凭据契约**：先写 `contracts/auth-api.md`（三侧唯一的契约来源），冻结 Cookie 名、claims（含 `jti`）、端点、错误码（含 `SESSION_REVOKED`）。
2. **平台侧（admin-backend）**：`password.ts` → `token.ts` → `session-store.ts` → `service.ts` → `routes/auth.ts`（含内省端点）；
   改 `user-links.ts`（加 `password` + 视图剥离）、`users.ts`（收密码、删除用户清会话）、`config.ts`、`server.ts`。
3. **运行侧（agent-backend）**：`infra/auth.ts`（验签 + 会话内省）+ `current-user.ts` 改 + `config.ts` + `server.ts`。
4. **管理界面（admin-frontend）**：`types.ts` → `api/users.ts` → `UserEditor.vue`（新建态密码输入）。
5. **聊天前台（frontend）**：`api/auth.ts` → `useAuth.ts` → `LoginView.vue` → `router` 守卫 → `http.ts`/`sse.ts` 401 处理。
6. **契约登记**：`specs/001-.../contracts/admin-api.md`（§6.2/§9/§11/§12）与 `runtime-api-delta.md`。
7. **门禁与冒烟**：四侧本地门禁 + `quickstart.md` 端到端场景 + 部署后非交互冒烟。

## 测试策略

### 单元测试（假密钥 + 内存桩，不依赖 LLM / 真实服务）

| 文件 | 覆盖 |
|---|---|
| `auth-password.spec.ts` | scrypt 往返一致；盐唯一；相同明文两次不同哈希；坏格式 → false；空/超长输入；`timingSafeEqual` 路径 |
| `auth-token.spec.ts` | 签发→验签往返；`sub/iss/aud/exp` 正确；过期 token 拒；密钥不符拒；篡改 payload 拒 |
| `auth-session-store.spec.ts` | 会话登记/覆盖/清除；`isCurrentSession` 判定；原子写入；`getCurrentSession` 无记录 → null |
| `auth-service.spec.ts` | 登录成功返回 `{user_id}` + Cookie 且登记会话；密码错/账号不存在**同码**（不枚举）；存量无密码 → 同码；二次登录覆盖旧会话；探针有/无 Cookie；登出清会话 + 清 Cookie；日志不含明文 |
| `agent-backend auth-hook.spec.ts` | 白名单放行；无 Cookie → 401；坏/过期/篡改 token → 401；有效 token → 内省通过 → ALS 注入 userId；被踢 → 401 `SESSION_REVOKED`；内省不可达 → 放行 + 告警；无密钥 → 放行回退；401 响应不含业务数据 |
| `current-user.spec.ts` | ALS 有 store → 返回其 userId；无 store → 回退 `admin` |
| `frontend useAuth.spec.ts` | 探针成功/失败；记忆化（只探一次）；登录成功设置态；登出清态；401 跳转（登录端点除外） |
| `LoginView.spec.ts` | 提交触发 login；错误提示文本化；键盘 Enter 提交；禁用态 |

### 集成测试

- admin-backend `auth.spec.ts`：登录 → 探针 → （同进程）登出 全链路；同一账号二次登录后旧会话失效（内省返回 `valid: false`）。
- agent-backend `auth.spec.ts`：未带凭据/无效凭据 401；白名单端点放行；有效凭据后 `/api/agents` 返回对应 userId 数据域；被踢会话 → 401 `SESSION_REVOKED`。
- 前端 `router` 守卫 spec：未登录访问业务路由 → 重定向 `/login`；已登录 → 放行。

### 质量门禁（本地，单命令）

```bash
cd admin-backend && npm run typecheck && npm run lint && npm run test:coverage && npm run build
cd agent-backend && npm run typecheck && npm run lint && npm run test:coverage && npm run build
cd admin-frontend && npm run lint && npm run typecheck && npm run test:coverage && npm run build
cd frontend && npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

## 覆盖率缺口处置结论（宪章「仍生效的待办与口径」第 1 项）

**待办原文要求**：`frontend` 的 `src/api/**`（7）与 `src/composables/**`（13）尚无同名测试，补测顺序与范围 MUST 在下一个特性的 `plan.md` 给出结论，且 MUST NOT 发起专项。

**本次结论**：

| 项 | 结论 |
|---|---|
| 是否触及 `frontend` | **是**（新增 `api/auth.ts`、`composables/useAuth.ts`、`views/LoginView.vue`；修改 `api/http.ts`、`api/sse.ts`、`router/index.ts`） |
| 本次范围 | 只为**本次新增/改动**的模块补同名测试（`auth.ts`/`useAuth.ts`/`LoginView.vue`/路由守卫/`http.ts`/`sse.ts` 的 401 行为）；MUST NOT 为未触及的存量模块发起补测 |
| 顺序（沿用先例，不变更） | ① 网络与契约边界：`api/http.ts`、`api/threads.ts`、`api/files.ts`、`api/produced.ts`；② 产出与预览：`usePreview.ts`、`useWorkspace.ts`；③ 会话与流式：`useChatPanel.ts`、`useThreads.ts`、`useSessionSearch.ts`；④ 其余 |
| 机制 | "触达即补"：本次触及的 `api/http.ts`（新增 401 分支）与新增模块随本特性补测；其余存量模块仍零触达零补测 |
| 全局地板 | 只可随补测上调，MUST NOT 下调 |

## 平台差异风险登记（宪章原则三）

**登记结论：本特性新增能力均为纯 JS / Node 内建，无原生模块，无平台差异。**

| 风险 | 表现 | 措施 |
|---|---|---|
| 原生模块二进制差异 | 本特性**无**原生模块（`jose` 纯 JS、`crypto` 内建），不适用 `better-sqlite3` 那类差异 | 无需登记 |
| Cookie 与同源 | 网关统一 `Host` 透传，Cookie 在同源下自动携带；本地直连（非网关）开发时经 Vite 代理同源 | 本地用 Vite 代理 `/api`→`3000`、`/api/admin`→`3001`；Cookie 不设 `Secure`、不设 `Domain`（走默认主机） |
| 明文 HTTP 无 TLS | `Secure` 不设，Cookie 明文传输 | 内部工具 + 仅内网；对外暴露前必须补 TLS 与 `Secure`（已在 quickstart 标注边界） |

部署后冒烟沿用既有 `quickstart` 打点；冒烟不作为测试结论。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 凭据密钥在两侧不一致（`AUTH_SECRET` 值不同） | 登录"成功"但聊天全 401 | compose/.env 单一密钥来源；冒烟覆盖"登录→探针→受保护请求"链路 |
| agent 侧 `AUTH_SECRET` 未配导致静默回退 legacy 单用户 | 以为有登录、实则无隔离 | admin 侧必填 + 探针/冒烟显式验证 401 与 userId 隔离；`AUTH_SECRET` 缺失在 agent 启动日志告警 |
| 会话内省引入 agent→admin 运行期依赖 | admin 短暂不可达时要么锁死用户、要么放宽单会话 | 内省不可达按"放行 + 告警"降级（原则九）；短缓存摊薄；冒烟覆盖互踢链路 |
| 会话内省短缓存导致"被踢"最坏延迟 | 旧会话在被踢后最多 ~2s 内仍可访问 | 缓存 TTL 固定 ≤2s，满足 SC-008；冒烟覆盖互踢 |
| 登录端点自身 401 与受保护资源 401 混淆 | 前端误把"密码错误"当"未登录"跳登录页 | 错误码分离（`ADM_INVALID_CREDENTIALS` vs `UNAUTHENTICATED`）；前端按码分派，仅后者跳登录 |
| `mcp-call-stats` 等平台级只读投影白名单开放 | 未登录可读聚合统计（含按用户计数） | 与"管理台本期不鉴权"口径一致；在契约登记为边界；敏感面后续随管理台鉴权一并收紧 |
| `getCurrentUser()` 改造引入回归 | 存量单用户行为改变 | 无 store 时回退 `BUILTIN_ADMIN`，与改造前逐字一致；既有全量单测/集成测试为回归门禁 |

## 复杂度跟踪

| 违规（潜在） | 为什么需要 | 更简单的替代为何不可行 |
|---|---|---|
| 新增依赖 `jose` | 标准 JWT 是"后续替换专业认证（Keycloak/OIDC/CAS）"的**前提**——专业方案同样签发 JWT，换签发方即可，验签方几乎不动；手写 HMAC 令牌会在替换时被整体废弃 | 手写 HMAC 紧凑 token：零依赖但非标准、验签/claims/过期都要自造且易错，且与"可升级"目标相悖 |
| admin-backend 新增 `domain/auth/**` 5 个文件 | 哈希、令牌、会话登记、服务、出口职责不同，要求可独立测试 | 单文件会超 500 行且把纯函数与编排混在一起 |
| 服务端会话登记 + 运行侧会话内省 | 单会话（后登踢前登）本质需要"每账号当前有效会话"这一共享状态，无状态 JWT 无法表达 | 纯客户端清 Cookie 无法踢人；运行侧纯本地比对无法跨服务；独立会话数据库服务过重 |
| agent-backend 新增 `infra/auth.ts` 钩子 + ALS | 身份注入必须发生在路由之前、且 `getCurrentUser()` 53 处调用点零改动的唯一路径 | 给 53 处传 `req` 侵入大；`@fastify/request-context` 增加依赖且仍要改调用点 |
| 鉴权白名单（4 个只读端点） | admin-backend 的 `RuntimeClient` 以平台身份采集目录/统计，不携带用户凭据 | 全量保护会打断平台观测；为这 4 个端点引入"服务间令牌"属过度设计（本期不做） |
| `AUTH_SECRET` 两侧不一致的耦合 | 验签必须同密钥 | 单密钥源自 compose/.env 一处；验签 + 内省短缓存是同时满足"解耦 + 单会话 + P95 ≤5ms"的形态 |

## 规格修订（plan 阶段事实校正）

1. **FR-006 / FR-007 / FR-008 的鉴权边界细化**：规格"后端拒绝缺失/无效凭据"在实现上存在**必须保留的平台级只读投影**（`/api/monitor/*`、`/api/builtin-tools`、`/api/mcp-call-stats`），它们不按用户隔离、由管理平台以平台身份采集。故在契约中显式登记"白名单"，不改变规格对**用户级**端点 100% 拦截的要求。此项不改写规格原文，仅在计划与契约登记实现依据。
2. **FR-013 存量用户兜底落地**：存量用户（无密码）登录时与"账号不存在/密码错误"走**同一错误码**（不枚举），不单独提示"未设置密码"——既满足 FR-013"不可静默放行"，又满足 FR-011"不枚举"。管理员补设入口不在本期（见规格假设）。
3. **SC-007 测量口径**：验签钩子为纯内存（HS256 验签），P95 ≤ 5ms 的目标口径登记于契约与 `quickstart.md`；实测值在实现期回填。
4. 其余 `FR` / `SC` 编号与语义保持原样。

## 完成定义

- [ ] `spec.md` 的 `FR-001`~`FR-014`、`SC-001`~`SC-008` 均有实现或测试对应，逐条可勾。
- [ ] 密码明文在响应/列表/详情/日志/审计中的出现次数为 0（可 grep 断言）。
- [ ] `agent-backend/domain/**` 的 import 清单中不含 `infra/auth.ts`（身份只经 `getCurrentUser()`，反向依赖为 0）。
- [ ] 凭据契约三侧一致：`contracts/auth-api.md` 是 Cookie 名 / claims / 端点 / 错误码的唯一来源。
- [ ] 四侧本地门禁全绿；新增/修改模块覆盖率 ≥ 80%；`SC-007` 实测值已回填。
- [ ] 端到端：登录 → 探针 → 受保护请求（按 userId 隔离）→ 二次登录踢前登 → 登出 → 再访问 401，全链路在 `quickstart.md` 可复现。
- [ ] `specs/001-.../contracts/admin-api.md` 与 `runtime-api-delta.md` 差异已登记。

## 修订记录（2026-11-27）：工作台登录入口收敛

**问题**：工作台存在两套登录表单——`/login`（账号 `user_id`）与注册链接页的「登录」页签
（仅手机号），字段、文案、跳转规则各写一遍；`admin` 这类无手机号账号在注册链接页会被
判「手机号格式不正确」而无法登录；注册链接过期后页面只剩一条红色警告，连登录入口都没有。

**决策**：抽出共享组件 `frontend/src/components/auth/LoginForm.vue`，两处复用同一实现。

| 项 | 收敛前 | 收敛后 |
|---|---|---|
| 表单实现 | 两处各写一套 | 一处（组件） |
| 标识字段 | 账号 / 仅手机号 | **账号或手机号**（11 位手机号走 `loginWithPhone`，其余走 `login`） |
| 登录后去向 | `/login` 尊重 `?redirect=`；注册页固定 `/` | 组件只 `emit('success')`，去向由页面决定（行为不变） |
| 链接失效 | 仅告警，无登录入口 | 告警 + **保留登录**（token 只与注册授权相关，与登录无关） |
| 管理后台登录 | `AdminLoginView` | 不变（`role=admin` 门槛属独立场景，不合并且不复用） |

**契约影响**：无。后端 `POST /api/admin/auth/login` 早已支持 `user_id` / `phone` 二选一
（`contracts/auth-api.md` §2.1），本次只让前端在同一个输入框里做形态分流。

**验证**：`frontend` typecheck 通过；1527 tests / 132 files 全绿（新增 `LoginForm.spec.ts` 10 例，
`RegisterView.spec.ts` 扩到 8 例）；`eslint` 0 error（5 个存量 warning 位于 gantt 相关文件）。

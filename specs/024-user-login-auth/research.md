# 研究：用户登录与鉴权（方案 A）

**特性**：`024-user-login-auth` | **日期**：2026-11-17

本文件收敛本特性的全部技术决策。格式统一为：决策 / 理由 / 被否决的替代方案。

## D1 身份权威源：admin-backend（平台），运行环境只验签不碰密码

- **决策**：登录校验与密码存储**只在** `admin-backend`；`agent-backend` 不持有、不比对密码，只验签凭据并解析"当前用户"。
- **理由**：符合"平台是配置唯一权威源"与"单向数据流"的既定架构；运行侧保持对密码零感知，删除/替换认证实现不影响运行侧数据域。
- **否决**：① agent-backend 存密码（破坏权威源边界，且密码需同步到运行环境目录，违反"密码不部署"）；② agent-backend 代理登录并反查 admin（每请求多一跳，破坏 P95，且运行侧仍需感知账号体系）。

## D2 凭据形态：标准 JWT（`jose`，HS256）

- **决策**：登录凭据用标准 JWT，`jose` 库签发（admin）与验签（agent），HS256 共享密钥。
- **理由**：JWT 是事实标准，与"后续升级/替换为专业方案（Keycloak/OIDC/CAS）"直接对齐——专业方案同样签发 JWT，届时只换签发方、验签方几乎不动；`jose` 纯 JS、零原生依赖、体积小、无平台差异。
- **否决**：① 手写 HMAC 紧凑 token（零依赖但非标准，claims/过期/验签都需自造且易错，替换时被整体废弃）；② `jsonwebtoken`（体积大、CVE 史，已被 `jose` 取代的旧选型）。

## D3 密码哈希：Node 内置 `crypto.scrypt`

- **决策**：密码以 `scrypt` 摘要存储（随机盐，`N=16384, r=8, p=1`），自描述记录 `{ algo, params, salt, hash }`。
- **理由**：内存难解（抗 GPU 暴力），Node 内建**零依赖**，纯 JS 无平台差异；自描述结构为未来换算法（如 argon2）留迁移口。
- **否决**：① bcrypt（`bcrypt`/`bcryptjs` 依赖，原生/纯 JS 两难）；② argon2（原生模块，平台差异风险）；③ pbkdf2（弱于 scrypt）。

## D4 凭据载体：HttpOnly Cookie（`optagent_auth`）

- **决策**：登录凭据经 HttpOnly Cookie 下发（`Path=/`、`SameSite=Lax`、`Max-Age=TTL`，登出置 0），Cookie 名 `optagent_auth`。
- **理由**：聊天前台有 `EventSource` 通道（MCP 状态推送），**无法自定义请求头**；HttpOnly Cookie 由浏览器同源自动携带，两条 SSE 都天然支持，且防 XSS 读取。
- **否决**：① Bearer header（`EventSource` 带不了 header，需改造成 fetch-SSE，侵入大）；② localStorage（XSS 可读，安全性差）。
- **命名**：刻意**不复用**旧 sa-token 的 `Authentication`（那是 `/dataApi` 排产服务的残留，语义与系统都不同，混用会互相干扰）。

## D5 运行侧身份注入：`AsyncLocalStorage` + `onRequest` 钩子

- **决策**：agent-backend 用 `AsyncLocalStorage` 承载请求级 `userId`；`onRequest` 钩子验签后 `ALS.run({ userId }, next)`；`getCurrentUser()` 签名不变、内部改读 ALS。
- **理由**：`getCurrentUser()` 是 53 处调用点的**唯一身份来源**，ALS 让这些调用点零改动；Node 内建零依赖。
- **否决**：① 给 53 处传 `req`（侵入大）；② `@fastify/request-context`（新增依赖，且仍要改调用点）。

## D6 鉴权边界：用户级端点全保护，平台级只读投影白名单开放

- **决策**：除白名单（`/api/monitor/health`、`/api/monitor/agents`、`/api/builtin-tools`、`/api/mcp-call-stats`）外，所有 `/api/*` 均要求有效凭据。
- **理由**：这四个是**平台级只读投影**，由 admin-backend 的 `RuntimeClient` 以平台身份采集，不携带用户凭据；与"管理台本期不鉴权"口径一致。
- **否决**：全量保护（会打断平台观测）；为这 4 个端点引入"服务间令牌"（过度设计，本期不做，登记为后续项）。

## D7 登录态探针：`GET /api/admin/auth/me`

- **决策**：前端以 `/me` 为"是否已登录"的**唯一探针**，路由守卫异步探针 + 记忆化。
- **理由**：HttpOnly Cookie 前端 JS 读不到，必须由服务端回答"我是谁"；`/me` 轻量、无副作用、可记忆化避免重复请求。
- **否决**：① 可读 cookie 标记（不安全、可伪造）；② 纯前端本地标记（刷新易错、可伪造）。

## D8 登录失败不枚举：单一 `ADM_INVALID_CREDENTIALS`

- **决策**：登录失败（账号不存在 / 密码错误 / 存量无密码）统一返回 401 `ADM_INVALID_CREDENTIALS`，同一文案。
- **理由**：防账号枚举；符合规格 `FR-011`。
- **否决**：区分"账号不存在"与"密码错误"（可被枚举）。

## D9 回滚/降级：agent 侧密钥可选、admin 侧必填

- **决策**：admin-backend 的 `AUTH_SECRET` **必填**（签发方，缺失拒绝启动并给可读报错）；agent-backend 的 `AUTH_SECRET` **可选**（缺失即鉴权钩子放行、`getCurrentUser()` 回退 `BUILTIN_ADMIN`，等价于改造前单用户行为）。
- **理由**：agent 侧可选使回滚 = "不配密钥即回退"（对应 §11"回滚=移除校验钩子"），且不破坏存量单机单用户部署；admin 侧是登录入口，缺失必须显式失败而非静默。
- **否决**：两侧都强制（存量单机部署需改动即不可用）；两侧都可选（登录静默不可用，违反"不掩盖问题"）。

## D10 错误码：新增两个、复用两个

- **决策**：新增 `ADM_INVALID_CREDENTIALS`（401，登录失败）与 agent 侧 `UNAUTHENTICATED`（401，凭据缺失/无效）；复用已预登记的 `ADM_UNAUTHENTICATED`（`/me` 探针）与 `ADM_FORBIDDEN`（预留不启用）。
- **理由**：语义互不重叠，符合宪章"同码不同义禁止"；登录失败与受保护资源 401 必须分离（前端据此决定是否跳登录）。
- **否决**：复用同一码表达"密码错"与"未登录"（前端无法区分，误跳登录）。

## D11 会话模型：无状态 JWT + 平台侧"每账号当前会话标识"登记

- **决策**：JWT 仍无状态，但新增每账号"当前唯一会话标识"登记（`.platform-data/sessions/{uid}.json`）；登录生成 `session_id`（JWT `jti`）并覆盖旧会话，登出/删除用户即清除。
- **理由**：单会话（后登踢前登）本质需要"每账号当前有效会话"这一共享状态，纯无状态 JWT 无法表达"踢人"；轻量文件登记即可满足，无需独立会话服务。
- **否决**：① 纯客户端清 Cookie（无法踢掉另一端旧会话）；② 独立会话数据库/服务（内部工具 + <100 用户，过重）。

## D12 存量用户：无密码不可登录，管理员补设，不批量迁移

- **决策**：存量用户记录无 `password` 字段即不可登录（走统一 `ADM_INVALID_CREDENTIALS`）；管理员按需补设；不发起批量迁移专项。
- **理由**：不制造"默认空密码"这类安全后门；不引入没有入口的批量造密码流程。
- **否决**：① 默认空密码（危险）；② 批量生成随机密码（无分发通道，徒增噪音）。

## D13 单会话判定：运行侧"验签 + 会话内省（短缓存）"

- **决策**：agent-backend 验签后调 admin-backend 的 `GET /api/admin/auth/session/valid` 确认 `jti` 仍为当前会话，配 1~2 秒本地缓存；被踢 → 401 `SESSION_REVOKED`；内省不可达 → 放行 + 告警。
- **理由**：会话权威源在平台侧，运行侧必须经内省读取；短缓存把稳态额外耗时摊薄到 P95 ≤ 5ms；不可达时降级避免平台故障锁死用户。
- **否决**：① 运行侧纯本地比对（无法跨服务共享会话状态）；② 逐请求实时内省无缓存（P95 恶化）；③ 内省不可达一律拒绝（平台短暂故障即全员不可用）。

---

## 结论

- 新增依赖**仅 `jose`**（D2 已记录理由与被否决方案），其余全部 Node 内建能力。
- 无 `NEEDS CLARIFICATION` 残留；凭据契约（Cookie 名 / claims 含 `jti` / 端点 / 错误码）冻结于 `contracts/auth-api.md`。
- 依赖方向：运行侧对平台侧仅存在"会话内省"一条受限读依赖（不感知密码/用户记录）；替换专业认证的路径 = 换 admin-backend 签发方（D1/D2），其 token introspection 正是同形，agent 侧验签与前端登录态几乎不动。

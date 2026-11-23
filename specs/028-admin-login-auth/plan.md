# 实现计划：数字人管理平台登录授权入口

**特性目录**：`specs/028-admin-login-auth`　**分支**：`028-admin-login-auth`　**日期**：2026-11-23
**规格**：[`spec.md`](./spec.md)　**研究**：[`research.md`](./research.md)
**影响侧**：`admin-frontend`（新增登录页与登录态守卫）、`admin-backend`（新增登录态端点、转发既有管理员登录接口、启用管理接口未认证拦截）；`gateway` 无需改动；`frontend` / `agent-backend` 不改。

## 1. 摘要

管理平台（`/admin/`）首次访问必须先看到登录页；管理员以账号密码登录，校验**委托既有认证中心**（`POST /api/auth/admin/login`，实测 `admin/123456` 成功），本平台**不重写**任何密码校验逻辑，只做三件事：

1. **登录态承载**：管理后端新增三个端点（登录 / 探针 / 登出），把认证中心返回的凭据换成本平台自签的 HttpOnly 会话 Cookie（浏览器脚本不可读），有效期为"认证中心 `expiresIn`"与"平台上限"的较小值。
2. **前端守卫**：应用启动先探针；未登录只渲染登录页，登录后回到原目标页面；提供退出登录（二次确认）。
3. **接口守卫**：管理后端对 `/api/admin/*`（除 `/api/admin/auth/*` 与 CORS 预检）统一校验控制台会话，缺失/失效返回 401 `ADM_UNAUTHENTICATED` —— 即契约 §11「身份与分权」此前预登记、本期正式生效的部分。

**不做**：新增后端服务、管理员注册/改密/找回、角色与细粒度权限、多端互踢（认证中心未提供管理员会话撤销/内省接口）。

## 2. 技术上下文

| 项 | 内容 |
|---|---|
| 语言/版本 | TypeScript（两端一致，Node ≥ 20） |
| 前端 | Vue 3.5 `<script setup>` + 自建极简路由（`src/router.ts`，**不引入 vue-router**）+ 原生 `fetch` 封装（`src/api/http.ts`）；零第三方运行时依赖 |
| 后端 | Fastify 5 + zod + `jose`（已存在，用于 024 会话签名）；无新增依赖 |
| 存储 | 无新增存储：控制台会话是无状态 JWT（签名 Cookie）；认证中心负责账号存储 |
| 测试 | Vitest（`admin-backend`：`tests/unit` + `tests/integration`；`admin-frontend`：与源码同目录 `*.spec.ts`）+ `@vue/test-utils` + jsdom |
| 目标平台 | Linux 容器（部署）+ Windows 宿主机（开发与门禁执行） |
| 项目类型 | 前后端分离的 Web 管理台（管理侧两端） |
| 性能目标 | 登录、探针、登出非流式 P95 ≤ 500ms（不含认证中心自身耗时）；守卫校验为本地验签，额外开销 P95 ≤ 5ms。**测量口径**：本地连跑 20 次取服务端 `reply.elapsedTime` 的 P95；守卫额外开销 = 启用/关闭钩子两次采样的 P95 之差；前端交互反馈以状态切换耗时计时 |
| 约束 | 凭据 MUST NOT 进入前端可读存储；错误码四处同步（契约 / 后端码表 / 前端常量 / 前端文案）；单文件 ≤ 500 行；不引入新依赖 |
| 规模 | 后端新增 3 个端点 + 1 个守卫钩子；前端新增 1 个页面 + 1 个 composable + 1 个 api 模块 |

**外部依赖（已就绪，只调用不改造）**：认证中心 `http://192.168.0.156:8999/dh-auth-center`，`POST /api/auth/admin/login`。实测契约见 `research.md` D2。

## 3. 宪章检查（Constitution Check）

*门禁：Phase 0 前一次，Phase 1 设计后复核一次。*

| 原则 | 本计划的落实 | 结论 |
|---|---|---|
| 一、中文文档与规格驱动 | 本特性规格/计划/研究/契约/快速验证全部中文；契约变更（§11 生效、新增错误码、新增端点）在同一次改动中回写 `specs/001-digital-human-platform/contracts/admin-api.md` | ✅ |
| 二、代码质量与模块化 | 后端：`routes/console-auth.ts`（接口层）→ `domain/auth/console-service.ts`（业务层）→ `infra/auth-center-client.ts`（外部访问）；前端：`components/auth/LoginPage.vue` → `composables/useConsoleAuth.ts` → `api/console-auth.ts`。每个文件单一职责、均 < 500 行；登录态判定唯一来源（`useConsoleAuth` + `console-token`） | ✅ |
| 三、测试完备性 | 后端每端点集成测试（含 401/503/业务码失败）+ 领域/基础设施单测；前端 `LoginPage` / `useConsoleAuth` / `console-auth` api 各自同名 spec；新增模块纳入 `vite.config.ts` 的 80% 清单；全部在宿主机本地执行 | ✅ |
| 四、无障碍 | 登录页为原生 `<form>` + `<label for>` + `<button>`；字段错误用 `aria-describedby` 关联 + `role="status"` 播报；密码显隐按钮带 `aria-pressed`；错误区 `aria-live`；失败自动聚焦首个错误字段 | ✅ |
| 五、性能与一致性 | 守卫为本地 JWT 验签（无网络往返）；登录按钮请求中禁用防重复提交；退出二次确认；无 N+1、无新增渲染热点 | ✅ |
| 六、依赖治理 | **零新增依赖**：签名复用 `jose`，HTTP 复用全局 `fetch` + `AbortController`（沿用 `infra/runtime-client.ts` 模式） | ✅ |
| 七、接口契约与前后端一致 | 新增 `contracts/console-auth-api.md`（唯一契约来源）；后端错误码表、前端常量与文案、集成测试四处同步；前端不硬编码认证中心地址（仅在管理后端配置中） | ✅ |
| 八、测试与部署简单可控 | 两端各有单命令门禁；认证中心地址走 `.env*`；部署后以 `curl` 冒烟（登录成功/失败、未登录 401）而非"点界面看" | ✅ |
| 九、优雅降级与故障可观测 | 认证中心不可达/超时/非预期响应 → 503 `ADM_AUTH_CENTER_UNREACHABLE` + 可读提示，**不放行**；原始错误落结构化日志（含 `req_id`）；超时有界（默认 5s）；降级路径有测试 | ✅ |

**结论**：无违反项，无需 Complexity Tracking 例外。

## 4. 存量补测待办结论（宪章 §治理 要求）

宪章文首待办 1 要求"存量补测顺序与范围 MUST 在下一个特性的 `plan.md` 给出结论"。本特性结论：

- **本期不发起存量补测专项**（宪章明确禁止），且本特性改动集中在 `admin-frontend` / `admin-backend`，不触及 `frontend/src/api/**` 与 `frontend/src/composables/**` 这 20 个 0% 模块。
- **建议顺序（供后续特性排期）**：① 先补 `frontend/src/composables/useAuth.ts` 与 `useWorkspace.ts` 这类"承载登录态/数据域"的模块（安全与数据隔离风险最高，且与本特性同属身份链路）；② 再补 `frontend/src/api/**` 中与登录/用户相关的 2 个模块；③ 其余按"被 spec 直接消费的频次"从高到低补齐。
- **范围口径**：只补同名 `*.spec.ts`，不重构被补模块；单次专项不超过 5 个模块，避免"为凑覆盖率"扩大改动面。

## 5. Phase 0：研究结论（详见 `research.md`）

| 编号 | 决策 | 一句话理由 |
|---|---|---|
| D1 | 浏览器 → 平台同源 `/api/admin/auth/admin-login` / `admin-me` / `admin-logout` → 管理后端 → 认证中心（**同源中转**） | 认证中心 CORS 只回显请求 Origin、生产域名未登记；且凭据不进前端可读存储；路径置于 `/api/admin/` 下才能被网关分发到管理服务 |
| D2 | 认证中心结果**按业务码**判定（HTTP 恒 200） | 实测 `code=0` 成功、`code=401` 账号或密码错误；只看 HTTP 状态会把失败当成功 |
| D3 | 控制台会话 = 自签 HS256 JWT（复用 `AUTH_SECRET`），独立 Cookie `optagent_console` + 独立 `aud` | 与 024 业务使用者会话物理隔离，互不踢出、互不认账 |
| D4 | 管理接口守卫用 `onRequest` 钩子，仅放行 `/api/admin/auth/*` 与 `OPTIONS` | 契约 §11 的"校验钩子"落点；一次性覆盖全部业务端点 |
| D5 | 前端不引入 vue-router：App 根组件按登录态切换"登录页 / 应用外壳" | 保持零依赖与既有路由模型；守卫逻辑单点 |
| D6 | 登录态过期用统一 401 钩子（`http` 的 `onUnauthorized`）触发回登录页 | 避免每个调用点各写一套过期处理（唯一职责来源） |
| D7 | 会话 TTL = `min(认证中心 expiresIn, AUTH_CONSOLE_TTL_SECONDS)`（默认 12h） | 不让平台会话活得比认证中心凭据更久 |

## 6. Phase 1：设计与契约

- **数据模型**：[`data-model.md`](./data-model.md)（登录请求/响应、控制台会话 claims、Cookie 属性、前端登录态状态机、校验规则）
- **接口契约**：[`contracts/console-auth-api.md`](./contracts/console-auth-api.md)（3 个端点 + 错误码 + 守卫规则 + 与 §11/§12 的关系）
- **验证指南**：[`quickstart.md`](./quickstart.md)（本地启动、验收步骤、门禁命令、部署冒烟）

### 6.1 后端改动（`admin-backend`）

```text
src/
├── config.ts                       # + AUTH_CENTER_URL / AUTH_CENTER_TIMEOUT_MS / AUTH_CONSOLE_TTL_SECONDS
├── context.ts                      # + consoleAuth（AppContext 注入）
├── server.ts                       # + 注册控制台路由；+ onRequest 守卫钩子
├── routes/
│   └── console-auth.ts             # 新增：登录 / 探针 / 登出（接口层，只管 HTTP）
├── domain/
│   ├── error-codes.ts              # + ADM_AUTH_CENTER_UNREACHABLE（503）
│   └── auth/
│       ├── console-token.ts        # 新增：控制台会话签发/验签（独立 Cookie 与 audience）
│       └── console-service.ts      # 新增：编排"调用认证中心 → 签发 → 校验 → 清除"
└── infra/
    └── auth-center-client.ts       # 新增：认证中心管理员登录客户端（超时/错误映射）
tests/
├── unit/
│   ├── console-service.spec.ts     # 编排：登录成功/异常映射/TTL 截断/验签失败
│   ├── console-token.spec.ts       # 签发与验签、过期、篡改、aud 隔离
│   └── auth-center-client.spec.ts  # 业务码映射、非 JSON、超时
├── integration/
│   └── console-auth.spec.ts        # 端点 + 守卫（无 Cookie 401、写接口无副作用、024 端点不受影响、双登录并存）
└── helpers/fixture.ts              # 默认注入有效控制台会话 Cookie（可显式关闭）
```

- `.env`（Docker 形态）与 `.env.example` 增补 `AUTH_CENTER_URL=http://192.168.0.156:8999/dh-auth-center`；`.env.local`（本地形态）同值，注释说明"内网地址，容器可直连"。
- 守卫仅对 `/api/admin/` 前缀生效，**排除** `/api/admin/auth/`（024 的业务使用者登录、会话内省与本期控制台端点），避免破坏既有契约。

### 6.2 前端改动（`admin-frontend`）

```text
src/
├── App.vue                         # 按登录态渲染 LoginPage / AppShell；登录后恢复原目标路径
├── App.spec.ts                     # 三态守卫、登录后落原路径、退出回登录页、后退不可绕过
├── api/
│   ├── console-auth.ts             # 新增：login / me / logout
│   ├── http.ts                     # + onUnauthorized 钩子（未认证统一回登录页）
│   └── types.ts                    # + 控制台会话类型
├── composables/
│   └── useConsoleAuth.ts           # 新增：状态机、探针、登录、退出（登录态唯一来源）
├── components/
│   ├── auth/
│   │   ├── LoginPage.vue           # 新增：管理员登录页（原型一致 + 无障碍）
│   │   └── LoginPage.spec.ts
│   └── layout/
│       ├── AppShell.vue            # + 当前账号与「退出登录」（ConfirmDialog 二次确认）
│       └── AppShell.spec.ts        # 新增（该组件此前无 spec）
├── constants/error-messages.ts     # + ADM_AUTH_CENTER_UNREACHABLE 文案
├── composables/useConsoleAuth.spec.ts
└── api/console-auth.spec.ts
```

- 路由**不变**（不新增 `/login` 路由名）：未登录时 URL 保持原路径，登录成功后自然回到该路径，刷新后仍落在原功能区。
- 登录页字段与交互对齐原型：品牌区（数字人管理平台）+「管理员登录」标题 + 账号 + 密码（显隐）+ 登录按钮 + 失败提示区；**不**带入原型的演示账号、普通用户入口与"原型说明"。
- `vite.config.ts` 覆盖率清单新增：`src/api/console-auth.ts`、`src/composables/useConsoleAuth.ts`（80% 门禁）。

### 6.3 既有契约同步（宪章原则七 · 四处同步）

| 位置 | 变更 |
|---|---|
| `specs/001-digital-human-platform/contracts/admin-api.md` §0.4 | 新增 `ADM_AUTH_CENTER_UNREACHABLE`（503） |
| 同上 §11 | 状态从"预登记、未实施"改为"已实施（028）：`/api/admin/*` 统一 401 拦截，放行清单见 028 契约" |
| 同上 §12 | 新增一行指向 `specs/028-admin-login-auth/contracts/console-auth-api.md` |
| `admin-backend/src/domain/error-codes.ts` + `admin-frontend/src/constants/error-messages.ts` | 同步新码与中文文案 |
| `admin-backend/tests/integration/console-auth.spec.ts` | 覆盖新码与新端点（`check:contract` 依赖四处一致） |

## 7. 部署与风险

| 风险 | 处理 |
|---|---|
| 容器访问内网认证中心（`192.168.0.156:8999`）是否可达 | `.env` 显式配置；部署冒烟含一次真实登录打点；不可达时返回 503 且界面可读（不静默放行） |
| 管理接口守卫改变既有行为（此前无鉴权） | 属契约 §11 既定方向；回滚 = 移除 `onRequest` 钩子（数据侧无残留）；集成测试以"默认已登录"夹具保证 250+ 既有调用零改动 |
| 测试夹具默认注入会话可能掩盖守卫缺陷 | 专门集成用例显式**不带** Cookie 断言 401；夹具提供关闭开关 |
| Windows/Linux 平台差异 | 本期不涉及原生模块/路径语义；行尾符由 Prettier 统一；冒烟在容器内执行一次 |
| 认证中心凭据格式变化（字段名/业务码） | 客户端集中映射（`auth-center-client.ts`），契约文档记录实测值；变化只需改一处 + 单测 |

## 8. 复杂度追踪（Complexity Tracking）

无宪章违反项，本节留空（仅登记一个非违反性权衡）：

| 权衡 | 选择 | 被否决的方案 |
|---|---|---|
| 管理接口守卫的作用域 | 全量 `/api/admin/*`（排除 `/auth/*`） | 仅保护新增端点：会让"已登录才可操作"停留在前端假象（原则九禁止假绿） |
| 登录凭据前端可见性 | 服务端 HttpOnly Cookie | `localStorage` 存 accessToken：XSS 可直接窃取，且与 024 凭据形态不一致 |

## 9. 完成定义（供 `/speckit.tasks` 拆解）

- 后端：3 端点 + 守卫钩子 + 客户端 + 配置；单测 + 集成测试；`npm run lint / typecheck / test / test:coverage / build` 全绿。
- 前端：登录页 + composable + api + 外壳账号区；4 个 spec；`npm run lint / typecheck / test:coverage / build` 全绿。
- 文档：契约、数据模型、快速验证、规格修订记录、`admin-api.md` 三处同步全部落地。
- 冒烟：容器内 `curl` 完成"未登录 401 → 登录 200 → 带 Cookie 访问业务端点 200 → 登出 204 → 再访问 401"。

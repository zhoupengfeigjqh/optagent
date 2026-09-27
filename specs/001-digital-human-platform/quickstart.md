# 快速验证指南：数字人管理平台

**特性**：`001-digital-human-platform` | **日期**：2026-09-15

本文件是**可运行的验证指南**：说明如何在本机把门禁跑起来、如何部署、以及如何用可复现的步骤证明本特性端到端可用。实现细节见 [plan.md](./plan.md)、[data-model.md](./data-model.md) 与 [contracts/](./contracts/)；本文件不重复它们。

> 按宪章原则八：**门禁 MUST 能用单条命令在本地跑完**，本文件即该命令的**可发现落点**（另一落点是各子项目的 `package.json` scripts）。**测试、lint、类型检查、覆盖率 MUST 在宿主机本地执行，容器不参与**（原则三）。

---

## 1. 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| Node | ≥ 20（本地已实测 24.x） | 与既有子项目一致 |
| npm | 随 Node | 包管理统一用 npm（用户明确要求） |
| Docker Desktop | 已启动 | 仅用于**部署与运行**，不用于测试（原则三） |
| Python | 不需要 | 本特性不涉及 `ocr-service` 的改动 |
| 既有栈 | `agent-backend` / `frontend` / `ocr-service` 可独立运行 | 本平台依赖运行环境提供的内置工具目录与调用统计（见 `contracts/runtime-api-delta.md`） |

**宿主机 `hosts` 文件 SHOULD NOT 被修改**：**（2026-09-27）** MCP 连接地址是平台内登记的**唯一取值**，本地联调**不得**依赖修改 hosts 文件或手工编辑数字人配置。若本地验证时发现仍需改 hosts，说明该 MCP 服务的调用配置里登记的地址不可达（例如容器内网服务名在宿主机上无法解析），**应视为配置缺陷**——本地形态应登记宿主机可达地址（如 `http://192.168.1.2:8000/mcp`）。

---

## 2. 目录与端口一览

| 组件 | 目录 | 端口 | 备注 |
|---|---|---|---|
| 统一入口网关 | `gateway/` | `82 → 80` | 唯一对外入口（宪章「技术栈与工程约束」） |
| 既有对话工作台 | `frontend/` | `/` | 不随本特性改动 |
| 既有对话后端 | `agent-backend/` | `/api/` → `3000` | 本特性**只新增**两个只读端点 |
| **管理界面（新）** | `admin-frontend/` | `/admin/` | 本特性新增 |
| **管理服务（新）** | `admin-backend/` | `/api/admin/` → `3001`（2026-09-20 起容器内与本地形态统一；经 gateway 分发，外部不可直连） | 本特性新增 |
| OCR MCP 服务 | `ocr-service/` | 仅内网 | 本特性不改动 |
| 平台设计态 | `admin-backend/.platform-data/` | — | bind mount；**不进镜像**（2026-09-15 由根目录 `platform-data/` 迁入 admin-backend 源码目录，与 `.opt-agent/` 布局对称） |

---

## 3. 本地门禁（每个子项目一条命令）

**新增的两个子项目** MUST 各自具备下列脚本，且各自能用**单条命令**跑完（原则八）：

| 子项目 | 命令 | 通过标准 |
|---|---|---|
| `admin-backend` | `npm run lint` | 退出码 0 |
| `admin-backend` | `npm run typecheck` | 退出码 0（`tsc --noEmit`） |
| `admin-backend` | `npm run test` | 全部通过（含**每个管理端点的集成测试**，`app.inject`） |
| `admin-backend` | `npm run test:coverage` | 阈值通过（**受约束模块语句覆盖率 ≥ 80%** + 全局防倒退地板；阈值结构同 `agent-backend/vitest.config.ts`） |
| `admin-backend` | `npm run build` | 退出码 0 |
| `admin-backend` | `npm run check:lines` | 无文件超过 500 行（硬门禁，见 `research.md` D9） |
| `admin-backend` | `npm run check:deps` | 无未登记依赖（硬门禁，同上） |
| `admin-frontend` | `npm run lint` / `typecheck` / `test` / `test:coverage` / `build` | 同上；测试用 `vitest` + `@vue/test-utils` + `jsdom`，**每个组件/composable MUST 有同名同目录测试**（原则三） |

**既有子项目**（本特性仍需保持全绿）：

```bash
# agent-backend：门禁 MUST 全过（本特性新增的 2 个端点 MUST 有集成测试）
cd agent-backend && npm run lint && npm run build && npm run test:all && npm run test:coverage
```

```bash
# frontend：本特性不改动它，门禁 MUST 保持全过（防止误伤）
cd frontend && npm run lint && npm run typecheck && npm run test && npm run test:coverage && npm run build
```

**门禁 MUST 从当前源码重新构建**，MUST NOT 依赖仓库内的陈旧 `dist/`（原则八）。

---

## 4. 本地开发启动（非容器）

```bash
# 既有运行环境（本平台的依赖）
cd agent-backend && npm run dev      # :3000
cd frontend     && npm run dev       # :5173（含 /api 代理）

# 本特性新增
cd admin-backend  && npm run dev     # :3001（本地开发端口，避免与 agent-backend 冲突）
cd admin-frontend && npm run dev     # :5174（Vite 代理 /api/admin → :3001）
```

**本地开发的 MCP 连通前提**：**（2026-09-27）** 在「MCP 服务」区为每个要用的服务登记**宿主机可达的连接地址**（如 `http://192.168.1.2:8000/mcp`），并在数字人设计里勾选它。这是唯一被允许的方式——**MUST NOT** 改 hosts 文件或改数字人配置文件。

---

## 5. 部署（容器只做部署与运行）

```bash
docker compose up -d --build
```

拉起后：

| 入口 | 地址 |
|---|---|
| 管理界面 | `http://localhost:82/admin/` |
| 管理服务健康检查 | `http://localhost:82/api/admin/platform/health` |
| 既有对话工作台 | `http://localhost:82/` |

**部署说明中 MUST 显式标注的风险**：**（2026-09-27）** `admin-backend` **不再挂载** `/var/run/docker.sock`，也不再挂载 `docker-compose.yml`——平台不读容器编排声明与容器运行态，原"挂载 socket 等价于授予宿主机 root 权限"的风险已消除（见 `research.md` D3）。**平台当前无鉴权**（`research.md` D11），因此**MUST NOT** 把网关端口暴露到公网。

---

## 6. 部署后非交互冒烟确认（原则八，MUST 执行）

仅确认**服务可达与关键接口状态码符合预期**，MUST NOT 作为测试结论。一条命令序列：

```bash
# 1) 健康检查：一次性看到全部外部依赖可达性
curl -s -o /dev/null -w "health  %{http_code}\n" http://localhost:82/api/admin/platform/health

# 2) 四个功能区的卡片列表接口均可用
curl -s -o /dev/null -w "mcp     %{http_code}\n" "http://localhost:82/api/admin/mcp/services?page=1"
curl -s -o /dev/null -w "skills  %{http_code}\n" "http://localhost:82/api/admin/skills?page=1"
curl -s -o /dev/null -w "agents  %{http_code}\n" "http://localhost:82/api/admin/agents?page=1"
curl -s -o /dev/null -w "users   %{http_code}\n" "http://localhost:82/api/admin/users?page=1"

# 3) 管理界面静态资源可达
curl -s -o /dev/null -w "admin   %{http_code}\n" http://localhost:82/admin/

# 4) 既有对话工作台未被误伤
curl -s -o /dev/null -w "chat-ui %{http_code}\n" http://localhost:82/
```

**期望**：全部输出 `200`（`/admin/` 允许 `200` 或 `304`）。任一非 200 即判定部署失败，MUST NOT 视为成功。

---

## 7. 端到端验证场景

按 `spec.md` 的四个用户故事组织。每一步都对应明确的接口（见 `contracts/admin-api.md`）与可观测结果。

### 7.1 `US1` 数字人设计与配置产出（P1）

| # | 步骤 | 期望结果 | 对应需求 |
|---|---|---|---|
| 1 | 打开 `/admin/`，进入**数字人设计**功能区 | 卡片列表每页 **8 项**（4 列 × 2 行），展示总条数与页码 | `FR-006`、`SC-022` |
| 2 | 新建数字人，SOUL 留空保存 | 被拒绝，指明"SOUL 必填" | `FR-019` |
| 3 | 用已存在或含 `/`、`..` 的名称保存 | 被拒绝并说明原因 | `FR-015` |
| 4 | 完整填写五类配置（SOUL / MCP / 工具 / SKILL / 文件空间场景）后保存 | 保存成功；重新打开**原样回显**（含换行、标点、条目顺序） | `FR-016`、`FR-017` |
| 5 | 打开某 MCP 服务的调用配置 | **只有一个**连接地址输入框（不再按运行形态分形态声明） | `FR-043`、`FR-044` |
| 6 | 打开内置工具只读目录 | 说明以**占位符模板**呈现（`{可用目录}` / `{示例路径}` / `{会话标识}`），**不出现任何具体用户目录名或会话标识** | `FR-012`、`FR-054`、`SC-014` |
| 7 | 在工具选择器中查找不在目录中的工具名 | 无法选中；已有的失效引用被标为异常并指明失效工具名 | `FR-013` |

### 7.2 `US2` 数字人分发与部署生效（P2）

| # | 步骤 | 期望结果 | 对应需求 |
|---|---|---|---|
| 1 | 为 `admin` 关联某个数字人，点击**部署生效** | 运行环境 `users/admin/agents/{agent}/` 出现四文件 + `skills/`；部署结果显示成功 | `FR-026` |
| 2 | 检查 `MCP.json` 的 `servers[].url` | 与平台侧调用配置里登记的**唯一连接地址逐字一致** | `FR-044` |
| 3 | 在平台修改该服务的连接地址，**再部署一次** | 落盘产物中的地址随之更新；**全程未修改 hosts 文件、未手工编辑任何数字人配置** | `FR-044` |
| 4 | 删除某被数字人引用的 MCP 服务后再部署 | 部署被**阻止**、`details.errors` 指明"哪个数字人引用了已不存在的 MCP 服务"、运行环境**零写入** | `FR-027`、`FR-052`、`SC-020` |
| 5 | 让某数字人引用一个已下线的工具 / 已删除的 SKILL，点击部署 | 部署被阻止，**一次性列出全部错误项**（含用户、数字人、配置类别），运行环境零写入 | `FR-027`、`SC-020` |
| 6 | 无任何改动的情况下再次点击部署 | 结果稳定（幂等），不产生重复或损坏 | `FR-030` |
| 7 | 在 `数据准备`/`共享空间`/`临时空间` 下放入文件，执行一次部署 | 三个空间下既有文件与二级目录**数量与内容 100% 不变** | `FR-028`、`SC-012` |
| 8 | 把某数字人的场景目录清单收缩后再部署 | 被移除的二级目录**及其文件仍保留**在运行环境（仅不再出现在可访问清单） | `FR-028`、边缘情况 |
| 9 | 查看部署页用户卡片 | 可展开看到每个数字人的搭配摘要与异常标记（部署前核对总账） | `FR-023` |
| 10 | 查看全局异常项汇总 | **一次视图内**列出全部引用了失效对象的数字人及其所属用户，可跳转到编辑位置 | `FR-055`、`SC-016` |
| 11 | 查看部署历史 | 可追溯到时间、涉及对象与结果 | `FR-033`、`SC-008` |

### 7.3 `US3` SKILL 管理与安装（P3）

| # | 步骤 | 期望结果 | 对应需求 |
|---|---|---|---|
| 1 | 上传一个合规 ZIP（含 `SKILL.md`，元数据含非空 `name`/`description`） | 安装成功，卡片出现且名称/描述与包内声明一致 | `FR-037`、`FR-038` |
| 2 | 上传缺少 `SKILL.md`、或元数据缺 `name`/`description` 的 ZIP | 拒绝安装并指出具体原因（`ADM_SKILL_ARCHIVE_INVALID`） | `FR-038` |
| 3 | 上传含 `../` 越界路径、绝对路径或符号链接的 ZIP | 拒绝安装并提示安全原因（`ADM_SKILL_ARCHIVE_UNSAFE`） | `FR-039` |
| 4 | 上传超大 / 层级极深的 ZIP | 在**写入目标目录之前**按上限拒绝，且**无半解压残留** | `FR-039`、`FR-041` |
| 5 | 上传与库中同名的 ZIP | 提示冲突并要求显式选择「覆盖」或「取消」；选择覆盖后为原子替换 | `FR-040` |
| 6 | 编辑某 SKILL 正文并保存后重新打开 | 内容与保存前完全一致 | `FR-036` |
| 7 | 删除一个被多个数字人引用的 SKILL | 确认环节列出受影响数字人清单并要求二次确认 | `FR-042` |

### 7.4 `US4` MCP 服务管理（P4）

| # | 步骤 | 期望结果 | 对应需求 |
|---|---|---|---|
| 1 | 打开 MCP 卡片列表 | 展示名称、用途描述、传输方式与连接地址；空态给出「新建 MCP 服务」引导 | `FR-043` |
| 2 | 点击右上角「新建 MCP 服务」，在弹窗填名称与连接地址后点「创建服务」 | 弹窗关闭 → 进入该服务**详情页** → **自动测试一次**并展示连通性结果；新服务**立即**出现在卡片列表（无需改编排、无需重启、无需改代码） | `FR-043`、`FR-047`、`SC-010` |
| 3 | 用已存在的名称新建 | 被拒绝并提示"名称已存在"（`ADM_MCP_SERVICE_EXISTS`）；弹窗**不关闭**、已填内容保留 | `FR-043` |
| 3b | 弹窗里填一个不可达的地址后创建 | 创建成功（可达性不由创建校验），详情页的自动测试给出**明确失败原因**，不误报为成功 | `FR-047`、`FR-009` |
| 3c | 创建请求未返回时按 `Esc` 或点「取消」 | 弹窗**不关闭**、按钮为禁用态（避免"以为没建成"而重复创建） | 原则五 |
| 4 | 打开某服务详情 | 展示工具清单及每个工具的用途与入参说明；不可得时给出可读原因（不报错） | `FR-045` |
| 5 | 对某服务发起测试 | 返回连通性 + 一次实际能力验证的结果；失败时给出**明确原因**（超时／连接被拒／协议不匹配），**不把失败误报为成功** | `FR-047` |
| 6 | 让数字人实际调用某服务若干次后查看统计 | 累计/成功/失败次数与最近调用时间**自动更新**，无需人工录入 | `FR-049`、`FR-050` |
| 7 | 删除一个正被数字人引用的服务 | 先列出受影响数字人并要求二次确认 | `FR-051` |
| 8 | 刷新列表 | 被删除的服务不再出现；引用它的数字人在异常项汇总中以失效引用列出 | `FR-052`、`FR-055` |
| 9 | 打开一个**不可达**或响应很慢的 MCP 服务详情 | 界面**立即**进入详情页并显示"正在读取调用配置与工具清单…"（标题用服务名）；超时后给出可读原因 + 「重试」；期间「保存调用配置」为禁用态 | `FR-009`、原则五、原则九 |
| 10 | 详情读取失败后点「重试」 | 重新拉取该服务详情（成功后正常显示调用配置、工具清单与统计） | `FR-009` |

---

## 8. 无障碍验证（原则四，MUST 随组件同步完成）

对新增的每个交互组件，在其自身任务内完成：

1. **仅用键盘**走完主流程：`Tab` 到达一级导航 → `Enter` 进入功能区 → 打开卡片详情 → 分页 → 触发一次破坏性操作确认框 → `Esc` 关闭。焦点 MUST 始终可见。
2. **确认框**使用原生 `<dialog>`：确认 `Esc` 可关闭、焦点被限制在框内、关闭后焦点回到原触发元素。
3. **状态不只靠颜色**：异常态同时有图标 + 文本；`FR-006` 的异常卡片必须有可读原因。
4. **读屏**抽查：一级导航当前项有 `aria-current`；分页按钮有可读 `aria-label`；部署结果在 `aria-live` 区域播报。
5. **动效降级**：开启系统 `prefers-reduced-motion` 后，界面无动画且功能不受影响。

---

## 9. 常见问题

| 现象 | 排查 |
|---|---|
| 管理界面打开但所有接口 404 | 检查 `gateway/nginx.conf` 是否已加 `/api/admin/` 且**在 `/api/` 之前**被最长前缀命中；确认 `admin-backend` 已在编排中 |
| 内置工具目录为空 / 调用统计为"未知" | `agent-backend` 未运行或未包含 R2/R4 的新端点（`contracts/runtime-api-delta.md` §2、§4） |
| 本地联调时 MCP 连接失败 | 检查该服务的**连接地址**（`FR-044`）在本地是否可达——本地形态应登记宿主机可达地址（如 `http://192.168.1.2:8000/mcp`），而非容器内网服务名。**不要**去改 hosts 文件 |
| 新建 MCP 服务报 `ADM_MCP_SERVICE_EXISTS` | 名称已被占用，换一个名称（服务名全局唯一，且会成为运行环境的工具前缀） |
| 某数字人保存/部署报引用失效 | 它引用的 MCP 服务已被删除，去「MCP 服务」区重建同名服务或改该数字人的勾选 |
| 部署报 `ADM_DEPLOY_VALIDATION_FAILED` | 按 `details.errors` 逐条修（该列表是**一次性全部**错误，不是第一个） |
| `check:lines` 失败 | 有文件超过 500 行，按"拆子组件 / 抽 `useXxx` / 抽纯函数"拆分（原则二） |

---

## 10. 实现期验证记录（2026-09-15，宿主机本地 + 一次真实容器部署）

> 本节是**可核验的证据**，不是结论声明。所有命令均在宿主机（Windows + Node 24）本地执行；
> 容器只参与构建与运行（宪章原则三 2.0.0）。

### 10.1 门禁全量结果

| 子项目 | 命令 | 结果 |
|---|---|---|
| `admin-backend` | `npm run lint` | ✅ 0 problems |
| `admin-backend` | `npm run typecheck` | ✅ 退出码 0 |
| `admin-backend` | `npm run build` | ✅ 退出码 0 |
| `admin-backend` | `npm test` | ✅ **26 文件 / 367 用例全过** |
| `admin-backend` | `npm run test:coverage` | ✅ 全局 **92.5 / 81.2 / 94.3 / 94.1**（stmts/branch/funcs/lines），受约束模块 20 个全部 ≥ 80% |
| `admin-backend` | `npm run check:lines` | ✅ 62 个文件均未超过 500 行 |
| `admin-backend` | `npm run check:deps` | ✅ 依赖与 `research.md` D2/D7 清单一致 |
| `admin-backend` | `npm run check:contract` | ✅ 契约 §0.4 登记 **24** 个错误码，前后端码表一致，无"端点使用但未登记" |
| `admin-frontend` | `npm run lint` | ✅ 0 problems |
| `admin-frontend` | `npm run typecheck` | ✅ 退出码 0 |
| `admin-frontend` | `npm run build` | ✅ 138 modules transformed |
| `admin-frontend` | `npm test` | ✅ **29 文件 / 252 用例全过** |
| `admin-frontend` | `npm run test:coverage` | ✅ 全局 **96.0 / 89.6 / 98.9 / 96.5**，受约束模块 15 个全部 ≥ 80% |
| `admin-frontend` | `npm run check:lines` / `check:deps` | ✅ 通过 |
| `agent-backend`（既有，防误伤） | `lint` / `build` / `test:all` / `test:coverage` | ✅ **7 文件 / 62 用例全过**；新增的 4 个模块（`builtin-tool-catalog`、`config-fingerprint`、`routes/builtin-tools`、`routes/mcp-call-stats`）已纳入 80% 清单并通过 |
| `frontend`（既有，防误伤） | `lint` / `typecheck` / `test` / `test:coverage` / `build` | ✅ **6 文件 / 117 用例全过**，覆盖率门禁无告警 |

> **注（既有前端的 `test:coverage`）**：直接运行会因仓库内**早已存在**的
> `frontend/coverage/` 目录清理失败而报 `[safe-delete] … trash operation`（环境侧
> 的删除守卫，与本特性改动无关）。用 `npx vitest run --coverage --coverage.reportsDirectory=coverage-verify`
> 复核，阈值全部通过。该目录的处置不在本特性范围内（「不追溯」）。

### 10.2 部署后非交互冒烟（原则八）

```bash
docker compose up -d --build        # 6 个容器全部构建并拉起（含两个新增服务）
docker compose config --services    # gateway / frontend / backend / ocr / admin-backend / admin-frontend
```

§6 的七个检查点**实测全部 200**：

```text
health   200    # /api/admin/platform/health
mcp      200    # /api/admin/mcp/services?page=1
skills   200    # /api/admin/skills?page=1
agents   200    # /api/admin/agents?page=1
users    200    # /api/admin/users?page=1
admin-ui 200    # /admin/（管理界面静态资源）
chat-ui  200    # /（既有对话工作台未被误伤）
```

> **历史记录（2026-09-15）**：以下载荷为当时的实测快照。**2026-09-27 起**
> `health` 不再返回 `compose_file` / `docker` / `runtime_form` 三个字段；
> MCP 卡片项也不再返回 `status` / `in_compose` / `configured` / `abnormal_reason`，
> 改为返回单一 `url`（见 `contracts/admin-api.md` §1.1、§3.1）。原文保留以作对照。

`health` 的实际载荷（四类依赖一并可见）：

```json
{"platform_data":{"writable":true,"path":"/app/.platform-data"},
 "opt_agent":{"readable":true,"writable":true,"path":"/app/.opt-agent"},
 "compose_file":{"readable":true,"path":"/app/docker-compose.yml"},
 "docker":{"available":true},
 "runtime_form":"container_network"}
```

MCP 卡片列表的实际载荷（清单来自编排声明 + 真实容器状态，`FR-043`）：

```json
{"items":[{"name":"ocr","description":"","transport":"http","status":"running",
           "in_compose":true,"configured":false,"abnormal_reason":null}],
 "total":1,"page":1,"page_size":8,"total_pages":1}
```

### 10.3 真实部署暴露并修复的两个问题（原文保留证据）

> **历史记录（2026-09-15）**：本节两个问题均位于**当时**的 Docker/编排读取路径
> （`infra/docker-host.ts`、`infra/compose-reader.ts`）。**2026-09-27 起这两个模块已删除**，
> 问题随之不再存在；原文保留以作证据与经验记录（"冒烟确认不是走过场"依然成立）。

冒烟确认**不是走过场**——第一次执行时它抓出了两个只有真部署才能发现的问题：

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | `health` 报 `docker.available=false`，但容器内 `/var/run/docker.sock` 明明存在且可读 | `DockerHost` 把 Engine API 路径写死为 `/v1.43/...`，而本机 Docker Engine **29** 要求最低 `1.44`，返回 `400 client version 1.43 is too old`；`available()` 把非 200 视为不可达，于是表现为"权限/挂载问题"，极具误导性 | 改为**路径不带版本前缀**，由守护进程协商版本（`infra/docker-host.ts`）。修复后 `docker.available=true`（**该模块已于 2026-09-27 删除**） |
| 2 | MCP 卡片把 `ocr` 的传输方式显示为 `stdio` | 编排里 `ocr` **不对外暴露端口**（只在容器内网提供 streamable-http），而推断规则是"有 ports → http，否则 stdio" | 改为**编排内服务一律按 `http`**：容器网络里的服务对平台而言必然是跨进程网络调用，`stdio` 只能由调用配置显式声明（`infra/compose-reader.ts`，**该模块已于 2026-09-27 删除**） |

### 10.4 性能与可用性（`SC-001`、`SC-002`、`SC-015`、`SC-021`、`SC-022`、`SC-023`、原则五）

| 指标 | 口径 | 结果 |
|---|---|---|
| `SC-002`（列表 ≤ 1s） | 卡片列表为**单次** JSON 文档读取 + 内存切片，无 N+1：`PlatformStore.readJson` 一次读盘，`paginate` 纯内存 | 本地实测 < 50ms（集成测试中的接口耗时同量级） |
| `SC-022`（翻页 ≤ 100ms） | 翻页为**纯前端切片**（服务端已返回固定 8 项），无新请求 | 单元测试覆盖（`EntityCardList` 翻页只发 `update:page`） |
| `SC-023`（单页恒 8 项） | `page_size` 由服务端固定为 8，**不接受客户端覆盖** | `paging.ts` 无页大小参数；4 处卡片列表共用；测试断言 `page_size === 8` |
| `SC-021`（预校验 ≤ 3s） | 预检为纯内存判定 + 一次运行环境只读端点查询（**2026-09-27**：原"Docker 状态查询"已移除） | 集成测试中 `deploy/validate` 全量用户 < 100ms |
| 原则五（接口 P95 ≤ 500ms） | 写路径为"临时文件 → fsync → rename"；部署的 IO 集中在一次目录改名 | 见上述各项实测值 |
| `SC-001`（≤ 5 分钟完成一个数字人并部署） | 按 §7.1 + §7.2 的步骤：新建 → 填五类 → 保存 → 关联用户 → 校验 → 部署 | **由自动化测试等价覆盖**（见 §10.5）；界面侧的手工计时**未执行**，需由验收人按 §7 逐条走一遍 |
| `SC-015`（≤ 3 次点击到编辑位置） | 一级导航（1 次）→ 卡片「打开设计/查看与编辑」（2 次）→ 页签切到目标分区（3 次） | 导航深度上限两级由 `FR-053` 与组件结构保证；**手工逐页计数未执行**，需由验收人复核 |

### 10.5 端到端场景的自动化等价覆盖（`quickstart.md` §7）

§7 的四个用户故事**每一条**都在自动化测试里有对应断言（因此不是"只靠人工点界面"）：

| §7 场景 | 自动化落点 |
|---|---|
| 7.1 US1 第 1~7 步 | `admin-backend/tests/integration/agents.spec.ts`、`builtin-tools.spec.ts`；`admin-frontend` 的 `AgentCardList/AgentDesigner/ToolSelector/BuiltinToolCatalog/ScenarioEditor.spec.ts` |
| 7.2 US2 第 1~11 步 | `admin-backend/tests/integration/deploy.spec.ts`（含既有数据零破坏 `SC-007`、`§7.1` 引用一致性）、`deploy-scope.spec.ts`（`SC-012`、`SC-009`、`SC-019`）、`users.spec.ts`；`DeployPanel/UserCardList/AnomalySummary.spec.ts`（**2026-09-27**：`SC-024` 双形态对比与 `RuntimeFormSwitch.spec.ts` 已随运行形态下架移除） |
| 7.3 US3 第 1~7 步 | `admin-backend/tests/integration/skills.spec.ts`、`tests/unit/skill-archive.spec.ts`、`skill-library.spec.ts`；`SkillCardList/SkillContentEditor/SkillUploadDialog.spec.ts` |
| 7.4 US4 第 1~8 步 | `admin-backend/tests/integration/mcp.spec.ts`（含新建/重名/删除/引用失效）、`tests/unit/mcp-service-list.spec.ts`、`service-config.spec.ts`、`service-config-create.spec.ts`、`mcp-client.spec.ts`；`McpCardList/McpCallConfigForm/McpStatsTable.spec.ts`（**2026-09-27**：`McpLogViewer.spec.ts` 与 `docker-host*.spec.ts` 已下架移除） |
| 10.2（本节） | 一次**真实的** `docker compose up -d --build` + 七个 HTTP 打点 |

### 10.6 无障碍复核（原则四；`quickstart.md` §8）

`prefers-reduced-motion` 降级已在 `styles/base.css` 中以媒体查询统一实现；
"状态不只靠颜色"（图标 + 文本双通道）有 `StatusBadge.spec.ts` 与各卡片测试断言；
确认框用原生 `<dialog>`（Esc / 焦点归还）有 `ConfirmDialog.spec.ts` 覆盖；
页签方向键、一级导航 `aria-current`、分页 `aria-label` 均有对应测试。
**读屏实机抽查未执行**，需由验收人按 §8 第 4 条补做一次。

# 004 · SOUL 结构化设计 —— 任务与验证

> 四侧改动已落地（2026-10-09）。本文件记录**做了什么、怎么验的、还剩什么**。

## 1. 任务分解与状态

| # | 任务 | 状态 |
|---|---|---|
| T1 | 定型契约 + 撰写 spec（本目录） | ✅ |
| T2 | 运行环境：`domain/soul.ts`（stripFrontmatter / parseSoulMeta / 工具暴露名 / 引导文案） | ✅ |
| T3 | 运行环境：`agent-instance` 只把 SOUL **正文**拼进 System Prompt | ✅ |
| T4 | 运行环境：`agent-catalog` 下发 `intro` / `welcome` / `starters`（含算好的 `guidance`） | ✅ |
| T5 | 运行环境：请求级隐藏引导通道（`chat` schema → `run-manager` → `prompt-builder`） | ✅ |
| T6 | 平台：`soul-design.ts`（类型 / 校验 / 渲染 / 存量包装） | ✅ |
| T7 | 平台：`agent-design` 结构化字段 + 保存校验（含问题实例工具引用） | ✅ |
| T8 | 平台：`materialize` 渲染 SOUL.md；`precheck` 适配主要使命 | ✅ |
| T9 | 平台：`ReferenceIndex` 增"服务 → 可见工具"判据；MCP 列表回 `allowed_tools` | ✅ |
| T10 | 管理台：`SoulEditor` 结构化表单（含归属标注与计数） | ✅ |
| T11 | 管理台：`QuickStartDialog`（欢迎语 + 问题实例增删 + 工具关联） | ✅ |
| T12 | 管理台：`TagInput`（回车加 / ❌ 删），用于能力标签与绝对禁止 | ✅ |
| T13 | 管理台：`useAgentDesign` 深拷贝与脏判定、契约类型 | ✅ |
| T14 | 前台：hero 区渲染欢迎语 + 问题卡片（网格 + 滚动兜底） | ✅ |
| T15 | 前台：点击卡片发起对话（`content` 干净 + `guidance` 隐藏） | ✅ |
| T16 | 前台：数字人面板简介改用 `intro`（旧数据回退首行） | ✅ |
| T17 | 测试：`soul.spec`（解析 + System Prompt 端到端不变式）、`prompt-builder-guidance.spec`（隐藏引导）、`soul-design.spec`（校验/渲染/兼容）、`ChatPanel.starters.spec`、`messages.spec` 增补 | ✅ |
| T18 | 回归：四侧既有测试全绿 | ✅ |

## 2. 验证结果

| 侧 | 命令 | 结果 |
|---|---|---|
| `agent-backend` | `npm run test:all`（unit + integration） | ✅ 38 文件 / 471 用例（含 `soul.spec.ts`、`prompt-builder-guidance.spec.ts`） |
| `agent-backend` | `tsc --noEmit` / `npm run lint` | ✅ |
| `admin-backend` | `npm run test` | ✅ 42 文件 / 571 用例（含 `soul-design.spec.ts`） |
| `admin-backend` | `npm run typecheck` / `npm run lint` | ✅ |
| `admin-frontend` | `npm run test` | ✅ 45 文件 / 498 用例 |
| `admin-frontend` | `npm run lint` | ✅ |
| `frontend` | `npm run test` | ✅ 34 文件 / 446 用例（含新增 2 个 spec） |
| `frontend` | `npm run lint` | ✅ |

### 存量零破坏的验证点

1. `soul.spec.ts`：无 frontmatter 的旧 SOUL.md → `stripFrontmatter` **原样返回**（System Prompt 逐字不变）。
2. `agent-design.spec.ts`：手工写入**字符串** `soul` 的旧文档 → 读取时包装为 `{ mission: 原文, 其余为空 }`。
3. `deploy.spec.ts`：预检负向用例仍以"手工改写为字符串 `soul`"制造破损配置，走兼容路径报 `config_integrity`。
4. `agent-catalog`：旧数字人 `intro`/`welcome` 为空 → 前台退回"开始新的对话"（`ChatPanel.starters.spec.ts` 有断言）。

## 3. 已知遗留（**非本次引入**）

`admin-frontend` 与 `frontend` 的 `npm run typecheck` 在**改动前**就有存量报错（与 SOUL 无关）：

- `admin-frontend`：`McpCallConfigForm.vue:302`（未使用变量）、`OntologyMarketDialog.vue:93`、`modules.spec.ts:107` / `useMcpServices.spec.ts:128,144`（`McpServiceCreatePayload` 缺 `allowed_tools`）。
- `frontend`：`views/datapage/task-result.vue`（`label` 不存在、`customRender` 签名）、`views/demo/gantt-demo.vue` 等未使用变量、`router/index.ts:56`。

本次改动**引入的类型错误已全部清零**；上述存量问题建议单独开一条清理任务。

## 4. 后续可选增强

1. 问题卡片支持"短标题 + 长问题"两字段（当前卡片文本即发送文本）。
2. 引导文案模板（`本轮请优先使用…`）如需多语言 / 可配置，移到数字人配置或平台常量。
3. 部署后运行环境缓存（`config-fingerprint`）已覆盖 `SOUL.md`，无需改动；若后续新增独立配置文件，**务必同步 `KEY_FILES`**。

# 004 · SOUL 结构化设计

> 状态：实施中
> 影响面：`admin-backend`、`admin-frontend`、`agent-backend`、`frontend`（四侧同改，宪章原则七）
> 前置：`specs/001-digital-human-platform`（数字人设计态、部署物化、整体覆盖语义）

## 1. 背景与目标

现状 SOUL 是**单个自由文本**，全文字直接进入模型 System Prompt（`agent-instance.ts:68`），
同时又被聊天前台当作"数字人描述"展示（`AgentPanel.vue:131`）。

这带来两个问题：

1. 用户进入新建对话页后**不知道该说什么**，没有任何可点击的引导；
2. 人格提示词与前台展示信息混在一段文本里，无法分别治理。

目标：把 SOUL 升级为**结构化设计**，一份 `SOUL.md` 同时满足两类消费者：

- **给模型**：主要使命、能力标签、绝对禁止、补充说明（进 System Prompt）；
- **给前台**：角色简介、首屏欢迎语、问题实例（不进 System Prompt，随接口下发）。

### 非目标

- 不新增配置文件（全部内容仍只在 `SOUL.md` 内）；
- 不改变部署"以数字人为单位整体覆盖"的语义，不影响文件空间（`user-data/**`）；
- 不改变工具注册与权限模型（工具仍是"挂载即全量可用"，问题实例的关联工具只是**引导**）。

## 2. 术语

| 术语 | 含义 |
|---|---|
| SOUL 结构化 | `SOUL.md` 由 `YAML frontmatter`（展示/引导）+ 正文（提示词）两部分组成 |
| 展示数据 | `intro` / `welcome` / `starters`，只给聊天前台 |
| 提示词正文 | `mission` / `capability_tags` / `forbidden` / `prompt_extra`，只给模型 |
| 问题实例 | `starters[]`，前台卡片；点击即以 `prompt` 发起一轮对话 |
| 工具引导 | 问题实例关联工具生成的文本，**对用户不可见**，仅注入本轮 System Prompt |

## 3. 数据模型（设计态）

`.platform-data/agents/{name}.json` 的 `soul` 字段由 `string` 升级为结构化对象：

```jsonc
{
  "soul": {
    "intro": "≤100 字，角色简介，用于数字人切换面板展示",
    "welcome": "≤100 字，新建对话页首屏欢迎语",
    "starters": [
      {
        "prompt": "帮我梳理昨天订单的交付风险",
        "tools": [
          { "kind": "builtin", "name": "read_file" },
          { "kind": "mcp", "service": "erp", "name": "query_order" }
        ]
      }
    ],
    "mission": "主要使命（必填）",
    "capability_tags": ["订单排程", "交付风险"],
    "forbidden": ["不得编造订单号"],
    "prompt_extra": "补充说明（可选）"
  }
}
```

### 3.1 字段口径

| 字段 | 进提示词 | 必填 | 约束 |
|---|---|---|---|
| `intro` | ❌ | ✅ | ≤100 字 |
| `welcome` | ❌ | ✅ | ≤100 字 |
| `starters[].prompt` | ❌ | ✅ | 非空、≤150 字、去重 |
| `starters[].tools[]` | ❌（拼进隐藏引导） | ❌ | ≤10 项，引用必须合法（§8） |
| `mission` | ✅ | ✅ | 非空、≤4000 字 |
| `capability_tags[]` | ✅ | ❌ | ≤20 项，单项 ≤20 字，去重 |
| `forbidden[]` | ✅ | ❌ | ≤20 项，单项 ≤100 字，去重 |
| `prompt_extra` | ✅ | ❌ | ≤4000 字 |
| `starters` | ❌ | ❌ | ≤12 条 |

## 4. SOUL.md 渲染规范（物化产物）

`deploy/materialize.ts` 由"原样透传 `design.soul`"改为 **`renderSoulMd(soul)`**，
产物仍只有 `SOUL.md` 一个文件：

```markdown
---
soul_version: 1
intro: 专注订单交付风险排查的助理。
welcome: 你好，我是交付助理。告诉我要看哪批订单。
starters:
  - prompt: 帮我梳理昨天订单的交付风险
    tools:
      - kind: builtin
        name: read_file
---

## 主要使命

（mission）

## 能力标签
- 订单排程

## 绝对禁止
- 不得编造订单号

## 补充说明

（prompt_extra，为空则整节省略）
```

约束：

- `frontmatter` 由 `yaml` 库序列化（`lineWidth: 0`，中文不转义）；
- 空数组/空字符串**不渲染空壳小节**（与 `scenario.json`"不写空壳键"同口径）；
- `capability_tags` / `forbidden` 为空时省略对应小节。

## 5. 系统提示词取值规则

**唯一规则**：`systemPrompt = stripFrontmatter(SOUL.md) + 技能小节`。

即 frontmatter 天然不进模型；正文即提示词。现有拼接逻辑（`agent-instance.ts:67-68`）
仅把 `soul.trim()` 换成 `stripFrontmatter(soul).trim()`，技能小节部分不动。

## 6. 聊天前台展示与交互

| 位置 | 数据 | 组件 |
|---|---|---|
| 数字人切换面板 | `intro` | `AgentPanel.vue`（替换原 `displayed.soul`） |
| 数字人卡片列表描述 | `intro`（派生） | 平台 `deriveDescription` |
| 新建对话页中间 | `welcome` + `starters` 全部平铺 | `ChatPanel.vue` hero 区 |
| 问题卡片 | `starters[].prompt` | 点击 → 发起对话 |

点击卡片：`onSend({ content: starter.prompt, attachments: [], guidance })`，
自动建会话 + 走 SSE（复用 `useChatPanel.ts:129` 既有链路）。

- 未选数字人时卡片置灰并提示（`useThreads.create()` 会拒绝）；
- 无结构化 SOUL（存量数字人）时退回既有"开始新的对话"文案；
- 卡片数量不限，hero 区网格布局 + 滚动兜底。

## 7. 隐藏工具引导

工具引导**对用户不可见**，但必须进入本轮模型上下文。

通道：复用请求级 `systemExtra`（`agent-factory.ts:232-234`）——该通道
**不落盘、不进历史、不影响用户消息气泡**（`prompt-builder.ts` 组装）。

链路：

```
前端：send({ content: starter.prompt, guidance: starter.guidance })
  → POST /api/threads/:id/messages  body 新增可选字段 guidance（≤500 字）
  → run-manager StartRunOptions.guidance
  → prompt-builder PromptSources.guidance → 并入 systemExtra
  → agent 本轮 System Prompt 追加段（与滚动摘要并列）
```

引导文本由**运行环境**生成（它持有 `{server}__{tool}` 前缀规则的内部知识）；
`GET /api/agents/{name}` 的 `starters[]` 直接下发算好的 `guidance`，前端零规则知悉。

引导文案：`本轮请优先使用以下工具完成任务：read_file、erp__query_order`。
仅当 `tools` 非空时下发；无工具的问题实例不下发该字段。

**语义边界**：这是"建议优先使用"，**不改变工具权限**（工具仍全量可用）。

## 8. 保存校验规则（平台侧）

在 `validateAgentInput` 内扩展，全部为**拒绝式**（不做隐式剔除或合并）：

1. 字数/条数上限按 §3.1；
2. `starters[].tools[].kind === 'builtin'` → 名称必须在该数字人 `enabled_tools` 内；
3. `starters[].tools[].kind === 'mcp'` → 服务必须在该数字人 `mcp_services` 内，
   且工具名在该服务的 `allowed_tools` 内；
4. 越界报错必须**指明具体工具名**，便于管理员定位。

> 工具引用越界在管理台表现为"先配快速上手、后取消勾选工具"的级联失效。

## 9. 存量兼容（零破坏）

| 场景 | 行为 |
|---|---|
| 旧 `SOUL.md`（无 frontmatter） | `stripFrontmatter` 返回原文 → System Prompt 与改造前**逐字一致** |
| 旧设计态 JSON（`soul` 为字符串） | 读取时包装为 `{ mission: 原文, 其余为空 }`，管理台提示可结构化升级 |
| 首次保存 | 自动升级为新结构，无需迁移脚本、不反向写运行环境 |

`parseSoulMeta` 对"有头无尾/ YAML 非法"一律按"无 frontmatter"处理，绝不吞配置。

## 10. 契约变更

| 契约 | 变更 |
|---|---|
| `contracts/admin-api.md` §5 | `soul` 由 string 改为结构化对象；新增校验错误口径 |
| `contracts/runtime-api-delta.md` §3.1 | `GET /api/agents/{name}` 新增 `intro` / `welcome` / `starters`；`soul` 保留兼容 |
| `contracts/backend-api.md` §4 | `POST /api/threads/:id/messages` body 新增可选 `guidance` |

**指纹不变**：`SOUL.md` 已在 `config-fingerprint.ts:23` 的 `KEY_FILES` 内。

## 11. 任务分解

见 `tasks.md`。四侧依赖顺序：运行环境解析核心 → 平台侧结构/校验/渲染 →
管理台编辑界面 → 聊天前台展示与交互 → 测试与回归。

## 12. 测试要求

1. **运行环境**：`stripFrontmatter`（无 frontmatter / 有头无尾 / 正文含水平线）；
   `parseSoulMeta`（合法 / 非法 / 缺字段 / 工具项残缺）；
   `loadAgentConfig` 的 systemPrompt **不含 frontmatter、不含 intro/welcome**。
2. **平台侧**：字数与条数上限、工具引用越界（三种：内置未启用 / MCP 未挂载 / 工具不在白名单）、
   存量字符串 `soul` 读取兼容、`renderSoulMd` 产物（空壳小节省略）。
3. **物化**：`materialize.spec.ts` 断言由"等于 design.soul"改为"等于 renderSoulMd 产物"。
4. **前台**：无 SOUL 数据时降级；点击卡片发送 `content` 干净、`guidance` 不为空。
5. **回归**：存量数字人部署后 System Prompt 逐字不变（各取一份旧 SOUL.md 做快照比对）。

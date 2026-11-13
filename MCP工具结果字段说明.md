# MCP 工具结果字段说明：`resultUrl` / `filePath` / `filePathName` / `viewUrl` / `viewUrlName`

> 适用对象：所有接入运行环境的 MCP 服务，以及与之使用同一协议的**内置工具**（`write_file`）。
> 本文口径全部取自本仓库现有实现（不是设计意图）；改实现须同步改本文，改本文须注明日期。
> 关联文档：`异步MCP服务接入约定.md`（异步全链路约定）、`specs/002-conversation-runtime/spec.md` §4.7~§4.9（视图链接）、`specs/001-digital-human-platform/contracts/runtime-api-delta.md` §10（回写契约）。
>
> 更新日期：2026-11-12

---

## 0. 一张表看懂

| 字段 | 方向 | 谁产生 | 谁消费 | 值形态 |
|---|---|---|---|---|
| `resultUrl` | **输入**（工具入参） | 运行环境现铸，**模型看不到** | MCP 服务 | 带签名的 `http(s)` 绝对地址 |
| `filePath` | **输出**（工具结果里） | MCP 服务（值取自回写响应的 `path`） | 平台 → 前端 | 相对**数字人数据根**的 posix 路径 |
| `filePathName` | 输出（可选） | MCP 服务 | 前端 | 单行显示名（≤120 字符） |
| `viewUrl` | 输出（可选） | MCP 服务 | 平台 → 前端 | 根相对路径或 `http(s)://` 绝对地址 |
| `viewUrlName` | 输出（可选） | MCP 服务 | 前端 | 单行显示名（≤120 字符） |

一句话关系：`resultUrl` 是**把结果送回来的通道**；`filePath` / `viewUrl` 是**结果里"用户点哪儿看"的入口声明**，两者二选一。

---

## 1. `resultUrl`（输入侧；异步开关）

### 1.1 定义

`resultUrl` 是运行环境为**单次工具调用**现铸的、带 HMAC 签名的**回写直链**。服务在后台算完后，把结果 POST 到它，平台负责落盘并让产出出现在界面「后台记录」里。

它同时是**异步开关**：入参 schema 里声明了 `resultUrl` → 平台注入，走异步；服务收不到（直接调用/第三方）→ 走同步返回。

### 1.2 平台如何注入（三条硬规则）

| # | 规则 | 实现 |
|---|---|---|
| 1 | **声明即生效**：工具自己的 `inputSchema.properties` 里有 `resultUrl` 才会被注入，平台侧没有任何白名单配置 | `infra/mcp/async-result-url.ts` 的 `declaresResultUrl` |
| 2 | **对模型隐藏**：声明后平台把它从给模型的 schema 里删掉，模型看不到也填不了 | `mcp-schema-view.ts` |
| 3 | **一律覆盖**：注入发生在 HITL 确认之后，且覆盖模型填的任何值；签名 URL 不会进 `interaction_request` 的 `proposed_args` 快照 | `mcp-tool-adapter.ts` + `infra/agent-factory.ts` |

不要在 `required` 里放它（有默认值即可，平台照样注入）。

### 1.3 地址形状

```
{PUBLIC_BASE_URL}/api/files/put?u=&d=&exp=&sig=&t=&sid=&call_id=&tool=
```

| 参数 | 含义 | 是否参与验签 |
|---|---|---|
| `u` | 用户 id | 是 |
| `d` | `{数字人}/临时空间/后台产出`（只有这一层可写） | 是 |
| `exp` | 过期时刻（epoch ms），默认铸造时刻 + **12h** | 是 |
| `sig` | `HMAC-SHA256("put\nu\nd\nexp")` | — |
| `t` | 提交时刻（epoch ms）= 铸造时刻 → 落 sidecar 的 `created_at` | 否（提示参数） |
| `sid` | 会话 id → 决定落盘名的 `{prefix}`（非法时回退 `uid`） | 否 |
| `call_id` | 工具调用 id（前端挂载点） | 否 |
| `tool` | 运行环境侧工具全名 `{server}__{tool}` | 否 |
| `filename` | **服务自己追加**，必填，单段文件名 | 否 |
| `summary` | **服务自己追加**，可选，≤200 字符（超出按码点截断） | 否 |

代码：`infra/file-sign.ts` 的 `mintPutUrl`、`routes/files-put.ts` 的 query schema。

### 1.4 服务侧 MUST

1. **先校验协议**：只接受 `http` / `https`；不合法就**忽略该地址并降级为同步返回**（既不能照样 POST，也不能静默丢弃——否则调用方永远等不到结果）。
2. **保留原 query**：`u/d/exp/sig/t/sid/call_id/tool` 一个都不能丢，丢 `sig` 直接 403，丢 `d` 会写错目录。
3. **追加参数用 URL 解析器**（`urlsplit` + `parse_qsl` + `urlencode`），不要字符串拼 `&filename=`（URL 可能已有 query 或 fragment）。
4. **body 必须是标准 JSON 且非空**，成功与失败**同一形状**：`{"status": "success"|"failed", "message": "...", ...}`。
5. **失败也要回写**（否则界面上什么都不出现，用户无法区分"还在算 / 超时 / 挂了"）。
6. **超限先降级**：回写 body 受 `UPLOAD_MAX_MB` 限制（默认 5MB，与上传同一口径），超限直接 `413` —— 应在发送前判大小，超限就只回写状态与消息。
7. 成功判据是 HTTP `200` / `202`；`403` = 签名无效或过期，`400` = `filename` 非法或 body 为空。
8. **一个 `resultUrl` 可以 POST 多次**（签名不消费），每次换 `filename` 即多一条产出记录。

### 1.5 平台的响应就是 `filePath` 的权威来源

```http
HTTP/1.1 202
{"path": "临时空间/后台产出/th_1_bom_1792_ab391a00.json", "size": 1234}
```

- `path` 相对**数字人数据根**，由平台铸造；服务 MUST 原样回传作为 `filePath`，**不要自己拼**（拼出来的多半点不开）。
- 落盘名 = `{sid}_{服务给的 filename}`，落点固定 `临时空间/后台产出/`，与临时空间同生命周期（**30 天未访问清理**，过期后入口 404）。
- 产出目录对界面是**只读**（可预览/下载，不可上传/删除/列子目录）。

---

## 2. 结果侧的两个入口：`filePath` 与 `viewUrl`

### 2.1 共同规则

| 项 | 规定 |
|---|---|
| 判定方式 | **只看字段名**（大小写不敏感、忽略首尾空白），**绝不**按"值看起来像不像地址/路径"判定 |
| 位置 | 出现在工具结果正文的**任意层**（对象/数组，深度 ≤8，最多抽 50 条）；名称字段 MUST 与地址**同层** |
| 平台行为 | 只搬运：**不改写值、不拼前缀、不校验 scheme**，只做形态卫生 |
| 形态卫生 | 必须是非空字符串、地址 ≤2048 字符、名称 ≤120 字符、无控制字符（`<0x20`、`0x7f`）与反斜杠；名称不合格只丢名字、**保留地址** |
| 抽取上限 | 结果文本 >256KB 不尝试解析（视同没有入口） |
| 去重 | 按 `kind + 原值` 去重，重复出现时名称取首个非空值 |
| 缺失语义 | 不给字段 = 本次没有入口；入口行整行不渲染，其余展示不变 |
| 落点 | 抽成 `view_links` **sidecar** 随工具记录下发，**不占模型上下文回灌预算**，正文被外置（落临时空间）时入口照样在 |

代码：后端 `domain/view-links.ts`（`extractViewLinks`）、`domain/tool-events.ts`；前端 `utils/view-link.ts`（`resolveViewUrl` / `toViewLinkEntries`）。

### 2.2 `filePath` / `filePathName`（本地文件空间）

**用于：本次结果自己产出了文件**（xlsx / html / pdf…）。不要编下载地址，改给文件空间相对路径。

```json
{
  "status": "success",
  "message": "合并完成：327 行",
  "filePath": "临时空间/后台产出/th_1_总BOM_WCCMT-00000B0570_报告.html",
  "filePathName": "总BOM_WCCMT-00000B0570_报告.html",
  "mergedFile": {
    "filePath": "临时空间/后台产出/th_1_总BOM_WCCMT-00000B0570.xlsx",
    "filePathName": "总BOM_WCCMT-00000B0570.xlsx"
  }
}
```

| 项 | 规定 |
|---|---|
| 值从哪来 | `POST /api/files/put` 的 `202 {"path": …}` 原样回传（见 §1.5） |
| 形态 | posix、相对数字人数据根、单段文件名、无 `..` / 反斜杠 / 控制字符 |
| 名称 | `filePathName`（可选、同层）；不给就显示路径（前端中段省略，保留末尾 32 字符内） |
| 点开行为 | 与「在文件空间里点文件」完全一致：文本进预览面板、`.html` 进沙箱 iframe、`.xlsx` 等走下载引导 |
| 一次多个产出 | 允许。顶层给**第一入口**（你最想让用户先看到的那个），其余放进任意对象/数组字段；顶层只有一条 |
| 可达性约束 | 必须落在可读白名单内。目前唯一可行落点就是 `临时空间/后台产出/` |

### 2.3 `viewUrl` / `viewUrlName`（外部/同源页面地址）

**用于：结果有一个能跳转查看的页面**（如数据源表格预览页），且这不是一个文件。

```json
{
  "status": "success",
  "message": "产能表解析完成",
  "viewUrl": "/datasource/dsdasds/dstsd/abc/xlsx",
  "viewUrlName": "一车间产能明细"
}
```

| 项 | 规定 |
|---|---|
| 值的形态（二选一） | ① 根相对路径（**单个** `/` 开头）；② 完整 `http(s)://` 地址 |
| 前缀归属 | 根相对路径的前缀**由前端补**（= 用户当前访问入口）。服务 MUST NOT 自行拼接平台入口地址 |
| MUST NOT | `//host/…`（协议相对）、缺协议的 `host:port/…`、`javascript:` / `data:` 等其它 scheme、含反斜杠或控制字符 —— 这些**不会被链接化** |
| 名称 | `viewUrlName`（可选、同层）；不给就显示地址（中段省略）。平台与界面都**不推断名称**（不从 URL 末段取名、不用"视图 1/2"占位） |
| 与 `summary` 的区别 | 界面标题恒用 `summary`；`viewUrlName` 只是链接自身的显示名，两者用途不同、不互相替代 |
| 可达性 | 该路径必须能在用户访问的入口上打开，否则点开是 404/空白页——这属于部署路由，不是平台职责 |

### 2.4 二选一，不要同时给

- 产**文件** → `filePath`；有**页面** → `viewUrl`。两者都给不报错（各成一条入口），但通常没有意义。
- **反面用法**：MUST NOT 新造与 `artifact` / `filePath` 语义相近的字段名（如 `artifacts`）——平台不认，人也会读混。多产出请嵌套在业务语义字段里（如 `mergedFile`）。

### 2.5 字段名 MUST 逐字使用

平台只认这五个名字（**`Name` 后缀不是 `Name` 简写**）：

| 正确 | 常见错写（不生效） |
|---|---|
| `filePath` / `filePathName` | `fileName`、`file`、`path`、`artifact`、`artifacts` |
| `viewUrl` / `viewUrlName` | `viewName`、`url`、`link`、`view_url` |

---

## 3. 平台怎么消费（两条链路）

### 3.1 同步工具结果 / 内置工具（`write_file`）

```
服务返回 JSON 文本（含 filePath / viewUrl）
  → extractViewLinks() 抽成 sidecar view_links（条带 kind: 'url' | 'file'）
  → 写入 tool-events.jsonl 那一行（与正文分离）
  → GET /api/threads/... 下发 view_links
  → 前端在**回答正文之后**渲染入口行（最多显示 3 条，其余「另有 N 个」）
```

### 3.2 异步回写产出（`resultUrl` → 铃铛「后台记录」）

```
服务 POST 回写 body → 平台落盘 正文 + .meta.json
  → SSE 信号 → 铃铛列表新条目（标题 = 回写时的 summary）
  → 用户点开「结构化查看」：正文里的 viewUrl 渲染为链接（文本 = 值本身）
```

**关键差异（容易踩）**：入口行只从**工具返回正文**里抽取（§3.1）。仅出现在**回写 body** 里的 `filePath`，只会作为产出正文的一个普通字段展示，不会自动变成可点入口。

因此**同时要"落后台记录"和"聊天区可点入口"**的服务，正确做法是：先用 `resultUrl` 回写换取 `path`，再把拿到的 `filePath` / `filePathName` **也放进本次工具返回的正文**（范本：`bom-service/server.py` 的 `_deliver_outputs` + `public.update(entries)`）。

---

## 4. 自检清单

- [ ] `inputSchema.properties` 里有 `resultUrl:string`，且**不在** `required`
- [ ] `resultUrl` 只接受 http/https；不合法时降级为同步并说明原因
- [ ] 追加 `filename` / `summary` 用 URL 解析器，原 query 完整保留
- [ ] 回写 body 是标准 JSON，`status` 只有 `success` / `failed`，失败也回写
- [ ] `summary` 必填、≤200 字符、失败结论前置（标题单行省略号，结论写在末尾会被截掉）
- [ ] `filePath` 取自回写响应的 `path`，不是我拼的路径
- [ ] 名称字段与地址字段**同层**，且拼写是 `filePathName` / `viewUrlName`
- [ ] 根相对路径以**单个** `/` 开头，没带 `//host` 之类
- [ ] 需要聊天区入口时，`filePath` / `viewUrl` 出现在**工具返回正文**里，而不只在回写 body 里

---

## 5. 实现位置索引

| 内容 | 文件 |
|---|---|
| `resultUrl` 注入判据 / 覆盖规则 | `agent-backend/src/infra/mcp/async-result-url.ts` |
| 回写地址铸造（签名、TTL、提示参数） | `agent-backend/src/infra/file-sign.ts` |
| 回写端点（验签、目录白名单、落盘、202） | `agent-backend/src/routes/files-put.ts` |
| 产出 sidecar 与列表投影 | `agent-backend/src/domain/produced.ts` |
| 视图链接抽取（`viewUrl` / `filePath`） | `agent-backend/src/domain/view-links.ts` |
| sidecar 落盘与读回（`view_links`） | `agent-backend/src/domain/tool-events.ts` |
| 内置 `write_file` 的结构化结果 | `agent-backend/src/infra/builtin-tools.ts` |
| 前端归一化（拼入口、去重、显示名） | `frontend/src/utils/view-link.ts` |
| 前端点开分流（文件预览 / 同源面板 / 异源新标签） | `frontend/src/composables/usePreview.ts` |
| 参考范本：同步 + 回写双产出 | `bom-service/server.py` |

---

## 修订记录

| 日期 | 变更 |
|---|---|
| 2026-11-12 | 首版：按现有实现整理 `resultUrl` / `filePath` / `filePathName` / `viewUrl` / `viewUrlName` 的定义、约束与消费链路 |

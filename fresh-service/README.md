# 生鲜订货订单识别与审核（fresh_order_review）

面向生鲜配送「文员接单」场景的订单识别与审核系统：手写单据图片 / 对话文本→ 标准化 + RapidFuzz 模糊匹配 → 按置信度分流为三张表（高度匹配 / 候选审核 / 异常记录）→ 人工审核（本地 CLI 或 Dify Chatflow Human Input）→ 导出三工作表 Excel。
核心逻辑全部是无状态纯函数，本地 CLI 与 FastMCP 两个入口复用同一套 `core/` 代码。
MCP 侧另产出**一份自包含 HTML 解析报告**与**三表 xlsx**，经平台注入的 `resultUrl` 回写文件空间（见 §4.1）。

---

## 0. 文件树

fresh_order_review
|——core/  # 核心纯函数（CLI 与 MCP 共用）
	|——__init__.py
	|——config.py  # 阈值、路径、服务、OCR 配置（环境变量可覆盖）
	|——data_loader.py # 读三工作表 + 校验 + 别名合并
	|——normalize.py # 行级标准化（清洗、数量、噪声、同义词）
	|——matcher.py  # RapidFuzz 匹配 + 三档分流
	|——ocr.py # PP-OCRv6 图片识别（按 y 坐标排序）
	|——pipeline.py # analyze_order / analyze_batch / apply_decisions / finalize_order / resolve_manual_product
	|——excel_export.py  # 三工作表 Excel 导出
	|——html_report.py  # 解析报告 HTML 渲染（自包含、无脚本、无外链）
|——mcp_server.py # FastMCP 服务（工具 fresh_order_parse）+ resultUrl 产出回写
|——tests/  # pytest：报告渲染 + 产出回写/降级链
|——requirements.txt # 基础依赖
|——requirements-ocr.txt # 图片 OCR 依赖（paddleocr/paddlepaddle）
|——Dockerfile # 单镜像打包（含 OCR 模型预热）
|——pytest.ini

## 1. 输入数据结构——`商品数据.xlsx`

默认文件名 `商品数据.xlsx`，三个工作表，表名与列名严格如下：

### 1.1 工作表 1：`SKU清单`

| SKU编码 | 商品名称 | 别名 | 品类 | 规格 | 单位 | 是否启用

- `商品名称` 是标准化层的 canonical 锚点，映射表的 canonical 必须与此列完全一致。
- `别名` 多个用 `|` 分隔，可为空，加载时自动合并进映射表，`source="sku_alias"`。
- `是否启用` 为 `是` / `否`，停用 SKU 不参与匹配。

### 1.2 工作表 2：`映射表`

| alias | canonical | match_type | confidence | source | version | note

- `match_type` 取值 `exact` / `contains`；`confidence` 取值 `strict` / `loose`。
- `canonical` 必须存在于 `SKU清单.商品名称`，加载时校验，不一致报错并列出冲突项。
- `alias` 不允许重复，同一 alias 指向不同 canonical 视为冲突，加载时报错。
- `loose` 映射在替换后标记到审计字段，最终 Excel 的「审核通过」表保留该标记。

### 1.3 工作表 3：`噪声词表`

| noise_word | category | version |

- 加载时校验 `noise_word` 不出现在任何 `SKU清单.商品名称` 中（子串判定），命中即报错，不静默删除。
- 标准化层按此表（长度降序）剥离修饰词/口语词。

1.4 一致性约束（加载时校验，任一失败抛 `DataLoadError`）

1. 三张表齐全、列名完整；
2. 映射表 `canonical ⊆ SKU清单.商品名称`；
3. 映射表内部 `alias` 无重复；
4. 同一 `alias` 指向不同 `canonical`（含 SKU别名合并冲突）时报错；
5. 噪声词不碰任何 SKU 商品名称。

## 2. Excel 三表列说明

工作表     | 列 |
高度匹配 | 订单编号 | 原始行 | 标准化名称 | 数量 | 匹配商品 | SKU编码 | 置信度 | 来源 |
审核通过 | 订单编号 | 原始行 | 标准化名称 | 数量 | 审核商品 | SKU编码 | 置信度 | 审核标记 | 来源 |
异常记录 | 订单编号 | 原始行 | 标准化名称 | 数量 | 异常类型 | 最高候选 | 最高分 | 候选列表 | 说明 | 来源 |

- 「订单编号」从 1 起，每张图/每段文字等于一个独立订单，其中「来源」是文件名。
  批量处理时三张表的所有行都用「订单编号」区分归属。
- 「审核标记」列在应用了 `loose` 映射时标注 `loose映射`，并附同义词、剥离词信息。
- 「异常记录」包含三部分，analyze 阶段异常（OCR_EMPTY / NO_SKU_MATCH / LOW_CONFIDENCE_NO_CANDIDATE）、审核拒绝（REVIEW_REJECTED）、待审核（REVIEW_PENDING）。

## 3. 阈值校准建议

当前默认值（`core/config.py`，均可用环境变量覆盖），`T_HIGH=80.0`、`T_LOW=30.0`、`TOP_N=5`。
这三个值**需要用真实标注订单校准**。
注意 `fuzz.WRatio` 对中文短词的分值并不均匀（常见 0 / 50 / 60 /80 / 90 / 100），且对「子串」给分偏高（`番茄酱` vs `番茄` ≈ 90、`小番茄` vs `番茄` ≈ 90、`大白菜` vs `白菜` ≈ 90）。

- 用一批真实订单 + 正确标注，统计「正确匹配」与「错误匹配」的分数分布，再定 T_HIGH / T_LOW。
- 召回不足时，调低 `T_LOW`，复核过多时，调高 `T_LOW` 或调低 `T_HIGH`。
- `TOP_N` 控制候选审核时展示的候选数量（默认 5），可按需调整。
- 对前缀修饰导致误匹配（如 `番茄酱`/`番茄`）这类问题，可靠手段是在 SKU 清单中补齐「番茄酱」等独立商品，或在映射表/噪声词表里显式处理，而不是一味依赖阈值。
- 形近字/同音字（士豆/土豆、蕃茄/番茄）交给LLM审核分支或映射表别名兜底。

## 4. MCP 工具接口：fresh_order_parse

工具名 `fresh_order_parse`（标题「生鲜订单解析」）：动词落在**解析**上，与平台已有的 `ocr_image`（通用图片识别）、`bom_validate`/`bom_merge`（按 `{服务}_{动作}` 命名）保持同一套口径。

四个入参对**模型**都是**文件空间相对路径**（如 `临时空间/订单1.png`），平台按 `file_args` 声明原位铸造成签名直链后才发给本服务；一次调用只处理一张订单图片：

| 入参 | 中文标题（schema `title`） | 模型该填什么 | 必填 |
|---|---|---|---|
| `image_path` | 订单图片 | 订单图片的相对路径（单张） | 是 |
| `sku_path` | SKU清单 | SKU清单 xlsx 的相对路径 | 是 |
| `noise_path` | 噪声词表 | 噪声词表的相对路径 | 否，留空用镜像内默认 `噪声词表.xlsx` |
| `synonyms_path` | 映射表 | 映射表的相对路径 | 否，留空用镜像内默认 `映射表.xlsx` |
| `resultUrl` | 结果回写地址 | **模型不填**（运行环境自动注入；声明即开启产出交付） | 否 |

- **两段语义要分清**：模型侧填相对路径（`description` 已按此措辞，并明确「请勿自行填写 http 地址」）；
  服务侧实际收到的是平台铸造的 `http(s)` 直链。若服务收到相对路径，说明平台侧漏配 `file_args`，
  报错文案会直接指出这一点；
- 三个数据表地址的解析结果在进程内缓存：同一组地址 `DATA_CACHE_TTL_SECONDS`（默认 300 秒）内复用，不重复下载解析；`DATA_CACHE_TTL_SECONDS=0` 关闭缓存，`DATA_CACHE_MAX_ENTRIES`（默认 8）控制缓存组数。

返回值**始终**包含三表解析结果（下面是 `order1.png` 的一次真实调用，非示意）；回写成功时末尾再多三个入口字段（见 §4.1）：

```json
{
  "auto_rows": [
    {"raw_line": "洋芋2斤", "normalized_name": "土豆", "quantity": "2斤", "unit": "斤",
     "removed_tokens": [], "synonym_applied": "洋芋→土豆", "loose_applied": false,
     "matched_name": "土豆", "sku_id": "VEG-002", "score": 100.0,
     "order_no": 1, "source": "order1.png"}
  ],
  "auto_count": 1,
  "review_rows": [
    {"raw_line": "蕃茄3斤", "normalized_name": "蕃茄", "quantity": "3斤", "unit": "斤",
     "removed_tokens": [], "synonym_applied": "", "loose_applied": false, "index": 0,
     "top_score": 60.00000000000001,
     "candidates": [{"name": "小番茄", "score": 60.00000000000001, "sku_id": "FRU-021"},
                    {"name": "番茄", "score": 50.0, "sku_id": "VEG-001"},
                    {"name": "茄子", "score": 50.0, "sku_id": "VEG-010"}],
     "order_no": 1, "source": "order1.png"}
  ],
  "review_count": 1,
  "error_rows": [],
  "error_count": 0
}
```

| 表 | 行字段 |
|---|---|
| `auto_rows`（高度匹配，score ≥ `T_HIGH`） | `raw_line` 原始行、`normalized_name` 标准化名、`quantity` 数量（含单位字符串，如 `2斤`）、`unit` 单位、`removed_tokens` 被剥离词（数组）、`synonym_applied` 生效的同义词（如 `洋芋→土豆`）、`loose_applied` 是否 loose 映射、`matched_name`/`sku_id`/`score` 命中的 SKU 与分数 |
| `review_rows`（候选审核，`T_LOW` ≤ score < `T_HIGH`） | 同上基础字段 + `index`（本批内的审核行序号）、`top_score` 最高分、`candidates[]`（`{name, sku_id, score}`，按分数降序，最多 `TOP_N` 个） |
| `error_rows`（异常记录） | 基础字段 + `error_type`（`OCR_EMPTY` / `NO_SKU_MATCH` / `LOW_CONFIDENCE_NO_CANDIDATE`）、`top_candidate`、`top_score`、`candidates[]`、`message` 一行说明 |

每行都带 `order_no`（订单编号，本工具单图恒为 `1`）与 `source`（图片文件名，取自 `image_path`）；`score` 为 0–100 的浮点数（可能带浮点尾数，如 `60.00000000000001`）。

- 图片下载失败或 OCR 不可用时，返回一条 `error_type="OCR_EMPTY"` 的异常记录（不抛异常），整体仍是成功响应；
- 三个数据表地址下载失败 / 列名不符 / 一致性校验失败时，抛 `DataLoadError` → MCP 侧是**工具错误**（`isError: true`，正文为一行原因），实测形状：

```json
{"jsonrpc":"2.0","id":2,"result":{"isError":true,"content":[
  {"type":"text","text":"Error calling tool 'fresh_order_parse': 下载商品数据失败：http://host.docker.internal:8765/not-exist.xlsx（Client error '404 File not found' ...）"}]}}
```

- 下载只有超时（`HTTP_TIMEOUT_SECONDS`，默认 30s）与 `follow_redirects=True`（对象存储签名直链常见 302），
  **当前没有下载体积上限**——大图 / 超大 xlsx 会整体读进内存；要设上限时加一个 `MAX_DOWNLOAD_BYTES` 配置即可；
- 返回 `dict` 时 FastMCP 把 JSON 直接放进 `content` 文本块（实测 `structuredContent` 为空），平台按正文读取即可。

### 4.1 产出交付：HTML 解析报告 + 三表工作簿

回写开关**只在工具自己的 `inputSchema` 里声明 `resultUrl`**（平台据此自动注入，模型看不到、也填不了，
平台侧无需任何配置；2026-10-17 起 `async_tools` 白名单已移除）。收到地址后本服务产出两份文件：

| 产出 | 文件名 | 返回字段 | 点开行为 |
|---|---|---|---|
| HTML 解析报告（顶层，第一入口） | `生鲜订单_{订单图名}_{时间戳}_报告.html` | `filePath` / `filePathName` | 平台沙箱 iframe 内联渲染（可读、可打印） |
| 三表工作簿（高度匹配 / 候选审核 / 异常记录） | `生鲜订单_{订单图名}_{时间戳}.xlsx` | `excelFile: {filePath, filePathName}` | 下载 |

```json
{
  "auto_rows": ["…"], "auto_count": 1,
  "review_rows": ["…"], "review_count": 1,
  "error_rows": [], "error_count": 0,
  "filePath": "临时空间/后台产出/th_1_生鲜订单_order1_20261113_153012_报告.html",
  "filePathName": "生鲜订单_order1_20261113_153012_报告.html",
  "excelFile": {
    "filePath": "临时空间/后台产出/th_1_生鲜订单_order1_20261113_153012.xlsx",
    "filePathName": "生鲜订单_order1_20261113_153012.xlsx"
  }
}
```

- **`filePath` 是平台回写响应里的 `path` 原样回传**，服务不自己拼（拼出来的多半点不开）；
- **键序即界面入口顺序**：报告在前、xlsx 在后（平台按 JSON 键顺序深度优先抽取 `filePath`）；
- **报告里没有导出按钮**：文件空间的 `.html` 以 `sandbox=""` + `CSP: sandbox` 打开，脚本与下载都被平台
  关掉。报告只写 xlsx 文件名与指路文案，**真正的导出入口是聊天区那两行入口 + 铃铛「后台记录」**
  （同一取舍见 `bom-service/report.py` 的三条硬约束）；
- **降级链**（原则九：解析结果永远照给）：xlsx 回写失败 → 报告照交；报告失败 → 顶层退回 xlsx 且不再给
  `excelFile`（同一文件不给两条入口）；两份都失败 → 无入口，原因写进返回值的 `delivery_note`；
- **单次回写上限 5MB**（平台 `UPLOAD_MAX_MB` bodyLimit）：先判大小再 POST，超限不白传一遍；
  报告另有 `FRESH_REPORT_MAX_ROWS`（默认 200 行/表）截断，全量数据以 xlsx 为准；
- 产出落点由平台锁死为 `临时空间/后台产出/`，**30 天未访问清理**，过期后入口点开 404。

### 4.2 数字人管理平台侧配置要点

| 项 | 取值 |
|---|---|
| 服务名（平台 `name`，管理员自定） | 建议 `fresh`（在 `MCP.json` 里工具会呈现为 `fresh__fresh_order_parse`） |
| transport | `http`（streamable-http） |
| url | 容器内互访 `http://fresh:8000/mcp`；宿主机直跑 backend 用 `http://<宿主机IP>:8104/mcp` |
| `allowed_tools` | 至少勾选 `fresh_order_parse`（本服务只有这一个工具） |
| `tool_labels` | `{"fresh_order_parse": "生鲜订单解析"}`（进意图聚焦命题文本与工具清单主标题） |
| `file_args`（**必需**） | `{"fresh_order_parse": {"image_path": "url", "sku_path": "url", "noise_path": "url", "synonyms_path": "url"}}`——模型填相对路径，平台按此声明铸成签名直链；漏配则服务收到相对路径并报错 |
| `confirmation` | 只读解析、无副作用，可设 `never` |
| 产出回写 | **无需配置**：工具 schema 已声明 `resultUrl`，运行环境自动注入（**不要**写进 `file_args`，那是"相对路径 → 签名直链"的入参口径） |

> 工具的**名字**会进入 `allowed_tools`、`confirmation.tools`、数字人 starter 的 `{kind:'mcp', name}` 与 `MCP.json`，
> 改名后这些位置 MUST 同步更新，否则工具对模型不可见（`allowed_tools` 按名字精确匹配）。

## 5. Docker 单镜像打包

镜像内已安装 `paddleocr` + `paddlepaddle`，并在构建期预热 PP-OCRv6 small 模型权重，容器运行时**不需要联网下载模型**。

**推荐：走仓库根 `docker-compose.yml`**（服务名 `fresh`，宿主 8104 → 容器 8000，与 ocr/jev/bom/laya 同一套约定）：

```bash
docker compose up -d --build fresh     # 仓库根目录执行
# MCP 端点（streamable-http）：容器内 http://fresh:8000/mcp；宿主机 http://<宿主机IP>:8104/mcp
```

单独构建运行（不接编排时）：

```bash
docker build -t fresh_food_mcp_v1 .
docker run -d --name fresh_food_mcp_v1 -p 8104:8000 fresh_food_mcp_v1
```

环境变量（可覆盖 `core/config.py` 默认值）：`MCP_HOST`、`MCP_PORT`、`MCP_PATH`、`T_HIGH`、`T_LOW`、`TOP_N`、`HTTP_TIMEOUT_SECONDS`、`DATA_CACHE_TTL_SECONDS`、`DATA_CACHE_MAX_ENTRIES`、`OCR_DET_MODEL`、`OCR_REC_MODEL`；
产出交付相关（默认值见 `mcp_server.py` / `core/html_report.py`）：`FRESH_PUT_TIMEOUT_S`（回写超时，默认 30s）、`FRESH_RESULT_MAX_BYTES`（单次回写上限，默认 5MB，与平台 `UPLOAD_MAX_MB` 对齐）、`FRESH_REPORT_MAX_ROWS`（报告单表行数上限，默认 200）、`FRESH_REPORT_MAX_CANDIDATES`（报告候选展示上限，默认 5）。

注意：镜像体积约 2–3 GB（paddle 依赖所致）；首次构建需要联网下载 `paddlepaddle` 与 OCR 模型。

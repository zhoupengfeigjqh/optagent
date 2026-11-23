# 生鲜订货订单识别与审核（fresh_order_review）

面向生鲜配送「文员接单」场景的订单识别与审核系统：手写单据图片 / 对话文本→ 标准化 + RapidFuzz 模糊匹配 → 按置信度分流为三张表（高度匹配 / 候选审核 / 异常记录）→ 人工审核（本地 CLI 或 Dify Chatflow Human Input）→ 导出三工作表 Excel。
核心逻辑全部是无状态纯函数，本地 CLI 与 FastMCP 两个入口复用同一套 `core/` 代码。
MCP 侧另产出**一份三表 xlsx**，经平台注入的 `resultUrl` 回写文件空间（见 §4.1）；**不产出 HTML 报告**。

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
	|——html_report.py  # 解析报告 HTML 渲染（历史实现，MCP 侧已不再调用）
|——mcp_server.py # FastMCP 服务（工具 fresh_order_parse）+ resultUrl 产出回写
|——requirements.txt # 基础依赖
|——requirements-ocr.txt # 图片 OCR 依赖（paddleocr/paddlepaddle）
|——Dockerfile # 单镜像打包（含 OCR 模型预热）
|——pytest.ini

## 1. 输入数据结构——`商品数据.xlsx`

默认文件名 `商品数据.xlsx`，三个工作表，表名与列名严格如下：

> **2026-11 起的三文件模式（`fresh_order_parse` 默认走这条）**：三个独立文件各一张表——
> `sku.xlsx`（SKU 主数据，列见 1.1）、`map.xlsx`（映射表，列见 1.2）、`noise.xlsx`（噪声词表，列见 1.3）。
> 两点差异：① 编码列名为 **`编码`**（旧表 `SKU编码` 仍兼容，加载时统一成 `编码`）；
> ② SKU 表可有多余列（`品牌` / `要求` / `备注`），加载器只校验必需列，多余列不参与匹配。
> 默认路径见 `core/config.py`（`DEFAULT_SKU_PATH` / `DEFAULT_SYNONYMS_PATH` / `DEFAULT_NOISE_PATH`，可用环境变量覆盖）。

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

## 2. Excel 列说明（默认只看到「最终推荐」）

工作簿有 4 张表，**默认只显示「最终推荐」**，明细三表被隐藏（Excel 里右键标签「取消隐藏」可查看）：

工作表     | 列 | 可见性 |
最终推荐 | 客户 | 商品名称 | 销售单位 | 数量 | 单价 | 金额 | 供应商 | 原始记录 | **可见（唯一）** |
高度匹配 | 客户 | 商品名称 | 销售单位 | 数量 | 单价 | 金额 | 供应商 | 原始记录 | 隐藏 |
候选审核 | 客户 | 商品名称 | 销售单位 | 数量 | 单价 | 金额 | 供应商 | 候选1 | 候选2 | 候选3 | 候选4 | 候选5 | 原始记录 | 隐藏 |
异常记录 | 客户 | 商品名称 | 销售单位 | 数量 | 单价 | 金额 | 供应商 | 原始记录 | 异常说明 | 隐藏 |

- **最终推荐** = 三档按 高度匹配 → 候选审核 → 异常记录 顺序拼接，列与「高度匹配」一致；
  按来源分色：高度匹配黑字、**候选审核紫字加粗**、**异常记录红字加粗**；
  候选审核那几行的「商品名称」保留下拉，数据源是「候选审核」表同一行的 `候选1~候选5`
  （`B3 → '候选审核'!$H2:$L2`）。
- **客户** 列**留空**（只保留表头）：单图解析拿不到客户信息，也不再写 `订单001` 这类占位值。
- **商品名称**：高度匹配/异常记录是 SKU 标准名（异常行取最高候选的标准名）；
  **候选审核是下拉列表**——点单元格右侧箭头可选，选项就是本行的 `候选1~候选5`（纯商品名、不带分数），
  默认预选第一候选，也可手填（`showErrorMessage=False`，下拉只是省事）。
- **候选1~候选5** 放**纯商品名**（不带分数），既是给人看的候选，也是下拉列表的数据源（`B2 → $H2:$L2`）。
- **销售单位 / 数量 / 原始记录 / 异常说明** 保留原解析结果；数量只放数字（`1件` → `1`，单位另列）。
- **单价 / 金额 / 供应商** 只保留列名，内容留空（平台侧自行补）。


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
| `noise_path` | 噪声词表 | 噪声词表的相对路径 | 否，留空用镜像内默认 `noise.xlsx` |
| `synonyms_path` | 映射表 | 映射表的相对路径 | 否，留空用镜像内默认 `map.xlsx` |
| `resultUrl` | 结果回写地址 | **模型不填**（运行环境自动注入；声明即开启产出交付） | 否 |
| `layout` | 版面模式 | **模型不填**（默认 `auto`；`off` 退回旧逐行 OCR） | 否 |
| `reader` | 识别通道 | **模型不填**（默认 `auto`：表格走 OCR、手写走 LLM；`ocr` / `llm` 可强制） | 否 |

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

### 4.1 产出交付：三表工作簿（**不再产出 HTML 报告**）

回写开关**只在工具自己的 `inputSchema` 里声明 `resultUrl`**（平台据此自动注入，模型看不到、也填不了，
平台侧无需任何配置；2026-10-17 起 `async_tools` 白名单已移除）。收到地址后本服务**只产出一份文件**：

| 产出 | 文件名 | 返回字段 | 点开行为 |
|---|---|---|---|
| 三表工作簿（高度匹配 / 候选审核 / 异常记录） | `{订单图名}_{时间戳}.xlsx` | 顶层 `filePath` / `filePathName` | 下载 |

```json
{
  "auto_rows": ["…"], "auto_count": 1,
  "review_rows": ["…"], "review_count": 1,
  "error_rows": [], "error_count": 0,
  "filePath": "临时空间/后台产出/th_1_order1_20261113_153012.xlsx",
  "filePathName": "order1_20261113_153012.xlsx"
}
```

- **`filePath` 是平台回写响应里的 `path` 原样回传**，服务不自己拼（拼出来的多半点不开）；
- **只有一份产出 ⇒ 入口字段放顶层**（契约 §4.7.1：单产出不给嵌套字段，同一文件也不给两条入口）；
- **降级**（原则九：解析结果永远照给）：xlsx 生成/回写失败 → 无入口，原因写进返回值的 `delivery_note`；
- **单次回写上限 5MB**（平台 `UPLOAD_MAX_MB` bodyLimit）：先判大小再 POST，超限不白传一遍；
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

环境变量（可覆盖 `core/config.py` 默认值）：`MCP_HOST`、`MCP_PORT`、`MCP_PATH`、`T_HIGH`、`T_LOW`、`TOP_N`、`HTTP_TIMEOUT_SECONDS`、`DATA_CACHE_TTL_SECONDS`、`DATA_CACHE_MAX_ENTRIES`、`OCR_DET_MODEL`、`OCR_REC_MODEL`、`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_TIMEOUT_S`、`LLM_MAX_IMAGE_BYTES`、`LLM_MAX_TOKENS`、`LLM_CACHE_TTL_SECONDS`；
这些也可以写在项目根 `.env`（`.env.local` 可覆盖，真实环境变量优先级最高）；**API Key 只放 `.env`，不要写进 `core/config.py`**。
产出交付相关（默认值见 `mcp_server.py`）：`FRESH_PUT_TIMEOUT_S`（回写超时，默认 30s）、`FRESH_RESULT_MAX_BYTES`（单次回写上限，默认 5MB，与平台 `UPLOAD_MAX_MB` 对齐）。

注意：镜像体积主要来自 `paddlepaddle`（约 400–600 MB）与 `opencv-contrib-python`（约 90 MB）；首次构建需要联网下载依赖与 OCR 模型。

**API Key 怎么进容器**（`.env` 不会被打进镜像，`.dockerignore` 已排除）：

| 方式 | 写法 |
|---|---|
| docker compose（推荐） | 服务里加 `env_file: [ "./.env" ]`（或 `environment: { LLM_API_KEY: ${LLM_API_KEY} }`，compose 会自动读同目录 `.env` 做插值） |
| docker run | `docker run -e LLM_API_KEY=sk-... ...` 或 `docker run --env-file .env ...` |
| 系统环境变量 | 宿主导出后 `-e LLM_API_KEY` 透传（**不要** COPY 进镜像） |


### 5.1 镜像瘦身（2026-11：只改构建，不改逻辑）

`Dockerfile` 已改成**两阶段构建**（builder 装依赖并预热模型 → runtime 只搬运行期需要的文件），并做了这些清理：

| 措施 | 作用 |
|---|---|
| 两阶段 + `COPY --from=builder` | 构建期中间产物不进最终镜像；`site-packages` 与 `/usr/local/bin` 与 builder 完全一致 |
| 删除 `site-packages/paddle/include` | 运行时用不到的 C++ 头文件（实测 **17.6 MB**，删掉后 OCR 结果不变） |
| 模型缓存只留 `PP-OCRv6_small_det` / `PP-OCRv6_small_rec` | 防止 medium（**133 MB**）等其它权重被打进镜像 |
| `.dockerignore` 收紧 | `输出/`、`单据样例/`、`actual_orders/`、`.venv/`、`餐料报价.xlsx`、`导入模板-*.xlsx`、`*.zip` 不再进入构建上下文，构建更快 |
| `ARG INSTALL_OCR=1` | 默认与改造前完全一致；`--build-arg INSTALL_OCR=0` 可构建**不带 OCR**的瘦镜像 |

```bash
# 完整镜像（含 OCR，默认）
docker build -t fresh_food_mcp_v1 .

# 瘦镜像（不带 paddle/OCR，仅 LLM 通道）
docker build --build-arg INSTALL_OCR=0 -t fresh_food_mcp_v1:slim .

# 量一下效果
docker images | grep fresh_food_mcp
docker history --no-trunc fresh_food_mcp_v1 | head -20
```

**预期与边界（实测数据）**：镜像体积的 ~85% 是 `paddle`（本机实测 398.7 MB）+ `opencv-contrib-python`（约 90 MB），
所以"纯工程瘦身"的天花板就在 **3–5%（约 30–50 MB）**；`slim` 镜像因去掉了 OCR 全家桶可到 **约 250–350 MB（−70%）**，
但表格截图将无法识别（会返回 OCR 不可用的错误记录）。

> 想在不牺牲表格能力的前提下大幅瘦身，必须**换 OCR 引擎**（如 `rapidocr-onnxruntime`，去掉 paddle 全家桶，可到 300–450 MB），
> 那会动到 `core/ocr.py` 的实现，不属于"零逻辑改动"，需要单独评估与回归。


## 6. 本地跑一单（VS Code）

### 6.1 一次性准备

1. VS Code → 文件 → 打开文件夹 → 选 `fresh-service`；
2. `Ctrl+Shift+P` → `Python: Select Interpreter` → 选装了依赖的解释器（本机为 Anaconda 3.12）；
3. 终端里装依赖：

```bash
pip install -r requirements.txt
pip install -r requirements-ocr.txt   # 只有要跑图片 OCR 才需要（paddleocr + paddlepaddle）
```

### 6.2 跑一单（三种入口）

```bash
python run_order.py 单据/order1.png              # 图片：版面归一 + OCR
python run_order.py 单据/order1.txt              # 文本：整份文件算一张单
python run_order.py actual_orders.txt --each-line  # 批量：每行算一张单
```

常用参数：`--sku / --map / --noise` 换数据表；`--outdir` 换输出目录（默认 `输出/`）；
`--prefer-text` 在图片旁有同名 `.txt` 时优先用转录文本；
`--layout auto|table|list|off` 控制版面模式（默认 `auto`，`off` 退回旧的逐行 OCR）；
`--reader auto|llm|ocr` 控制识别通道（默认 `auto`：**表格走 OCR、手写走 LLM**）。

### 6.2.0 识别通道：表格 OCR、手写 LLM（2026-11 新增）

```
图片 ──① 版面层先判版式（core/layout.py）
        ├─ 表格截图 → OCR + 版面层（印刷体 OCR 已足够，零成本、可离线）
        └─ 手写/列表 → LLM 转录（core/llm_read.py）→ 文本交给 analyze_order（后续完全不变）
                          └─ 未配 Key / 超时 / 行数明显少于 OCR → 自动回退 OCR+版面层
```

- **Key 放项目根的 `.env`**（**不要写进 `core/config.py`**）：`core/config.py` 导入时会自动加载
  `.env` → `.env.local`（后者覆盖前者）。
  **API Key 槽位（`LLM_API_KEY` / `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY` / `OPENAI_API_KEY`）以 `.env` 里的非空值为准**——
  改了 `.env` 就生效，不用再动系统变量；`.env` 里是空值（`LLM_API_KEY=`）则视为没设置，继续用系统/容器环境变量。
  其它变量（`MCP_PORT`、阈值等）仍以真实进程环境变量优先。`core/config.py` 里只保留占位符。
- **认四个常见的变量名**（优先级从高到低，没有唯一官方名）：`LLM_API_KEY` → `DEEPSEEK_API_KEY` →
  `DASHSCOPE_API_KEY`（阿里云百炼）→ `OPENAI_API_KEY`。Key 来自 `DASHSCOPE_API_KEY` 时，
  没显式设 `LLM_BASE_URL` 会自动用百炼兼容端点 `https://dashscope.aliyuncs.com/compatible-mode/v1`。
  ⚠️ 百炼上的 deepseek 系列多为**纯文本**模型，读图要设 `LLM_MODEL=qwen-vl-max`（或其它视觉模型）。
- **怎么准备 `.env`**：`cp .env.example .env`（Windows：`Copy-Item .env.example .env`），填 `LLM_API_KEY=sk-...` 即可；
  `.env` / `.env.local` 已在 `.gitignore` 与 `.dockerignore` 里排除——**不会提交、也不会打进镜像**，部署时由 compose 的 `env_file` 注入。
- **每次都会告诉你走了哪条路**：`run_order.py` 日志、HTML 报告头、MCP 返回 JSON 的 `reader` 字段都会写明
  `reader=llm|ocr`、`kind`、`llm_lines`、降级原因；`--reader llm` 却没配 Key 时**直接报错退出**，不会静默回退成 OCR。
- 相关配置（同文件）：`LLM_BASE_URL`（默认 `https://api.deepseek.com/v1`）、`LLM_MODEL`（默认 `deepseek-flash`，可选 `deepseek-v4-pro`）、
  `LLM_TIMEOUT_S`、`LLM_MAX_IMAGE_BYTES`、`LLM_MAX_TOKENS`（默认 **8192**，见下）、`LLM_CACHE_TTL_SECONDS`（同图 sha256 缓存，不重复计费）。
- ⚠️ **推理模型要注意 `max_tokens`**：`deepseek-flash` 会先把思维链写进 `reasoning_content`，
  给 2048 会卡在"思考阶段"被截断（`finish_reason=length`、`content` 为空）→ 镜像里的默认值已调到 8192；
  真被截断时日志会直接提示"调大 `LLM_MAX_TOKENS` 或换非推理模型"。
- 提示词要求模型"**只转录**"：不纠错、不补全、不带表头/页码、保留数量单位原始写法；返回再按行过滤。
- 校验与降级：LLM 行数 < OCR 检出行数 × 0.8 → 判为漏行，回退 OCR；每行带 `reader=llm|ocr` 标记便于审计。
- 成本：只有手写单会调 LLM；表格单、以及没有 Key 的环境完全走本地 OCR。

### 6.2.1 版面归一层（2026-11 起，默认开启）

图片先经 `core/layout.py` 还原成「行 → 品名/数量/单位」再匹配，因此**两种单据都能吃**：

| 输入形态 | 处理 |
|---|---|
| 表格截图（终端/货品名称/数量/单位/备注/部门） | 找表头 → 按列角色取值；终端、部门、合计、表头行丢弃；`1.9L`/`25KG` 等规格不被当成数量 |
| 手写列表（一行一个商品，可能左右分栏） | 按大间隙判分栏 → 逐行拼回 → 从右往左取「数字+数量单位」锚点，锚点右侧进备注 |

**无关列排除（2026-11 加固）**：采购系统导出的宽表常带一堆跟下单量无关的列（当前状态、采购食堂/工作小组、
联系方式、采购日期、单价、下单金额、供货商名称、货品编码、品类…）。表格模式下这些列统一判为 `ignore`：
- 表头关键词里补了这些词，**ignore 优先于 name**，所以「供货商名称」不会再被「名称」抢成品名列；
- 一页里若有多列都像品名，只保留**紧挨单位/规格/数量**的那一列，其余降级为 ignore；
- 品名只接受**落在品名列区间内**的单元格（±0.6 列宽），供应商/编码即使被 OCR 粘在一起也进不来；
- 品名里若出现「有限公司/餐饮/供应商/食堂/集团」或长度 > 24，判为串列，置信度压到审核阈值以下。

**列对齐（2026-11 加固）**：手机斜拍/透视会让同一列在不同高度上横向漂移（实测序号列漂 85px、品名列漂 91px），
固定 x 边界或按比例缩放都会错列。现在改为**按内容类型 + 列顺序做单调对齐（DP）**——
「品名是中文、数量是数字、单位是单位词」，跨列允许跳过空单元格；对不齐时再用
「最长中文格当品名 + 离单位最近的数字当数量」兜底；仍解析不出的行写入异常记录
（`LAYOUT_UNPARSED`），不再静默丢弃。

**合行、换行与左右两栏**：手写行距小、OCR 框又常常"一框包两行"，所以**允许相邻行被聚成一行**，
再靠三条规则保证商品数不丢：
- **横向**：一行里若两块文字之间有明显空白（> 3 字宽）→ 判为左右两栏的两件商品，各自成行；
- **锚点**：一行里出现 ≥2 个「数字+数量单位」锚点时，按锚点切成多条记录（不会只保留最后一个）；
- **换行**：一个商品被换行写（名字一行、数量一行）时，把"以数字开头的行"接回上一行。
此外：手写常见的单位近形字（抱→包、伴→件、泮→瓶、体→件、仓→箱…）在解析前统一纠正；
左右分栏位置改为**按行投票**（个别横跨两栏的框拖不垮整页判定）。
数量为 0 / 缺失 / >1000 的行不再自动放行，直接进候选审核。

版面置信度不足（缺数量/单位、名称过短）的行不会自动放行，直接进**候选审核**，避免"瓶""包""1"这类格子被误匹配。
平台侧无需任何改动：`fresh_order_parse` 入参仍是图片 + 三张表，出参仍是三表（+ 回写成功时的 xlsx 入口）；`layout` 参数默认 `auto`，平台不必填。

**在 VS Code 里按 F5**：仓库自带 `.vscode/launch.json`，三个配置——
「解析当前打开的单据（图片或 txt）」（打开文件后直接 F5）、「批量跑 actual_orders.txt」、「跑单元测试」。

### 6.3 输出

- `输出/<单据名>_三表结果.xlsx`：三个工作表（高度匹配 / 候选审核 / 异常记录），列与线上一致；
- `输出/<单据名>_报告.html`：同一份结果的可读报告（无脚本、可打印）；
- 控制台同时打印三张表明细。

### 6.4 手写字识别不准时

PP-OCRv6 small 对手写体能力有限（实测一张手写单 38 行里约一半会认错字，多数会落进候选审核）。两个办法：

1. 手工转录成同名 `.txt`（每行一条 `商品名数量单位`），然后
   `python run_order.py 单据/order1.png --prefer-text`；
2. 换更大模型（首次会联网下载权重）：
   `OCR_DET_MODEL=PP-OCRv6_medium_det OCR_REC_MODEL=PP-OCRv6_medium_rec`。

### 6.5 调阈值 / 候选数

`T_HIGH`（≥ 该分进高度匹配）、`T_LOW`、`TOP_N` 都可用环境变量覆盖，例如 PowerShell：

```powershell
$env:T_HIGH="95"; python run_order.py 单据/order1.png
```

### 6.6 跑测试

```bash
python -m pytest -q
```

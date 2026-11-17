# 特性规格：`write_file` 按扩展名路由输出格式

- **特性标识**：`022-write-file-format-routing`
- **创建日期**：2026-11-16
- **状态**：**一期 / 二期 / 三期均已实现**（2026-11-16）
- **影响范围**：`agent-backend`（新增 `domain/tools/write-modes.ts`、`domain/tools/encoders/{text,xlsx,pdf}.ts`、`domain/preview/xlsx-text.ts`，改 `write-file.ts` / `file-access.ts` / `read-file.ts` / `routes/files.ts` / `builtin-tool-catalog.ts` / `infra/builtin-tools.ts` / `infra/agent-factory.ts` / `server.ts` / `config.ts` 注释）+ `frontend`（`utils/file-kind.ts`、`composables/usePreview.ts`、`components/layout/WorkspacePanel.vue`）。接口结构不变（`write_file` 结果新增 `mode`，属增量）

## 原始输入

> 我们约定 `write_file` 支持：md/json/html/txt/pdf/xlsx/csv 这几大类文件的生成……`write_file` 根据 filename 的后缀，路由到对应的输出模式里……后缀不在预定义内的，一律走 txt 格式。

## 现状核对（改造前）

| # | 环节 | 改造前 | 与规格的关系 |
|---|---|---|---|
| 1 | 落盘 | `FileAccess.write` 固定 `writeFile(abs, content, 'utf8')`，无扩展名判定 | 无法产出任何二进制容器 → `FR-001` |
| 2 | 假文件 | 写 `x.pdf` / `x.xlsx` 会**成功落盘纯文本**，入口可点、打开即失败 | 静默损坏 → `FR-006` |
| 3 | `.md` 预览 | 后端 `PREVIEW_CONTENT_TYPES` 无 `.md` → 回退附件下载；前端 `resolvePreviewKind` → `unsupported` | 与 `read_file` 支持 `.md` 不对称 → `FR-010` |
| 4 | 未知扩展名 | 写入侧不限制；读取侧对未知扩展名一律拒绝 | 写读不对称 → `FR-003` / `FR-009` |
| 5 | 体积上限 | `write_file` 无任何字节校验（`config.ts` 注释误称被 `UPLOAD_MAX_MB` 卡住） | 可能写出点开即 413 的文件 → `FR-007` |
| 6 | 错误通道 | 内容/格式错误只能落进通用 `TOOL_EXECUTION_FAILED` | 模型无法自我纠正 → `FR-004`~`FR-007` |

## 功能需求

- **FR-001**：`write_file` MUST 按 `filename` 的扩展名（`path.extname().toLowerCase()`，只取最后一段）路由输出模式；大小写不敏感。
- **FR-002**：已登记扩展名 = `.txt` `.md` `.html` `.csv` `.json` `.xlsx` `.pdf`；清单的唯一实现在 `write-modes.ts`（`supportedExtensions()`）。
- **FR-003**：**未登记扩展名（含无扩展名）MUST 回落文本模式，不得拒绝**——行为与改造前一致，零兼容破坏。
- **FR-004**：`.json` MUST 通过 `JSON.parse`，失败 → `CONTENT_FORMAT_MISMATCH`，**零落盘**；内容原样写盘（不重排）。
- **FR-005**：`.csv` MUST 通过弱校验（无 NUL、引号配对），失败 → `CONTENT_FORMAT_MISMATCH`，**零落盘**；列数不齐不视为错误。
- **FR-006**：`.xlsx` MUST 由 `content`（CSV 行数据，可用 `# Sheet: 名称` 分段）生成**真实 xlsx 容器**；MUST NOT 落"扩展名像二进制、内容却是文本"的假文件。约束：
  - 所有单元格 MUST 为字符串类型（不产生公式，防 `=cmd|'/c calc'!A0` 注入）；
  - 表名非法字符 MUST 被改写、>31 字符 MUST 被截断、重名 MUST 去重（不因命名细节让写入失败）；
  - 行列数与单元格总量 MUST 有上限（规范上限 + 单次 20 万单元格护栏）。
- **FR-011**：`.pdf` MUST 由 `content`（受限 Markdown：`#` 标题、空行分段、`- `/`1. ` 列表、`| a | b |` 表格）生成**真实 PDF**，且 MUST 嵌入开源中文字体（不依赖阅读器替换 CJK 字形）。含不可打印控制字符、内容为空 → `CONTENT_FORMAT_MISMATCH` 且零落盘。
- **FR-012**：`.xlsx` MUST 可内联预览：后端 `GET /api/files/preview` 将其转成 `text/csv`（多 sheet 带 `### Sheet:` 分段）内联返回，前端 `resolvePreviewKind('.xlsx') === 'sheet'` 并以等宽文本呈现；`.xls` 保持回退下载。
- **FR-007**：编码后字节数 MUST 不超过写入上限（生产注入 `PREVIEW_MAX_MB`，缺省 5MB），超限 → `FILE_TOO_LARGE` 且**零落盘**；结果里的 `bytes` MUST 是**落盘字节数**。
- **FR-008**：**权限与命名判据不变**：仅 `临时空间/` 顶层扁平文件名、`{threadId}_` 前缀、禁 `:`、`resolveSafe` 全链路照旧。格式路由 MUST NOT 进入 `FileAccess`（该层还有 `tool-events` 外置副本调用方，不能被模型的格式清单牵连）。
- **FR-009**：`read_file` 对未登记扩展名 MUST 按**内容**判定：含 NUL → 沿用"不支持的文件格式"提示；无 NUL → 按 utf8 文本读并沿用截断口径。以此保证"写得进去的一定读得回来"。
- **FR-010**：`.md` MUST 可内联预览：后端 `text/markdown; charset=utf-8` + `inline`，前端 `resolvePreviewKind('.md') === 'text'`；两侧同一批改动，MUST NOT 单侧生效。

## 验收场景

- **SC-001**：`th_1_分析.md` + Markdown 文本 → 落盘原文，`mode=markdown`，预览为纯文本（不再下载）。
- **SC-002**：`th_1_数据.json` + `{rows: 42}` → 卡片标红、`CONTENT_FORMAT_MISMATCH`、磁盘无文件。
- **SC-003**：`th_1_汇总.xlsx` + `物料,数量\nA,10` → 落盘 zip 容器（`PK` 魔数）、`mode=xlsx`；`read_file` 回读得到 `### Sheet: Sheet1` 与行列内容；预览以 `text/csv` 内联。
- **SC-003b**：`th_1_报告.pdf` + `# 月报\n\n产量 1200 件` → 落盘 `%PDF-` 容器、`mode=pdf`；`read_file`（pdfjs）能读出中文原文。
- **SC-003c**：`.xlsx` 单元格 `=cmd|'/c calc'!A0` → 落成**字符串**单元格（无 `f` 字段），Excel 打开不执行。
- **SC-004**：`th_1_日志.log` + 文本 → 写入成功；随后 `read_file 临时空间/th_1_日志.log` 逐字回读；预览回退附件下载。
- **SC-005**：`报表.xlsx`（缺前缀）→ `FILE_ACCESS_DENIED`，文案与改造前一致。
- **SC-006**：`缓冲区.bin`（含 NUL）`read_file` → "不支持的文件格式"，提示含支持清单。
- **SC-007**：`.xlsx` 表格源为空 / 引号未闭合 → `CONTENT_FORMAT_MISMATCH`、磁盘无文件。

## 非目标

- `.xls` 生成（BIFF8 容器）：回落文本模式，工具说明点名"需要 Excel 请用 `.xlsx`"；`.xls` 预览保持回退下载。
- 未登记扩展名的内联预览（仍为下载）。
- `.html` 放开脚本执行（沙箱 `sandbox=""` + `CSP: sandbox` 双保险不变）。
- PDF 的完整 Markdown（图片、脚注、目录、页眉页脚）与样式定制。

## 修订记录

| 日期 | 修订 | 说明 |
|---|---|---|
| 2026-11-16 | 初版并落地一期 | 定稿"未登记扩展名回落文本"（原方案曾考虑拒绝，用户拍板改为回落）；一期含 `.md` 预览映射与 `read_file` 嗅探兜底；`.xlsx` / `.pdf` 一期只报错不落假文件 |
| 2026-11-16 | 二期 `.xlsx` 落地 | 新增 `encoders/xlsx.ts`（CSV / `# Sheet:` 分段 → 真实工作簿，单元格强制字符串、表名合法化、行列护栏）；`xlsxToText` 抽到 `domain/preview/xlsx-text.ts` 供读侧与预览侧共用；`routes/files.ts` 把 `.xlsx` 转 `text/csv` 内联；前端新增 `sheet` kind |
| 2026-11-16 | 三期 `.pdf` 落地 | 新增 `encoders/pdf.ts`（受限 Markdown → PDF，嵌入 Noto Sans SC 400/700，字体字节进程级缓存）；`FR-006` 由"报错不落盘"改为"生成真实 xlsx"；删除 `FormatNotImplementedError`（已无触发点） |

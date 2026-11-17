# 实施计划：`write_file` 按扩展名路由输出格式

- **特性**：`022-write-file-format-routing`
- **日期**：2026-11-16
- **范围**：`agent-backend` + `frontend`（契约面上 `write_file` 结果新增 `mode`，其余不变）

## 分层决策

| 层 | 文件 | 职责 |
|---|---|---|
| 注册表 | `src/domain/tools/write-modes.ts` | 扩展名 → 模式（纯数据 + 三类错误），`resolveWriteMode` / `supportedExtensions` |
| 编码/校验 | `src/domain/tools/encoders/text.ts` | `encodeText` / `validateJson` / `validateCsv`（纯函数） |
| 编码（表格） | `src/domain/tools/encoders/xlsx.ts` | CSV / `# Sheet:` 分段解析 + 校验 + xlsx 容器编码 |
| 编码（文档） | `src/domain/tools/encoders/pdf.ts` | 受限 Markdown → 排版块 → PDF（嵌入中文字体，字体字节进程级缓存） |
| 共享解析 | `src/domain/preview/xlsx-text.ts` | `xlsxToText`：`read_file` 与 `/api/files/preview` 共用 |
| 工具入口 | `src/domain/tools/write-file.ts` | 路由 → 校验 → 编码 → 限额 → 交字节给写口（`await` 编码结果） |
| 权限原语 | `src/domain/file-access.ts` | 新增 `writeBytes`；`write` 委托给它。**不含格式知识** |

**为什么路由不进 `FileAccess`**：`FileAccess.write` 还有内部调用方（`tool-events` 的
`{threadId}_toolresult_{callId}.txt` 外置副本）。把模型可见的格式清单塞进权限层，
将来清单调整会静默影响工具事件外置；分层后内部路径只受"tmp 顶层 + 前缀"约束。

## 改动清单

### 后端
| 文件 | 改动 |
|---|---|
`domain/tools/write-modes.ts` | 新增：注册表、`ContentFormatError` / `FormatNotImplementedError` / `WriteTooLargeError`、`FALLBACK_WRITE_MODE`
`domain/tools/encoders/text.ts` | 新增：utf8 编码 + JSON/CSV 校验
`domain/tools/encoders/xlsx.ts` | 新增：表格源解析/校验 + xlsx 编码（单元格强制字符串、表名合法化、护栏）
`domain/tools/encoders/pdf.ts` | 新增：受限 Markdown → PDF（Noto Sans SC 400/700 嵌入、自动分页、表格排版）
`domain/preview/xlsx-text.ts` | 新增：`xlsxToText` 抽离（读侧与预览侧共用）
`domain/tools/write-file.ts` | 改写：路由 + 校验 + 编码 + 限额；返回 `{ path, bytes, mode }`；`bytes` = `buf.length`
`domain/file-access.ts` | 新增 `writeBytes`；`write` 委托它（行为不变）
`domain/tools/read-file.ts` | 未知扩展名按内容嗅探（含 NUL 拒绝，否则按文本）；抽出 `sliceText` 供 Excel/PDF/未知三条路共用
`routes/files.ts` | `PREVIEW_CONTENT_TYPES` 增 `.md: text/markdown`；`.xlsx` 分支转 `text/csv` 内联
`domain/builtin-tool-catalog.ts` | `write_file` 说明与入参重写（列七类 + 回落规则 + HTML 无脚本）
`infra/builtin-tools.ts` | 三种新错误 → 专用错误码；结果加 `mode`；`maxWriteBytes` 透传
`infra/agent-factory.ts` | `AgentFactoryDeps.writeMaxBytes` 透传
`server.ts` | 注入 `config.previewMaxMb * 1024 * 1024`
`config.ts` | 更正 `PREVIEW_MAX_MB` 注释（原文误称 `write_file` 受 `UPLOAD_MAX_MB` 约束）

### 前端
| 文件 | 改动 |
|---|---|
`src/utils/file-kind.ts` | `TEXT_EXTENSIONS` 增 `.md`（与后端 `text/markdown` 同批）；新增 `sheet` kind 收纳 `.xlsx`，`.xls` 保持下载 |
`src/composables/usePreview.ts` | `PreviewContent.renderMode` 增 `sheet`；文本分支按 kind 产出 `sheet` |
`src/components/layout/WorkspacePanel.vue` | 新增 `renderMode === 'sheet'` 分支（复用 `<pre>`，不引前端解析库） |

## 契约与错误码

| code | 触发 | 卡片 |
|---|---|---|
`CONTENT_FORMAT_MISMATCH` | JSON 解析失败、CSV 引号未闭合/含 NUL、xlsx 表格源为空/无行列、pdf 内容为空/含控制字符 | 标红 |
`FILE_TOO_LARGE` | 编码后超写入上限 | 标红 |
`FILE_ACCESS_DENIED` | 既有（前缀/扁平名/`:`/空间只读） | 标红，文案不变 |

> 一期曾定义 `FORMAT_NOT_IMPLEMENTED`（`.xlsx` / `.pdf` 未接编码器时）。二期/三期落地后**该错误已无触发点，代码与错误码一并删除**，避免留一条永远不会命中的分支。

工具结果 JSON 新增 `mode`（`text` / `markdown` / `json` / `html` / `csv` / `xlsx` / `pdf`）；
`filePath` / `filePathName` 语义与位置不变，`view_links` 抽取不受影响。

## 宪章对照

- **② 代码质量**：注册表与编码器分离，单文件均 < 300 行；`xlsxToText` 在二期抽到 `domain/preview/`（此时才出现第二个调用方）。
- **③ 测试**：`write-modes.spec`（21 例）、`write-file.spec`（17 例）、`xlsx-encoder.spec`（16 例）、`pdf-encoder.spec`（12 例）、`read-file.spec` 增 4 例、`builtin-tools.spec` 增 6 例、`files-preview.spec` 增 3 例；`builtin-tool-catalog.spec` 同步逐字断言。
- **⑤ 性能**：路由为 O(1) 查表；xlsx 为内存内一次序列化；pdf 字体字节进程级缓存（最多两份 ≈21MB），单份文档 ~100–150ms。
- **⑥ 依赖**：一期零新增；二期复用已有 `xlsx`；三期新增 `pdfkit`（MIT）、`@types/pdfkit`（dev，MIT）、`@expo-google-fonts/noto-sans-sc`（SIL OFL 1.1，中文字体）——选型与拒绝方案记录在 `research.md`。
- **⑦ 契约**：错误码变更（新增 `CONTENT_FORMAT_MISMATCH`，删除 `FORMAT_NOT_IMPLEMENTED`）；`write_file` 说明文本变更两侧同批（目录是唯一来源，平台投影自动跟随）。
- **⑨ 降级**：编码失败一律"不落盘 + 明确文案"（含字体缺失时提示依赖包名），不存在"写成功但打不开"的中间态。

## 平台差异与风险

- `path.extname` 在 Windows / Linux 对 `.md`、`.JSON` 行为一致；Windows 的 `:`（NTFS ADS）判定沿用既有实现，未改动。
- 未知扩展名写入仍是**无白名单**的（按用户定稿），`.exe` / `.sh` 之流可写入文本——与改造前一致，说明文本已加提示。
- `read_file` 未知扩展名兜底会把**无 NUL 的二进制**（少见，如部分压缩流）当文本读出乱码。取舍：与"写读对称"相比，乱码可被模型自行判断，而"写得出读不回"是硬故障。
- **PDF 字体是部署敏感项**：`@expo-google-fonts/noto-sans-sc` 必须随 `npm install` 落到 `node_modules`。若部署流程做了裁剪式打包（只 copy `dist/`），字体文件会缺 → 生成时报"字体加载失败"。部署清单需保留 node_modules 或显式复制该包。

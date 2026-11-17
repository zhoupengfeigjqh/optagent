# 任务清单：`write_file` 按扩展名路由输出格式

- **特性**：`022-write-file-format-routing`
- **更新**：2026-11-16

## 一期（已完成，2026-11-16）

- [x] T001 新增 `agent-backend/src/domain/tools/write-modes.ts`：注册表 + 三类错误 + `resolveWriteMode` / `supportedExtensions`
- [x] T002 新增 `agent-backend/src/domain/tools/encoders/text.ts`：`encodeText` / `validateJson` / `validateCsv`
- [x] T003 改写 `agent-backend/src/domain/tools/write-file.ts`：路由 → 校验 → 编码 → 限额；`bytes` 改取落盘字节数
- [x] T004 `agent-backend/src/domain/file-access.ts` 新增 `writeBytes`，`write` 委托（权限判据不动）
- [x] T005 `agent-backend/src/domain/tools/read-file.ts` 未知扩展名按内容嗅探；抽出 `sliceText`
- [x] T006 `agent-backend/src/routes/files.ts` 增 `.md` → `text/markdown`（内联）
- [x] T007 `agent-backend/src/domain/builtin-tool-catalog.ts` 重写 `write_file` 说明与入参
- [x] T008 `agent-backend/src/infra/builtin-tools.ts` 三种新错误 → 专用错误码；结果加 `mode`；`maxWriteBytes` 透传
- [x] T009 `agent-backend/src/infra/agent-factory.ts` + `src/server.ts` 注入写入上限（`PREVIEW_MAX_MB`）
- [x] T010 `agent-backend/src/config.ts` 更正 `PREVIEW_MAX_MB` 注释
- [x] T011 `frontend/src/utils/file-kind.ts` 把 `.md` 归入 `text`
- [x] T012 测试：`tests/unit/write-modes.spec.ts`（19 例）、`tests/unit/write-file.spec.ts`（15 例）
- [x] T013 测试：`tests/unit/read-file.spec.ts`（新增 4 例）、`tests/unit/builtin-tools.spec.ts`（新增 6 例）
- [x] T014 测试：`tests/integration/files-preview.spec.ts`（新增 `.md` 内联 + `.log` 回退下载 2 例）
- [x] T015 测试：`tests/unit/builtin-tool-catalog.spec.ts` 逐字断言同步
- [x] T016 前端用例：`src/utils/file-kind.spec.ts` 增 `.md` 分派断言
- [x] T017 门禁：`agent-backend` `typecheck` / `lint` / `npm run test`（1291 例全绿）、受影响集成测试（12 例全绿）；`frontend` `typecheck`、`file-kind`/`usePreview`/`WorkspacePanel` 用例全绿

## 二期：`.xlsx` 生成与内联预览（已完成，2026-11-16）

- [x] T101 新增 `domain/tools/encoders/xlsx.ts`：CSV / `# Sheet: 名称` 分段 → workbook → `XLSX.write(buffer)`
- [x] T102 单元格强制字符串类型（防 `=cmd|...` 公式注入）；sheet 名 ≤31 字符、剥 `[]:*?/\`；行/列/单元格总量上限
- [x] T103 `write-modes.ts` 把 `.xlsx` 从 `pendingMode` 换成真实 encoder，并更新工具说明
- [x] T104 抽出 `domain/preview/xlsx-text.ts`（读侧与预览侧共用 `xlsxToText`）
- [x] T105 `routes/files.ts`：`.xlsx` 以 `text/csv` 内联（转换逻辑走共用模块，未给该文件加行数负担）
- [x] T106 前端 `.xlsx` 归入新 kind `sheet`，`usePreview` / `WorkspacePanel` 同批调整（`ProducedBell` 判据 `!== 'text'` 对 `sheet` 仍成立，无需改）
- [x] T107 用例：`tests/unit/xlsx-encoder.spec.ts`（16 例，含往返一致、多 sheet、注入载荷、表名合法化）、`files-preview.spec` 增 2 例

## 三期：`.pdf` 生成（已完成，2026-11-16）

- [x] T201 `research.md` 记录写库选型（`pdfkit`）与中文字体（Noto Sans SC，SIL OFL，以 npm 依赖形式引入）
- [x] T202 `domain/tools/encoders/pdf.ts`：受限 Markdown（标题/段落/列表/表格）→ PDF 字节；字体字节进程级缓存
- [x] T203 字体加载失败的明确文案（含依赖包名与目录，`cause` 保留原始错误）
- [x] T204 用例：`tests/unit/pdf-encoder.spec.ts`（12 例，含 pdfjs 读回中文、表格/列表落文本层、自动分页、控制字符拒绝）

## 已知遗留

- 未登记扩展名写完后**只能下载**（预览分派表未放开）——若要内联，需在前端 `unsupported` 分支加"按文本展示"兜底，属独立小改动。
- `.xls` 走回落文本（不做 BIFF8）；工具说明已点名"需要 Excel 请用 `.xlsx`"。
- `.xlsx` 预览是**只读 CSV 文本**，不做表头冻结、列宽、分页等交互；需要看格式请下载原文件。
- PDF 只支持受限 Markdown（无图片/脚注/目录）；复杂排版需后续单独立特性。

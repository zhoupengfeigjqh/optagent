# 快速验证指南：上传记录与重名编号

**特性**：`012-upload-record-naming` | **日期**：2026-10-18

> 本文件只写"怎么跑、看什么"。实现细节见 [plan.md](./plan.md) / [data-model.md](./data-model.md)，
> 契约见 [contracts/http-upload.md](./contracts/http-upload.md) 与 [contracts/ui-contract.md](./contracts/ui-contract.md)。

## 1. 前置

| 项 | 要求 |
|---|---|
| Node | ≥ 20（后端镜像用 22） |
| 依赖 | 两侧 `npm ci` 已完成（**零新增依赖**，`package-lock.json` 不应有 diff） |
| 数字人 | 至少一个可用数字人，且其场景已配置「数据准备」目录（否则上传目录树为空） |
| 数据 | 准备三个小文件：`报告.csv`、`a.tar.gz`、无扩展名的 `README`（内容各不相同，便于核对零覆盖） |

启动（手工验收用）：

```powershell
cd agent-backend ; npm run dev      # 端口 3000
cd frontend      ; npm run dev      # 端口 5173，/api 由 Vite 代理到 3000
```

## 2. 一键门禁（本地；容器不参与）

```powershell
# 后端
cd agent-backend
npm run typecheck
npm run lint
npm run test               # tests/unit（含新增 upload-name.spec.ts）
npm run test:integration   # 端点集成（命名 / 并发 / 错误码）
npm run build

# 前端
cd frontend
npm run lint
npm run typecheck
npm run test
npm run test:coverage      # useUploads / useUploadPanel ≥ 80%，全局地板不下滑
npm run build

# 行数硬门禁（每个改动/新增文件 ≤ 500）
[System.IO.File]::ReadAllLines('agent-backend/src/routes/files.ts').Length   # 期望 ≈ 350
[System.IO.File]::ReadAllLines('agent-backend/src/routes/files-upload.ts').Length
[System.IO.File]::ReadAllLines('frontend/src/composables/useChatPanel.ts').Length  # 期望 < 499
```

## 3. 手工验收场景（对应 `SC-001`~`SC-008`）

### A. 成功即回写（US1 / `SC-001` / `SC-005`）

| # | 步骤 | 期望 |
|---|---|---|
| 1 | 选数字人 → 点 `+` → 点「数据准备/生产计划」→ 选 `报告.csv` | 记录项转「已完成」；**输入区末尾自动出现 `@报告.csv `**（无需手动打 `@`） |
| 2 | 立即点发送 | 正常发出；**不出现**"引用的文件已不存在" |
| 3 | 再传一个同名 `报告.csv`（内容不同） | 输入区出现 `@报告(1).csv `；目录内有两个文件，内容各自正确 |
| 4 | 传一个超白名单类型（如 `.exe`） | 记录「上传失败」+ 中文原因；**输入区没有任何变化** |
| 5 | 输入区先打一段文字"帮我分析一下"，再上传成功 | 原文一字不改，`@落盘名` 追加在末尾；光标未被移到开头 |
| 6 | 一次多选 3 个文件 | 3 条记录各自完成；输入区按完成顺序出现 3 个 `@落盘名` |

### B. 收起即清清终态（US2 / `SC-002` / `SC-008`）

| # | 步骤 | 期望 |
|---|---|---|
| 7 | 面板内有 1 成功 + 1 失败 → 再点 `+` 收起 → 再点 `+` 展开 | 列表为空（无"已完成/上传失败"残影）；目录树照常 |
| 8 | 观察输入区与目录 | `@` 标记与引用**仍在**；已落盘文件**仍在**（清空不删文件） |
| 9 | 上传一个较大文件的同时点 `+` 收起 → 再展开 | 该条**仍在**（上传中/已完成）；成功后输入区仍出现它的 `@落盘名`；其余已完成的记录不复活 |
| 10 | 切换数字人后展开面板 | 上一数字人的终态记录已清空 |

### C. 重名编号（US3 / `SC-003` / `SC-004`）

| # | 步骤 | 期望 |
|---|---|---|
| 11 | 空目录连传 3 次 `报告.csv` | 目录内恰为 `报告.csv`、`报告(1).csv`、`报告(2).csv`；**无时间戳**；三份内容各不相同 |
| 12 | 删除 `报告(1).csv` 后再传同名 | 得到 `报告(1).csv`（最小可用编号，不跳 `(3)`） |
| 13 | 传 `a.tar.gz` 两次 / 传 `README` 两次 | `a.tar(1).gz` / `README(1)` |
| 14 | 在另一个目录 / 另一个数字人下传同名文件 | 各自用原名（冲突域只在目标目录内） |

### D. 边界

| # | 步骤 | 期望 |
|---|---|---|
| 15 | 已引用 10 个文件后再上传成功 | 上传记录「已完成」，但**不**插入第 11 个 `@`，并提示"单条消息最多引用 10 个文件" |
| 16 | 手动删掉输入区里的 `@报告.csv` → 收起再展开面板 | 引用已随删除移除；清空记录**不会**把它恢复 |
| 17 | 刷新页面 | 记录清空（无持久化）；已落盘文件仍在 |

## 4. 部署后冒烟（**只确认部署成功，不替代测试**）

```powershell
# 1) 服务可达
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:82/api/files/workspace

# 2) 连续两次同名上传 → 第二次应返回 201 且 filename 带 (1)
#    用浏览器/前端手动点两次上传，或按接口手打 multipart：
curl.exe -s -X POST http://localhost:82/api/files/upload ^
  -F "dir=数据准备/生产计划" -F "file=@报告.csv"
```

期望：两次均 `201`；`filename` 依次为 `报告.csv` 与 `报告(1).csv`。

## 5. 失败对照（排查用）

| 现象 | 多半是 |
|---|---|
| 输入区拿到的是 `报告_20261018_143022.csv` | 后端仍是旧 `stampedName`（`files-upload.ts` 未接入 `claimName`），或跑的是旧构建 |
| 输入区没有 `@`，记录却是「已完成」 | `useUploadPanel` 的订阅没接上 / `acceptUpload` 未传 `mentionComposer.onPickFile` |
| 出现 `@` 但发送被拒"引用已不存在" | `workspace.registerFile` 未调用（`FR-004`） |
| 收起再展开仍有失败项 | `clear()` 未改口径，或收起路径没接 `clear()`（三条路径都要接） |
| 并发同名只剩一个文件 | 占名回退到了 `renameSync`（应走 `linkSync` / `COPYFILE_EXCL`） |
| 文件名变成全角 `报告（1）.csv` | 用了全角括号，违反 Q1 = A |

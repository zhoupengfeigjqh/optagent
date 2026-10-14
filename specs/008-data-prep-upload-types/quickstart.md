# 快速验收：数据准备目录的可上传文件类型配置

**特性**：`008-data-prep-upload-types` | **日期**：2026-10-13 | **上游**：[spec.md](./spec.md) · [plan.md](./plan.md) · [data-model.md](./data-model.md) · [contracts/api-delta.md](./contracts/api-delta.md)

> 本文是**验证与运行指南**：怎么跑门禁、怎么端到端验一遍、看什么结果算通过。实现细节见 `tasks.md` 与实现阶段的代码。

## 1. 前置条件

- 本地（宿主机）已安装 Node ≥ 20；四个子项目依赖已安装（`npm ci`）；
- 一个可用的用户与数字人（数字人至少配置了 1 个「数据准备」二级目录，如预定义目录 `算法规则`）；
- 若要验证"部署后生效"，需要一个可运行的环境（`docker compose up -d --build` 或本地四个服务分别启动）。

## 2. 本地门禁（宪章原则八；全部在宿主机执行，容器不参与）

```powershell
# 四侧门禁（逐个子项目执行）
cd agent-backend;    npm run typecheck; npm run lint; npm run test:coverage; npm run build
cd frontend;         npm run lint; npm run typecheck; npm run test:coverage; npm run build
cd admin-backend;    npm run typecheck; npm run lint; npm run test:coverage; npm run build
cd admin-frontend;   npm run lint; npm run typecheck; npm run test:coverage; npm run build

# 行数硬门禁（两个子项目对称；阈值 500）
node admin-backend/scripts/check-lines.mjs
node admin-frontend/scripts/check-lines.mjs
```

**通过判据**：以上命令全部以退出码 0 结束；覆盖率不低于 `frontend/vite.config.ts` 中的地板（只上不下）；`check-lines` 输出"通过：N 个文件均未超过 500 行"。
**已知存量变化（非本次引入）**：`views/demo/**`、`views/datapage/**` 的既有 lint/typecheck 红灯由该区域负责人处置；`frontend/src/composables/useChatPanel.ts`（525 行）为存量超限且本次刻意不触及。

## 3. 端到端验收（6 步）

### 步骤 1 — 管理端：入口存在且位置正确
打开数字人管理 → 某数字人 → 数字人设计 → 文件空间 → 「数据准备」二级目录清单。
**看什么**：每个目录行在「字段(n)」与「移除」**之间**出现「文件类型(m)」入口；键盘 `Tab` 可达。

### 步骤 2 — 管理端：默认值与"至少一项"
点开某目录（**未配置过**）的「文件类型」。
**看什么**：恰好 9 个候选（`.xlsx` `.csv` `.txt` `.pdf` `.json` `.zip` `.jpg` `.png` `.jpeg`）；`.csv` 与 `.xlsx` 已勾选；
取消全部勾选后保存被拒，并给出"至少选择一种文件类型"的可读提示；重新勾选后可保存。

### 步骤 3 — 管理端：保存与回显
把某目录改为 `.csv` `.xlsx` `.txt`，保存设计；重新打开该数字人。
**看什么**：入口回显 `文件类型(3)`，弹窗内勾选一致；移除该目录后再次保存，该目录的配置一并消失（不留孤儿键）。

### 步骤 4 — 部署产物：只写该写的内容
执行一次部署（平台内置的部署入口）。
**看什么**：`users/{uid}/agents/{agent}/scenario.json` 含 `data_prep_uploads` 且**只包含被配置的目录**；未配置的目录不出现在该键内；再次把某目录改回"不配置"后部署，产物中该目录的项**消失**（整体覆盖，无残留）。

### 步骤 5 — 聊天前台：按目录限定（核心）
以该用户进入聊天前台，点「+」上传，进入**已配置**的数据准备目录。
**看什么**：
1. 文件选择器只呈现该目录允许的类型（第 3 步的 3 类）；
2. 手工选一个 `.pdf` 提交 → 被拒绝，提示**包含该目录允许的类型**；
3. 选一个 `.txt` 提交 → 成功，文件出现在该目录下；
4. 进入**同一空间的另一个目录**（白名单不同）→ 过滤范围随之不同（证明粒度是目录而非空间）。

### 步骤 6 — 边界：共享/临时空间与存量数字人

| 场景 | 期望 |
|---|---|
| 在**共享空间**上传改造前允许的类型 | 全部照常成功，与改造前一致 |
| 在**临时空间**上传改造前允许的类型 | 同上 |
| 管理端查看共享空间/临时空间 | **不存在**文件类型入口 |
| 取一个**未配置**该字段的存量数字人并部署 | 数据准备目录仍只接受 `.csv` 与 `.xlsx`；无需任何迁移 |
| 某目录**声明了字段约束**且允许 `.txt`，上传 `.txt` | 成功；**不出现**"缺少必填表头"之类理由 |
| 同一目录，上传**缺必填表头**的 `.csv` | 仍被拒绝（`FILE_SCHEMA_INVALID`），逐条列出缺失表头与不合规行 |
| 上传的 `.zip` | 可上传；预览区呈现为**可下载**而非"不支持" |

## 4. 非交互冒烟（部署后确认"服务真的起来了 + 配置真的下发了"）

> 只确认部署本身成功与关键接口状态码符合预期，**MUST NOT 替代测试结论**（宪章原则三）。鉴权与会话准备方式沿用 `specs/001-digital-human-platform/quickstart.md` 的既有口径。

```powershell
# 1) 管理端：读取单个数字人的设计态，确认 scenario 内含新键
#    （路径与鉴权沿用既有 admin-api quickstart；期望 200 且响应体 scenario.data_prep_uploads 与配置一致）
curl.exe -s -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:82/api/admin/agents/<agent-name>

# 2) 运行环境：读取文件空间，确认"数据准备目录级"白名单已下发
#    （期望 200；spaces[数据准备].dirs[<dir>].upload_extensions 等于配置值）
curl.exe -s -H "Authorization: Bearer $USER_TOKEN" http://localhost:82/api/files/workspace
```

**判据**：
- 两处均返回 `200`；
- 第 2 步响应中，被配置目录的 `upload_extensions` 等于配置值；**未配置**目录等于 `[".csv",".xlsx"]`；`共享空间`/`临时空间` 的值与改造前逐字一致；
- 若返回 `503 SCENARIO_NOT_CONFIGURED` 或目录缺失，说明部署未覆盖该数字人，属部署问题而非本特性问题。

## 5. 失败判据（出现任一条即视为未通过）

1. 管理端保存"0 个类型"的目录成功（前后端任一放行）；
2. 前台文件选择器的过滤范围是**空间级**（同空间两个配置不同的目录，过滤范围相同）；
3. 前台允许、服务端拒绝（或反之）同一文件；
4. 共享空间或临时空间的可上传类型发生变化；
5. 声明了字段约束的目录上传 `.txt` 时出现"缺少必填表头"类理由；
6. 缺必填表头的 `.csv` 被放行；
7. 未配置的存量数字人行为发生变化，或需要数据迁移；
8. 四侧任一门禁命令非零退出（存量红灯区域除外，见 §2）。

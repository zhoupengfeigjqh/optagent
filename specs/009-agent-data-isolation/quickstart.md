# 快速验收指南：按数字人隔离用户数据

**特性**：`009-agent-data-isolation` | **日期**：2026-10-14 | **规格**：[spec.md](./spec.md) | **计划**：[plan.md](./plan.md) | **契约**：[contracts/api-delta.md](./contracts/api-delta.md)

本文件是**可直接执行的验证指南**：前置条件 → 一条命令跑门禁 → 端到端验收场景 → 存量迁移验收 → 部署后非交互冒烟。
接口字段与错误码口径以 [contracts/api-delta.md](./contracts/api-delta.md) 为准，目录布局与迁移映射以 [data-model.md](./data-model.md) 为准（此处不重复）。

> 全部命令在 **Windows PowerShell**（宿主机本地）下可直接执行；`{A}`、`{B}` 等为占位符，替换为真实数字人名称。
> **测试 MUST 在宿主机本地执行，容器不参与**（宪章原则三）。

---

## 0. 前置条件

| 项 | 要求 |
|---|---|
| Node | ≥ 20（`agent-backend` / `frontend` 均声明 `engines.node >= 20`） |
| 运行根 | `agent-backend/.opt-agent/`（可用 `OPT_AGENT_ROOT` 覆盖） |
| 当前用户 | 单用户 `admin`（运行环境侧固定；不引入登录） |
| 依赖 | **零新增依赖**（无需 `npm i` 任何新包） |
| 数字人准备 | 至少 2 个已部署且配置完好的数字人（`users/admin/agents/{A}`、`{B}`，含 `scenario.json`）；可用管理平台"部署生效"生成 |

```powershell
# 确认两个数字人的配置目录存在（示例）
Get-ChildItem .\agent-backend\.opt-agent\users\admin\agents | Select-Object Name
```

---

## 1. 门禁（四侧，逐条执行）

```powershell
# 后端：类型检查 + lint + 全量测试（单测 + 集成）+ 构建
cd .\agent-backend; npm run typecheck; npm run lint; npm run test:all; npm run build

# 前端：lint + 类型检查 + 测试 + 构建
cd ..\frontend; npm run lint; npm run typecheck; npm run test; npm run build

# 管理平台两侧（本次零改动，回归确认）
cd ..\admin-backend;  npm run typecheck; npm run lint; npm run test
cd ..\admin-frontend; npm run lint; npm run typecheck; npm run test
```

**通过判据**：四条门禁全部 `exit 0`；覆盖率不低于改造前（53 / 59 / 42 / 52，实测 54.28 / 60.47 / 43.03 / 53.17，**只上不下**）；
新增模块 `domain/data-migration.ts`、`domain/agent-scope.ts` 覆盖率 ≥ 80%。

---

## 2. 启动服务

```powershell
cd .\agent-backend; npm run dev          # 运行环境（:3000，接口前缀 /api）
cd ..\frontend;      npm run dev          # 聊天前台（:5173，dev 期 Vite proxy 转发 /api）
```

启动日志中 MUST 可见迁移相关事件（首次启动、存在存量数据时）：
`data.migration.start` / `data.migration.owner` / `data.migration.moved` / `data.migration.done`（字段见 [data-model.md](./data-model.md) §5）。

---

## 3. 验收场景 A —— 文件空间按数字人隔离（用户故事 1 / FR-001~004）

```powershell
# ① 选中 A，上传一个文件到「共享空间」，并列出该空间
curl.exe -s -X POST "http://localhost:3000/api/agents/{A}/select"
curl.exe -s -X POST "http://localhost:3000/api/files/upload" -F "dir=共享空间" -F "file=@./tmp/a1.csv"
curl.exe -s "http://localhost:3000/api/files/list?dir=共享空间"

# ② 切换到 B，再列同一空间
curl.exe -s -X POST "http://localhost:3000/api/agents/{B}/select"
curl.exe -s "http://localhost:3000/api/files/list?dir=共享空间"     # ← MUST NOT 出现 a1.csv
```

**通过判据**

1. 步骤①列表含 `a1.csv`；步骤②列表**不含** `a1.csv`（跨数字人出现次数为 0）。
2. 磁盘上分别落在两个目录：`users/admin/user-data/{A}/共享空间/a1.csv` 与 `users/admin/user-data/{B}/共享空间/`（后者无该文件）。
3. 在 B 下请求 A 的目录参数（如构造 `dir=共享空间` 之外的越界相对路径）→ `403 DIR_VALIDATION` 或 `400 VALIDATION_FAILED`。
4. 同名二级目录（如两边都有 `数据准备/生产计划`）分别上传同名文件 → 互不覆盖。

---

## 4. 验收场景 B —— 切换数字人即新建对话 + 历史隔离（用户故事 2 / FR-010~014）

界面路径：聊天前台 → 打开数字人面板 → 在 A 下进行 2 轮对话 → 点「新建对话」（进入视图态空对话）→ 切换到 B。

**通过判据**

1. 切换到 B 后**立即**呈现一个新的空对话（无消息、无工具调用记录），且归属为 B（进入**视图态**：`MUST NOT` 出现新的 `thread_id`，历史列表条数不变）。
2. 左侧历史列表只含 B 的会话；A 的会话出现次数为 0。
3. 直接请求 A 的会话详情：

```powershell
# 在 B 的选中态下访问 A 的会话 → MUST 为 404（不区分"不存在/不可访问"）
curl.exe -s -o NUL -w "%{http_code}`n" "http://localhost:3000/api/threads/{A的thread_id}"
```

4. 切回 A → A 的会话仍在且内容逐字一致（切换不删数据）。
5. 重复点击"切换到 B"（当前已是 B）→ **MUST NOT**新增空会话（幂等，FR-012）。
6. 在 A 下等待一轮回答的过程中尝试切换 → **切换入口不可用**并有可读提示；该轮回答继续正常进行，归属仍为 A（FR-015）。
7. 在 A 下进行一轮对话（当前对话**已有消息**）后尝试切换 → 入口不可用、提示"请先新建对话再切换数字人"，且**点击未发出任何切换请求**（可用浏览器网络面板或 `select` 未被调用的组件测试佐证）。
8. 点「新建对话」→ 进入视图态空对话：历史列表条数与磁盘 `user-data/{A}/threads/` 的目录数**均不增加**；此时切换可用并按第 1 条执行（FR-010/FR-016）。
9. 在空对话视图下发出第一条消息 → 新建会话归属当前数字人，历史列表**恰新增一条**（SC-011）。

---

## 5. 验收场景 C —— 移除数字人后数据保留、但不可用（用户故事 3 / FR-030~033）

```powershell
# ① 记录 B 的数据快照（条目数与内容哈希口径）
Get-ChildItem -Recurse .\agent-backend\.opt-agent\users\admin\user-data\{B} | Measure-Object -Property Length -Sum
Get-ChildItem .\agent-backend\.opt-agent\users\admin\user-data\{B}\threads | Measure-Object

# ② 在管理平台把 B 从用户 admin 移除并「部署生效」，然后回到运行环境
# ③ 断言：可用清单不含 B
curl.exe -s "http://localhost:3000/api/agents"

# ④ 断言：陈旧上下文下发送消息 MUST 失败且可读
curl.exe -s -X POST "http://localhost:3000/api/threads/{B会话id}/messages" -H "content-type: application/json" -d "{\"content\":\"hi\"}"
#    → 409 AGENT_NOT_AVAILABLE（不得 200、不得静默由 A 回答、不得 500）

# ⑤ 再次记录快照 → MUST 与 ① 逐项一致（删除/覆盖条数为 0）
```

**通过判据**

1. 可用清单不含 B；B 的会话与文件在界面不可见。
2. 陈旧上下文发送消息 → `409 AGENT_NOT_AVAILABLE`，前端文案："该数字人已不可用，请重新选择"。
3. B 的数据目录、文件与历史会话条数与移除前**完全一致**（数据丢失 0）。
4. 重新把 B 关联给 admin 并部署 → B 的既有数据重新可见且可用（Q3=A 复用，同名重关联即复活）。
5. 部署/撤回前后 `users/admin/user-data/**` 的条目与内容**逐项不变**（平台零触碰数据）。

---

## 6. 验收场景 D —— 存量数据迁移（用户故事 4 / FR-040~042）

用于验证**升级路径**与**幂等**。用一份隔离的临时根做，避免动到真实数据：

```powershell
# ① 构造"改前布局"：数字人配置 + 用户级数据
$root = Join-Path $env:TEMP "mig-$(Get-Random)"
New-Item -ItemType Directory -Force "$root\users\admin\agents\A"  | Out-Null
New-Item -ItemType Directory -Force "$root\users\admin\agents\B"  | Out-Null
# scenario.json / SOUL.md 等按既有格式写入（可直接复制真实数字人目录）
New-Item -ItemType Directory -Force "$root\users\admin\user-data\共享空间" | Out-Null
New-Item -ItemType Directory -Force "$root\users\admin\user-data\数据准备\生产计划" | Out-Null
New-Item -ItemType Directory -Force "$root\users\admin\user-data\threads\t1" | Out-Null
"keep" | Set-Content "$root\users\admin\user-data\共享空间\keep.txt"

# ② 以该根启动运行环境
$env:OPT_AGENT_ROOT = $root; cd .\agent-backend; npm run dev
```

**通过判据**

| 情形 | 期望 |
|---|---|
| 清单有多个、无选中态（默认） | 数据迁到**名称升序第一**的数字人目录；日志含 `data.migration.owner`（reason=名称升序第一）；迁移后 `user-data/` 下只剩数字人目录（`数据准备`/`共享空间`/`临时空间`/`threads` 不再直接存在） |
| 清单只有一个数字人 | 迁到该数字人目录（reason=唯一） |
| 清单为空 | 数据**原地保留**（不删除）+ `warn` 告警；随后部署一个数字人并调用 `POST /api/agents/{name}/select` ⇒ 数据迁到**该数字人**目录（FR-040 的①） |
| 重复启动（幂等） | 无重复条目、无报错、日志为"已完成/无待迁移" |
| 中途中断后重启 | 续迁剩余条目；已迁条目不被二次搬迁、不被覆盖 |
| 目标同名项已存在 | 跳过该项 + `warn`（不合并、不覆盖），其余条目照常迁移 |

---

## 7. 非交互冒烟（部署后，容器环境）

**仅用于确认"部署本身成功"（服务可达 + 关键状态码符合预期）**，MUST NOT 作为测试结论（宪章原则三、原则八）。

```powershell
$base = "http://localhost:82/api"     # 经 gateway（nginx，82 → 80）；直连运行环境用 :3000/api

# ① 可达性 + 数字人清单
curl.exe -s -o NUL -w "agents          %{http_code}`n" "$base/agents"

# ② 未选中数字人时，会话与文件接口应为 409
curl.exe -s -o NUL -w "threads(未选)    %{http_code}`n" "$base/threads"
curl.exe -s -o NUL -w "workspace(未选)  %{http_code}`n" "$base/files/workspace"

# ③ 选中一个已部署数字人后，关键读接口应为 200
curl.exe -s -X POST "$base/agents/{A}/select" | Out-Null
curl.exe -s -o NUL -w "threads(已选)    %{http_code}`n" "$base/threads"
curl.exe -s -o NUL -w "workspace(已选)  %{http_code}`n" "$base/files/workspace"
```

**期望**：`agents` 200；前两条 409（`AGENT_NOT_SELECTED`）；选中后两条 200。任一条不符即视为**部署失败**（失败 MUST 以非零退出码结束）。

---

## 8. 失败判据（出现任一条即不通过）

1. 在数字人 B 的文件空间或历史列表里看到数字人 A 的文件 / 会话（隔离失效）。
2. 跨数字人会话语义返回"存在但无权限"这类可区分信息（泄露存在性）。
3. 切换数字人后仍停留在原会话、或需要用户手动点"新建"才能开始新对话。
4. 重复选择同一数字人产生多余的空会话。
5. 移除数字人后其数据被删除或改写（数据丢失）、或发送消息静默改由其他数字人回答。
6. 陈旧上下文发送消息返回 `200`，或返回 `500`（应为 `409 AGENT_NOT_AVAILABLE`）。
7. 迁移后既有文件/会话条数变化（丢失或重复），或 `user-data/` 下仍直接残留 `数据准备`/`共享空间`/`临时空间`/`threads`。
8. 迁移不可重复执行（第二次启动报错或产生重复），或中断后留下不可恢复的半成品。
9. 平台部署/撤回改动了 `users/{uid}/user-data/**` 的任何条目（应零写入）。
10. 出现"数字人级目录不可写却静默回退到用户级共享目录"的行为（隔离失效却看起来正常）。
11. 在当前对话**已有消息**或**一轮回答正在进行**时仍能切换数字人，或切换入口虽不可用却没有任何原因提示（FR-015）。
12. 切换数字人或点「新建对话」后留下**没有消息的空会话**（历史列表或磁盘上出现空会话记录，FR-010/FR-016）。

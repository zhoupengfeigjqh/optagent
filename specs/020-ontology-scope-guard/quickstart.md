# 快速验证：本体行为权限闸门

**用途**：在不改代码、不重建镜像的前提下，验证"工具调用前的本体行为授权判定"是否按规格生效，
并给出排障入口。契约细节见 [contracts/scope-guard.md](./contracts/scope-guard.md)，
判定矩阵见 [data-model.md](./data-model.md) §3.3。

---

## 1. 前置条件

| 项 | 要求 |
|---|---|
| 运行环境 | `agent-backend` 已按本地开发配置启动（`npm run dev` 或生产构建 `npm start`），端口 3000 |
| 前端 | `frontend` 已启动（`npm run dev`，5173，经 Vite 代理转发 `/api`） |
| 数字人 | 一只**已部署本体**且挂载了对应 MCP 服务的数字人（仓库自带样例：`admin` / `生产调度测试`，本体 `生产调度/原材料采购和库存`，MCP 服务 `test2` → `http://localhost:8022/mcp`） |
| MCP 服务 | 上述服务已启动且可用（`GET /api/agents/current/mcp` 该服务状态为 `connected`） |
| 权限 | 可以读写 `agent-backend/.opt-agent/users/{用户}/agents/{数字人}/ontology/{场景}/{本体}/securities.yaml`（验证期间会临时改动，**改完务必还原**） |

> 若样例不可用：任何"本体行为名 = MCP 工具名"的组合都可以，判定只依赖这两份文件与工具名。

**先备份**（每一步改动前都做一次，便于比对与还原）：

```powershell
$dir = "agent-backend/.opt-agent/users/admin/agents/生产调度测试/ontology/生产调度/原材料采购和库存"
Copy-Item "$dir/securities.yaml" "$dir/securities.yaml.bak" -Force
```

---

## 2. 六类验证场景

> 每个场景都按"改配置 →（等待部署或直接改本地文件）→ 在聊天里发同一句要求 → 观察卡片与日志"进行。
> 本地直改文件即可触发重载（闸门按 `ontology` 目录签名判失效），**不需要重启后端**。

### 场景 A：授权用户正常执行（`scope` 含当前用户名）

1. 把 `CreatePurchaseRecord` 的 `scope` 改为当前用户名（样例用户为 `admin`）：

   ```yaml
   - action_name: CreatePurchaseRecord
     title: 创建原材料采购单
     op_type: command
     scope:
     - admin
     confirm: true
     confirm_content: ''
   ```

2. 在聊天里发：`给高强度钢板下一张 50 吨的采购单，下周一到位`。
3. **期望**：工具正常执行（如有 HITL 配置则先弹确认），卡片为完成态，无拒绝日志。

   ```powershell
   Select-String -Path logs/*.log -Pattern 'scope_guard.denied'   # 期望：无输出
   ```

### 场景 B：未授权被拒（`scope` 只含他人）

1. 把同一行为的 `scope` 改为 `- zpf`（**不含**当前用户 `admin`）。
2. 重复同一句请求。
3. **期望**：
   - 工具**未执行**（无新采购单、MCP 服务无收到该次调用）；
   - 卡片标红，正文形如 `本体行为「原材料采购和库存/CreatePurchaseRecord」未授权给当前用户，已拒绝执行。`；
   - 日志一条 `scope_guard.denied`，`code=ONTOLOGY_SCOPE_DENIED`、`reason=not_in_scope`；
   - 文案**不含** `zpf` 以外的授权清单（本场景应完全不出现用户名列表）。

### 场景 C：`disable` 硬关停（含与 `everyone` 并存）

1. 把 `CancelPurchaseRecord` 的 `scope` 改为：

   ```yaml
   - action_name: CancelPurchaseRecord
     scope:
     - everyone
     - disable
   ```

2. 请求取消一张采购单。
3. **期望**：拒绝，`code=ONTOLOGY_SCOPE_DENIED`、`reason=disabled`、`scope_kind=disable`；
   文案为 `…未授权给当前用户，已拒绝执行。`（`disable` 优先于 `everyone`；
   2026-11-09 起"已停用"不再单列错误码与文案，只保留内部 `reason` 区分）。

### 场景 D：`everyone` 全放开

1. 把某查询行为（如 `QueryInventory`）的 `scope` 改为 `- everyone`。
2. 请求查询库存。
3. **期望**：放行，无拒绝日志。

### 场景 E：管控配置不可用（缺条目 / 坏文件）

1. 从 `securities.yaml` 中**删掉** `QuerySuppliers` 条目，或把整份文件改成非法 YAML（如 `securities: [`）。
2. 请求查询供应商。
3. **期望**：
   - 拒绝，`code=ONTOLOGY_SCOPE_UNAVAILABLE`、`reason=no_entry`（或 `no_securities`）；
   - 日志为 `error` 级；若整份文件不可解析，另有一条 `scope_guard.catalog.degraded`；
   - 该本体其它行为同样被拒（文件级异常）；
   - 还原文件后，下一次调用立即恢复（无需重启）。

### 场景 F：非本体工具零影响（回归）

1. 恢复 `securities.yaml` 原样。
2. 让模型调用内置工具（如"看看数据准备目录里有什么"→ `list_dir`），或调用不在任何本体里的 MCP 工具。
3. **期望**：与改动前完全一致；`scope_guard.*` 日志为 0；卡片正常。

---

## 3. 日志与排障

```powershell
# 最近 20 条拒绝记录
Select-String -Path logs/*.log -Pattern 'scope_guard.denied' | Select-Object -Last 20

# 只看配置异常
Select-String -Path logs/*.log -Pattern 'ONTOLOGY_SCOPE_UNAVAILABLE|scope_guard.catalog.degraded'

# Linux / 容器内
grep -h 'scope_guard.denied' logs/*.log | tail -n 20
```

| 现象 | 可能原因 | 处置 |
|---|---|---|
| 该拒的没拒（工具照常执行） | 工具名与行为名不同名（前缀之外还有别名）；或本体目录未被识别 | 对照 `GET /api/agents/current/mcp` 的工具名与 `ontology.yaml` 的 `behaviors[].name`；检查 `ontology/{场景}/{本体}/` 是否为真实目录（非符号链接） |
| 该放行的被拒（`reason=no_entry`） | `action_name` 与行为名不一致，或 `scope` 缩进错位导致为 `null` | 对照两份文件的条目名；用 YAML 解析器校验结构 |
| 改了文件没生效 | 目录签名未变（同毫秒覆盖的极端情况）或改错数字人目录 | 再次保存文件（mtime 变更）；确认路径为当前选中数字人的 `agents/{数字人}` |
| 卡片不红 | 前端未消费 `isError`（版本过旧） | 刷新页面；确认 `tool_call_end.status` 为 `error` |
| 拒绝文案出现用户名列表 | 违反契约 `§4` | 按契约修正文案铸造（唯一来源在 `guard.ts`） |

---

## 4. 自动化验证（本地，单命令）

```bash
cd agent-backend
npm run lint
npm run typecheck
npm run test            # 含 scope-guard 规则矩阵、目录加载、包装器与进程内 loop 接线
npm run test:coverage   # 新增模块语句覆盖率 ≥ 80%
npm run build
```

**必看的三组断言**（对应 [contracts/scope-guard.md](./contracts/scope-guard.md) §8）：

| 组 | 断言编号 |
|---|---|
| 规则矩阵 | C3、C4、C5、C6 |
| 包装与透传 | C1、C2、C8 |
| 接线与可观测 | C7、C9、C10 |

---

## 5. 还原与回滚

```powershell
$dir = "agent-backend/.opt-agent/users/admin/agents/生产调度测试/ontology/生产调度/原材料采购和库存"
Move-Item "$dir/securities.yaml.bak" "$dir/securities.yaml" -Force
```

- 功能回滚：删除 `domain/scope-guard/**` 与 `infra/tool-scope-guard.ts`，还原 `agent-factory.ts` 的 3 处装配行即可
  （无数据迁移、无持久化残留、无平台侧改动）。
- 策略回滚（只想临时放开某行为）：把该行为 `scope` 改为 `everyone` 并重新部署，无需改代码。

---

## 6. 验收对照

| 规格条目 | 本文件的验证点 |
|---|---|
| `SC-001` 判定矩阵一致率 100% | §2 场景 A~F + 自动化规则矩阵用例 |
| `SC-002` 未授权执行 0 次 | 场景 B / C 观察"无新业务数据 + MCP 无收到调用" |
| `SC-003` MCP 请求 0、计数 0 | 场景 B 后查看 `GET /api/mcp-call-stats` 该工具计数未增加 |
| `SC-005` 拒绝 100% 可检索、文案不含清单 | §3 日志查询 + 场景 B 文案检查 |
| `SC-006` 非本体工具与无本体数字人零影响 | 场景 F + 既有集成测试 |
| `SC-007` 部署后下一次调用生效 | 场景 E 的"还原后立即恢复" |
| `SC-004` 判定耗时 | 实现期按 `plan.md` 口径表实测并回填 |

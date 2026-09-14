# Quickstart: 数字人Agent对话后端端到端验证

> 验证本 feature 各用户故事可独立交付。接口细节见
> [contracts/http-api.md](./contracts/http-api.md) 与
> [contracts/sse-events.md](./contracts/sse-events.md)；
> 数据落点见 [data-model.md](./data-model.md)。

## 前置条件

1. Node.js ≥ 20；`npm install`；`npm run build`。
2. 准备 `.env`（运行参数 + key 兜底）与 `config.yaml`（模型清单）：
   ```
   # .env
   DEEPSEEK_API_KEY=sk-...
   # 可选覆盖：PORT=3000 / OPT_AGENT_ROOT=.opt-agent
   # POOL_SIZE=5 / IDLE_TIMEOUT_MS=600000 / MCP_TIMEOUT_MS=30000
   ```
   ```yaml
   # config.yaml（默认模型 = 第一项）
   models:
     - api_key: sk-...
       model: deepseek-v4-flash-vision-exp
       # base_url: https://api.deepseek.com  # 可省略
   ```
3. 准备测试数字人（模拟设计平台下发）：
   ```
   .opt-agent/users/admin/agents/demo/
   ├── SOUL.md          # "你是产线助手小优……"
   ├── TOOL.json        # {"enabled": ["read_file","write_file","list_dir","grep_files","calculator"]}
   ├── MCP.json         # {"servers": []}（先空，后续验证降级再加）
   └── skills/qa/SKILL.md  # 含 YAML frontmatter（name/description）
   ```
4. 启动：`npm run dev`（或 `node --env-file=.env dist/server.js`）。

## 场景 1：流式对话核心链路（对应 US1 / SC-001 / SC-005）

0. `POST /api/agents/demo/select` 选定数字人 → 200；未 select 直接建 thread
   → **预期**：409 `AGENT_NOT_SELECTED`。
1. `POST /api/threads` `{ "agent_name": "demo" }` → 记下 `thread_id`。
2. `POST /api/threads/{id}/messages` `{ "content": "你好", "thinking": true }`
   （SSE）→ **预期**：5s 内首个事件（即使 MCP 无响应也不阻塞——异步建连）；
   先 `thinking` 流，后 `content` 流，最后 `done`（含 usage）。
3. `GET /api/threads/{id}` → **预期**：messages 含本轮 user+assistant，
   **不含 thinking**；`total` 字段正确。
4. 断连验证：发一条长问题，SSE 输出中途 `Ctrl+C` 断开后等待 20s，
   再 `GET /api/threads/{id}` → **预期**：assistant 回复已完整落盘。
5. 断连中途查看：发一条长问题后立刻断开，3 秒后 `GET /api/threads/{id}` →
   **预期**：`running: true`，已落盘部分可见（run 结束后为完整回复；
   本期不做实时续推）。
6. 中断验证：再发一条长问题，输出中途 `POST .../stop` → **预期**：SSE 收到
   `done {"finish_reason":"stop"}`，history 不含本轮但 usage 已记录；
   实例仍在（`GET /api/monitor/agents` 可见）。
7. 并发验证：同一数字人开 3 个 thread 同时发消息 → 均正常；
   第 4 个 thread 发消息 → **预期**：409 `THREAD_BUSY_LIMIT`（额度按用户累计、跨数字人；
   创建 thread 本身不限总数）。
8. 切换验证（**2026-09-10 修订**）：未 exit 直接 `POST /api/agents/other/select` →
  **预期** 200（覆盖式切换，无需先 exit）；`POST /api/agents/current/exit` 后
  `GET /api/agents/current` → `agent_name: null`。
9. 会话跨数字人：同一 thread 内先由 A 发一轮、切换后由 B 再发一轮 →
  **预期** 均 200；`GET /api/threads/:id` 的每条消息带各自的 `agent_name`，
  会话 meta 的 `agent_name` = 最近一轮使用者。

## 场景 2：Thread 生命周期与滚动摘要（对应 US2 / SC-006）

1. 创建多个 thread，互发消息 → `GET /api/threads` → **预期**：按 updated_at
   倒序，标题为首条 user 消息前 20 字。
2. `PATCH /api/threads/{id}` 改名 → 列表显示新标题。
3. 单 thread 连发 25+ 轮问答（可用脚本批量发）→ 再问一个依赖第 1~3 轮内容的
   问题 → **预期**：回答引用早期要点（摘要生效）；检查 `summary.json` 已生成
   且 `covered_count` ≥ 20。
4. `DELETE /api/threads/{id}` → **预期**：threads 目录、`summary.json`、
   `临时空间/` 下该前缀文件全部消失。

## 场景 3：文件上传与权限管控（对应 US3 / SC-007）

> **2026-09-13 修订**：`dir` 取值由"7 业务目录名 / `shared` / `tmp`"改为三空间相对路径
> `数据准备/{业务子目录}` / `共享空间` / `临时空间`。

1. 上传 `数据准备/生产计划` 一份 ≤50MB 的 `.xlsx` → **预期**：201，返回文件名带
   `_YYYYMMDD_HHMMSS` 时间戳。
2. 越界上传：`dir=数据准备`（不带子目录）→ 400；`dir=数据准备/不存在的目录` → 403；
   `dir=共享空间/子目录` → 400；`dir=../共享空间` → 400；
   向 `数据准备/生产计划` 传 `.txt` → 400（该空间仅 `.csv`/`.xlsx`）；
   `dir=共享空间` 传 `.png` → 201；上传 `.exe` 或 >50MB → 400/413。
3. 对话中问"生产计划里第一批产品是什么" → **预期**：数字人引用 xlsx 内容作答
   （read_file 解析为 CSV 文本生效）。
4. 让数字人"把结果保存到生产计划目录" → **预期**：对话不中断，回复中说明
   无权限；日志出现 `file.write.denied`（`alert` 级不中断验证见场景 5）。
5. 让数字人"把分析结果写入临时空间" → 在 `临时空间/` 出现 `{thread_id}_*_结果.csv`；
   `GET /api/files/list?dir=临时空间` 可见并可下载。
6. 删除策略：删除 `共享空间/` 内文件 → 403 `FILE_READONLY`；删除
   `数据准备/生产计划` 内文件 → 204（仅共享空间不可删）。

## 场景 6：场景配置（scenario.json，FR-007a）

1. 把 `users/admin/scenario.json` 改名隐藏 → 重启无关，直接调
   `GET /api/files/workspace` → **预期**：503 `SCENARIO_NOT_CONFIGURED`，
   消息为"用户未设置场景信息，请联系管理员"；后端进程不掉线。
2. 恢复该文件 → 再次调用 → **预期**：200，`scenario` 为场景名，
   `spaces` 含三个空间，数据准备下为 scenario 定义的全部子目录。
3. **热加载**：向 `data_prep_dirs` 追加一个新目录名并保存（**不重启**）→
   再次调 workspace → **预期**：新目录出现在 `data_prep_dirs` 同级位置，
   且磁盘上已被惰性创建。
6. （可选慢测）把 tmp 某文件 mtime 改为 8 天前，等清理周期或手动触发 →
   **预期**：文件被清除。

## 场景 4：数字人查询（对应 US4）

1. `GET /api/agents` → 含 `demo`。
2. `GET /api/agents/demo` → 返回 soul 全文、skills frontmatter、enabled_tools、
   mcp_servers。
3. 把 `demo/SOUL.md` 移走再查列表 → **预期**：demo 消失，日志有告警；
   恢复后重新出现。

## 场景 5：监控、降级与用量（对应 US5 / SC-004 / SC-008）

1. `GET /api/monitor/health` → 200，含 RSS 与磁盘空间。
2. 对话若干轮后 `GET /api/monitor/agents` → 实例明细含活跃 thread 数、
   空闲时长。
3. 用量查询：`GET /api/usage/summary?agent_name=demo` →
   **预期**：每轮对话恰有一条记录，汇总值与条数吻合。
4. MCP 降级：给 `demo/MCP.json` 配一个指向不存在端点的 server，重启后对话 →
   **预期**：对话正常；`GET /api/monitor/agents` 的 `unavailable_mcp` 含该服务；
   让数字人调用该能力 → 回复"当前服务不可用，请稍后尝试"；日志有 `alert: true`。
5. 容量：配置 `POOL_SIZE=1`，先后用两个数字人各发一条消息（保持第一个有活跃
   run）→ 第二次发消息 **预期**：409 `POOL_EXHAUSTED`。

## 场景 6：容灾与优雅关闭（对应 Edge Cases）

1. 手工向 `history.jsonl` 写入一行乱码 → 下次对话 → **预期**：正常加载
   （坏行跳过），日志告警；整体改坏 → 自动重建并告警。
2. 对话输出中给进程发 SIGTERM → **预期**：不再接受新请求；当前 assistant
   消息继续写完落盘后进程退出（≤15s）；重连启动后 history 含该完整回复。

## 自动化验证

- `npm test`：单测（file-access 权限矩阵全组合、history 坏行、LRU 淘汰、
  摘要窗口边界 19/20/21 条、config 校验失败案例）。
- `npm run test:integration`：`app.inject()` + 假 LlmProvider 覆盖
  SSE 全流程、断连续跑、stop、409 拒绝路径——不调真 API。
- `npm run smoke`：真 DeepSeek key 跑场景 1 的 1~3 步（本地手动，需 `.env`）。

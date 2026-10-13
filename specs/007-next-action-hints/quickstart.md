# 007 快速验证指南：下一步动作提示卡片

- **特性标识**：`007-next-action-hints`
- **日期**：2026-10-12
- **口径**：门禁与验证**全部在本地（宿主机）执行**；容器只承担部署与运行（宪章原则三/八）。
  本文件只写"怎么跑、看到什么算通过"，实现细节见 `plan.md` 与 `tasks.md`。

---

## 1. 前置

| 项 | 要求 |
|---|---|
| Node | ≥ 20（本地与镜像一致） |
| 四侧依赖 | 各子项目 `npm ci`（已安装可跳过） |
| 数字人 | 至少一个已部署、且**挂载了真实可用工具**的数字人（用于观察工具引用与隐藏引导） |
| LLM | 本地联调需要可用的模型配置；**门禁测试不得依赖真实外部 LLM**（一律桩实现） |

---

## 2. 一条命令跑门禁（逐侧，MUST 全绿）

```powershell
# 运行侧后端
cd agent-backend; npm run lint; npm run typecheck; npm run test:coverage; npm run test:integration; npm run build

# 聊天前台
cd frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build

# 管理平台服务
cd admin-backend; npm run lint; npm run typecheck; npm run test:coverage; npm run build

# 管理界面
cd admin-frontend; npm run lint; npm run typecheck; npm run test:coverage; npm run build
```

**通过判据**

- 四条命令链零 error（`lint` / `typecheck` 不引入新 error）；
- `test:coverage`：新增模块（`agent-backend` 的 `next-actions.ts` / `run-finalize.ts`，`frontend` 的 `utils/next-steps.ts`、`composables/useNextSteps.ts`）语句/分支/函数/行 **≥ 80%**；
- 全局覆盖地板**只上不下**；
- 单文件 ≤ 500 行：`admin-backend` / `admin-frontend` 用 `npm run check:lines`；`agent-backend` / `frontend` 既有即无该脚本，按人工复核核对（本次需盯：`agent-backend/src/domain/run-manager.ts` 拆分后 ≤500、`frontend/src/components/chat/ChatPanel.vue` ≤500）。

---

## 3. 端到端场景（人工，按顺序）

准备：`docker compose up -d --build` 或本地 `npm run dev`（`agent-backend` + `frontend` + `admin-backend` + `admin-frontend`）。

### S1 关闭态零影响（回归基线）

1. 管理台进入数字人 → SOUL → 确认"是否开启下一步动作提示"**关闭**（或该数字人从未配置过该开关）→ 保存 → 部署。
2. 聊天前台与该数字人对话一轮。
3. **期望**：回答下方**没有**引导句、**没有**卡片；`GET /api/threads/{id}/next-actions` 返回 `{"message_id":null,"actions":[]}`；后端日志中**没有** `next-actions` 相关调用记录。

### S2 开启后出现卡片

1. 管理台把"是否开启下一步动作提示"改为**开启** → 保存 → 部署（务必确认部署完成）。
2. 聊天前台提一个有下一步空间的问题（例如"帮我看下这批订单的情况"）。
3. **期望**：
   - 回答正文照常流式输出、正文逐字与关闭态一致；
   - 回答完成后（最迟 ~6 s 内）正文下方出现固定引导句"您接下来可以操作以下动作，请选择" + 至多 3 张卡片；
   - 卡片文本**全中文、无工具英文名、≤50 字**；
   - 卡片上**看不到**任何工具名；
   - 回答区**没有**加载态/骨架屏。

### S3 点击卡片 → 确认 → 下一轮

1. 点击一张卡片。
2. **期望**：弹出二次确认弹窗，展示该提示词全文；(a) 取消/`Esc` → 聊天区**无新消息**；(b) 确认"发送" → 聊天区出现一条内容等于该提示词的用户消息，并开始新一轮；用户消息气泡与历史里**看不到**任何工具名。
3. 打开浏览器网络面板核对新一轮 `POST /api/threads/{id}/messages` 请求体：`content` 等于卡片文本，存在 `guidance`（该卡片有可用工具关联时），`guidance` **未**出现在任何用户可见位置。

### S4 刷新与"仅最新一轮"

1. 在 S2 的会话上刷新页面。
2. **期望**：最新一轮回答下方的卡片**仍在**，仍可点击。
3. 再发一条消息（新一轮开始）。
4. **期望**：上一轮卡片**立即消失**（不是等本轮答完才消失）；历史轮次位置**始终**没有卡片；本轮结束后新卡片出现在新回答下方。

### S5 降级不打扰（四类）

| 注入方式 | 期望 |
|---|---|
| 断开/停掉模型服务后跑一轮 | 回答正常结束；无卡片、无引导句、**无错误弹窗**；日志有 `next-actions.failed`（含会话与数字人标识） |
| 生成慢于超时上限 | 同上（最迟 6 s 后确认"本轮无建议"），回答与工具记录不受影响 |
| 手工把 `next-actions.json` 改成非法 JSON | `next-actions` 接口仍 200 + 空；有快照损坏告警；聊天不受影响 |
| 让模型返回 5 条（含英文名/超 50 字/重复） | 只展示 ≤3 条合规条目；其余静默丢弃 |

### S6 开关关闭 → 历史也不展示

1. 在 S2 之后，把开关改回**关闭**并**重新部署**。
2. 刷新 S2 的会话。
3. **期望**：已持久化的卡片**不再展示**（FR-034）；接口返回空。

### S7 会话隔离与生命周期

1. 删除 S2 的会话。
2. **期望**：`threads/{tid}/next-actions.json` 随会话目录一并消失；其它会话不受影响。
3. 用另一个用户（或另一会话）访问同一 `thread_id`：404 `THREAD_NOT_FOUND`。

### S8 跨数字人切换（FR-019 / SC-011，越权兜底）

1. 在 S2 的会话（数字人 A 产生过卡片）中，把当前数字人切换为 B（**不要发消息**）。
2. **期望**：A 的卡片**立即不再展示**；`GET /api/threads/{id}/next-actions` 返回 `{"message_id":null,"actions":[]}`。
3. 切回数字人 A。
4. **期望**：A 的卡片**重新展示**（同一份快照，未被清除）。
5. 反例核对：在 B 为当前数字人的状态下，界面上**不存在**任何可点击的 A 卡片 ⇒ 无法构造"用 A 的卡片把 A 的工具引导注入 B 的一轮"；若在 B 下正常提问，其新卡片归属 B。

---

## 4. 非交互冒烟确认（部署后，一条命令序列）

> 只确认"部署成功 + 关键接口状态码符合预期"，**MUST NOT** 替代测试结论（宪章原则八）。

```powershell
$base = 'http://localhost:82'          # gateway 入口
$tid  = '<一个真实会话 id>'

# 1) 服务可达
curl.exe -s -o NUL -w "health=%{http_code}`n" "$base/api/agents"

# 2) 新端点可达且形状正确（无建议时也必须是 200 + 空）
curl.exe -s -w "`nstatus=%{http_code}`n" "$base/api/threads/$tid/next-actions"

# 3) 他人/不存在会话必须 404
curl.exe -s -o NUL -w "notfound=%{http_code}`n" "$base/api/threads/th_not_exist/next-actions"

# 4) 既有详情接口形状未被改动（不应出现 next_actions 字段）
curl.exe -s "$base/api/threads/$tid" | Select-String -Pattern 'next_actions' -Quiet
```

**通过判据**：`health=200`；`status=200` 且响应体为 `{"message_id":…,"actions":[…]}`（或空形态）；`notfound=404`；第 4 条**无匹配**（`False`）。

---

## 5. 验收前自查清单

- [ ] `spec.md` 的 SC-001~SC-011 逐条有对应证据（测试输出或本指南的场景记录；SC-001 按"无加载态 + 成功时 P90 ≤5s + 最迟 6s 可确定"口径取证）
- [ ] FR-019 / SC-011：跨数字人切换后不下发、切回恢复，且不存在越权注入路径（S8）
- [ ] 四侧门禁全绿；新增模块覆盖率 ≥80%；单文件 ≤500 行；零新增依赖
- [ ] 契约三处一致：本目录 `contracts/next-actions-api.md`、`specs/001-digital-human-platform/contracts/{admin-api.md,runtime-api-delta.md}`、前端 `api/types.ts` + 后端路由 schema
- [ ] 平台 → 运行环境单向与"整体覆盖"未被破坏（关闭态部署产物无 `next_action_hints` 键）
- [ ] 关闭态：无卡片、无额外模型调用（SC-007）
- [ ] 降级路径四类均有测试覆盖（原则九）
- [ ] 卡片键盘可达（`Tab` / `Enter` / `Space`）、`prefers-reduced-motion` 下无动效（原则四）

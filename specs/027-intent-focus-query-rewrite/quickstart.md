# 快速验证：意图聚焦指代改写（027）

**目标**：在不依赖真实 Laya / 真实 LLM 的前提下跑通自动化验证；再用真实部署做一次非交互冒烟与手工端到端确认。
**前置**：Node.js ≥ 20、npm；仓库根 `d:/公司项目/智能体/optagent`（Linux 容器部署另需 Docker Compose）。

---

## 1. 静态与单元验证（宿主机本地执行，容器不承担测试）

```bash
# 运行环境
cd agent-backend
npm run typecheck
npm run lint
npm test                     # 单元：rewrite-prompt / rewrite / rewrite-llm / runner / record / soul / config
npm run test:integration     # 集成：chat-rewrite / chat-intent-focus / term-normalize
npm run test:coverage        # 新增模块语句覆盖率 ≥ 80%
npm run gate                 # typecheck → lint → coverage → build（提交前一次性门禁）

# 管理平台服务
cd ../admin-backend
npm test                     # soul-design / soul-design-switches / agent-design / materialize

# 管理前端
cd ../admin-frontend
npm run typecheck
npm test                     # SoulEditor.spec.ts（勾选 / 置灰 / 值保留 / 文案 / 无障碍）
```

**通过判据**：
- 全部用例绿；`agent-backend` 新增模块（`rewrite-prompt.ts`、`rewrite.ts`、`rewrite-llm.ts`）语句覆盖率 ≥ 80%；
- 无新增依赖（`package.json` / lockfile 无变化）；
- 单文件行数：新增文件 ≤ 500 行（存量 `runner.ts` 见 plan 复杂度跟踪）。

---

## 2. 键路径冒烟（本地起服务）

```bash
cd agent-backend
cp config.example.yaml config.yaml          # 已存在则跳过
# 打开 intent_focus 块并填入真实 Laya 与模型配置后：
npm run dev
```

准备一个数字人（目录约定）：`.opt-agent/users/{user}/agents/{agent}/SOUL.md`

```markdown
---
soul_version: 1
intent_focus: true
input_rewrite: true
term_normalize: false
---
## 主要使命

你是订单交付助理。
```

并放置至少一个技能：`.../skills/{skill}/SKILL.md`（否则会命中 `no_skills` 短路，判定 / 改写不会发生）。

### 2.1 指代轮次（应发生判定 + 改写）

```bash
curl -sN -X POST http://127.0.0.1:3000/api/threads/{threadId}/messages \
  -H 'content-type: application/json' \
  -d '{"content":"请根据上述结果分析"}' | head -c 400
```

**期望**：
- SSE 正常流式输出，无错误事件；
- `.../threads/{threadId}/intent-focus.jsonl` 最后一行含 `need_rewrite: true`、非空 `rewrite_query`（≤100 字）、`rewrite_ms` 有值；
- `history.jsonl` 的 user 行仍是 `"请根据上述结果分析"`（改写未落历史）；
- 日志出现 `intent-focus.rewrite.done`（含 `rewrite_chars`）。

### 2.2 独立问句（应不改写）

```bash
curl -sN -X POST http://127.0.0.1:3000/api/threads/{threadId}/messages \
  -H 'content-type: application/json' \
  -d '{"content":"查询原材料库存的可用量"}' | head -c 200
```

**期望**：最后一行记录 `need_rewrite: false`、`rewrite_query: ""`；无改写耗时。

### 2.3 关闭输入重写（应零判定零改写）

把 SOUL frontmatter 改为 `intent_focus: true` 且删除 `input_rewrite`，重发 2.1 的请求。

**期望**：记录中 `need_rewrite: null`、`rewrite_query: ""`，且日志无 `intent-focus.rewrite.*` 事件。

### 2.4 术语替换开关

```bash
curl -s -X POST http://127.0.0.1:3000/api/term-normalize \
  -H 'content-type: application/json' \
  -d '{"content":"查一下供应商编号"}'
```

| SOUL 状态 | 期望 |
|---|---|
| `term_normalize` 缺失或 `false` | `{"applied":false,...}`，且不读 `term_mapping.json`（日志无 `term_normalize.degraded`） |
| 两个开关皆 `true` 且存在映射 | 命中时 `applied:true`、`normalized` 含替换值 |

---

## 3. 平台侧验证（管理台）

1. `cd admin-backend && npm run dev`；`cd admin-frontend && npm run dev`；
2. 打开数字人设计 → SOUL 页签 → 「意图聚焦」区：
   - 勾选「意图聚焦」后，两个新复选框可编辑；
   - 勾选「输入重写」「术语替换」，保存；
   - 取消「意图聚焦」：两个复选框**置灰但保留勾选状态**；再次勾选意图聚焦，状态恢复；
3. 检查设计态文档：`.platform-data/agents/{name}.json` 的 `soul` 含 `input_rewrite: true`、`term_normalize: true`；
4. 部署该数字人，检查运行环境 `SOUL.md` 产物：

```yaml
intent_focus: true
input_rewrite: true
term_normalize: true
```

5. 关闭「意图聚焦」后重新部署：上述三个键**全部消失**（零残留）。

---

## 4. 部署冒烟（非交互，部署成功判据，不是测试结论）

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:3000/api/health && echo OK
docker compose ps            # 全部 healthy / running
```

再用 §2.1 的 curl 打一次真实链路（真实 Laya + 真实模型），确认：
- 首字时间没有明显劣化（记录 `rewrite_ms`，P90 ≤ 3s）；
- 聚焦提示内容与改造前格式一致（五元组 / 技能说明，无改写原文）；
- 回答正文与用户气泡不含改写内容。

---

## 5. 排障

| 现象 | 先看什么 | 常见原因 |
|---|---|---|
| 记录里 `need_rewrite: null` 且 `rewrite_reason: judge_failed` | `intent-focus.rewrite.degraded` 日志的 `reason` / `detail` | Laya 不可达 / 超时 / 配置块缺失 |
| 记录 `need_rewrite: true` 但 `rewrite_query: ""` | `rewrite_reason` | `llm_failed`（模型 key / 超时）、`empty_output`、`budget_exhausted` |
| 完全没有 `rewrite_*` 字段 | SOUL frontmatter | 未部署 / `input_rewrite` 未写键 / 意图聚焦关闭 |
| 改写发生了但聚焦结果没变 | `intent-focus.jsonl` 的 `skills[].score` | 改写后仍低于阈值（属于正常结果，不是故障） |
| 术语替换不再发生 | `SOUL.md` 是否有 `term_normalize: true`；部署说明 | 新开关默认关闭，需要管理员显式开启并重新部署 |
| 保存后脏检查立刻提示"有修改" | 前后端 `emptySoulDesign` 形态 | 两侧字段不同步（缺 `input_rewrite` / `term_normalize`） |

---

## 6. 回滚

无需数据回滚：

1. 管理台取消「输入重写」「术语替换」并重新部署 → 运行期零新增调用，行为回到 016 / 019 口径；
2. 关闭「意图聚焦」→ 本特性与术语替换整体不生效（含管理台置灰）；
3. 留档新增字段对旧读取方是可选字段，无需删除历史记录。

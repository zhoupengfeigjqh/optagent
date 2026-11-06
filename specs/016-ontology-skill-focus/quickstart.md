# 快速验证：意图聚焦（技能与本体能力聚焦）

- **特性**：`016-ontology-skill-focus`
- **日期**：2026-11-04
- **目标**：在本地验证「非本体技能只做技能聚焦、本体技能补充本体能力、旧工具聚焦完全停用、提示不污染历史」。
- **详细字段**：[data-model.md](./data-model.md) / [contracts/intent-focus-api.md](./contracts/intent-focus-api.md)。

## 1. 前置条件

- Node.js >= 20；仓库已安装依赖。
- 可选：Docker（跑真实 Laya）；不跑 Laya 时用集成测试里的桩客户端。
- 一个测试数字人目录，至少包含：

```text
agent-backend/.opt-agent/users/{user}/agents/{agent}/
├── SOUL.md                         # frontmatter: intent_focus: true
├── skills/
│   ├── 非本体技能/SKILL.md          # name/description，无 metadata.ontology_*
│   └── 本体技能/SKILL.md            # metadata.ontology_id / ontology_name
└── ontology/
    └── {scenario}/{ontology}/ontology.yaml
```

> 测试用临时目录由集成测试自动创建；手动验证时才需要上述结构。不要把测试数据写进真实用户目录。

## 2. 安装与静态检查

```bash
cd agent-backend
npm ci
npm run lint
npm run typecheck
```

预期：全部通过，无新增 ESLint / TypeScript 错误。

## 3. 单元测试（不依赖 Laya）

```bash
cd agent-backend
npm test
```

重点用例：

| 文件 | 验证点 |
|---|---|
| `tests/unit/skill-header.spec.ts` | 只读头部、metadata 类型归一化、缺字段、非法 frontmatter |
| `tests/unit/ontology-loader.spec.ts` | 多本体同 ID、缺 title、`functions` / `rules` 不解析、坏 YAML、符号链接 |
| `tests/unit/ontology-candidates.spec.ts` | 非本体技能进入、未匹配本体不进入、qid 唯一、上限截断、无 `kind` |
| `tests/unit/ontology-selection.spec.ts` | **严格大于**阈值、规则不补入、行为 ≤96 截断、跨本体去重 |
| `tests/unit/ontology-prompt.spec.ts` | 非本体无本体段、无「关联函数」、同本体多技能不重复、1200 截断 |
| `tests/unit/intent-focus.spec.ts` | `prepareState` 200 字符、处置五态、`no_skills` / `below_threshold` |

## 4. 集成测试（临时目录 + 桩 Laya）

```bash
cd agent-backend
npm run test:integration
```

重点场景（`tests/integration/chat-intent-focus.spec.ts`）：

1. 开关关闭：零文件读取、零 Laya 调用、零记录。
2. 卡片 / `guidance`：零读取、零调用、一条 `skipped`。
3. Laya 未配置：一条 `unconfigured`，回答正常。
4. 只有非本体技能入选：提示只有 `n）{name}（非本体技能）`；本体读取 / 行为评分 / 工具评分 = 0。
5. 本体技能入选：`n）{name}（本体技能；ontology_name='…'，ontology_id='…'；关联行为：…）`；
   `data_supplements` 声明的低分查询行为**不出现**；同名去重。
6. 部分批次失败：有可用结果则继续；无结果 `degraded`；用户无可见错误。
7. 两轮独立：第二轮不携带第一轮提示；`history.jsonl` / 摘要 / 记忆中无聚焦文本。
8. 旧工具聚焦：工具候选构造、工具评分、旧提示出现次数均为 0。

## 5. 覆盖率与构建

一条命令跑完门禁（宪章原则八）：

```bash
cd agent-backend
npm run gate
```

等价于串行执行 `typecheck` → `lint` → `test:coverage` → `build`；需要单看某一项时再单独跑：

```bash
npm run test:coverage
npm run build
```

预期：
- 新增模块语句覆盖率 ≥ 80%；
- `dist/` 构建成功；
- 不新增依赖（`package.json` / lockfile 无变化，新增的只是 `gate` 脚本）。

## 6. 真实 Laya 手动验证（可选）

### 6.1 启动 Laya

```bash
# 仓库根目录
docker compose up -d laya
```

确认容器内 8000 端口可用；本地直跑时按实际端口映射调整 `base_url`（例如 `http://127.0.0.1:8103`）。

### 6.2 配置 `agent-backend/config.yaml`

```yaml
intent_focus:
  base_url: http://127.0.0.1:8103   # 容器内用 http://laya:8000
  model: laya-multilingual
  api_key: $DECIS_API_KEY
  timeout_ms: 10000
  skill_threshold: 0.8
  ontology_threshold: 0.8
  max_skills: 32
  max_capabilities: 96
```

`agent-backend/.env.local`：

```bash
DECIS_API_KEY=与 laya 容器一致的值
```

### 6.3 启动后端并发送一轮

```bash
cd agent-backend
npm run dev
```

通过现有聊天前端或既有消息接口发送一条**明确指向某技能**的输入，例如「帮我创建一笔原材料采购记录」。

### 6.4 检查记录

```bash
cd agent-backend
node -e "const fs=require('fs');const p=process.argv[1];const rows=fs.readFileSync(p,'utf8').trim().split('\n').map(JSON.parse);const r=rows[rows.length-1];console.log(JSON.stringify({disposition:r.disposition,reason:r.reason,skills:r.selected_skills,behaviors:r.selected_behaviors,functions:r.selected_functions,prompt:r.prompt,truncated:r.prompt_truncated},null,2))" ".opt-agent/users/{user}/user-data/{agent}/threads/{thread}/intent-focus.jsonl"
```

预期：
- `disposition` 为 `focused`；
- `selected_skills` 含目标技能；
- 若为**非本体技能**：`selected_behaviors` / `selected_functions` 为空，`prompt` 只有 `技能：...`；
- 若为**本体技能**：`prompt` 中技能说明在 `本体能力` 之前，含行为 / 函数；
- `prompt` 只出现一次，长度 ≤1200；
- `history.jsonl` 中只有用户 / 助手正文，无聚焦提示。

### 6.5 检查历史隔离

```bash
cd agent-backend
node -e "const fs=require('fs');const p=process.argv[1];const t=fs.readFileSync(p,'utf8');console.log({hasFocus:t.includes('本轮可优先参考以下聚焦结果'),hasToolFocus:t.includes('本轮可优先考虑以下工具')})" ".opt-agent/users/{user}/user-data/{agent}/threads/{thread}/history.jsonl"
```

预期：`hasFocus=false`，`hasToolFocus=false`。

### 6.6 性能抽样（可选）

用真实 Laya 连续跑 20 轮（覆盖 1 个技能 + 1 个本体的典型场景），读取每轮 `round_ms`，
计算 P90：

```bash
cd agent-backend
node -e "const fs=require('fs');const p=process.argv[1];const rows=fs.readFileSync(p,'utf8').trim().split('\n').map(JSON.parse).slice(-20);const xs=rows.map(r=>r.round_ms).filter(x=>typeof x==='number').sort((a,b)=>a-b);const p90=xs[Math.max(0,Math.ceil(xs.length*0.9)-1)];console.log({n:xs.length,p90_ms:p90,max_ms:xs[xs.length-1]})" ".opt-agent/users/{user}/user-data/{agent}/threads/{thread}/intent-focus.jsonl"
```

预期：P90 ≤ 5000ms；若出现 `degraded`，记录 `reason` 并检查批数 / Laya 负载。

## 7. 常见问题

| 现象 | 排查 |
|---|---|
| `disposition=unconfigured` | `config.yaml` 缺少 `intent_focus` 块，或 `api_key` / `base_url` 未解析；检查 `DECIS_API_KEY` 是否在**后端进程**环境 |
| `disposition=empty / no_skills` | 数字人 `skills/` 为空或 `SKILL.md` 头部非法；检查 frontmatter 与目录 |
| `disposition=empty / no_focusable_skills` | 只有本体技能且 `ontology_id` 都匹配不到本体；检查 `ontology/{scenario}/{ontology}/ontology.yaml` 的 `metadata.ontology_id` |
| `disposition=empty / below_threshold` | 技能分数未超过 `skill_threshold`；可临时降低 `INTENT_FOCUS_SKILL_THRESHOLD` 复测 |
| `disposition=degraded` | 看 `error`：`timeout` / `laya_unreachable` / `invalid_response` / `all_batches_failed`；检查 Laya 与预算 |
| 本体技能提示没有能力段 | 行为 / 函数全部低于 `ontology_threshold`，或本体无 `behaviors` / `functions` |
| 提示出现英文行为名 | 该行为条目确实缺 `title`（或 YAML 解析未取到）；按规格回退 `name`，先检查 `behaviors[].title` |
| 卡片轮次没有记录 | 开关关闭时不记录；卡片 / guidance 应记录 `skipped`；检查 `skip_intent_focus` 与 `guidance` |
| 旧工具提示仍出现 | 旧链路未完全移除；断言 `tools` 评分调用为 0，检查 `agent-factory` / `run-manager` 的 `focusJudge` 残留 |

## 8. 验收清单

- [ ] `npm run lint` / `typecheck` / `test` / `test:integration` / `test:coverage` / `build` 全绿。
- [ ] 非本体技能：提示只有技能段；本体 / 能力 / 工具评分均为 0。
- [ ] 本体技能：技能说明 + 行为 / 函数；数据补充的查询行为出现在行为段来源标记正确；同名去重。
- [ ] 技能与能力请求均为 `noul`；严格 `score > threshold`。
- [ ] 开关关闭 / 卡片跳过 / 未配置 / 空结果 / 降级五态可区分。
- [ ] 提示只在 `systemExtra` 末尾出现一次；历史 / 摘要 / 记忆无痕。
- [ ] 旧工具聚焦零执行；公开 HTTP 与前端 / 管理端无变更。

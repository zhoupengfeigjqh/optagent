# 特性规格：本体术语字典随部署生成（Ontology Term Mapping）

- **特性标识**：`017-ontology-term-mapping`
- **创建日期**：2026-11-06
- **状态**：实施中（2026-11-06 用户确认全部口径后落地）
- **影响范围**：`admin-backend`（唯一改动侧）；`agent-backend` / `frontend` / `admin-frontend` 本期零改动（见「影响面评估」）
- **上游依据**：`specs/001-digital-human-platform/spec.md`（数字人设计态与部署物化 `FR-026` / `FR-064`）、
  `specs/016-ontology-skill-focus/spec.md`（本体技能与本体行为聚焦）

## 原始输入（用户需求，逐字保留）

> 新增一个需求：在数字人管理平台，启动数字人部署的时候，如果关联了本体ontology.yaml文件，则自动提取一份术语字典。即ontology.yaml里的concepts里的terms和title。
> 1 提取为一份json文件，命名为term_mapping.json。
> 2 遍历提取，key：terms，value：title。
> 3 每次部署时自动生成，并覆盖已有term_mapping.json文件
> 4 和ontology.yaml放在同一个地方

## Clarifications

### Session 2026-11-06

- Q: 术语数据从哪来？ → A: 平台本体库 `onto_market/{场景}/{本体}/ontology.yaml` 里**数字人已关联的那份本体**的
  `concepts[].terms`；允许为空（空则不产生条目）。
- Q: 键值形态？ → A: **每个 term 一个键**，value 为该 concept 的 `title`（不是"整组 terms 拼成一个键"）。
- Q: 同一 term 命中多个 concept 怎么办？ → A: **value 合并**，多个 title 用全角分号 `；` 连接。
- Q: `terms` 为空？ → A: 跳过该 concept（不产生条目）。
- Q: 生成时机与使用方？ → A: 每次部署时生成；供 agent 聊天区使用。
- Q: 消费链路是否本期实现？ → A: **不实现**。本期只做"部署生成"，聊天区读取另立需求（见「非目标」）。

---

## 术语与口径

| 术语 | 定义 |
|---|---|
| **术语字典（Term Mapping）** | 由单个本体派生的一层 `term → concept.title` 映射，落盘为 `term_mapping.json`。 |
| **本体目录** | 运行环境中的 `ontology/{场景}/{本体}/`，其中 `{场景}` = `metadata.scenario_name`、`{本体}` = `metadata.ontology_name`。 |
| **来源概念（Concept）** | `ontology.yaml` 的 `concepts[]` 条目，判定只使用 `terms[]` 与 `title`。 |

**合并口径**：同一 term 的值按 `concepts[]` 的出现顺序追加；同一 concept 的 `title` 重复出现时**只保留一次**
（不生成本体内部的自我重复）；分隔符固定为 `或`（不含空格）。
**位置口径**：与 `ontology.yaml` / `securities.yaml` **同目录**，不另建目录、不合并多本体。
**编码口径**：UTF-8；`JSON.stringify(obj, null, 2)` + 末尾换行（与仓库其余 `.json` 产物一致）。

---

## 需求

### 功能需求

| 编号 | 需求 | 验收 |
|---|---|---|
| **FR-001** | 部署时 MUST 为**每个被引用的本体**生成一份 `term_mapping.json`，落盘路径 MUST 为 `ontology/{场景}/{本体}/term_mapping.json`，与 `ontology.yaml` 同目录 | 产物清单断言：每个本体目录下三个文件齐全 |
| **FR-002** | 内容 MUST 由该本体 `ontology.yaml` 的 `concepts[].terms` 与 `title` 派生：**每个 term 一个键**，value = 对应 concept 的 `title` | 单概念多 term → 多键同值 |
| **FR-003** | 同一 term 命中多个 concept 时 MUST 合并 value，用 `或` 连接；顺序 MUST 为 `concepts[]` 原序；同一 `title` MUST NOT 重复追加 | `{"供应商信息": "供应商或供应商编号"}` |
| **FR-004** | `terms` 为空数组、缺失或全部为空串的 concept MUST 跳过，不产生任何条目 | `terms: []` 的本体产出 `{}` |
| **FR-005** | 每次部署 MUST 重新生成并覆盖同名文件；MUST NOT 复用上一次的产物 | 二次部署产物逐字节等于重新计算结果 |
| **FR-006** | 生成 MUST NOT 阻断部署：YAML 非法、`concepts` 非数组、concept 缺 `title` 等情形一律降级为"该本体空字典 / 该条跳过"，并写入结构化 warning 日志 | 坏 YAML → 部署成功、该文件为 `{}`、日志含事件名 |
| **FR-007** | `term_mapping.json` MUST NOT 反向写回平台；MUST NOT 改动 `ontology.yaml` / `securities.yaml` 的字节 | 两个本体文件与库内快照逐字节一致 |
| **FR-008** | 平台侧 API MUST NOT 新增或变更端点、请求/响应字段；本体库 MUST 继续保持"不解析 concepts、不提供编辑端点" | 契约文档零变更（仅 `data-model` 产物布局补一行） |
| **FR-009** | 一个数字人关联多个本体时 MUST 各自生成一份，MUST NOT 合并成全局字典 | 两个本体 → 两份独立文件 |

### 关键技术需求

| 编号 | 需求 |
|---|---|
| **TR-01** | 提取 MUST 为**独立纯函数模块**（`domain/ontology/term-mapping.ts`），不做 IO、不读时钟；部署编排只负责把结果塞进产物清单 |
| **TR-02** | YAML 解析 MUST 复用既有 `yaml` 依赖与既有解析风格，MUST NOT 新增依赖 |
| **TR-03** | 单文件 ≤ 500 行；新增模块 MUST 纳入覆盖率统计（语句覆盖率 ≥ 80%） |
| **TR-04** | 结构化日志事件：`deploy.term_mapping.degraded`（含数字人、本体引用、原因），MUST NOT 记录本体正文 |

### 不可破坏的不变量

| # | 不变量 | 落点 |
|---|---|---|
| **I-1** | 平台是内容唯一权威源，运行环境只读产物；派生文件同样只从平台流向运行环境 | 物化链路 |
| **I-2** | 部署整体覆盖语义不变：`agents/` 下的内容以本次产物为准 | `OptAgentWriter` |
| **I-3** | 术语字典是**派生只读件**：任何链路都不得把它当作本体结构化的第二权威源 | 模块边界 |

---

## 边界情况

- **本体 `concepts` 缺失 / 为 `null` / 空数组**：生成 `{}`，不记 warning（正常形态）。
- **`concepts` 存在但不是数组**：生成 `{}` + warning。
- **YAML 语法非法**：生成 `{}` + warning，部署继续（导入期只强校验过 `metadata`）。
- **concept 缺 `title` 或为空串**：该 concept 的 terms 全部跳过，汇总一条 warning。
- **`terms` 内含非字符串 / 空串**：跳过该项，其余照常。
- **同一 concept 内重复 term**：只产生一个键（同 title 合并后仍是一个值）。
- **term 命中多个 concept**：value 合并，顺序按 concepts 原序。
- **同一 term 大小写 / 空白差异**：按去首尾空白后的原文比较，不做大小写归一（中文场景为主）。
- **本体库文件在部署中被改动**：按本轮读取到的快照生成，不重试。
- **部署回滚**：`term_mapping.json` 与其他产物同属一次目录级原子替换，回滚后不会留下旧字典。

---

## 成功标准

- **SC-001**：被引用的本体中，`term_mapping.json` 存在率 **100%**（含 `{}` 的空字典）。
- **SC-002**：条目正确率 **100%**：每个键都来自某个 concept 的 `terms`，value 均为该 concept 的 `title`；无凭空生成项。
- **SC-003**：同 term 多义合并正确率 **100%**（顺序、分隔符、去重三处断言）。
- **SC-004**：空 terms 的本体产出 `{}` 的比例 **100%**，且不视为失败。
- **SC-005**：二次部署后文件内容逐字节等于重新计算的结果（无残留、无追加）。
- **SC-006**：任一本体 YAML 损坏时，部署成功率 **100%**（不因派生文件失败），且日志可定位到具体本体。

---

## 影响面评估（宪章原则七：四侧同改）

| 侧 | 结论 |
|---|---|
| `admin-backend` | **需要改动**：新增 `domain/ontology/term-mapping.ts`；`domain/deploy/materialize.ts` 在同一本体循环内多产出一个文件；`MaterializeContext` 增加可选 `logger`。 |
| `agent-backend` | **本期无改动**：文件只是躺在 `ontology/{场景}/{本体}/` 下，运行环境现有链路不读取它（016 只读 `ontology.yaml`）。聊天区消费另立需求。 |
| `frontend` / `admin-frontend` | **无改动**：不展示、不请求。 |
| 契约文档 | `data-model.md` §8 的产物布局与映射表补一行；`contracts/admin-api.md` **无端点变更**（部署请求/响应不含产物清单） |
| 数据流方向 | **不破坏**：仍是"平台 → 运行环境"单向、以数字人为单位的整体覆盖 |

---

## 非目标（本次明确不做）

- 不做聊天区消费（注入 `systemExtra` / 术语查询工具 / 前端展示），另立需求。
- 不把多个本体的字典合并成全局表。
- 不在平台上编辑 `concepts` / `terms`（平台仍不提供本体编辑端点）。
- 不做术语的同义词扩展、模糊匹配、大小写或繁简归一。
- 不对存量已部署目录做回溯性补写（下次部署自然生成）。

---

## 验收证据（2026-11-06）

- **代码落点**：`admin-backend/src/domain/ontology/term-mapping.ts`（新增，纯函数）+
  `domain/deploy/materialize.ts`（本体循环内多产出一个文件）+ `domain/deploy/deployer.ts`（传 logger）。
- **测试**：新增 `tests/unit/term-mapping.spec.ts`（9 例，覆盖键值形态 / 多义合并 / 空 terms /
  缺 title / concepts 非数组 / 坏 YAML / 落盘格式）与 `tests/unit/materialize-term-mapping.spec.ts`
  （3 例，覆盖物化产出、更新后重算、空字典不破坏两个必需文件）；
  `tests/unit/materialize.spec.ts` 与 `tests/integration/deploy-ontology.spec.ts` 各补断言。
- **门禁**：`admin-backend` `tsc --noEmit`、`eslint .`、`check:deps`、`check:contract` 全通过；
  全量 **50 文件 / 全绿**，`term-mapping.ts` 语句覆盖率 **100%**（分支 89.65%）。
- **已知无关项**：`npm run check:lines` 仍报 `src/domain/mcp/service-config-fields.ts` 503 行——
  存量文件，本次未触碰（宪章「不追溯存量」），本次改动文件均在 500 行内。

## 修订记录

- 2026-11-06：初稿并实施。用户逐条确认：数据源为已关联本体的 `concepts[].terms`（允许为空）、
  每个 term 一个键且 value 为 `title`、同 term 多义用 `；` 合并、空 terms 跳过 concept、
  部署时生成供聊天区使用（本期只生成不消费）。落点：`domain/ontology/term-mapping.ts` +
  `domain/deploy/materialize.ts`。
- 2026-11-06（同日修订）：同名 key 的 value 合并分隔符由全角 `；` 改为 **`或`**（不含空格）。
  理由：同 term 对应的多个 `title` 是同一概念在本体里的不同叫法（"任选其一"），不是并列陈述；
  且 018 的跨本体合并同样用 `或`，两层口径统一后聊天侧无需再区分。涉及 FR-003、合并口径、
  单测断言与 `specs/001/data-model.md` 的产物说明。

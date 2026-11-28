# 实施计划：账号域 MySQL 模式功能对齐

**Branch**：`029-account-mysql-alignment` | **Date**：2026-11-28 | **Spec**：[spec.md](./spec.md)

**Input**：`specs/029-account-mysql-alignment/spec.md`（含 [research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/account-api.md](./contracts/account-api.md)、[quickstart.md](./quickstart.md)）

**Note**：本计划由 `/speckit.plan` 流程产出：阶段 0 结论见 `research.md`（R1–R13 已收敛全部未知项），阶段 1 结论见 `data-model.md` 与 `contracts/`。

## Summary

现有代码已有"账号域双存储"骨架（文件 / 数据库），但数据库这条路目前**不可用作等价替代**：搬运脚本只覆盖账号的少数字段与会话，角色与手机号在搬运中丢失（管理员切换后进不了管理界面）；数字人服务与注册链接完全没搬；"删除服务"因数据库引用约束从成功变为报错；配置版本保护、链接清单顺序、使用次数计数、运维脚本、健康检查各有偏差。

本计划把数据库路径提升到"与文件路径行为等价"：**搬运做全、语义回正、原子性下沉、顺序统一、运维对齐**。对外接口约定零变更，两个前端零改动。技术栈不变、零新增依赖。

**关键取舍**（详见 `research.md`）：引用规则只留在领域层（R4）；配置版本两种存储完全一致（R3）；级联撤销与使用计数下沉为存储端口的一次原子操作（R7/R8）；跨"数据库 + 文件系统"不做假事务，改用固定顺序 + 幂等 + 可观测失败（R11）。

## Technical Context

**Language/Version**：TypeScript 6 / Node.js ≥ 20（ESM）

**Primary Dependencies**：Fastify 5、`mysql2`（028 已引入）、`zod`（配置校验）；**本特性不新增依赖**

**Storage**：账号域四类实体（账号、会话、服务、注册链接）在文件与数据库之间可切换；设计态数字人、部署清单与产物、技能、MCP、本体、配置版本文件仍为 `.platform-data/**`

**Testing**：Vitest 5（`npm run test` / `test:integration`）；数据库相关用例连本地独立测试库，不可达时先打印"已跳过"再跳过

**Target Platform**：本地 Windows 开发 / Linux 容器交付；`mysql2` 为纯 JS，无原生编译差异

**Project Type**：Web 服务（单侧实现 + 四侧回归）：`admin-backend` 改动，`admin-frontend` / `agent-backend` / `frontend` 零改动

**Performance Goals**：账号相关接口 P95 ≤ 500ms（口径与目标见 `spec.md` SC-009：同机本地库、预热 1 次、各端点连续 10 次取 P95；结果回填本文件「测量结果」）

**Constraints**：单文件 ≤ 500 行；改动模块语句覆盖率 ≥ 80%；注释极简（守宪章 2.3.0）；列表接口 SQL 条数为常数（禁 N+1）

**Scale/Scope**：单实例；账号 < 100、链接 < 1000；四类实体；受影响端点 **23 个**（以 `contracts/account-api.md` §4 索引为准，本文不另计数）

## Constitution Check

*GATE：阶段 0 前检查；阶段 1 设计后复核。*

| 原则 | 结论 | 说明 |
|---|---|---|
| 一、中文与规格驱动 | 通过 | spec/plan/research/data-model/contracts/quickstart 全中文；实现期把实际差异回写 spec 修订记录 |
| 二、代码质量与模块化 | 通过 | 引用判定唯一来源留在 `domain/account/**`；存储端口新增方法表达领域动作（撤销一批链接、使用次数自增），不泄漏 SQL；改动文件均 < 500 行；同步清理与新实现不符的旧注释 |
| 三、测试完备性 | 通过 | 端点本身不变（既有集成测试继续有效），但数据库分支必须新增真库用例；原先零覆盖的服务/链接数据库实现提升到全方法覆盖；覆盖率门禁 `test:coverage` 已纳入 T057（范围＝本次改动模块、阈值 80%）；测试仅在宿主机执行 |
| 四、无障碍 | 通过 | 无前端改动 |
| 五、性能与一致性 | 通过 | 性能验收口径已进规格（SC-009：端点、取样方式、阈值），实现期只回填结果；级联撤销与计数收敛为单次原子操作；配置版本恢复乐观锁；跨介质不可原子处登记于「复杂度跟踪」并给出可重试语义 |
| 六、依赖治理 | 通过 | 零新增依赖，无选型需要 |
| 七、接口契约两侧同改 | 通过 | 契约零变更（见 `contracts/account-api.md`），因此无需两侧同改；本文与 028 文档互链，避免出现第二份端点定义 |
| 八、测试部署简单可控 | 通过 | 单命令门禁不变；新增 `db:init` 一步并写入 quickstart；部署后非交互冒烟见 quickstart §4 |
| 九、优雅降级与可观测 | 通过 | 搬运失败整体失败并打印差异；补偿失败记结构化告警；健康检查暴露存储不可用；存储不可达仍拒绝启动 |

**Phase 1 后复核**：未新增模块边界、未改变依赖方向（routes → domain → infra）；账号数据仍不进入运行环境用户目录；无新增契约；仍通过。

**存量补测结论（宪章待办项，本处给出结论）**：本特性为后端存储切换，前端零改动，**不发起**存量补测专项。当前实测缺口为 `frontend/src/api` 8 个、`frontend/src/composables` 8 个模块无同名 spec；建议补测顺序：`api/http.ts` → `api/agents.ts` → `api/threads.ts` → 其余按被引用次数；纯类型文件（`api/types.ts`、`useChatStream.types.ts`）不计入覆盖率分母。留待下一个涉及前端的特性执行。

## Project Structure

### Documentation (this feature)

```text
specs/029-account-mysql-alignment/
├── plan.md                          # 本文件
├── spec.md                          # 特性规格
├── research.md                      # 阶段 0：R1–R13 决策
├── data-model.md                    # 阶段 1：实体/约束/状态迁移/映射
├── contracts/
│   └── account-api.md               # 阶段 1：零增量行为契约（端点形态指向既有契约）
├── quickstart.md                    # 阶段 1：切换/对拍/回滚验证指引
├── checklists/
│   └── requirements.md              # 规格质量检查
└── tasks.md                         # 阶段 2 输出（/speckit.tasks）
```

### Source Code (repository root)

```text
admin-backend/
├── src/
│   ├── domain/
│   │   ├── account/
│   │   │   ├── account-store.ts            # 存储端口（新增两个领域动作）
│   │   │   ├── file-account-store.ts       # 文件实现
│   │   │   ├── mysql-account-store.ts      # 数据库实现
│   │   │   ├── agent-services.ts           # 引用判定唯一来源
│   │   │   ├── register-links.ts           # 链接校验 / 计数
│   │   │   └── registration.ts             # 注册编排与补偿
│   │   └── config-center/
│   │       ├── user-links.ts               # 账号端口 + 文件实现
│   │       └── mysql-user-link-service.ts  # 数据库实现（配置版本语义）
│   ├── infra/
│   │   ├── mysql.ts                        # 连接池 + 错误翻译
│   │   └── platform-store.ts               # 设计态与目录骨架
│   ├── routes/                             # platform.ts 增加健康探测；其余零改动
│   └── server.ts                           # 装配（按存储选择实现）
├── scripts/
│   ├── db-init.ts                          # 新增：执行 schema
│   ├── migrate-to-mysql.ts                 # 重写：四类实体全字段搬运
│   ├── lib/account-stores.ts               # 新增：运维脚本统一装配
│   ├── set-user-password.ts                # 改：按存储生效
│   └── backfill-agent-services.ts          # 改：按存储生效
└── tests/
    ├── helpers/mysql-schema.ts             # 新增：从 schema.sql 建表（防漂移）
    ├── unit/                               # 端口/实现/版本语义/搬运映射
    └── integration/                        # 双驱动对拍、并发、健康检查、搬运幂等

specs/028-account-mysql-binding/schema.sql  # DDL 唯一来源（删除废列与两处外键）
frontend/ · admin-frontend/ · agent-backend/  # 零改动（仅回归）
```

**Structure Decision**：保持现有"接口层 → 业务层 → 数据访问层"分层与三个存储端口不变，只在其内补齐能力。理由：账号域读写已全部经由端口（路由层无直读文件），改动的自然落点就是端口实现与搬运/运维工具。**新增模块 3 个**，各自消除一处重复：

1. `scripts/lib/account-stores.ts` —— 消除运维脚本与主程序各写一套装配；
2. `scripts/db-init.ts` —— 消除"靠人肉执行 schema"这一步；
3. `tests/helpers/mysql-schema.ts` —— 消除测试自建表与 `schema.sql` 的双份真相。

**契约单一来源**：`contracts/account-api.md` 只记录 4 项行为差异（D-1～D-4）与回归断言项，端点字段仍以 001/024/028 既有契约为唯一来源，避免出现第二份端点定义。

## 设计要点（细节见 research.md 与 data-model.md）

1. **搬运**：四类实体按 `data-model.md` §必迁列清单 逐列搬运（唯一口径，不在别处写列数）；顺序 `服务 → 账号 → 链接 → 会话`；全部"存在即更新"；结束逐列对账（R1/R2/R13）。
2. **配置版本**：新建/改授权"校验 → 写入 → 推进"，改密不推进，删号推进（R3，契约见 `contracts` §2）。
3. **引用完整性**：数据库不裁决能否删除；服务与账号来源字段去外键留索引；会话保留级联（R4/R5）。
4. **原子动作**：撤销一批链接、使用次数自增各为一次操作（R7/R8）；列表排序统一（R9）。
5. **运维**：脚本按当前存储装配；健康检查增加存储探测（R12）。
6. **命名**：文件模式存在的字段在表中必须同名同义（`password` 不得改名）；允许额外列（`id`/审计时间），但不得承载冲突语义或充当业务键（R14，FR-028）。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 跨"数据库 + 文件系统"无事务（删账号三步） | 部署产物、配置版本、清单都在文件系统，无法同事务 | 把部署产物也入库越出 028 边界；两阶段提交无基础设施，成本远超收益（R11） |
| 账号保留进程内内存投影（会话已改直读） | 部署编排与引用统计是同步消费方 | 账号改直读需把同步端口全部异步化，波及多处（R10）；会话是安全边界，2026-11-28 已单独改为每次回源 |
| 配置版本文件为单实例读改写 | 版本是设计态快照的一部分，两种存储必须同构 | 把版本入库需同时改部署链路（R3） |
| 时间以本地时间字符串存取 | 兼顾数据库无时区类型与既有展示格式 | 改用带时区类型仍受会话时区影响，且会改变既有响应格式 |
| 单实例运行前提 | 内存投影无跨进程失效通知 | 需要失效广播或直读，属独立特性 |

**平台差异风险**：无新增原生模块（`mysql2` 纯 JS）；主要风险为数据库与 Node 时区不一致导致有效期整体偏移，已由统一本地时间口径规避，并在 `data-model.md`「不变量 5」与对拍用例中固定。Windows 与 Linux 行尾/路径差异不影响本特性（迁移只处理 JSON 与 SQL）。

## 测量结果（实现期回填）

| 项 | 口径 | 结果 |
|---|---|---|
| 账号列表 P95 | 本地数据库，预热 1 次后连续 10 次取 P95 | 实现期回填（T056） |
| 注册链接列表 P95 | 同上 | 实现期回填（T056） |
| 登录 P95 | 同上（含一次密码校验开销） | 实现期回填（T056） |

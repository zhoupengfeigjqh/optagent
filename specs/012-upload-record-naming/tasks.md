---
description: "任务清单：上传记录的生命周期与重名编号"
---

# 任务清单：上传记录的生命周期与重名编号

**Input**：设计文档 `specs/012-upload-record-naming/`（[spec.md](./spec.md) / [plan.md](./plan.md) / [research.md](./research.md) / [data-model.md](./data-model.md) / [contracts/](./contracts/) / [quickstart.md](./quickstart.md)）

**Tests**：**必须包含**——宪章原则三（NON-NEGOTIABLE）要求"每个新增模块配同名测试、每个改动模块覆盖改动行为"，
故本清单的测试任务不可省略（不是可选项）。

**组织方式**：按用户故事分阶段，每个故事可独立实现 / 独立验证 / 独立交付。

## 格式：`[ID] [P?] [Story] 描述（含文件路径）`

- **[P]**：可并行（不同文件、无未完成依赖）
- **[Story]**：`[US1]` 成功即回写 / `[US2]` 收起即清终态 / `[US3]` 重名编号
- 路径一律相对仓库根；命令一律在 **本地宿主机**执行（容器不参与测试）

## 路径约定

- 后端：`agent-backend/src/**`、`agent-backend/tests/**`
- 前端：`frontend/src/**`

---

## Phase 1：准备（Setup）

**目的**：把基线钉住，后面每一步都能对比"变了什么"。

- [ ] T001 记录基线并核对零新增依赖：实测 `agent-backend/src/routes/files.ts` = 543 行、`frontend/src/composables/useChatPanel.ts` = 499 行；确认 `agent-backend/package.json` 与 `frontend/package.json` 依赖段无改动（`git diff` 为空），结果登记到 `specs/012-upload-record-naming/plan.md` §「影响面清单」

---

## Phase 2：结构性前置（Foundational）

**目的**：先把"要改的代码搬到家"，**行为零变化**。这一步不通过，后面的故事无法在 500 行门禁内落地。

**⚠️ 关键**：本阶段完成前，任何用户故事都不应开始。

- [ ] T002 [P] 新增 `agent-backend/src/routes/files-scope.ts`：把 `currentAgentFor` / `checkDir` 从 `routes/files.ts` **原样搬入**并 `export`（含既有日志与状态码映射，逐字不改）
- [ ] T003 改动 `agent-backend/src/routes/files.ts`：改为从 `routes/files-scope.ts` 导入两个函数，删除本地实现（纯移动）
- [ ] T004 新增 `agent-backend/src/routes/files-upload.ts`：把 `POST /api/files/upload` 处理器（暂存 / 早验 / 白名单 / 字段校验）整体搬入，导出 `registerFileUploadRoute(app, ctx)`；`routes/files.ts` 的 `registerFileRoutes` 内调用它。**此步仍用旧的 `stampedName`**（命名在 US3 替换）
- [ ] T005 后端回归（证明纯移动）：`cd agent-backend && npm run typecheck && npm run test:integration` 全绿，且 `tests/integration/files-scenario.spec.ts` **断言口径零改动**
- [ ] T006 [P] 新增 `frontend/src/composables/useUploadPanel.ts`：把 `uploadOpen` 与 `onToggleUpload` / `onCloseUpload` / `onPickFiles` / `onRetryUpload` 从 `useChatPanel.ts` **原样搬入**（此步**不**加 `clear()`、**不**加回写，行为零变化）
- [ ] T007 改动 `frontend/src/composables/useChatPanel.ts`：装配 `useUploadPanel({ uploads, workspace })`（放在 `mentionComposer` 之后），并**保持导出名与签名不变**（`uploadOpen` + 4 个处理器）
- [ ] T008 前端回归（证明导出面未变）：`cd frontend && npm run test` 全绿，重点 `ChatPanel.spec.ts` / `ChatPanel.starters.spec.ts` / `ChatPanel.nextSteps.spec.ts` / `useChatPanel.nextSteps.spec.ts` / `useChatPanel.retry.spec.ts`

**检查点**：两侧门禁绿 + `routes/files.ts` 实测 ≤ 350 行 + `useChatPanel.ts` 实测 < 470 行（后续故事还要往里加 1 行装配）。

---

## Phase 3：[US1] 上传成功即回写 `@落盘名`（优先级 P1）

**故事目标**：文件落盘成功的瞬间，输入区末尾出现 `@落盘名`，并立刻可发送。
**独立测试**：`useUploadPanel.spec.ts` 的"成功项回写一次 / 失败零回写 / 重试成功也回写"三例 + `useWorkspace.spec.ts` 的 `registerFile` 三例。

### 测试（先红）

- [ ] T009 [P] [US1] 在 `frontend/src/composables/useWorkspace.spec.ts` 补 `registerFile` 三例：登记后 `exists(reference)` 为真且 `filesOf` 含该项；同 `{dir,filename}` 重复登记不重复；未知目录 no-op 且不抛错
- [ ] T010 [P] [US1] 新建 `frontend/src/composables/useUploads.spec.ts`：预校验失败不发请求；逐文件独立状态；成功写入 `serverFilename`；失败保留 `error` 且可重试；批量失败 toast 计数（**本任务不含 `clear()`**，见 T017）
- [ ] T011 [P] [US1] 新建 `frontend/src/composables/useUploadPanel.spec.ts`：成功项调用 `acceptUpload({dir, filename})` **恰好一次**；失败项**零调用**；`retry` 成功后补一次回写；`pick` 把目录级白名单透传给 `uploads.upload`；**已引用 10 个**时再上传成功 ⇒ `acceptUpload` 被调用但 `pickFile` 侧拒绝插入、提示被推送、记录仍「已完成」（`FR-006` / `SC-006`）；一次多选 3 个文件 ⇒ 回写顺序 = **完成顺序**，且草稿原有文本**逐字未变**、仅末尾追加（`FR-005`）

### 实现

- [ ] T012 [US1] 在 `frontend/src/composables/useWorkspace.ts` 新增 `registerFile({dir, filename, size})`：不可变替换 `spaces`、同键幂等、未知目录 no-op（契约见 `contracts/ui-contract.md` §4）
- [ ] T013 [US1] 在 `frontend/src/composables/useUploadPanel.ts` 加成功订阅：`watch(uploads.items)` → 首次进入 `success` 的 `localId`（`Set` 去重）→ **先** `workspace.registerFile` → **后** `acceptUpload({dir, filename})`
- [ ] T014 [US1] 在 `frontend/src/composables/useChatPanel.ts` 把 `acceptUpload` 传为 `mentionComposer.onPickFile`（复用唯一入口：登记引用 + 拼写 `@标记` + 上限/去重/提示）
- [ ] T015 [P] [US1] 注释同步 + 补同名测试（`FR-044` 前半）：改 `frontend/src/composables/useUploads.ts` 头注释与 `serverFilename` 字段注释；改 `frontend/src/components/chat/UploadItem.vue` 头注释（删掉"后端已追加时间戳"）；**新建** `frontend/src/components/chat/UploadItem.spec.ts`——该组件本次被改动且此前**无同名测试**，按 011 `BaseIcon` 先例补测，并钉住 `displayName === serverFilename`（含 `(1)` 后缀，`FR-024`）
- [ ] T016 [US1] 验证：`cd frontend && npm run test` 全绿；手工走 `quickstart.md` §3A 场景 1~6（含"已引用 10 个时不上第 11 个 `@`"）

**检查点**：US1 单独可用——上传成功即可在输入区看到 `@落盘名` 并成功发送（不依赖 US2 / US3）。

---

## Phase 4：[US2] 收起面板即清空终态记录（优先级 P1）

**故事目标**：收起再展开，列表为空；清空的只有"记录"，不删文件、不动 `@` 与引用。
**独立测试**：`useUploads.spec.ts` 的"1 成功 + 1 失败 + 1 上传中 ⇒ 只剩上传中"，以及 `useUploadPanel.spec.ts` 的三条收起路径。

> **依赖**：本阶段与 US1 **共用两个文件**（`useUploadPanel.ts`、`useUploads.spec.ts`），故 MUST 在 US1 之后顺序执行，不能并行。

- [ ] T017 [US2] 在 `frontend/src/composables/useUploads.spec.ts` 补 `clear()` 三态用例：终态被移除、`uploading` 保留、`retry` 仍在保留项上可用；**清空后再上传** ⇒ 新记录从空列表开始且 `localId` 与上一轮不同（`FR-012`）
- [ ] T018 [US2] 在 `frontend/src/composables/useUploadPanel.spec.ts` 补：`+` 收起调 `clear()`；`onCloseUpload` 同口径；收起时 `uploading` 项仍在；**面板关闭后才完成**的上传仍回写一次（`FR-013`）；清空后断言 `workspace.remove` / `files.remove` **零调用**、草稿与引用快照**逐字不变**（`FR-011`）；正文删掉 `@标记` 后再收起/展开 ⇒ 引用仍为空、**不被复活**（`FR-007`）
- [ ] T019 [P] [US2] 在 `frontend/src/components/chat/UploadMenu.spec.ts` 补：`uploads` 为空 ⇒ 不渲染 `.upload-menu__uploads`（`FR-015`），目录树照常
- [ ] T020 [US2] 改 `frontend/src/composables/useUploads.ts` 的 `clear()`：只移除 `success` / `failed`，保留 `pending` / `uploading`；同时释放被移除项的 `sources` 条目；同步改头注释
- [ ] T021 [US2] 在 `frontend/src/composables/useUploadPanel.ts` 接线：`onToggleUpload`（由开转关时）与 `onCloseUpload` 都调用 `uploads.clear()`
- [ ] T022 [US2] 在 `frontend/src/composables/useAppSession.ts` 的 `agents.onSwitched` 内补 `uploads.clear()`（第三条收起路径，`FR-014`）
- [ ] T023 [US2] 验证：`cd frontend && npm run test` 全绿；手工走 `quickstart.md` §3B 场景 7~10 与 §3D 场景 16

**检查点**：US1 + US2 同时可用——上传完能对话，收起不留残影，进行中的上传不丢。

---

## Phase 5：[US3] 重名文件用数字后缀（优先级 P2）

**故事目标**：不重名用原名；重名用 `原名(n).ext`（半角括号）；并发同名零覆盖。
**独立测试**：`agent-backend/tests/unit/upload-name.spec.ts` 全部通过（候选名表驱动 + 真实占名 + 两条错误路径）。

> 本阶段**只碰后端 + 一条前端文案**，与 US1 / US2 **无文件冲突**，可与 Phase 4 并行。

### 测试（先红）

- [ ] T024 [P] [US3] 新建 `agent-backend/tests/unit/upload-name.spec.ts`：候选名表驱动（`报告.csv` / `报告(1).csv` / `报告(2).csv` / 稀疏取最小 / `a.tar(1).gz` / `README(1)` / `.env(1)` / 含 `/`·`\` 清洗 / 空主名兜底 `file`）；**大小写冲突按 `process.platform` 分支断言**（Windows/macOS：`Report.csv` 已存在 ⇒ `report(1).csv`；Linux：仍 `report.csv`，`FR-023`）；`claimName` 真实占名（临时目录）：不重名原名、连占三次得 `(1)`·`(2)`、**已存在文件内容未被改写**、`maxAttempts=2` 抛 `FILE_NAME_CONFLICT`、超长名截断或抛 `VALIDATION_FAILED`；并在用例注释中钉住"控制字符"口径——既有清洗只处理 `basename` 与 `/`·`\`，**不额外剥离换行/控制字符**（与现状一致，`FR-027`），该口径同步写入 `data-model.md` §3.1
- [ ] T025 [P] [US3] 在 `agent-backend/tests/integration/files-scenario.spec.ts` 补用例：原名 / `(1)`·`(2)` / 删除 `(1)` 后取最小 / `Promise.all` 并发 3 个同名（3 个不同 `filename` 且内容互不相同）/ **同名 20 连传**（参数化循环：20 个不同 `filename`、编号连续无跳号、内容互不相同，`SC-004`）/ 跨目录与跨数字人同名互不影响 / 历史时间戳文件并存

### 实现

- [ ] T026 [US3] 新增 `agent-backend/src/domain/upload-name.ts`：`sanitizeBase` / `candidateName(original, index)` / `claimName(dirAbs, original, staging, maxAttempts = 999)`；占名用 `linkSync` 独占，`EPERM`/`EXDEV`/`ENOTSUP`/`EMLINK` 回退 `copyFileSync(COPYFILE_EXCL)`；成功后 `removeFileSafe(staging)`；用尽 409、超长 400（模型见 `data-model.md` §3）
- [ ] T027 [US3] 改 `agent-backend/src/routes/files-upload.ts`：落盘改调 `claimName(...)`，删除临时 `stampedName` / `timestamp`；`filename` 仍原样回传落盘名
- [ ] T028 [P] [US3] 改 `frontend/src/utils/error-message.ts` 增 `FILE_NAME_CONFLICT: '同名文件过多，请先整理目录后重试'`，并在 `frontend/src/utils/error-message.spec.ts` 补一条映射断言（四处同步的第 ② 处）
- [ ] T029 [P] [US3] 改 `frontend/src/api/files.ts` 头注释：删掉"后端已追加时间戳并追加 `-1`/`-2`"，改为"原名 / 原名(n).ext；前端 MUST NOT 自行拼接"
- [ ] T030 [US3] 验证：`cd agent-backend && npm run test && npm run test:integration` 全绿；手工走 `quickstart.md` §3C 场景 11~14

**检查点**：三个故事全部可用；`SC-003` / `SC-004`（3 连传恰为原名/`(1)`/`(2)`、20 连传零覆盖）可验。

---

## Phase 6：收尾与横切（Polish）

- [ ] T031 [P] 行数取证并回写 `plan.md` §「影响面清单」实测值：`agent-backend/src/routes/files.ts` ≤ 500、`routes/files-upload.ts`、`routes/files-scope.ts`、`domain/upload-name.ts`、`frontend/src/composables/useChatPanel.ts`、`useUploadPanel.ts`、`useUploads.ts`、`useWorkspace.ts`
- [ ] T032 [P] 改 `frontend/vite.config.ts`：登记 `src/composables/useUploads.ts` 与 `src/composables/useUploadPanel.ts` 的 80% 模块阈值（实测值写行末注释），并按实测**上调**全局地板（只上不下）
- [ ] T033 全门禁：后端 `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build`；前端 `npm run lint && npm run typecheck && npm run test && npm run test:coverage && npm run build`
- [ ] T034 按 `quickstart.md` 走查手工场景 1~17，并执行部署后冒烟（连续两次同名上传：`原名` → `原名(1).ext`）
- [ ] T035 文档回写与勾选：本文件勾选完成项；`plan.md` 修订记录登记实现期差异；若实现与规格有偏，回写 `spec.md` 修订记录（宪章原则一）

---

## 依赖关系（Dependency Graph）

```text
Phase 1 (T001)
   ↓
Phase 2 (T002 → T003 → T004 → T005 ；T002/T006 可并行 ；T006 → T007 → T008)
   ↓（两侧结构性前置全部完成）
   ├── US1 (T009~T016) ──► US2 (T017~T023)         # 同文件，必须串行
   └── US3 (T024~T030)                             # 与 US1/US2 无文件冲突，可并行
   ↓
Phase 6 (T031~T035)：等所有故事完成后收尾
```

- **T004 依赖 T002/T003**（`files-upload.ts` 要 `import` 共用的 `checkDir`）。
- **T007 依赖 T006**；**T008 依赖 T007**。
- **US1 → US2 串行**：两者都改 `useUploadPanel.ts` 与 `useUploads.spec.ts`。
- **US3 与 US1/US2 并行**：US3 只改 `agent-backend/**` 与 `frontend/src/utils/error-message.ts`、`frontend/src/api/files.ts`（注释），与 US1/US2 的文件不重叠。
- **T033 / T034 依赖全部完成**；**T031 可在每个故事完成后增量回写**。

## 并行执行示例

### 故事内并行（测试先行）

```text
US1：T009（useWorkspace.spec.ts）  ‖  T010（useUploads.spec.ts）  ‖  T011（useUploadPanel.spec.ts）
US2：T019（UploadMenu.spec.ts）    ‖  （T017/T018 因同文件需串行）
US3：T024（upload-name.spec.ts）   ‖  T025（files-scenario.spec.ts）  ‖  T028（error-message）‖ T029（api/files.ts 注释）
```

### 跨故事并行（两条人/两个 agent）

```text
Agent A：Phase 2 后端（T002~T005）→ Phase 5 后端（T024~T027、T030）
Agent B：Phase 2 前端（T006~T008）→ US1（T009~T016）→ US2（T017~T023）
合并点：T031 / T033 / T034
```

## 每条故事的独立验收判据

| 故事 | 只看它能验什么 | 判据 |
|---|---|---|
| **US1** | 上传成功 → 输入区自动出现 `@落盘名` 且能直接发送 | `useUploadPanel.spec.ts`（回写 ×1 / 失败 ×0 / 顺序 / 上限）+ `useWorkspace.spec.ts` 3 例 + `UploadItem.spec.ts`（展示名）；手工场景 A1~A6（`SC-001` / `SC-005` / `SC-006`） |
| **US2** | 收起再展开列表为空；文件、`@`、引用都不受影响；进行中的上传不丢 | `useUploads.spec.ts` 清空三态 + `useUploadPanel.spec.ts` 三条收起路径；手工场景 B7~B10（`SC-002` / `SC-008`） |
| **US3** | 同名文件得到 `原名` / `原名(1)` / `原名(2)`，并发零覆盖 | `upload-name.spec.ts` + `files-scenario.spec.ts` 新用例；手工场景 C11~C14（`SC-003` / `SC-004`） |

## 实施策略

### MVP 优先（只做 US1）

1. Phase 1 + Phase 2（结构性前置，行为零变化）
2. Phase 3（US1）
3. **停下验证**：上传成功后输入区即出现 `@落盘名` 且可发送 → 这就是用户最直接的收益
4. 此时 US2 / US3 未做也**不产生回归**：清空仍按旧口径、命名仍是时间戳（旧行为不会更差）

### 增量交付

1. Setup + Foundational → 结构就绪（可回归验证"零行为变化"）
2. + US1 → 验证 → 可交付（MVP）
3. + US2 → 验证 → 可交付
4. + US3 → 验证 → 可交付（`SC-003` / `SC-004` 达成）
5. 每个故事完成后跑一次 T031 的行数取证，避免最后一次性超限

### 并行团队

1. 两人先把 Phase 2 的两侧各做完（后端 A / 前端 B）
2. 之后 A 做 US3（纯后端 + 一条文案）、B 做 US1 → US2（同文件串行）
3. 合流后一起过 T033 / T034

---

## 备注

- `[P]` = 不同文件、无未完成依赖；同文件（`useUploadPanel.ts`、`useUploads.spec.ts`、`files.ts`、`files-upload.ts`）的任务**一律串行**。
- 测试先行：每阶段的测试任务先跑成"红"，再落实现使其转绿（原则三"改动即约束"）。
- 纯移动任务（T002~T004、T006~T007）的验收判据是"**既有测试零改动即全绿**"——若需要改断言，说明搬错了。
- 提交信息用中文并注明影响的侧，例如：`前端+后端：上传成功回写 @落盘名、收起清空终态记录、重名改为数字后缀(1)`。
- **2026-10-18 `/speckit.analyze` 回写**：本轮按分析结论补强覆盖，任务总数仍为 **35**（T001~T035，未增删编号），只扩写了 5 条任务的断言面——
  T011（+`FR-006` 上限、`FR-005` 顺序与原文不变）、T015（+新建 `UploadItem.spec.ts`，`FR-024` 展示名 / 原则三"改动即补测"）、
  T017（+`FR-012` 新记录 `localId` 不同）、T018（+`FR-011` 零删除与快照不变、`FR-007` 删标记后不复活）、
  T024（+`FR-023` 大小写按平台分支、控制字符口径）、T025（+`SC-004` 同名 20 连传）。行为口径未变。

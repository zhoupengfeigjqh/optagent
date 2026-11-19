# 实施任务：下线「共享空间」（025）

**状态**：实现完成，**测试门禁未执行**（原因见 §4）　**日期**：2026-11-18

## 1. 运行端（agent-backend）

- [x] T001 `domain/dirs.ts`：删 `SPACE_SHARED`，`SPACES = [数据准备, 临时空间]`，`SPACE_POLICIES` 删对应项；头注释改为两空间并登记 025。
- [x] T002 `domain/workspace-view.ts`：遍历改为 `SPACES`（去掉硬编码三元组），`deletable` 恒 `true`。
- [x] T003 `routes/files.ts`：删 `403 FILE_READONLY` 分支与 `SPACE_SHARED` 导入。
- [x] T004 `domain/file-access.ts`：`flatSpace = top === SPACE_TMP`；注释两空间化。
- [x] T005 `domain/space-path.ts` / `domain/scenario.ts` / `domain/data-migration.ts`：白名单、可用目录清单、迁移条目随 `SPACES` 自动收窄，只改注释与退化清单（`listAvailableDirs` 退化 = `临时空间` + `临时空间/后台产出`）。
- [x] T006 `infra/builtin-tools.ts`：空清单 fallback 由该空间改为 `临时空间`。
- [x] T007 `domain/builtin-tool-catalog.ts`：`read_file` 描述改「数据准备/临时空间」、`write_file` 改「数据准备为只读」。

## 2. 前端（frontend）

- [x] T008 `utils/error-message.ts`：删 `FILE_READONLY` 映射。
- [x] T009 `components/layout/WorkspaceFileList.vue`：删 `deletable` prop 与 `v-if`（删除入口恒渲染）。
- [x] T010 `components/layout/WorkspaceSpaceTree.vue`：不再传 `:deletable`。
- [x] T011 `composables/useWorkspace.ts`：删 `deletableOf`（API 已无人消费）。
- [x] T012 注释与枚举口径：`api/types.ts`、`api/files.ts`、`utils/space.ts`、`WorkspacePanel.vue`、`MentionPicker.vue`、`UploadMenu.vue`、`constants/limits.ts`、`usePathInsert.ts`、`useFileMention.ts`。
- [x] T013 **保留** `isFlatSpace` 抽象与 `TMP_SPACE` 常量（现在是唯一的扁平空间，但抽象本身有独立 spec，删掉是纯亏）。

## 3. 存量清理与规格

- [x] T014 新增 `src/domain/shared-space-cleanup.ts`：`findSharedSpaceDirs`（只读扫描，数字人级 + 旧用户级两布局）+ `removeSharedSpaceDirs`（走 `fs-safe`，逐个计账）。
- [x] T015 新增 `scripts/remove-shared-space.ts` + `package.json` 的 `data:remove-shared-space`；默认 dry-run，`--apply` 才删。
- [x] T016 文档：`specs/001` 契约总注与 3 处条款、`specs/002`、`specs/008`（US3/FR-030/SC-003 + v1.6 修订记录）、`specs/009`（FR-001/FR-002/关键实体/数据模型/契约/quickstart + v1.6）、`specs/014`（spec/data-model/plan/contracts）、`README.md` 目录树。
- [x] T017 `specs/025` 本规格与任务清单。

## 4. 测试与门禁

- [x] T018 后端单测：`dirs`（空间清单、`ensureAgentDataDirs` 两空间、退化清单）、`workspace-view`（新增"只回两空间""`deletable` 恒 true"）、`space-path`（新增"已下线空间两侧同判 `space-forbidden`"）、`file-access`（新增"一律读不到"）、`scenario`、`builtin-tool-catalog`、`builtin-tools`、`data-migration`（新增"用户级残留不搬不删"）。
- [x] T019 后端集成：`files-scenario`（原"不受场景清单限制"改为钉 `403 UPLOAD_DIR_FORBIDDEN`）、`files-preview`（两条同构 html 用例合并）、`agent-isolation`、`isolation-observability`、`migration`、`agent-removed`、`files-naming`、`produced`。
- [x] T020 前端 spec：`useWorkspace`（删该空间夹具与 `uploadExtensionsOf` 断言）、`space`、`usePreview`、`UploadMenu`（三空间夹具 → 两空间，索引断言同步）、`WorkspaceSpaceTree`、`WorkspacePanel`、`empty-data-hint`、`useMentionComposer`、`next-steps`。
- [x] T021 管理端 fixture 与用例：`fixture.ts` 骨架两空间；`users`/`deploy-withdraw`/`deploy-scope`/`opt-agent-writer` 的样本目录改为 `临时空间`（断言语义不变）。
- [x] T022 `agent-backend`：`tsc --noEmit` ✅、`eslint .` ✅。
- [x] T023 `frontend`：`vue-tsc --build --force` ✅、`npm run lint` ✅（0 error，仅 5 条与本次无关的既有 warning）。
- [x] T024 `admin-backend`：`tsc --noEmit` ✅、`eslint .` ✅。
- [ ] T025 **vitest 全量未执行** —— 本机 `vitest 5.0.0` 运行器**仓库级损坏**：四个包里**任何**一个 spec（含未被本次改动触及的文件、含最小空用例、含改用 Node 22 执行）都在 `describe()` 处抛 `Cannot read properties of undefined (reading 'config')` / `Vitest failed to find the current suite`，且 `node_modules/@vitest` 下缺 `expect`/`utils`/`snapshot`/`pretty-format`（疑似曾被安全软件中断安装，安装 Node 运行时也报过 `EPERM`）。属**既有环境问题**，与本次改动无关，需另行修复依赖安装后重跑。
- [x] T026 **替代验证（已执行）**：临时脚本直连运行端模块断言——`SPACES` 两项、`SPACE_POLICIES` 两项、`parseSpaceDir('共享空间')` → 403、退化清单 = `临时空间`/`临时空间/后台产出`、工具描述不含该空间且含「数据准备/临时空间」→ 全部通过（脚本已删除，等价断言已落在 T018 的 spec 里）。
- [x] T027 清理脚本 dry-run：命中 7 个目录、1 个文件（`.opt-agent` 实盘）。
- [x] T028 `--apply` 执行删除：已完成——`.opt-agent` 下 7 个目录（1 个文件 / 8 字节）已删除；复跑 dry-run 报「未发现」。

## 5. 未做（明确排除）

- 不迁移存量数据到其他空间（已决策删除不要）。
- 不动临时空间 30 天清理契约。
- 不为旧引用新增文案映射（沿用 `UPLOAD_DIR_FORBIDDEN` 的「该目录不允许访问」）。
- 不清洗 `threads/*.jsonl` 中的历史路径文本。

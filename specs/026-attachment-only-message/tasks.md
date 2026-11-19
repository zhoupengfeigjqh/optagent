# 实施任务：只有附件也能发送（026）

**状态**：实现完成，**vitest 未执行**（原因见 §4）　**日期**：2026-11-18　**影响侧**：frontend only

## 1. 落点（3 个文件）

- [x] T001 新增 `frontend/src/utils/attachment-only-prompt.ts`：`attachmentOnlyPrompt(count)`（1 →「请查看这个文件」，≥2 →「请查看这些文件」）+ 两个常量。措辞只此一处，避免散在组件里。
- [x] T002 `frontend/src/composables/useChatPanel.ts`：正文剥标记后 `trim()` 为空、且有附件 → 合成话术；空判定统一用 `trim()`（`"   "` 视为空）。合成后走原链路，**后端零改动**。
- [x] T003 同文件：`manual` 术语预检门槛加 `!attachmentOnly`——机器生成的句子不弹 018 替换确认。
- [x] T004 `frontend/src/components/chat/Composer.vue`：`canSend` 增加 `props.references.length > 0`（盖住回车与组件自带按钮）。
- [x] T005 `frontend/src/components/chat/ChatPanel.vue`：工具栏 `:can-send` 并上引用集合，并**显式**保留 `!sending && !preparing`（不能用 `||` 绕过流式禁用）。

## 2. 测试

- [x] T006 `frontend/src/utils/attachment-only-prompt.spec.ts`：单数 / 复数 / 常量无前后空格 / 不含路径。
- [x] T007 `frontend/src/composables/useChatPanel.attachmentOnly.spec.ts`（复用 `retry.spec` 的受控假会话，真实 `useChatPanel()`）：空白正文 + 1 附件 → 合成单数且不调术语预检；2 附件 → 复数；有正文 → 逐字不合成且照常规预检；无正文无附件 → 拦截 + toast；只有 `/技能名` → 仍拦截。
- [x] T008 `frontend/src/components/chat/Composer.spec.ts`：只有引用时发送按钮可用、回车发出空正文 + 引用；只有空白字符时仍置灰。

## 3. 规格

- [x] T009 新增本规格与任务清单。
- [x] T010 `specs/023-paste-upload/spec.md`：FR-011 的"正文非空"一环补注由 026 补台（落盘时机与命名规则一字未改）；修订记录加 v1.5。
- [x] T011 `specs/013-intent-focus/contracts/intent-focus-api.md` 的 `content: minLength 1, required` **不改**——这正是方案 A 的核心收益，已在本规格 FR-007 明示。

## 4. 门禁

- [x] T012 `frontend`：`vue-tsc --build --force` ✅、`npm run lint` ✅。
- [ ] T013 **vitest 未执行**：本机 `vitest 5.0.0` 运行器仓库级损坏（四个包任一 spec 都在 `describe()` 处抛 `Cannot read properties of undefined (reading 'config')`，`node_modules/@vitest` 缺 `expect`/`utils`/`snapshot` 等子包，疑似安装被安全软件中断），属既有环境问题，非本次改动引入。**T006~T008 三份测试已写但未跑过**，修复依赖安装后需补跑。
- [ ] T014 手工冒烟（待前端启动后执行）：①只传 1 个文件不写字 → 可发、气泡显示「请查看这个文件」；②传 2 个 → 「请查看这些文件」；③有正文 → 逐字不变；④只打 `@文件` 不写字 → 可发（原先"按钮亮但报错"）；⑤什么都不选 → 仍提示；⑥流式中发送键仍禁用。

## 5. 明确不做

- 不改服务端 `content` 必填契约，不新增跨字段校验。
- 不改会话标题派生规则（接受纯附件会话标题重名）。
- 不改 `read_file` 的图片支持（话术用「查看」以避开诱导失败调用）。
- 不把合成话术回填输入框。

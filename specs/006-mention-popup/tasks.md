# 006 任务清单：`@` 文件选择浮层与 HITL 输入控件口径统一

- **特性标识**：`006-mention-popup`
- **规则**：任务勾选状态 MUST 与代码同步（宪章原则一）；每期结束 MUST 跑完本地门禁

---

## Phase 0：规格（宪章原则一）

- [x] T001 `specs/006-mention-popup/spec.md`：三条需求线（浮层 / HITL 覆盖 / enum 保真）+ 不变量 + 影响面评估
- [x] T002 `specs/006-mention-popup/plan.md`：技术决策、被否决方案、复杂度跟踪、门禁
- [x] T003 `specs/006-mention-popup/tasks.md`（本文件）

## Phase 1：P1 · enum 下拉类型保真

- [x] T101 `frontend/src/utils/arg-schema.ts`：`optionsOf` 追加识别 `const` 与 `anyOf` / `oneOf` 内的枚举集合（保持"空数组即非下拉"语义）
- [x] T102 `frontend/src/utils/arg-schema.spec.ts`：四类形态各 1 例（`enum` / `const` / `anyOf` / `oneOf`）+ 空数组 1 例
- [x] T103 `frontend/src/components/chat/InteractionControl.vue`：`<option>` 改用下标，`onSelect` 按 `options[index]` 写回原值
- [x] T104 `frontend/src/components/chat/InteractionControl.spec.ts`：数字枚举选中后模型值为 `number`；字符串枚举仍为 `string`；空值项不可提交

## Phase 2：P2 · 定位纯函数与浮层组件

- [x] T201 新增 `frontend/src/utils/popup-position.ts`：`placePopup(anchorRect, popupSize, viewport)`（右侧优先 → 左侧翻转 → 四边夹取）
- [x] T202 新增 `frontend/src/utils/popup-position.spec.ts`：右溢出 / 左溢出 / 下溢出 / 垂直于锚点上方 / 极窄视口，共 5 例
- [x] T203 新增 `frontend/src/utils/caret-rect.ts`：mirror-div 测光标坐标（含 textarea 内部滚动），失败返回 `null`
- [x] T204 新增 `frontend/src/utils/caret-rect.spec.ts`：单行 / 多行 / 行首 / 行尾 / 滚动偏移 / 环境缺布局时返回 `null`
- [x] T205 新增 `frontend/src/components/chat/MentionPopup.vue`：DOM 归属不变 + `position: fixed` + 顶层 z-index + 定位 + 滚动/resize 跟随（rAF 节流）+ Esc 兜底 + 内容插槽
- [x] T206 新增 `frontend/src/components/chat/MentionPopup.spec.ts`：面板仍在原 DOM 子树内（无 Teleport）；`open` 变化时定位被调用；滚动触发重算；`Esc` 只关面板；测量失败回退贴下方
- [x] T207 `InteractionControl.vue`：判据去 `compact`（`mentionable = isTextControl(control)`）、新增 input `ref`、面板换 `MentionPopup`、`aria-expanded` / `aria-controls`、移除 absolute 面板样式
- [x] T208 `InteractionControl.spec.ts`：表格单元格可 `@`（新增）；普通字段可 `@`（回归）；number / switch / select / json 各 1 例无入口
- [x] T209 `InteractionControl.vue`：文本类控件 placeholder 改为 `可打 @ 选择文件`
- [x] T210 `InteractionControl.spec.ts`：placeholder 文案断言（文本类有、非文本类无）
- [x] T211 `InteractionField.vue`：删行、切 JSON 视图时 `context?.mention?.close()`
- [x] T212 `InteractionField.spec.ts`：删行 / 切视图 / 表单重建各 1 例断言面板收起
- [x] T213 `InteractionDialog.mention.spec.ts`：既有字段行用例回归 + 单元格用例

## Phase 3：P3 · 聊天侧接入

- [x] T301 `Composer.vue`：`#mention` 插槽透出 `anchor`（既有 `inputRef`）
- [x] T302 `Composer.spec.ts`：插槽 `anchor` 可用性；引用芯片（`.composer__refs`）结构回归不变；`mention-key` 键盘上抛回归
- [x] T303 `ChatPanel.vue`：`#mention` 内改渲染 `MentionPopup`；移除 `.chat-panel__mention` 的流内 margin
- [x] T304 `ChatPanel.spec.ts`：浮层挂载不推挤布局（锚点矩形不变）；引用芯片回归
- [x] T305 清理：确认 `MentionPicker` 在聊天与 HITL 两侧均为纯展示组件（无重复级联逻辑）

## Phase 4：文档同步（宪章原则一、原则七）

- [x] T401 `specs/001-digital-human-platform/contracts/runtime-api-delta.md`：修订 HITL 渲染口径（"表格单元格不挂" → "凡文本类控件一律挂，面板为浮层"），登记修订理由与日期
- [x] T402 `specs/001-digital-human-platform/tasks.md`：同步 `compact` 语义描述
- [x] T403 本文件勾选状态与实现同步

## Phase 5：门禁与验收（宪章原则三、八）

- [x] T501 `npm run lint`（**0 error**；余 34 warnings 为存量模板观感项，未用 `--fix` 批量改写，原因见「同步记录」）
- [x] T502 `npm run typecheck`（**0 error**）
- [x] T503 `npm run test:coverage`（新增/改动模块 ≥80%）
- [x] T504 `npm run build`（通过；`build` = `typecheck` + `vite build`）
- [x] T505 `check:lines` 等价检查：006 自己的改动/新增文件全部 ≤500 行（最大 **482**）。**本次为清存量门禁而触及的 3 个原超限文件也已按原则二拆到线下**：968 → 411 + 325 + 262、601 → 251 + 364、507 → 482 + 52（详见 T607 / 同步记录 4）
  - 【2026-10-12 处置变更：上述"3 个原超限文件的拆分"已**整体回滚**（拆分产物 4 个文件删除、原文件恢复为 **968 / 601 / 507** 行）——该区域（`views/demo/**`、`views/datapage/**`）由其他人负责，用户要求不再改动。**006 自身**的改动/新增文件仍全部 ≤500 行（最大 482）。详见宪章 2.1.2】
- [x] T506 依赖核对：`package.json` 无新增依赖

## Phase 6：验收期收口（2026-10-12，用户拍板项）

- [x] T601（FR-132）`Composer.vue`：占位文案改为 `输入消息：打 @ 可引用文件空间里的文件`，键盘用法落为输入框下方 `.composer__hint` 常驻提示（对齐 `frontend/prototype/mention-popup-prototype.html`）
- [x] T602（FR-111 对齐）`InteractionControl.vue`：`compact` 单元格补回 `可打 @ 选择文件` 占位提示（原被 `compact ? undefined : placeholder` 吞掉）
- [x] T603（FR-120 / FR-121）`InteractionControl.vue`：下拉写回改为**选项下标承载原值**（计划 D5 原设计），消掉"按字符串反查"在 `[1, "1"]` 这类退化枚举上的静默写回；补 3 例（数字枚举 / 字符串枚举 / 退化枚举）
- [x] T604（FR-120 对齐）测试：`compact` 单元格与表格列的 enum 各 1 例，断言渲染为 `select` 且非文本输入框
- [x] T605（原则一 / 八）存量门禁红灯清理：`lint` 100 → **0 error**、`typecheck` 11 → **0**；eslint 对移植/第三方来源的树按路径放开 4 条规则并登记（详见宪章 2.1.1）
  - 【2026-10-12 处置变更：**已回滚**（见宪章 2.1.2）——`views/demo/**` 与 `views/datapage/**` 已恢复至 HEAD，实测 `lint` **50 problems（16 errors / 34 warnings）**、`typecheck` **10 errors**，且 16 / 10 条**全部**落在回滚回来的文件内（其它文件为 0）；保留项为 `eslint.config.mjs` 的"按路径放开 4 条规则"与 `router/index.ts` 的未使用参数修复（**未回滚范围**，故 `lint` 100 → **16 errors**、`typecheck` 11 → **10 errors**，未退回原值）。该区域的缺陷与超限行数按「治理 § 不追溯」保持原状，交由该区域负责人处置】
- [x] T606（原则三）覆盖率地板上调 48/55/38/47 → **53/59/42/52**（实测 54.28/60.47/43.03/53.17）
- [x] T607（原则二，硬门禁）**把本次改动触及的 3 个原超限文件拆到线下**（此前误判为"登记债务即可"）：
  - `views/datapage/task-result.vue` 507 → **482** + 抽出 `task-result.columns.ts`（52，含同名 spec 54）
  - `views/demo/gantt-demo.vue` 601 → **251** + 抽出 `gantt-demo.data.ts`（364，含同名 spec 42）
  - `views/demo/urgent-insert-result.data.ts` 968 → **411** + `urgent-insert-result.gantt.data.ts`（325）+ `urgent-insert-result.gantt-after.data.ts`（262），两份各含同名 spec（81 / 50）；原路径 re-export，导入方零改动
  - 【2026-10-12 处置变更：**本条已整体回滚**（见宪章 2.1.2）——上述 4 个拆分产物文件（`task-result.columns.ts`、`gantt-demo.data.ts`、`urgent-insert-result.gantt.data.ts`、`urgent-insert-result.gantt-after.data.ts`）及其 4 个同名 spec **已删除**，3 个原文件恢复为 **968 / 601 / 507** 行，全部超出原则二的 ≤500 行。**但本条确立的口径不变**："MUST NOT 新增或保留超过 500 行的文件"+「治理 § 不追溯」把"本次实际改动的文件"纳入适用 ⇒ **触及即拆、不得登记为债务**；该口径适用于本仓库今后任何实际改动的文件，只是本次不再通过修改该区域来兑现】

## 验收清单（对应 spec §5）

- [x] FR-101~108 浮层行为与层级（含"看得见点不动"问题的消除）
- [x] FR-110~113 HITL 覆盖范围、提示文案（含 `compact` 单元格）、收起时机
- [x] FR-120~123 凡有 `enum` 一律下拉（含 `compact` 单元格与表格列）与类型保真
- [x] FR-130~132 聊天侧复用、引用展示回归、输入框 `@` 可见性提示
- [x] I-1~I-5 五项不变量全部保持

---

## 同步记录（2026-10-12，T403）

勾选状态逐条对照实现（不是"看一遍就勾"，而是按文件与用例反查）。同步过程中查出**一个会直接抛错的契约缺口**，已修；门禁本地实跑结果如下。

> **2026-10-12 处置变更（回滚）**：下表中的"存量门禁清理 / 3 个超限文件拆分"部分已按用户要求**整体回滚**——`views/demo/**` 与 `views/datapage/**` 恢复至 HEAD、4 个拆分产物删除。故 `lint` / `typecheck` / 单文件行数**不再全绿**，回滚后实测见表（2）；`@` 浮层本特性自身的交付与结论不受影响。详见宪章 2.1.2。

**（1）收口当时（2026-10-12，回滚前）**

| 门禁 | 结果 |
|---|---|
| `npm run lint` | **0 error**（余 34 warnings：存量模板属性顺序等纯观感项，未批量 `--fix`，原因见下 5） |
| `npm run typecheck` | **0 error** |
| `npm run test:coverage` | **47 文件 / 580 用例全绿**，阈值通过（全局 54.28 / 60.47 / 43.03 / 53.17，地板已随之上调为 53 / 59 / 42 / 52；`popup-position` / `caret-rect` / `arg-schema` 各自 ≥80%） |
| `npm run build` | 通过（`typecheck` + `vite build` 均退出码 0） |
| 单文件行数 | **全部改动/新增文件 ≤500 行（最大 482）**，含 3 个本次触及的**原超限**存量文件（已按原则二拆到线下） |
| 依赖 | `package.json` 零新增 |

**（2）回滚后实测（2026-10-12，当前状态）**

| 门禁 | 结果 |
|---|---|
| `npm run lint` | **50 problems（16 errors / 34 warnings）**——16 条 error 全部落在回滚回来的存量文件：`datapage.vue` 11、`gantt-demo.vue` 2、`gantt-compare-section.vue` 2、`urgent-insert-result.data.ts` 1；其余文件 0 |
| `npm run typecheck` | **10 errors**，同样全部落在上述文件内；其中 4 条是**真实缺陷**：`task-result.vue` 第 41 / 59 行取 `label`（数据源里是 `title`）→ 指标卡标题与图例**渲染为空**；第 365 / 367 行 `ColumnConfig.customRender` 签名与数据源实际形状不符 |
| `npm run test` | **43 文件 / 562 用例全绿**（比收口时少 5 个文件 / 21 用例，即随回滚删掉的 4 个抽取模块 spec 与被撤的图例 spec） |
| `npm run build` | **不通过**——`build` = `typecheck` + `vite build`，前置 `typecheck` 现有 10 errors |
| 单文件行数 | `urgent-insert-result.data.ts` **970**、`gantt-demo.vue` **603**、`task-result.vue` **507**（超限，属存量，按「不追溯」保持原状） |
| 依赖 | `package.json` 零新增（未变） |

**本次同步补记五处：**

1. **修掉一个会直接抛错的契约缺口（重要）**：`ChatPanel.vue` 按计划读 `mention.caret`，但 `useFileMention` **从未产出**该字段——组件测试各自打桩补了一个 `caret`，把"契约里根本没有它"遮住了，直到 `typecheck` 报 `Property 'caret' does not exist on type 'FileMentionStore'`（运行时表现为 `undefined.value` 抛错、聊天区渲染失败）。已按 `usePathInsert` 的同款口径补齐：`FileMentionStore.caret: Ref<number>`，`handleInput` 触发时记录本次光标、`close()` 归零；并新增 `src/composables/useFileMention.spec.ts`（3 例）作为该缺陷的回归防线。该文件是存量模块、按「不追溯」只覆盖**改动部分**，故未将其整体加入模块阈值清单（否则即是为存量模块发起覆盖率补齐专项）。
2. **T304 的 `ChatPanel.spec.ts` 已补齐**（原实现已就绪但该文件缺失，属计划 §3 所列文件）：断言浮层经 `#mention` 插槽就地挂载、落点为脚本写入的视口坐标、打开前后锚点矩形一致；以及 `.composer__refs` 芯片结构与上报口径回归。
3. **T103 按计划 D5 改回下标法**（用户拍板 B）：`<option>` 用下标承载原值，`onSelect` 按 `options[index]` 写回。除消掉 `[1, "1"]` 这类退化枚举的静默错值外，还补了该退化枚举的用例作为"为什么不是字符串反查"的证据；三处既有断言（`InteractionControl` / `InteractionDialog` / `InteractionField`）同步改为按下标取值。
4. 【2026-10-12 处置变更：**已整体回滚**（见宪章 2.1.2 与上表（2））——下面的清理与拆分做法及其产物均已不存在于仓库中；该区域由其他人负责，用户要求不再改动。**保留的只有** `eslint.config.mjs` 的按路径放开、`router/index.ts` 的未使用参数修复（故 `lint` 100 → 16 errors、`typecheck` 11 → 10 errors）与"口径澄清"本身】**存量门禁红灯已清**（用户拍板处理，**不是**借特性顺手做）：`lint` 100 → 0 error、`typecheck` 11 → 0、`build` 通过。做法按「不追溯」：16 处死代码手工清掉 + 修一个真实缺陷（`task-result.vue` 的 `card.label`/`item.label` 指向不存在字段 → 指标卡标题与图例**渲染为空**）+ `eslint.config.mjs` 对移植/第三方来源的树**按路径**放开 4 条"与搬运方式绑定"的规则（未把整棵树塞进 `ignores`，`no-unused-vars` 未放开）。
   随后按原则二（"MUST NOT 新增或**保留**超过 500 行的文件"，治理把"本次改动的文件"纳入适用）**把本次触及的 3 个原超限文件全部拆到线下**——纠正了先前"登记为债务即可"的误判：原本担心的"零测试 demo 文件拆分不可验证"，在本特性里用**同目录同名 spec** 解决（原则三），共新增 5 个测试文件、18 个用例。三个原文件的导入路径一律经 re-export 保持不变（对齐 002 的先例）。全部决定已登记在宪章 **2.1.1** 的同步影响报告。
5. **34 warnings 未批量 `--fix`**：那些 warnings 是 `vue/attributes-order`、`vue/attribute-hyphenation` 等纯观感项，落在 006 之外的存量模板里；`attribute-hyphenation` 会把 `v-model:activeKey` 改成 `v-model:active-key`（**改的是指令参数名**，属破坏性改写），`v-on-event-hyphenation` 同理会改事件名，故手工不动它们。宪章门禁口径是"0 error"，warnings 不拦门、且**留着可见比批量改写更诚实**。
6. 【2026-10-12 处置变更：**本条所述 4 个新增模块及其同名 spec 已随回滚删除**（见宪章 2.1.2）；本条保留的是**口径判定**本身——今后若在 `src/views/**` 新增纯数据/纯函数模块，仍按原则三补同名 spec、且不加入模块阈值清单（原因见下）】**新增模块的覆盖率口径**：本次新增的 6 个模块（`task-result.columns.ts`、`gantt-demo.data.ts`、`urgent-insert-result.gantt.data.ts`、`urgent-insert-result.gantt-after.data.ts` 及其 spec）都在 `src/views/**`。原则三把覆盖率门禁的范围限定在 `src/api` / `src/composables` / `src/utils`，故它们**按原则三补同名 spec**（已做），但**不加入模块阈值清单**——纳入的前提是先扩 `coverage.include`，那会把全部移植页拖进分母、等于废掉地板（`vite.config.ts` 的注释已说明该口径）。

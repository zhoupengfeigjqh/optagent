# 006 实施计划：`@` 文件选择浮层与 HITL 输入控件口径统一

- **特性标识**：`006-mention-popup`
- **计划日期**：2026-10-12（同日修订：定位方案由 "Teleport + Popover" 收敛为 "DOM 归属不变 + fixed"，理由见 §1 D1/D2 与 §2）
- **门禁**：本地执行（宪章原则三 / 原则八），容器不参与

---

## 1. 技术决策

### D1 定位方式：DOM 归属不变 + `position: fixed`

- 决策：面板**保持在原组件的 DOM 位置**（HITL 留在 `InteractionControl` 内、聊天留在 `Composer` 内），只把定位从「absolute（字段行下方）/ 流内」改为 `position: fixed` + JS 计算坐标。
- 理由（一次解决两个问题）：
  1. **不再被裁剪**：`fixed` 的包含块是**视口**，不是任何祖先的 `overflow` 容器，因此 `.base-dialog__body { overflow-y: auto }` 与表格的 `overflow-x: auto` 都裁不到它；
  2. **不再被 `inert` 拦住**：面板仍在 `<dialog>` 的 DOM 子树内，属于 dialog 内容，点击合法——这消除了"看得见、点不动"的成因。
- 附带收益：**MUST NOT 引入 Teleport，MUST NOT 依赖 Popover API**（零新 API 依赖，兼容性风险归零）；面板随所在字段被 `v-if` 卸载而自动卸载；组件测试无需 Teleport stub。
- **前提约束**：祖先 MUST NOT 含 `transform` / `filter` / `will-change` / `contain` / `perspective`，否则 `fixed` 的包含块会变成该祖先。已核对现状：`BaseDialog` → `.base-dialog__panel` → `.base-dialog__body` → `InteractionDialog` → `InteractionField` → `InteractionControl`，以及 `ChatPanel` → `.composer` 链条上均无这些属性（仓库内的 `transform` 只出现在 gantt tooltip、`LoadingDots`、`AppShell` 分隔线、`ProducedBell` 角标、`BaseButton` 动画等**叶子装饰**上）。

### D2 层级：`fixed` + 顶层 `z-index`

- 决策：面板 `z-index` 取顶层值；HITL 场景因面板在 dialog 子树内绘制，天然位于普通层内容（含 `::backdrop`）之上。
- 理由：层的归属由"面板是否在 dialog 内"决定，不需要 top layer 提升，故不需要 Popover。

### D3 定位计算：测量与计算分离

| 模块 | 职责 | 类型 |
|---|---|---|
| `utils/caret-rect.ts` | mirror-div 测光标视口坐标（同字体/内边距/边框/换行规则，扣除 textarea 内部滚动） | 薄 DOM 层 |
| `utils/popup-position.ts` | `placePopup(anchorRect, popupSize, viewport)`：右侧优先 → 左侧翻转 → 四边夹取 | 纯函数 |

- 理由：jsdom 无布局（`getBoundingClientRect` 恒为 0），几何混在组件里就**不可测**（原则三）。纯函数化后可对"右溢出 / 左溢出 / 下溢出 / 极窄视口"逐例断言。
- 回退：测量或计算拿不到有效矩形时，退为"贴锚点下方 + 夹取"，面板 MUST NOT 消失（原则九）。

### D4 覆盖范围：判据去掉 `compact`

- 决策：`mentionable = isTextControl(controlOf(schema))`，删除 `&& !props.compact`。
- 理由：表格单元格与普通字段**共用 `InteractionControl`**，"表格与非表格都支持"因此是**同一处实现**的自然结果（原则二"同一职责只有一处实现"），而不是两处改动。
- 边界：`number` / `switch` / `select` / `json` 四类控件不挂 `@`（`isTextControl` 已排除）。

### D5 enum 写回类型保真

- 决策：`<option>` 的 `:value` 改为**选项下标**，`onSelect` 按 `options[index]` 取**原值**写回；`<select>` 的当前值改为"当前值在选项中的下标"。
- 理由：现状 `event.target.value` 永远是字符串，任何**数字 / 布尔枚举**（服务方声明 `{"type":"integer","enum":[1,2,3,4,5]}` 这种）选中 `1` 后都会被写成 `"1"`，与 schema 声明不符。
- **2026-10-12 更正**：原先举例的 `businessType` 在真实契约里**没有 `enum`**（`{"type":"integer"}`，1~5 只写在 `description`），故这条是"服务方一旦声明数字枚举就会失真"的**前瞻性修复**，不是已知线上症状；契约里唯一的 `enum` 是字符串枚举 `ruleId`（`PR001~PR009`）。修法不变。
- 扩展：`optionsOf` 追加识别 `const` 与 `anyOf` / `oneOf` 内的常量集合；**只要有一个分支不是常量集合就整体放弃**（Pydantic 的 `Optional` 会生成 `{anyOf:[{type:'string'},{type:'null'}]}`，那是联合类型而非选项）。空数组与缺省仍保持"非下拉"语义。

### D6 滚动策略：跟随重算

- 决策：以 `scroll`（**capture**，覆盖任意祖先滚动）+ `resize` 触发重算，用 `requestAnimationFrame` 节流。
- 理由：浮层锚定的是**光标**；`fixed` 不随内容滚动，所以滚动必须重算，否则面板会停在旧坐标。滚动即关会让交互闪跳，故选择跟随。
- 成本：一次 rAF 内一次矩形计算，满足原则五的交互反馈要求。

### D7 聊天侧接入方式：插槽透出 `anchor`

- 决策：`Composer` 的 `#mention` 插槽新增 slot prop `anchor`（即既有 `inputRef`），由 `ChatPanel` 交给浮层；浮层不再参与流内布局。
- 理由：`Composer` 的 props/emits 不变（`mentionOpen` / `mention-key` 键盘上抛机制保留），改动面最小；`Composer.vue` 的引用芯片（`.composer__refs`）保持原样（不变量 I-1）。

## 2. 被否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 面板 Teleport 到 `document.body` | 在 `showModal()` 的 dialog 下，文档其余内容被 `inert`，面板**看得见却点不动**（原型已复现）；且普通层的 `z-index` 无论多大都跨不过 top layer |
| 面板 Teleport 进 `<dialog>` 内部 + fixed | 与 D1 效果相同，但需要 `closest('dialog')` 推导宿主或让 `BaseDialog` 暴露元素引用，**多引入耦合**；既然 `fixed` 已能逃逸裁剪，就不必搬动 DOM |
| 用 Popover API 提升到 top layer | D1 成立后它不再带来额外收益，却引入特性探测分支、UA 默认样式重置（作者 `display:flex` 会盖掉 `[popover]:not(:popover-open){display:none}`）与浏览器支持差异（原则六：能不加就不加） |
| 只用 `z-index` 提层（面板留在 body / 不动 DOM） | 若面板不在 dialog 子树内，`z-index` 只作用于同层排序，跨不过 top layer |
| 复用 antd `Popover` / `Dropdown` 定位 | 默认 teleport 到 body，同样掉出 dialog 子树；且引入第二套弹层体系与项目自有组件风格混搭 |
| 新增浮动定位库（floating-ui 等） | 规则简单（右侧优先 + 翻转 + 夹取），自写纯函数约七十行即可，无必要新增依赖（原则六） |
| 只把 `!props.compact` 去掉、面板仍 absolute | 面板仍被 `.base-dialog__body` 与表格 `overflow` 裁剪，位置也仍与光标无关 |
| 用"贴输入框下方"定位（放弃贴光标） | 实现便宜但不是需求（用户明确要求紧贴 `@` 右侧） |
| 为表格动态列（schema 未声明）推断类型 | 违反"不猜"口径，会放大误判面；保持 JSON 逃生舱 |
| 把动画加在 dialog 上（`transform` 入场） | 会让 `fixed` 的包含块变成该祖先，直接破坏本特性定位；写入约束禁止 |

## 3. 文件级改动

**新增（含同名测试）**

| 文件 | 职责 | 预估行数 |
|---|---|---|
| `frontend/src/utils/popup-position.ts` / `.spec.ts` | 坐标计算纯函数 | ~70 |
| `frontend/src/utils/caret-rect.ts` / `.spec.ts` | 光标测量 | ~80 |
| `frontend/src/components/chat/MentionPopup.vue` / `.spec.ts` | 浮层外壳：fixed 定位 + 滚动跟随 + Esc 兜底 + 内容插槽 | ~120 |

**修改**

| 文件 | 改动 |
|---|---|
| `utils/arg-schema.ts` / `.spec.ts` | `optionsOf` 兼容 `const` / `anyOf` / `oneOf` 常量集合 |
| `components/chat/InteractionControl.vue` / `.spec.ts` | 判据去 `compact`；面板换 `MentionPopup`（锚点 = input 元素）；**enum 下标写回保真**（D5）；placeholder 文案（**含 `compact` 单元格**，FR-111）；`aria-expanded`/`aria-controls`；删除 absolute 面板样式 |
| `components/chat/InteractionField.vue` / `.spec.ts` | 删行 / 切 JSON 视图时 `close()` |
| `components/chat/Composer.vue` / `.spec.ts` | `#mention` 插槽透出 `anchor`；**输入框 `@` 提示**（占位文案 + `.composer__hint`，FR-132） |
| `components/chat/ChatPanel.vue` / `.spec.ts` | `#mention` 内改渲染 `MentionPopup`；移除 `.chat-panel__mention` 流内 margin |
| `components/chat/InteractionDialog.spec.ts` | 既有 enum 断言改为按**下标**取值（D5 的连带改动） |
| `composables/useFileMention.ts` / `.spec.ts`（后者新增） | **补 `FileMentionStore.caret`**：聊天侧浮层定位读它，而它此前从未被产出（详见 tasks.md 同步记录 1） |
| `vite.config.ts` | 覆盖率地板上调 53/59/42/52（原则三"只上不下"） |
| `eslint.config.mjs` | 对移植/第三方来源的树按路径放开 4 条"与搬运方式绑定"的规则（见 §5 登记与宪章 2.1.1；2026-10-12 处置变更后**本项未回滚、仍有效**，见宪章 2.1.2） |

【2026-10-12 处置变更：**已整体回滚**（见宪章 2.1.2）——`views/demo/**` 与 `views/datapage/**` 已恢复至 HEAD，本段所述的清理与拆分**不再存在于仓库中**；该区域由其他人负责，用户要求不再改动。保留的只有 `eslint.config.mjs` 的按路径放开与 `router/index.ts` 的未使用参数修复（故 `lint` 100 → **16 errors**、`typecheck` 11 → **10 errors**，未退回原值）。】

**存量门禁清理（用户拍板，不属本特性交付物）**：`router/index.ts`、`views/datapage/{task-result,datapage,datapage.dialog}.vue`、`views/demo/**`、`components/z-{gantt,gantt-table,table}/**` —— 只做死代码清理与类型/真实缺陷修复，不重构、不改文件命名；其中 3 个原超限文件按原则二拆到线下（见 §5）。明细见 tasks.md Phase 6 / 同步记录 4。

**存量超限文件的拆分产物（新增模块，均为纯数据/纯函数 + 同名 spec）**：

【2026-10-12 处置变更：**已回滚**——下表 4 个文件及其同名 spec **均已删除**，3 个原文件恢复为 968 / 601 / 507 行（详见 tasks.md 表（2）、宪章 2.1.2）。下表仅作历史记录。】

| 文件 | 职责 |
|---|---|
| `views/datapage/task-result.columns.ts` | label/prop 列配置 → a-table 列（从 `task-result.vue` 抽出） |
| `views/demo/gantt-demo.data.ts` | 甘特图演示页的示例任务数据（从 `gantt-demo.vue` 抽出） |
| `views/demo/urgent-insert-result.gantt.data.ts` | 甘特图类型 + 度量函数 + **排产前**数据（从 `urgent-insert-result.data.ts` 抽出） |
| `views/demo/urgent-insert-result.gantt-after.data.ts` | **排产后**数据（同上） |

**明确不改**：`MentionPicker.vue`、`usePathInsert.ts`、`BaseDialog.vue`、`.composer__refs` 样式与展示结构、`agent-backend` 全部、以及 `useFileMention` 除 `caret` 外的任何既有行为。

## 4. 分期（每期独立可验收）

| 期 | 内容 | 验收 |
|---|---|---|
| **P1** | enum 写回保真 + 选项形态扩展 + 测试 | `InteractionControl.spec.ts` 断言 `typeof value === 'number'`；`arg-schema.spec.ts` 覆盖四类形态 |
| **P2** | 定位纯函数 + 浮层外壳 + HITL 接入 + 收起时机 + 测试 | 表格单元格可 `@`；面板为 fixed 且不被裁剪；Esc 只关面板；删行收面板 |
| **P3** | 聊天侧接入 + 引用展示回归 | `Composer.spec.ts` 引用芯片结构不变；聊天浮层不推布局 |
| **P4** | 验收期收口（2026-10-12，用户拍板项）：`@` 提示补齐（FR-132 / FR-111 对齐）、enum 一律下拉（FR-120）与下标写回（D5）、存量门禁清理、覆盖率地板上调 | tasks.md Phase 6 逐条勾选；`lint` / `typecheck` / `test:coverage` / `build` 四项全绿【2026-10-12 处置变更：其中"存量门禁清理"已回滚，故 `lint`（**16 errors**）与 `typecheck`（**10 errors**）**不再全绿**，`build`（= `typecheck` + `vite build`）随之不通过；`test` 仍全绿（43 文件 / 562 用例）。error 全部落在回滚回来的存量文件内，详见 tasks.md 同步记录表（2）与宪章 2.1.2】 |

## 5. 复杂度跟踪（治理条款）

| 项 | 登记 |
|---|---|
| 平台相关行为差异（Windows 本地 / Linux 容器） | **无**。纯前端渲染层改动，不涉及原生模块、文件系统大小写、非 ASCII 路径或行尾符，故不需要额外的部署后冒烟项。 |
| 宪章例外 | **无**。零新增依赖（原则六）、降级均有可感知状态与测试（原则九）、判据单点实现（原则二）。 |
| 已知技术约束 | ① `fixed` 的包含块要求祖先不含 `transform` / `filter` / `will-change` / `contain` / `perspective`（D1 前提约束，已核对现状）；② 面板依赖 `z-index` 顶层值，弹窗后续若新增更高的浮层需一并核对。两条均写入 `MentionPopup.vue` 的说明注释。 |
| 存量超限文件（本次已处置） | 本次改动触及的 3 个存量文件原本已超"单文件 ≤500 行"硬门禁。原则二是"**MUST NOT 新增或保留**超过 500 行的文件"，而治理把"本次改动的文件"纳入适用，故**本次一并拆到线下**：（968 → 411 + 325 + 262）、（601 → 251 + 364）、（507 → 482 + 52）。导入路径一律经 re-export 保持不变；新模块按原则三各配同目录同名 spec（共 5 个测试文件 / 18 用例）。**注**：先前误判为"零测试的 demo 文件拆分不可验证、登记债务即可"，纠正理由见 tasks.md 同步记录 4。【2026-10-12 处置变更：**已回滚**——3 个文件恢复为 968 / 601 / 507 行、4 个拆分产物已删除；"触及即拆"的口径不变，见宪章 2.1.2】 |
| 门禁覆盖范围界定（本次决定） | `eslint.config.mjs` 对移植/第三方来源的树（`z-gantt*` / `z-table` / `views/datapage/**` / `views/demo/**`）按路径放开 4 条与"搬运方式"绑定的规则。这是**明确的、登记的**范围界定，不是静默稀释；已写入宪章 2.1.1 的同步影响报告，且**MUST NOT** 被引用为"存量代码已达标"的依据。（2026-10-12 处置变更后**本条仍有效**——按路径放开与"存量未达标"的判定不变；见宪章 2.1.2） |

## 6. 门禁（本地单命令，原则八）

```
cd frontend
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

新增与改动模块 MUST 纳入覆盖率模块阈值清单（≥80%）；单文件 MUST ≤500 行；MUST NOT 新增依赖。

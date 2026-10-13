# 006 `@` 文件选择浮层与 HITL 输入控件口径统一

- **特性标识**：`006-mention-popup`
- **状态**：实现中（2026-10-12）
- **影响范围**：`frontend`（`agent-backend` 零改动，评估结论见 §7）
- **上游依据**：`specs/001-digital-human-platform/contracts/runtime-api-delta.md`（HITL 弹窗控件映射与 `@` 引用口径）、`specs/002-conversation-runtime/spec.md`（对话运行时）
- **本特性修订的上游条文**：`runtime-api-delta.md` 中「`@` 文件引用与结构化文件卡片仍只挂文本类控件（表格单元格不挂，避免在格子里展开面板）」——改口径为「凡文本类控件一律挂，面板改为浮层，故单元格不再有裁剪问题」

---

## 1. 背景与问题

1. **表格单元格里的字段没有 `@` 入口**。判据是 `isTextControl(control) && !compact`，而表格单元格走 `compact` 模式，因此 `hd_algorithm_input_parser.items[].realRelativePath` 这类**必须由人填写服务器相对路径**的字段只能手输。
2. **普通字段的 `@` 面板会被裁剪且位置错乱**。面板是"字段行下方的绝对定位块"（定位上下文是 `.interaction-dialog__field`），而它在 `.base-dialog__body { overflow-y: auto }` 内部——向下伸出即被滚动容器裁断；表格外层再叠一层 `overflow-x: auto`，横向也可能被裁。
3. **聊天输入框的 `@` 面板会推挤布局**。它经 `Composer` 的 `#mention` 插槽渲染在 textarea **之前**，是流内元素，展开时把输入框与消息区整体顶下去。
4. **HITL 的数字 enum 写回类型失真**。`enum` 字段虽已渲染为 `<select>`，但写回的是 `event.target.value`（**永远是字符串**），于是 `{"type":"integer","enum":[1,2,3,4,5]}` 这类**服务方声明的数字枚举**选中 `1` 后会写回 `"1"`，与 schema 声明的 `integer` 不符。

   > **事实更正（2026-10-12）**：初稿把这条挂在 `businessType` 上（写作 `businessType: {"type":"integer","enum":[1,2,3,4,5]}`），**那是编的样例**。真实契约（`异步MCP服务接入约定.md` §`hd_scheduling_submit` + 对接方 `parse_excel_files` 的 schema 副本，见 `agent-backend/tests/unit/mcp-tool-adapter.spec.ts`）里：
   > - `businessType` 是 `{"type":"integer"}`，1~5 的含义**只写在 `description` 里**（"产能信息的数据版本（businessType=1）"），**没有 `enum`**——它在 HITL 里渲染为**数字输入框**，不是下拉；
   > - 当前契约里**唯一**的 `enum` 是 `ruleId: {"type":"string","enum":["PR001"…"PR009"]}`，是**字符串**枚举（字符串化无损）。
   >
   > 因此本条应读作"**数字/布尔枚举一旦被服务方声明就会失真**"的**前瞻性/稳健性要求**，而非已知线上症状。修法不变（下标承载原值），但它不是"某个字段已经出问题"。

第 2、3 点的直接后果（已在原型中复现）：原生 `<dialog>` + `showModal()` 会使其外部内容 `inert`，**面板看得见但点不动**；`z-index` 给到普通层极限也无济于事。

## 2. 目标

1. 把 `@` 后的文件选择做成**紧贴 `@` 光标右侧、浮在最上层、不占布局**的浮层；
2. 聊天输入框与 HITL 弹窗**共用同一套浮层实现**；
3. HITL 侧覆盖**所有文本类控件**（表格单元格与非表格字段同源）；
4. enum 统一为下拉，且**写回保留声明的原始类型**；
5. 选完之后的**展示与提交语义一律不变**。

## 3. 非目标（本次明确不做）

- 字段标签的语言（`title` / `displayName` 的取用）——标签仍显示英文 `name`，hint 仍取 `description` 首句，表格列头仍显示列名；
- 面板内部的三级级联交互协议（点击下钻、`↑↓`/`←→`/`Enter`/`Esc`）——复用现有 `MentionPicker`；
- HITL 表单的校验、倒计时、拒绝/提交、`rules_field` 规则入口；
- 后端任何改动（含 schema 裁剪逻辑）；
- 对"列未在 schema 声明"的表格动态列做类型推断（保持 JSON 逃生舱，不猜）。

## 4. 不可破坏的不变量

| # | 不变量 | 落点 |
|---|---|---|
| I-1 | 聊天侧选完文件的展示风格不变：输入框上方 `@文件名` 芯片 + 移除按钮 | `Composer.vue` 的 `.composer__refs` |
| I-2 | HITL 选完的展示不变：字段值 + 命中文件空间时的结构化文件卡片；字段标签仍为英文 `name` | `InteractionField.vue` |
| I-3 | 提交语义不变：聊天发结构化 `attachments`；HITL 写 user-data 相对路径 | `useFileMention.buildAttachments()`、`usePathInsert.relativePathOf()` |
| I-4 | `@` 触发口径唯一：复用 `TRIGGER_PATTERN`，MUST NOT 新增第二套判定 | `useFileMention.ts` |
| I-5 | HITL 表单链路与后端 `file_args` 铸造链路不动 | `useInteractionForm.ts`、后端 `mcp-schema-view.ts` |

## 5. 功能需求

### 5.1 浮层（聊天 + HITL 通用）

| 编号 | 需求 | 验收 |
|---|---|---|
| **FR-101** | `@` 触发后的文件选择 MUST 渲染为**浮层**：`position: fixed`，MUST NOT 参与文档流、MUST NOT 推挤任何现有布局 | 组件测试：面板挂载后，锚点元素与相邻内容的 `getBoundingClientRect` 不变 |
| **FR-102** | 浮层 MUST **紧贴 `@` 光标右侧**（左边缘 = 光标右边缘 + 间隙，上边缘与光标所在行对齐） | 纯函数测试：给定锚点矩形与浮层尺寸，`left = anchor.right + gap` |
| **FR-103** | 右侧空间不足时 MUST **翻转到光标左侧**；两侧均不足时 MUST 夹取到视口内；垂直方向 MUST 夹取到视口内 | 纯函数测试：右溢出→左、左溢出→夹取、下溢出→上移，四类各 1 例 |
| **FR-104** | 浮层 MUST 处于**最上层**：MUST NOT 被任何祖先 `overflow` 裁剪，MUST NOT 被所在 `<dialog>` 的 `inert` 拦截点击 | 组件测试：断言面板为 `fixed` 定位且仍挂在其字段/输入框的 DOM 子树内 |
| **FR-105** | 浮层 MUST **保持在原组件的 DOM 位置**（MUST NOT Teleport）；屏幕位置 MUST 只由 `position: fixed` + 坐标计算决定 | 组件测试：`wrapper.find('.mention-picker')` 可命中；断言面板祖先链未改变，且随字段卸载而消失 |
| **FR-106** | 浮层 MUST NOT 依赖 Popover API 或任何新浏览器 API；MUST NOT 要求祖先使用 `transform` / `filter` / `will-change` / `contain` / `perspective` | 代码审阅 + 组件测试：无特性探测分支 |
| **FR-107** | 浮层的展开/收起 MUST NOT 依赖光标是否仍在输入框上（点击面板会导致输入框失焦） | 组件测试：点击面板项后值被正确写入 |
| **FR-108** | `Esc` MUST 只关闭浮层，MUST NOT 冒泡去关闭所在 `<dialog>` 或触发其它关闭意图 | 组件测试：`Esc` 后面板关闭且未发出 dialog 的 close |

### 5.2 HITL 覆盖范围

| 编号 | 需求 | 验收 |
|---|---|---|
| **FR-110** | HITL 中**所有文本类控件**（`text` / `textarea`）MUST 支持 `@` 引用，**不论位于表格单元格还是普通字段**；判据 MUST 只有一处实现 | 组件测试：表格单元格与普通字段各 1 例；非文本控件（number / switch / select / json）各 1 例断言无入口 |
| **FR-111** | HITL 文本类控件的占位提示 MUST 为 `可打 @ 选择文件`，**表格单元格（`compact`）与普通字段同源**——`compact` 只改排版与可达性，MUST NOT 吞掉该提示 | 组件测试：字段行与单元格各 1 例断言 placeholder 文案；非文本控件不断言该文案 |
| **FR-112** | 下列时机 MUST 收起浮层：表格**删行**、切换 JSON 视图、表单随挂起点重建、切到另一字段、**滚动** | 组件测试：删行 / 切视图 / 重建各 1 例 |
| **FR-113** | 滚动时 MUST **跟随重算**位置（视口 resize 同理），MUST NOT 让浮层停留在旧坐标 | 组件测试：触发滚动后重新定位被调用 |

### 5.3 enum 下拉

| 编号 | 需求 | 验收 |
|---|---|---|
| **FR-120** | **凡有 `enum` 的字段 MUST 渲染为下拉选择**，`compact` 表格单元格与普通字段**同源且同形态**（同一实现；`compact` MUST NOT 把它退化成文本输入框） | 组件测试：字段行与单元格各 1 例断言 `select` 存在且非文本输入框；`enum` 在 `anyOf`/`oneOf` 内时同样成立 |
| **FR-121** | 选中项 MUST 按**选项原值**写回，MUST 保留 schema 声明的原始类型（`integer` / `number` 的枚举不得写成字符串）。原值经**选项下标**承载（DOM 的 `value` 只能是字符串），因此字符串化后彼此相同的退化枚举（如 `[1, "1"]`）MUST 也能分辨 | 单元/组件测试：`enum:[1,2,3,4,5]` 选中后模型值为 `4`（`typeof` 为 `number`）；`enum:[1,"1"]` 选第二项得到字符串 `'1'` |
| **FR-122** | 选项来源 MUST 支持 `enum`，并 MUST 兼容 `const` 与 `anyOf` / `oneOf` 内的枚举集合（存在时） | 纯函数测试：四种形态各 1 例 |
| **FR-123** | 空值项（`请选择`）MUST 保持不可作为有效提交值（既有行为不变） | 组件测试：初始为空时不通过 `required` 校验 |

### 5.4 聊天侧接入

| 编号 | 需求 | 验收 |
|---|---|---|
| **FR-130** | 聊天输入框的 `@` 浮层 MUST 复用同一组件与同一状态机（`useFileMention`），MUST NOT 复制一套级联逻辑 | 代码审阅 + 组件测试 |
| **FR-131** | 聊天侧选完文件后的展示 MUST 保持现状（`@文件名` 芯片列表、移除按钮、发送时的 `attachments`） | 组件测试：断言 `.composer__refs` 结构不变（回归） |
| **FR-132** | 聊天输入框 MUST 让用户**看得出可以打 `@`**：占位文案提示可 `@` 引用文件；键盘用法（`Enter` 发送 / `Shift + Enter` 换行）MUST 改为输入框下方的常驻提示，MUST NOT 与 `@` 提示争夺同一行文案 | 组件测试：断言 placeholder 与 `.composer__hint` 文案 |

## 6. 技术需求

| 编号 | 需求 |
|---|---|
| **TR-01** | 定位计算 MUST 抽为纯函数（输入锚点矩形、浮层尺寸、视口尺寸，输出坐标），使 jsdom 下可测 |
| **TR-02** | 光标坐标测量 MUST 与定位计算分离；测量失败（拿不到矩形）时 MUST 回退"贴输入框下方 + 夹取"，MUST NOT 静默不显示 |
| **TR-03** | MUST NOT 新增第三方依赖（Popover API / Teleport / mirror-div 均为平台原生能力） |
| **TR-04** | 浮层复用既有 `MentionPicker` 与其样式 token，MUST NOT 引入第二套视觉体系 |
| **TR-05** | 无障碍：输入框 MUST 关联 `aria-expanded` / `aria-controls`；面板保留 `role="listbox"`；键盘协议沿用现有一份实现；无动效或随 `prefers-reduced-motion` 降级 |
| **TR-06** | 降级路径 MUST 有测试覆盖：Popover 不可用、定位测量失败、workspace 加载中/空/失败（三者均须有可感知状态） |
| **TR-07** | 涉及文件 MUST 符合 ≤500 行（**含本次改动触及的存量文件**：原则二是"不得新增或保留"，配合「不追溯」= 触及即拆，本次 3 个原超限文件已拆分）；新增模块 MUST 纳入覆盖率模块阈值清单（≥80%）——**但**本次新增模块均在 `src/views/**`，而原则三的覆盖率范围限定在 `src/api` / `src/composables` / `src/utils`，故按原则三**补同名 spec**、不加入阈值清单（纳入需先扩 `coverage.include`，会把全部移植页拖进分母）；新增模块为视图层纯数据/纯函数时同样 MUST 有同名 spec【2026-10-12 处置变更：上述"本次 3 个原超限文件已拆分"**已回滚**（该区域恢复至 HEAD、拆分产物已删除）；**TR-07 的口径本身不变**，仍适用于本仓库今后实际改动的文件。见宪章 2.1.2】 |

## 7. 影响面评估（原则七：两侧）

| 侧 | 结论 |
|---|---|
| `agent-backend` | **零改动**。HITL 的 schema 由 `infra/mcp/mcp-tool-adapter.ts` 经 `mcp-schema-view.ts` 的 `exposeSchema` / `hideSchemaPaths` 透传，两者均为"浅拷贝 + 只改 `properties`/`required`"（`{ ...source, properties }`），**未知关键字与 `enum` 原样保留**；`file_args` 铸造链路与派生隐藏逻辑不变。 |
| `admin-backend` / `admin-frontend` | 无关。 |
| 契约文档 | 需修订 `runtime-api-delta.md` 的 HITL 渲染口径条文（原"表格单元格不挂"），并在其中登记修订理由与日期。 |

## 8. 待收敛项

无。四项待确认已收敛：新建本特性、滚动跟随重算、定位紧贴右侧且右侧不足翻左侧、enum 症状为**数字枚举写回类型失真**（样例：服务方声明 `{"type":"integer","enum":[1,2,3,4,5]}` 的数字枚举；**更正**：原记的 `businessType` 不成立，它没有 `enum`，详见 §1.4 的事实更正）。

## 9. 修订记录

- 2026-10-12：初稿。确立三条需求线（浮层 / HITL 覆盖 / enum 保真）与五项不变量；明确字段标签语言不在本次范围。
- 2026-10-12（实现期补记）：补齐 `FileMentionStore.caret`。聊天侧浮层定位（FR-102 / TR-01）依赖"`@` 之后的光标"，而 `useFileMention` 此前不产出该字段——组件测试的打桩各自补了 `caret`，掩盖了契约缺口，直到 `typecheck` 才暴露（运行时为 `undefined.value` 抛错）。已按 `usePathInsert` 同款口径补上，并加 `useFileMention.spec.ts` 作为回归防线。
- 2026-10-12（**事实更正**）：初稿把"数字 enum 类型失真"挂在 `businessType` 上（`{"type":"integer","enum":[1,2,3,4,5]}`），**该样例是编的**——真实契约里 `businessType` 是 `{"type":"integer"}`、取值语义只写在 `description`（渲染为数字输入框），契约里唯一的 `enum` 是字符串枚举 `ruleId`。故 §1.4 / §8 / plan D5 的语气从"已知症状"改为"前瞻性要求"，并把测试里的合成样例字段改名为 `数字枚举`（不再借用真实字段名）。修法与验收不变。
- 2026-10-12（验收期修订，三处收口）：
  1. **FR-132 新增**：聊天输入框此前只有"Enter 发送"的提示，用户看不出可以打 `@`；按 `frontend/prototype/mention-popup-prototype.html` 同款拆开——占位文案提示 `@`，键盘用法落到输入框下方的 `.composer__hint` 常驻提示。
  2. **FR-111 收紧**：原文说"文本类控件必须有该占位提示"，而实现里 `compact` 把 placeholder 置为 `undefined`，**表格单元格反而没有提示**（原型在单元格上也写了提示）——属实现偏离规格，按规格修回。
  3. **FR-120 / FR-121 明确**："凡有 `enum` 一律下拉"含 `compact` 单元格；写回改为**选项下标承载原值**（计划 D5 的原设计），消掉"按字符串反查"在退化枚举上的静默错值。
- 2026-10-12（**处置变更：回滚**）：`views/demo/**`（甘特设计）与 `views/datapage/**`（解析 Excel 后跳转的查看页）由其他人负责，应用户要求**恢复至 HEAD**——Phase 6 / 宪章 2.1.1 登记的"存量门禁清理"与"3 个原超限文件拆分"**整体回滚**（4 个拆分产物及其 spec 删除、3 个原文件恢复为 968 / 601 / 507 行），故 `lint` 回到 **16 errors**、`typecheck` 回到 **10 errors**（16 / 10 条**全部**落在回滚回来的文件内）、`npm run build` 不通过；`npm run test` 仍全绿（43 文件 / 562 用例）。**本特性的交付物与结论不受影响**（保留项：`eslint.config.mjs` 的按路径放开、`router/index.ts` 的未使用参数修复，故 `lint` 100 → **16 errors**、`typecheck` 11 → **10 errors**，未退回原值）。详见宪章 2.1.2 与 tasks.md 同步记录表（2）。

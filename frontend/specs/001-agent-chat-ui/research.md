# Phase 0 调研：技术决策

**功能**: 001-agent-chat-ui | **日期**: 2026-09-10 | **依据**: [spec.md](spec.md)、后端 `specs/002-agent-chat-ui/contracts/`

技术栈由用户指定（Vue 3 + Vite + TypeScript + Composition API + Scoped CSS + Vitest + Vue Test Utils + npm）。
本文件记录**在既定栈内**的取舍决策与"不引入什么"的理由，以及若干实现路径的选型。
**无 NEEDS CLARIFICATION 残留。**

---

## D1. 依赖清单与版本

- **Decision**: 运行时依赖仅 `vue`；构建与校验依赖 `vite`、`@vitejs/plugin-vue`、`typescript`、`vue-tsc`；
  测试依赖 `vitest`、`@vue/test-utils`、`jsdom`、`@vitest/coverage-v8`；
  规范依赖 `eslint`、`eslint-plugin-vue`、`typescript-eslint`、`prettier`、`eslint-config-prettier`。
  版本取当前稳定版：`vue@^3.5.42`、`vite@^8.2.2`、`@vitejs/plugin-vue@^6.0.8`、
  `vitest@^5.0.0`、`@vue/test-utils@^2.5.0`、`jsdom@^30.0.1`、`vue-tsc@^3.3.11`、`eslint@^10.10.0`。
- **Rationale**: 与 `agent-backend` 保持同一工具链大版本（TypeScript 6、ESLint 10、Vitest 5），
  降低跨仓库心智负担；Vue 停留在 3.5 稳定线，规避 3.6（RC 阶段）的稳定性风险；
  `typescript` 选 ^6.0.3 而非 7.x，因为 `vue-tsc` 的 peer 仅要求 `>=5`，且与后端一致可避免双版本工具链差异。
- **Alternatives considered**: ①`vue@3.6`（Vapor Mode）—— 仍处 RC，生产风险高，否决；
  ②`typescript@7` —— 与后端不一致，收益不明，否决；③使用 `create-vue` 脚手架默认依赖集 ——
  会附带 vue-router 与 Pinia，违反依赖治理，改为手工精简配置。

## D2. 工程脚手架与配置方式

- **Decision**: 手工创建最小工程，不使用 `create-vue` 交互式脚手架。配置为：
  `vite.config.ts`（构建 + `server.proxy` + `test` 段合一）、三份 tsconfig
  （`tsconfig.json` 引用 `tsconfig.app.json` 与 `tsconfig.node.json`）、`eslint.config.js` 扁平配置。
- **Rationale**: 脚手架会引入 vue-router/Pinia/示例文件，需要逐一删除并解释，不如直接写最小集；
  配置合并到 `vite.config.ts` 可减少一个配置文件；`test` 段复用 Vite 的解析与插件链，SFC 测试零额外配置。
- **Alternatives considered**: ①`create-vue` 后删减 —— 删除动作本身无审计价值，否决；
  ②独立 `vitest.config.ts` —— 需重复维护 alias 与插件，收益为负，否决。

## D3. 开发期联调方式

- **Decision**: 开发环境通过 Vite `server.proxy` 将 `/api` 代理到后端
  （`VITE_API_BASE_URL` 缺省为空串，请求走同源相对路径；`.env.example` 记录可覆盖项）。
- **Rationale**: 后端 `@fastify/cors` 虽已开启，但同源代理可避免 Cookie/Origin 差异并让前端代码
  只使用相对路径；生产部署时由反向代理统一挂载 `/api`，前端无需改动。
- **Alternatives considered**: ①前端直连 `http://localhost:3000` 并依赖 CORS —— 需要在代码与部署中
  硬编码跨域地址，环境切换成本高，否决；②引入 `axios` + baseURL —— 原生 `fetch` 已足够，否决。

## D4. 状态管理：composable 单例 + `provide/inject`

- **Decision**: 不引入 Pinia。跨组件共享状态由 **模块级 composable 单例** 承载：
  `useAppSession()` 在 `App.vue` 中创建一次并通过 `provide` 注入，子组件用 `inject` 取用；
  各领域 composable（`useThreads`、`useChatStream`、`useAgents`、`useModels`、`useUploads`、
  `useWorkspace`、`useSessionSearch`、`usePreview`、`useToast`）在注入上下文中实例化，对外暴露
  `readonly` 的 `ref`/`computed` 与显式 action 函数。
- **Rationale**: 满足"优先使用 Vue 3 原生能力"；本应用只有一个页面、一个会话上下文，
  Pinia 的 devtools/插件/多 store 能力均无使用场景；`provide/inject` + 工厂函数天然可按测试需要
  注入 `fetch` 桩与假时钟（对应后端 `RunManagerDeps.now` 的可测性思路）。
- **Alternatives considered**: ①Pinia —— 额外依赖且需为单页应用配置 store，收益为零，否决；
  ②`reactive()` 全局单例模块 —— 隐式全局状态难以在测试间隔离，否决；
  ③事件总线（`mitt`）—— 新增依赖，且状态流向不可追踪，否决。

## D5. SSE 客户端实现

- **Decision**: 使用 `fetch` + `response.body.getReader()` 手写流式读取，配合纯函数
  `src/utils/sse-parser.ts` 将文本块解析为 `{event, data}` 事件对象；
  解析器支持跨 chunk 的行缓冲（`event:` / `data:` 可能被 TCP 分片截断）。
  后端 `done` / `error` 事件为终结事件，读取循环据此结束。
- **Rationale**: 发消息端点是 **POST** 且需要请求体，浏览器原生 `EventSource` 只支持 GET 且无法自定义请求体，
  因此原生 API 不可用；引入 `eventsource-parser` 等库属非必要依赖（宪章原则六），
  而 SSE 行协议足够简单（`event:`/`data:` 两字段 + 空行分隔），手写解析器约 60 行且可完整单测。
- **Alternatives considered**: ①`EventSource` —— 不支持 POST，否决；②`@microsoft/fetch-event-source` ——
  新增依赖且其重连语义与后端"断连不续推"契约不符，否决；③轮询历史接口 —— 丧失流式体验（SC-002），否决。

## D6. 流式增量渲染策略

- **Decision**: `useChatStream` 维护 `streamingText` 与 `streamingThinking` 两个 `ref`；
  收到 `content` / `thinking` 事件时仅做字符串追加，**不触发额外计算**；
  消息列表在流式期间对当前气泡使用稳定 `key`，其余历史气泡以 `v-memo` 冻结重渲染。
  流式结束（`done`）后用服务端返回的完整历史刷新消息数组。
- **Rationale**: 追加式字符串拼接是 O(n) 且不产生逐字 DOM 重建；`v-memo` 让长会话在流式期间
  只重渲染当前气泡，满足宪章原则五（渲染路径无昂贵计算、单组件首渲 ≤100ms）。
  用 `done` 后的历史接口结果替换本地流式缓冲，可保证与落盘数据一致（含 `message_id`）。
- **Alternatives considered**: ①逐事件 `nextTick` 强制刷新 —— 高频事件下每字一帧，浪费，否决；
  ②虚拟滚动（`vue-virtual-scroller`）—— 新增依赖，且规范未要求超长会话，先用 `v-memo` + 分页控制规模，否决；
  ③Web Worker 处理分段渲染 —— 分段结果需跨线程传输，复杂度远超收益，否决。

## D7. 内容渲染：纯文本 + 链接识别 + 搜索高亮（不引入 Markdown）

- **Decision**: 助手与用户消息内容按**纯文本**渲染（`white-space: pre-wrap`），
  通过纯函数 `utils/segments.ts` 将原始文本一次性切分为有序分段数组：
  `{type:'text'|'link'|'mark'}`，模板用 `v-for` 渲染分段（`link` → `<a>`，`mark` → `<mark>`）。
  链接识别用 URL 正则（`http/https`），搜索高亮复用同一分段函数并传入当前关键词。
  不引入 `marked`、`markdown-it`、`DOMPurify`。
- **Rationale**: 规范只要求"外部地址直接跳转"与"匹配结果黄色高亮"，未要求 Markdown 排版；
  纯文本方案 **0 XSS 风险**（不产生 `v-html`，无需消毒库），同时把链接识别与高亮合并为**一次分段计算**，
  避免两套 DOM 变换互相干扰（这正是 `v-html` 方案难以处理搜索高亮的根因）。
- **Alternatives considered**: ①`marked` + `DOMPurify` —— 两个依赖、XSS 面扩大、且高亮需二次 DOM 遍历，否决；
  ②`v-html` + 字符串替换 —— 无法安全处理链接与高亮叠加，否决；
  ③CSS Custom Highlight API —— 免 DOM 改动，但样式与可测性弱于 `<mark>`，且分段方案已可覆盖，否决。

## D8. 搜索高亮的逐次跳转实现

- **Decision**: `useSessionSearch` 维护 `keyword`、`matches`（跨消息的匹配序号 → `{messageId, index}`）
  与 `activeIndex`；消息组件通过 `inject` 读取"当前活跃匹配"的定位信息，仅给活跃项附加
  `data-search-active` 与滚动锚点；"下一个"通过 `activeIndex = (activeIndex + 1) % total` 循环。
- **Rationale**: 匹配集合由内容分段函数产出（见 D7），跳转只需变更一个索引并调用
  `scrollIntoView({block:'center'})`，O(1) 更新；循环语义与 Word 查找一致（FR-030）。
- **Alternatives considered**: ①每次跳转重算全部匹配 —— 重复计算，否决；
  ②用 `window.find()` —— 非标准、无法控制高亮样式，否决。

## D9. 输入区与 `@` 引用交互

- **Decision**: 输入区使用原生 `<textarea>`。`useFileMention` 监听 `input` 与 `keydown`：
  当光标前一个字符为 `@` 时打开 `MentionPicker`（目录列表 → 文件列表，两段式）；
  选中文件后以 `@文件名` 文本替换触发符并重新定位光标；引用集合单独以数组维护
  （`{dir, filename}`），提交时随 `attachments` 发送；超过 10 个时拒绝继续添加并提示。
  键盘操作：`↑`/`↓` 移动、`Enter` 选中、`Esc` 关闭面板（不删除已输入文本）。
- **Rationale**: 原生 `<textarea>` 天然满足无障碍（可聚焦、可读屏、原生输入法支持），
  且 `selectionStart` 足以完成触发检测与插入；`contenteditable` 需要自行实现输入法、撤销栈、
  ARIA 与光标管理，风险远高于收益。引用与展示文本分离，保证"展示 @文件名、提交结构化 dir+filename"（FR-016）。
- **Alternatives considered**: ①`contenteditable` 富文本（可实现内联 chip）—— 复杂度与无障碍风险高，否决；
  ②引入 `tiptap`/`prosemirror` —— 重度依赖，违反依赖治理，否决；
  ③触发后弹独立"引用选择"对话框 —— 交互成本高于就地面板，否决。

## D10. 弹层与折叠：平台原生元素

- **Decision**: 模态（数字人明细/切换、工作空间文件）使用原生 `<dialog>` +
  `showModal()`（封装为 `BaseDialog.vue`）；思考内容折叠使用原生 `<details>`/`<summary>`
  （封装为 `ThinkingBlock.vue`）；下拉（模型选择、上传入口）用自建 `BaseDropdown.vue`
  （`aria-haspopup`/`aria-expanded` + roving tabindex + 外点关闭）。
- **Rationale**: `<dialog>` 自带焦点陷阱、Esc 关闭、`::backdrop` 与顶层渲染（无 z-index 战争）；
  `<details>` 自带展开/收起语义与键盘支持。二者让"键盘导航 + WAI-ARIA"（宪章原则四）几乎零成本达成。
  下拉因需自定义触发器样式与列表键盘导航，原生 `<select>` 无法承载，故自建。
- **Alternatives considered**: ①自建 Modal（`div` + `role="dialog"` + 手写焦点陷阱）—— 重复实现平台能力，否决；
  ②`<select>` 承载模型选择 —— 无法展示"默认"标识与自定义项结构，否决；
  ③引入 Headless UI / Element Plus —— 违反依赖治理，否决。

## D11. 样式方案

- **Decision**: 组件内一律 `<style scoped>`；设计令牌集中在 `src/styles/tokens.css`
  以 CSS 自定义属性定义（颜色、间距、圆角、字号、层级、动效时长），`base.css` 做最小重置，
  并在 `@media (prefers-reduced-motion: reduce)` 下关闭非必要动效。
  颜色与状态（成功/失败/进行中）通过语义变量表达（如 `--color-status-error`）。
- **Rationale**: 用户指定 Scoped CSS；令牌化让"红色=失败、绿色=连接正常"等状态色只定义一次，
  同时满足 `MCP 状态`、上传失败、消息失败等多处一致复用；不引入预处理器（原生 CSS 变量与嵌套已够用）。
- **Alternatives considered**: ①Tailwind —— 新增构建依赖与类名噪音，与 Scoped CSS 指定冲突，否决；
  ②Sass/PostCSS 插件 —— 无必要，否决；③CSS Modules —— Scoped CSS 已满足隔离需求，否决。

## D12. 文件上传与预览实现

- **Decision**: 上传用 `FormData` + `fetch`（`file`、`dir` 字段），支持一次多选并逐项展示状态
  （成功/失败原因/重试）。预览按扩展名分派（`utils/file-kind.ts`）：
  `.txt`/`.json`/`.csv` → `fetch` 文本 + `<pre>` 展示；`.pdf` → `<iframe :src>`；
  `.xlsx` → 直接触发下载（后端已回退 attachment）；
  后端返回 `413 FILE_TOO_LARGE` / `404 FILE_NOT_FOUND` → 预览区展示 `ErrorNotice` 并引导下载。
- **Rationale**: 全部走平台原生渲染能力，不引入 PDF.js 与表格解析库；与后端
  `GET /api/files/preview` 的 Content-Type 映射一一对应；`.xlsx` 无法内联，下载是最简正确解（与后端决策一致）。
- **Alternatives considered**: ①`pdfjs-dist` 渲染 PDF —— 依赖体积大（后端已用它做文本提取，前端不需要），否决；
  ②`xlsx` 前端解析为表格 —— 引入依赖且大文件卡顿，否决；③全部走下载 —— 不满足 FR-046 内联预览要求，否决。

## D13. 错误码到用户文案的映射

- **Decision**: `utils/error-message.ts` 维护后端错误码 → 中文文案的**唯一映射表**
  （`THREAD_RUN_ACTIVE`、`AGENT_NOT_SELECTED`、`THREAD_BUSY_LIMIT`、
  `POOL_EXHAUSTED`、`MODEL_NOT_FOUND`、`FILE_REF_NOT_FOUND`、`FILE_TOO_LARGE`、
  `UPLOAD_DIR_FORBIDDEN`、`FILE_NOT_FOUND`、`TMP_WRITE_FAILED` 等），
  未知码回退为通用文案 + 原码；所有提示统一经 `ErrorNotice` 或 `useToast` 呈现。
- **Rationale**: 后端统一错误体 `{error:{code,message}}`（见 `docs/api.md`），
  前端按 `code` 分派而非匹配 `message` 文案，避免后端措辞调整导致前端提示失效；
  集中一处便于穷举单测（边界：未知码、网络异常、非 JSON 响应）。
- **Alternatives considered**: ①直接展示后端 `message` —— 后端文案面向开发者、且不稳定，否决；
  ②每个调用点各自 if/else —— 重复且易漏，否决。

## D14. 无障碍与键盘导航落地要点

- **Decision**: 全站焦点可见（`:focus-visible` 描边）；列表与菜单使用 roving tabindex；
  流式与提示类内容使用 `aria-live="polite"`（`TypingIndicator`、`ToastHost`）；
  "思考中"动效对 `prefers-reduced-motion` 降级为静态文本；MCP 状态除颜色外同时提供文本
  （`连接正常`/`连接失败`），避免仅靠颜色传达信息；发送/中断按钮提供 `aria-disabled` 与禁用原因说明。
- **Rationale**: 直接对应 FR-051、SC-007 与宪章原则四；"颜色 + 文本"双通道满足色觉障碍可用性。
- **Alternatives considered**: 仅用颜色 + `title` —— 读屏与色觉障碍不可用，否决。

## D15. 测试策略

- **Decision**: Vitest（`environment: 'jsdom'`、`globals: true`）配置在 `vite.config.ts` 的 `test` 段。
  组件测试与组件**同目录同名**（`MessageBubble.vue` ↔ `MessageBubble.spec.ts`），
  每个组件至少覆盖：props 渲染、事件 emit、边界条件（空值/禁用态/失败态/超限）。
  网络层测试用 `vi.stubGlobal('fetch', ...)` 注入桩；SSE 用构造的 `ReadableStream` 桩驱动
  `useChatStream` 的状态机；纯函数（`sse-parser`、`segments`、`format`、`error-message`、`file-kind`）
  做表驱动单测。跨模块流程放 `tests/integration/`。覆盖率门禁 ≥80%（`src/api`、`src/composables`、`src/utils`）。
- **Rationale**: 满足宪章原则三的"一一对应 + 三类场景"；`jsdom` 30 对 `<dialog>`/`<details>` 有基本支持，
  对 `showModal()` 能力缺失处以 `BaseDialog` 的薄封装隔离，测试中以属性断言替代真实顶层渲染。
- **Alternatives considered**: ①Playwright 组件测试 —— 新增重型依赖且与"单元测试"要求不符，否决；
  ②`happy-dom` —— `jsdom` 对原生元素支持更完整，否决；③只测纯函数 —— 无法覆盖事件与边界，否决。

## D16. 前后端契约的单一来源

- **Decision**: 前端不复制后端 OpenAPI/契约文件，而是将其**翻译**为 `contracts/backend-api.md`
  （含前端使用约定：错误码映射、SSE 状态机、分页语义），并在 `src/api/types.ts` 中落为 TS 类型；
  目录集合（三空间与数据准备场景子目录）**不落前端常量**，一律以 `GET /api/files/workspace` 下发为唯一来源，
  仅保留无状态的结构判定纯函数 `src/utils/space.ts`（**2026-09-14 修订**：原为 `src/constants/directories.ts` 常量，该文件已删除）。
- **Rationale**: 后端契约（`agent-backend/specs/002-agent-chat-ui/contracts/`、`docs/api.md`）是权威来源，
  前端只需记录"我如何消费"；接口下发避免三处口径漂移，也免去前端随目录清单变更而改代码（对应 SC-021）。
- **Alternatives considered**: ①代码生成（openapi-typescript）—— 后端未提供 OpenAPI 文档，且新增依赖，否决；
  ②前端各组件内写死目录名 —— 三处口径易漂移，否决；
  ③前端常量白名单（原方案）—— 场景子目录随配置而变，常量必然与后端漂移，2026-09-14 已废止。

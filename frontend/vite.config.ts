import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '#': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    // 双栈监听：'::' 同时接受 IPv4（IPv4-mapped）。默认的 'localhost' 只绑到 ::1，
    // 一旦浏览器走 IPv4 回环，本机要 ~2s 丢包超时才回退（实测 127.0.0.1:5173 → 2.04s 失败）
    host: '::',
    proxy: {
      // 开发期把 /api 转发到后端，前端代码只使用同源相对路径（research.md D3）
      // target 直接写 IPv4：后端监听 IPv4，避免 Node 先解析到 ::1 再回退（实测 205ms~2s）
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/dataApi': {
        //后端服务地址（与 minimalist-vue3 一致）
        target: 'http://192.168.0.188:8080',
        //允许跨域
        changeOrigin: true,
        //规则匹配，去掉前缀转发
        rewrite: (path) => path.replace(/^\/dataApi/, '/api'),
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    // Phase 1 尚无测试用例，允许 0 用例通过（Checkpoint 要求 `npm run test` 可运行）
    passWithNoTests: true,
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/api/**/*.ts', 'src/composables/**/*.ts', 'src/utils/**/*.ts'],
      // `src/api/types.ts` 与 `src/composables/useChatStream.types.ts` 均为纯类型声明
      // （无运行期语句），计入分母无意义——与后端 `vitest.config.ts` 排除 `src/types.ts` 同口径。
      // 后者由 010（2026-10-16）为「契约与实现分离」拆出，与前者同性质：无可测行为。
      exclude: [
        'src/**/*.spec.ts',
        'src/api/types.ts',
        'src/composables/useChatStream.types.ts',
      ],
      // 宪章原则三：核心逻辑覆盖率 ≥ 80%
      //
      // 分两层（与 `agent-backend/vitest.config.ts` 同口径）：
      // ① 全局「防倒退地板」：略低于当前实测值，只用于发现整体下滑；
      // ② 模块阈值：受门禁约束的模块按 80% 真实校验——**新增或改动模块时 MUST 加入本清单**。
      //
      // 为什么不设全局 80%：`src/api/**`（7 个）与 `src/composables/**`（13 个）共 20 个模块尚无测试，
      // 而宪章「治理 § 适用范围与不追溯」禁止为存量代码发起覆盖率补齐专项，
      // 设全局 80% 只会得到一个长期红灯（红灯久了等同没有门禁）。
      // 010（2026-10-16）新增与拆出的模块**全部配了同名测试**，故该缺口数量不变（仍是 20）——
      // `useChatStream.ts` / `useChatPanel.ts` / `useThreads.ts` 属那 20 个之列，
      // 本次只覆盖了改动到的行为，整体分支/函数口径仍低于 80%，故**不登记模块阈值**
      // （登记即等于发起存量补齐专项）；其改动行为的覆盖证据见 `specs/010-*/tasks.md` 执行记录。
      // 该缺口的处置结论由宪章「同步影响报告 § 待办」跟踪，
      // **MUST NOT 把本配置当作该缺口已闭合的依据**。
      thresholds: {
        // ① 全局地板（防倒退）。2026-10-16 实测（011 增量后）：stmts 79.01 / branch 76.89 / funcs 70.72 / lines 79.77
        //    （011「预览面板放大 / 缩小」：新增 `useMaximizeEscape` 模块并补测至 96%+，另补齐
        //     `AppShell` / `BaseIcon` 两个改动文件此前缺失的同名测试，整体小幅上行，地板随之抬到实测值略下方；
        //     上一版为 76/74/66/77 @ 2026-10-16（010「聊天消息渲染与会话导出」：新增 `markdown` /
        //     `export-thread` / `download` / `useThrottledText` 四个模块并补测，另由三个超限文件的拆分
        //     产出 6 个模块并补测至 87%~100%，实测 78.01/75.87/68.80/78.69；
        //     再上一版 59/63/48/58 @ 2026-10-12（007「下一步动作提示」），
        //     更早 53/59/42/52 @ 2026-10-12，48/55/38/47 @ 2026-10-08，45/52/34/44 @ 2026-09-23）
        //    该地板 MUST 随 `api` / `composables` 逐步补测而上调，不得下调。
        statements: 77,
        branches: 75,
        functions: 69,
        lines: 78,

        // ② 受宪章 80% 门禁约束的模块（已充分覆盖；实测见各模块注释）
        'src/utils/space.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/file-kind.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/format.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/error-message.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/segments.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 92.55 / 86.53 / 100 / 92.22
        'src/utils/sse-parser.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 96.55 / 92.30 / 100 / 96.55
        // HITL 递归表单三件套（2026-09-23）：路径读写、schema 内省、值校验与提交构建
        'src/utils/json-path.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 98.07 / 95.12 / 100 / 100
        'src/utils/arg-schema.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 96.19 / 94.73 / 100 / 97.43
        'src/utils/arg-values.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 97.89 / 91.75 / 100 / 100
        'src/composables/useInteractionForm.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 96.33 / 83.63 / 100 / 100
        // 后台产出展示（2026-09-25 / 26）：元数据格式化 + 正文展示解析
        'src/utils/produced-display.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/produced-content.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // 工具调用的折叠展示（2026-10-08）：展示模型纯函数 + 跨组件实例的查看态
        'src/utils/tool-calls.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 93.75 / 100 / 100
        'src/composables/useToolPanels.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 100 / 100 / 100 / 100
        // 产出正文的视图链接（2026-10-10，TR-40~TR-43）：viewUrl 字段判定 + 值归一化（唯一实现）
        'src/utils/view-link.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // 同源地址「能否内联渲染」预检（2026-10-15）：读响应头判定 iframe 渲染 / 下载入口
        'src/utils/preview-probe.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // 右侧面板状态机（2026-10-15）：异源直跳 / 同源预检 / 本地文件按扩展名预览的分流
        // 2026-10-16（011）新增放大态与"可放大判据"后实测 94.69 / 84.90 / 100 / 94.59
        // （上一版 92.63 / 80.48 / 90.90 / 92.55；均由 `src/composables/usePreview.spec.ts` 覆盖）
        'src/composables/usePreview.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // 放大态的 Esc 两种载体（2026-10-16，011）：本页捕获监听 + 同源 iframe 文档转发
        'src/composables/useMaximizeEscape.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 96.55 / 95.45 / 100 / 96.29
        // `@` 引用浮层（2026-10-12，FR-102~106 / TR-01~02）：坐标计算纯函数 + 光标测量
        'src/utils/popup-position.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/caret-rect.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 92.85 / 100 / 100
        // 下一步动作提示（2026-10-12，007）：拉取时刻表与可见性判定 + 窗口调度 + 只读拉取封装
        'src/utils/next-steps.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/composables/useNextSteps.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 100 / 100 / 100 / 100
        'src/api/next-steps.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        // 聊天消息渲染与会话导出（2026-10-16，010）：最小 Markdown 子集 / 分段切分 /
        // 导出文本映射 / 下载落盘 / 流式渲染影子（阈值一律取宪章下限 80%，实测值备查）
        'src/utils/markdown.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 95.09 / 91 / 100 / 98.62
        'src/utils/export-thread.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 96.55 / 100 / 100
        'src/utils/download.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/composables/useThrottledText.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 90.47 / 87.5 / 100 / 90
        // 010 由三个超限文件拆分产出（2026-10-16）：滚动跟随与位置记忆 / HITL 闸门 /
        // 草稿分桶 / 存储读写 / `@` 引用接线 / 卡片确认弹窗
        'src/composables/useMessageScroll.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 94.94 / 80.39 / 100 / 100
        'src/composables/useInteractionGate.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 100 / 100 / 100 / 100
        'src/composables/useThreadDrafts.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 93.33 / 90.9 / 100 / 100
        'src/utils/thinking-storage.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 87.5 / 100 / 100 / 87.5
        'src/composables/useMentionComposer.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 100 / 100 / 100 / 100
        'src/composables/useNextStepPrompt.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        }, // 100 / 100 / 100 / 100
      },
    },
  },
})

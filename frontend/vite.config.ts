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
          rewrite: path => path.replace(/^\/dataApi/, '/api'),
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
      // `src/api/types.ts` 为纯类型声明（无运行期语句），计入分母无意义——与后端
      // `vitest.config.ts` 排除 `src/types.ts` 同口径。
      exclude: ['src/**/*.spec.ts', 'src/api/types.ts'],
      // 宪章原则三：核心逻辑覆盖率 ≥ 80%
      //
      // 分两层（与 `agent-backend/vitest.config.ts` 同口径）：
      // ① 全局「防倒退地板」：略低于当前实测值，只用于发现整体下滑；
      // ② 模块阈值：受门禁约束的模块按 80% 真实校验——**新增或改动模块时 MUST 加入本清单**。
      //
      // 为什么不设全局 80%：`src/api/**`（7 个）与 `src/composables/**`（13 个）共 20 个模块尚无测试，
      // 而宪章「治理 § 适用范围与不追溯」禁止为存量代码发起覆盖率补齐专项，
      // 设全局 80% 只会得到一个长期红灯（红灯久了等同没有门禁）。
      // 该缺口的处置结论由宪章「同步影响报告 § 待办」跟踪，
      // **MUST NOT 把本配置当作该缺口已闭合的依据**。
      thresholds: {
        // ① 全局地板（防倒退）。2026-10-12 实测：stmts 60.05 / branch 64.98 / funcs 49.20 / lines 59.36
        //    （007「下一步动作提示」增量：新增 `utils/next-steps` / `api/next-steps` /
        //     `composables/useNextSteps` 三个模块并补测至满覆盖，整体上行，地板随之抬到实测值略下方；
        //     上一版为 53/59/42/52 @ 2026-10-12（`@` 引用浮层与 HITL 口径统一），
        //     再上一版 48/55/38/47 @ 2026-10-08，45/52/34/44 @ 2026-09-23）
        //    该地板 MUST 随 `api` / `composables` 逐步补测而上调，不得下调。
        statements: 59,
        branches: 63,
        functions: 48,
        lines: 58,

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
        'src/composables/useInteractionForm.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 96.33 / 83.63 / 100 / 100
        // 后台产出展示（2026-09-25 / 26）：元数据格式化 + 正文展示解析
        'src/utils/produced-display.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/produced-content.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // 工具调用的折叠展示（2026-10-08）：展示模型纯函数 + 跨组件实例的查看态
        'src/utils/tool-calls.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 93.75 / 100 / 100
        'src/composables/useToolPanels.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        // 产出正文的视图链接（2026-10-10，TR-40~TR-43）：viewUrl 字段判定 + 值归一化（唯一实现）
        'src/utils/view-link.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // `@` 引用浮层（2026-10-12，FR-102~106 / TR-01~02）：坐标计算纯函数 + 光标测量
        'src/utils/popup-position.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/caret-rect.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 92.85 / 100 / 100
        // 下一步动作提示（2026-10-12，007）：拉取时刻表与可见性判定 + 窗口调度 + 只读拉取封装
        'src/utils/next-steps.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/composables/useNextSteps.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/api/next-steps.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
      },
    },
  },
})

import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
        // ① 全局地板（防倒退）。2026-09-23 实测：stmts 46.18 / branch 53.19 / funcs 35.36 / lines 45.30
        //    （新增 HITL 表单三件套后大幅上行，地板随之抬到实测值略下方）
        //    该地板 MUST 随 `api` / `composables` 逐步补测而上调，不得下调。
        statements: 45,
        branches: 52,
        functions: 34,
        lines: 44,

        // ② 受宪章 80% 门禁约束的模块（已充分覆盖；实测见各模块注释）
        'src/utils/space.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/file-kind.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/format.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/error-message.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 100 / 100 / 100 / 100
        'src/utils/segments.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 92.55 / 86.53 / 100 / 92.22
        'src/utils/sse-parser.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 96.55 / 92.30 / 100 / 96.55
        // HITL 递归表单三件套（2026-09-23）：路径读写、schema 内省、值校验与提交构建
        'src/utils/json-path.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 98.07 / 95.12 / 100 / 100
        'src/utils/arg-schema.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 95.65 / 94.11 / 100 / 97.10
        'src/utils/arg-values.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 97.89 / 91.75 / 100 / 100
        'src/composables/useInteractionForm.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }, // 96.33 / 83.63 / 100 / 100
      },
    },
  },
})

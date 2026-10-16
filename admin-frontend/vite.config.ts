import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * 管理界面构建配置。
 *
 * - `base: '/admin/'`：静态资源与路由基址。管理界面由网关挂在 `/admin/` 下
 *   （`research.md` D10），资源路径必须带前缀，否则在子路径下会 404。
 * - 开发期 `proxy` 把 `/api/admin` 转发到管理服务（本地 :3001）；生产由网关分发。
 */
export default defineConfig({
  base: '/admin/',
  plugins: [vue()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5174,
    // 双栈监听：避免浏览器走 IPv4 回环时的连接回退延迟（与 frontend 同口径）
    host: '::',
    proxy: {
      '/api/admin': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/api/**/*.ts', 'src/composables/**/*.ts', 'src/utils/**/*.ts', 'src/router.ts'],
      // `src/api/types.ts` 为纯类型声明（无运行期语句），计入分母无意义
      exclude: ['src/**/*.spec.ts', 'src/api/types.ts'],
      // 两层阈值（与 `frontend/vite.config.ts`、`agent-backend/vitest.config.ts` 同口径）：
      // ① 全局「防倒退地板」；② 受宪章 80% 门禁约束的模块清单。
      thresholds: {
        // ① 全局地板（防倒退）。2026-10-15 实测：stmts 98.14 / branch 94.19 / funcs 100 / lines 98.37
        //    （2026-10-12 的实测是 95.31 / 93.21 / 88.79 / 95.46，其中 funcs 不达 95，
        //     原因是 `src/api/skills.ts` 的 3 个本体市场函数与 `src/api/ontologies.ts` 的 6 个函数
        //     没有任何 spec 直接调用（其消费方 spec 一律 `vi.mock` 掉这些模块）——
        //     已于 2026-10-15 补齐 `modules.spec.ts` 的请求形状断言后归零，见 `specs/001-digital-human-platform/tasks.md`
        //     §「维护性修复（2026-10-15）：§11 两个错误码补登 + `admin-frontend` 覆盖率门禁归零」；
        //     地板此次**维持不变**——按"实测值略下方"上调留待下一次按实测复核，
        //     避免把地板抬到会挡住并发在途改动的水平）。
        //    地板只可上调（原则三）。
        statements: 94,
        branches: 92,
        functions: 95,
        lines: 94,

        // ② 受宪章 80% 门禁约束的模块（新增或改动时 MUST 加入本清单）
        'src/router.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/error-message.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useAsync.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useAgentDesign.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/composables/useDeploy.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useSkills.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useMcpServices.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/api/http.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/api/agents.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/api/builtin-tools.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/api/deploy.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/api/mcp.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/api/platform.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/api/skills.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/api/users.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
})

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
      exclude: ['src/**/*.spec.ts', 'src/api/types.ts'],
      thresholds: {
        //     避免把地板抬到会挡住并发在途改动的水平）。
        statements: 94,
        branches: 92,
        functions: 95,
        lines: 94,

        'src/router.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/clipboard.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
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

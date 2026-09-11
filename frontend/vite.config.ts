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
      exclude: ['src/**/*.spec.ts'],
      // 宪章原则三：核心逻辑覆盖率 ≥ 80%
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})

import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * 联调（live）测试配置——**不进常规门禁**。
 *
 * 与 `vite.config.ts` 的关键差异：
 * - `include` 只匹配 `tests/live/**\/*.live.ts`（常规 `npm run test` 匹配 `*.spec.ts`，两者互不干扰）
 * - 需要**真实后端**在 `127.0.0.1:3000`：由 `tests/live/global-setup.ts` 自动起停（已在跑则复用）
 * - 会**真实调用 LLM**（消耗 API 额度、单条数十秒），因此 `testTimeout` 放宽到 180s
 * - 文件串行执行：避免同一数字人并发 run 上限（3）干扰断言
 *
 *   npm run test:live
 */
export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/live/**/*.live.ts'],
    globalSetup: ['tests/live/global-setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})

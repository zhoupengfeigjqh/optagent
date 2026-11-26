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
    // 一旦浏览器走 IPv4 回环，本机要 ~2s 丢包超时才回退（实测 127.0.0.1:5173 → 2.04s 失败）
    host: '::',
    proxy: {
      // 平台侧接口（登录/登出/会话探针，`contracts/auth-api.md`）**必须**转给管理服务，
      // 不能落进下面那条 `/api` → 3000：运行侧（agent-backend）的全局鉴权钩子会把
      // 顺序有意义：Vite 按声明顺序匹配，`/api/admin` 必须排在 `/api` 之前。
      '/api/admin': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      // target 直接写 IPv4：后端监听 IPv4，避免 Node 先解析到 ::1 再回退（实测 205ms~2s）
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/dataApi': {
        target: 'http://192.168.0.188:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dataApi/, '/api'),
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/api/**/*.ts', 'src/composables/**/*.ts', 'src/utils/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/api/types.ts', 'src/composables/useChatStream.types.ts'],
      // 为什么不设全局 80%：`src/api/**`（7 个）与 `src/composables/**`（13 个）共 20 个模块尚无测试，
      // 而宪章「治理 § 适用范围与不追溯」禁止为存量代码发起覆盖率补齐专项，
      // **MUST NOT 把本配置当作该缺口已闭合的依据**。
      thresholds: {
        //    该地板 MUST 随 `api` / `composables` 逐步补测而上调，不得下调。
        statements: 81,
        branches: 78,
        functions: 74,
        lines: 82,

        'src/utils/space.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/file-kind.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/format.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/error-message.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/segments.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/sse-parser.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/json-path.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/arg-schema.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/arg-values.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useInteractionForm.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/utils/produced-display.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/produced-content.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/tool-calls.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useToolPanels.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/utils/view-link.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/preview-probe.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/usePreview.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useMaximizeEscape.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/utils/popup-position.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/caret-rect.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/next-steps.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useNextSteps.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/api/next-steps.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        // 导出文本映射 / 下载落盘 / 流式渲染影子（阈值一律取宪章下限 80%，实测值备查）
        'src/utils/markdown.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/export-thread.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/utils/download.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useThrottledText.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/composables/useMessageScroll.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/composables/useInteractionGate.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/composables/useThreadDrafts.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/utils/thinking-storage.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/composables/useMentionComposer.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/composables/useNextStepPrompt.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 发送前的 MCP 就绪门（2026-10-18）：灰色等待 + 超时降级放行 + 等待态开关
        'src/composables/useMcpReadyGate.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // - `useUploadPanel` 是本次**新增**模块 ⇒ 按原则三配同名测试（成功回写 / 收起清空 / 顺序 / 上限）；
        'src/composables/useUploadPanel.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/composables/useUploads.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
})

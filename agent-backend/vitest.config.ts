import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/domain/intent-focus/types.ts', '**/*.d.ts'],
      thresholds: {
        //    "地板 = 实测值略下方"的口径抬到 66/61/65/67。地板只可上调，不得下调。
        statements: 66,
        branches: 61,
        functions: 65,
        lines: 67,

        'src/domain/dirs.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/builtin-tool-catalog.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/config-fingerprint.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-09-16：MCP 传输方式归一（兼容 `streamable-http` 别名）
        'src/domain/mcp-transport.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/file-arg-path.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-10-15：LLM 失败分类（唯一实现；两条调用路径共用，判据必须被逐类钉住）
        'src/domain/llm-error.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/routes/builtin-tools.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/routes/mcp-call-stats.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/infra/file-sign.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/infra/mcp/async-result-url.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/infra/mcp/mcp-schema-view.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/produced.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/produced-events.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/prompt-builder.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/tmp-cleanup.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/routes/produced.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/view-links.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/infra/mcp/mcp-result-text.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/next-actions.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/run-finalize.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-10-14（009）：存量数据布局迁移（三判定 / 逐项改名 / 可中断续跑 / 幂等）
        'src/domain/data-migration.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/agent-scope.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/scenario.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/intent-focus/state.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/intent-focus/runner.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-10-25（013）：留档存储（串行追加 / 有界滚动 / 原子替换）
        'src/domain/intent-focus/store.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/skill-header.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/intent-focus/ontology-loader.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-11-04（016）：候选构造与题面（qid / 分批 / 上限）
        'src/domain/intent-focus/candidates.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/intent-focus/selection.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/intent-focus/prompt.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/intent-focus/record.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/infra/laya-client.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/intent-focus/rewrite-prompt.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        //   编排层：开关 → 判定 → 改写 → 归一 → 降级 → 计时 —— 实测 stmts 94.33 / branch 91.89
        'src/domain/intent-focus/rewrite.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        //   LLM 适配：tools 空 / thinking 关 / 超时与中止可区分 / 请求级模型 —— 实测 stmts 95.45 / branch 84.61
        'src/infra/rewrite-llm.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});

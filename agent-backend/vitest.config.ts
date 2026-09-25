/**
 * Vitest 配置（后端）：覆盖率门禁
 *
 * 口径来自宪章，两条款必须一起读：
 * - 原则三：核心业务逻辑语句覆盖率 MUST ≥ 80%，低于阈值即视为任务未完成；
 * - 治理「适用范围与不追溯」：门禁只作用于**新增**文件与**本次改动涉及**的文件/模块，
 *   且 MUST NOT 为满足门禁而发起针对存量代码的覆盖率补齐专项。
 *
 * 因此**不设全局 80%**：存量代码整体仅约 20%，设全局阈值会第一天就红，
 * 而按「不追溯」又不允许为了变绿去补存量测试——那只会让门禁被无视。
 * 改为两层：
 *
 * ① **全局地板（防倒退）**：略低于当前实测值，只用于发现"覆盖率整体下滑"。
 *    调整它 MUST 有明确理由（如新增了尚未被测试加载的模块）。
 * ② **模块阈值**：受门禁约束的模块在 `thresholds` 中以路径为键、按 80% 校验。
 *    **新增或改动模块时，MUST 把该模块加进这个清单**——这是门禁真正咬人的地方。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      // 纯类型声明文件无运行期语句，计入分母无意义
      exclude: ['src/types.ts', '**/*.d.ts'],
      thresholds: {
        // ① 全局地板（防倒退）。当前实测：stmts 21.1 / branch 13.1 / funcs 20.0 / lines 22.6
        statements: 20,
        branches: 12,
        functions: 19,
        lines: 21,

        // ② 受宪章 80% 门禁约束的模块（在本次改动中已被充分覆盖）
        //    形如：'src/domain/xxx.ts': { statements: 80, branches: 80, functions: 80, lines: 80 }
        'src/domain/dirs.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 本特性新增（R1：内置工具目录单一来源）
        'src/domain/builtin-tool-catalog.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 本特性新增（R7：数字人配置"变化即失效"）
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
        // 2026-09-16：file_args 取值路径（对象数组里的字段也要能铸造签名直链）
        'src/domain/file-arg-path.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 本特性新增（R2/R4：两个只读端点）
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
        // 2026-09-25（R11 阶段 1）：签名写方向（与读方向形状隔离）
        'src/infra/file-sign.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-09-25（R11 阶段 1）：异步工具的 `result_url` 注入
        'src/infra/mcp/async-result-url.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-09-25（R11 阶段 1）：schema 视图裁剪（从适配器抽出，本次复用其隐藏机制）
        'src/infra/mcp/mcp-schema-view.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-09-25（R11 阶段 1）：后台产出（落盘 / 目录即索引 / 提示词段）
        'src/domain/produced.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-09-25（R11 阶段 1）：产出变更信号总线
        'src/domain/produced-events.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-09-25（R11 阶段 1）：prompt 组装（从 run-manager 抽出，含产出段）
        'src/domain/prompt-builder.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-09-25（R11 阶段 1）：产出目录纳入 7 天清理
        'src/domain/tmp-cleanup.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // 2026-09-25（R11 阶段 1）：产出列表与变更信号端点
        'src/routes/produced.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});

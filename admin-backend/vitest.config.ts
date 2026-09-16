/**
 * Vitest 配置（管理服务）：覆盖率门禁
 *
 * 结构与 `agent-backend/vitest.config.ts` 同构，两层阈值：
 * ① **全局地板（防倒退）**：略低于当前实测值，只用于发现"覆盖率整体下滑"；
 * ② **受约束模块阈值**：新增/改动的 `domain/`、`infra/` 模块按 80% 校验
 *    （宪章原则三：核心业务逻辑语句覆盖率 MUST ≥ 80%）。
 *
 * **新增或改动模块时 MUST 把该模块加进 ② 的清单**——这是门禁真正咬人的地方。
 * 本地执行（宿主机），容器不参与（宪章原则三）。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', '**/*.d.ts'],
      thresholds: {
        // ① 全局地板（防倒退）。实测：stmts 94.14 / branch 84.16 / funcs 95.83 / lines 95.4
        //    地板只可上调（原则三 / 治理 § 不追溯）。
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,

        // ② 受宪章 80% 门禁约束的模块（本次新增/改动且已被充分覆盖）
        'src/domain/error-codes.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/api-error.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/platform-settings.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/config-center/agent-design.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/config-center/references.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/config-center/user-links.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/mcp/service-config.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/mcp/file-arg-path.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/mcp/transport.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/mcp/service-list.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/skill-library/metadata.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/skill-library/archive.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/skill-library/install.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/skill-library/file-access.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/deploy/precheck.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/deploy/materialize.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/deploy/manifest.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/deploy/history.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/infra/platform-store.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/infra/fs-probe.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/infra/compose-reader.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/infra/opt-agent-writer.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/infra/docker-host.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});

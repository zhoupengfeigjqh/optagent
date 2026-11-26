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
        statements: 91,
        branches: 82,
        functions: 94,
        lines: 93,

        'src/domain/error-codes.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/api-error.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/platform-settings.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/config-center/agent-design.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/config-center/references.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/config-center/user-links.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/mcp/service-config.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/mcp/file-arg-path.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/mcp/transport.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/mcp/service-list.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/skill-library/metadata.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/skill-library/archive.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/skill-library/install.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/skill-library/file-access.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/domain/deploy/precheck.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/domain/deploy/materialize.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
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

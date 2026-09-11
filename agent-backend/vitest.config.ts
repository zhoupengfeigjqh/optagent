import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // ESM 源码按 NodeNext 用 .js 后缀引用，测试时映射回 .ts
    alias: [{ find: /^(\.{1,2}\/[^'"]*)\.js$/, replacement: '$1.ts' }],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});

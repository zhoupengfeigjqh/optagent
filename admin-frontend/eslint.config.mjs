/**
 * ESLint 配置（管理界面，flat config）
 *
 * 与 `frontend/eslint.config.mjs` 同构：官方推荐集 + Vue 3 推荐集 + Prettier 兼容层。
 * 用 `.mjs` 而非 `.ts`（ESLint 加载 TS 配置需 `jiti`，按原则六不引入）。
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `coverage-*/` 与 `.gitignore` 同一口径：覆盖率产物目录（如 `coverage-run-9/`、
  // `.coverage-gate/`）是生成的 HTML 报告，纳入 lint 只会刷出无意义的 warning
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'coverage-*/**', '.coverage-gate/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      // TypeScript 项目里 `no-undef` 冗余且误报（未定义标识符由 vue-tsc 负责）
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  prettier,
);

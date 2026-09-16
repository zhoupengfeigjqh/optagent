/**
 * ESLint 配置（管理服务，flat config）
 *
 * 与 `agent-backend/eslint.config.mjs` 同构：用 `.mjs` 而非 `.ts`
 * （ESLint 加载 TS 配置需要额外安装 `jiti`，按宪章原则六不引入）。
 * 规则集取官方推荐的最小可用组合，先让门禁"能跑、结论可信"。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 门禁脚本是 Node 的 ESM 入口（`scripts/*.mjs`）：声明其运行期全局，
    // 而不是为了迎合默认规则去引 `globals` 包（原则六：不引入非必要依赖）。
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    rules: {
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
);

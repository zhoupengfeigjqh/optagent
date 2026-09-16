/**
 * ESLint 配置（后端，flat config）
 *
 * 背景：仓库此前**缺少本文件**，而 ESLint 9+ 只认 `eslint.config.*`，
 * 因此 `npm run lint` 必然以退出码 2 失败（配置找不到），
 * 宪章「开发工作流与质量门禁」列出的 `npm run lint` 长期无法执行。
 *
 * 用 `.mjs` 而非 `.ts`：ESLint 加载 TS 配置需要额外安装 `jiti`，
 * 而按宪章原则六（MUST NOT 引入非必要第三方依赖），此处用原生 ESM 即可，零新增依赖。
 *
 * 规则集取官方推荐的最小可用组合，不叠加自定义规则——
 * 先让门禁"能跑、结论可信"，再按需要逐条收紧。
 *
 * 口径：按宪章「治理 § 适用范围与不追溯」，门禁只对**新增**与**本次改动涉及**的
 * 文件/模块生效，存量代码的历史告警不强制一次性清零。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 代码库既有约定：以下划线前缀标记"有意不使用"的参数/变量（如 getCurrentUser(_auth)、
      // async (_req) =>）。TypeScript 生态的通用惯例，此处把约定告知 linter，
      // 而不是改代码去迎合默认规则。
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

/**
 * ESLint 配置（前端，flat config）
 *
 * 背景：仓库此前**缺少本文件**，而 ESLint 9+ 只认 `eslint.config.*`，
 * 因此 `npm run lint` 必然以退出码 2 失败（配置找不到），
 * 而 package.json 里 `eslint`、`eslint-plugin-vue`、`eslint-config-prettier`、
 * `typescript-eslint` 早已备齐——门禁长期无法执行。
 *
 * 用 `.mjs` 而非 `.ts`：ESLint 加载 TS 配置需要额外安装 `jiti`，
 * 按宪章原则六（MUST NOT 引入非必要第三方依赖），此处用原生 ESM 即可。
 *
 * 组合：官方推荐集 + Vue 3 推荐集 + Prettier 兼容层（关掉与 Prettier 冲突的格式规则，
 * 因为本项目用 `format:check` 单独管格式）。
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      // 覆盖率**产物目录**（`coverage-verify/`、`.coverage-gate/` 等）：生成物纳入 lint 只会刷出
      // 与源码无关的问题（2026-10-08 补，与 `admin-frontend/eslint.config.mjs` 同口径）
      'coverage-*/**',
      '.coverage-*/**',
      // 第三方 vendored 静态资源（甘特图组件自带的 Highcharts 及其扩展，共 22k+ 行）。
      // 它们不是本项目代码，且是压缩/老式写法：实测 1952 条问题里 1815 条出自这里
      // （1558 条 `no-unused-expressions`、156 条 `no-this-alias`），只会淹没真问题。
      // 这类文件永远不该被 lint；改动它们也不归本仓库维护（2026-09-28）。
      'src/components/z-gantt/static/**',
    ],
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
      // TypeScript 项目里 `no-undef` 是冗余且误报的（typescript-eslint 官方建议关闭）：
      // 未定义标识符由 tsc/vue-tsc 负责，且 TS 能区分"类型"与"运行期值"。
      'no-undef': 'off',

      // 具名例外：`Composer.vue`。该规则的用意是避免组件名与原生 HTML 元素冲突，
      // 而 `Composer` 不是任何 HTML 元素；它在本项目里是与 `ComposerToolbar` 配套的
      // 领域术语（消息撰写区），改名反而会破坏这对命名的语义。
      // 规则本身保持开启，仅登记这一个例外（不用整条关闭）。
      'vue/multi-word-component-names': ['error', { ignores: ['Composer'] }],

      // 代码库既有约定：以下划线前缀标记"有意不使用"的参数/变量。
      // 把约定告知 linter，而不是改代码去迎合默认规则。
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

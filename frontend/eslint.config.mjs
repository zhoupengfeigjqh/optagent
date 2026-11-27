import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'coverage-*/**',
      '.coverage-*/**',
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
      'no-undef': 'off',

      // 具名例外：`Composer.vue`。该规则的用意是避免组件名与原生 HTML 元素冲突，
      'vue/multi-word-component-names': ['error', { ignores: ['Composer'] }],

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
  {
    // 理由：宪章「治理 § 适用范围与不追溯」禁止借改动之机对无关存量做大范围重构；该决定已登记在
    files: [
      'src/components/z-gantt/**',
      'src/components/z-gantt-table/**',
      'src/components/z-table/**',
      'src/views/datapage/**',
      'src/views/demo/**',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'vue/multi-word-component-names': 'off',
    },
  },
  prettier,
)

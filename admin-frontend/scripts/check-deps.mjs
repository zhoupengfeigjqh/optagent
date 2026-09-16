#!/usr/bin/env node
/**
 * 硬门禁：依赖清单比对（宪章原则六：MUST NOT 引入未登记依赖）
 *
 * `research.md` D9 的最小实现——零依赖，把本子项目 `package.json` 的
 * `dependencies` / `devDependencies` 与 `research.md` D2 的登记清单逐一比对，
 * 出现**未登记依赖**即非零退出。
 *
 * 白名单来源：`specs/001-digital-human-platform/research.md` § D2
 * （管理界面为**零第三方运行时依赖**，唯一 `dependencies` 是 `vue`）。
 * 与 `admin-backend/scripts/check-deps.mjs` **MUST 保持对称**（原则八）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** D2 登记：管理界面零第三方运行时依赖 */
const ALLOWED_DEPENDENCIES = new Set(['vue']);

/** D2 登记的开发依赖（版本与既有 `frontend` 一致） */
const ALLOWED_DEV_DEPENDENCIES = new Set([
  '@eslint/js',
  '@types/node',
  '@vitejs/plugin-vue',
  '@vitest/coverage-v8',
  '@vue/test-utils',
  'eslint',
  'eslint-config-prettier',
  'eslint-plugin-vue',
  'jsdom',
  'prettier',
  'typescript',
  'typescript-eslint',
  'vite',
  'vitest',
  'vue-tsc',
]);

const pkgPath = path.join(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const violations = [];
for (const [kind, allowed] of [
  ['dependencies', ALLOWED_DEPENDENCIES],
  ['devDependencies', ALLOWED_DEV_DEPENDENCIES],
]) {
  for (const name of Object.keys(pkg[kind] ?? {})) {
    if (!allowed.has(name)) violations.push(`${kind}: ${name}`);
  }
}

if (violations.length > 0) {
  console.error('[check:deps] 出现 research.md D2 未登记的依赖（原则六），请先登记再引入：');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log('[check:deps] 通过：全部依赖均已在 research.md D2 登记');

#!/usr/bin/env node
/**
 * 硬门禁：依赖清单比对（宪章原则六：MUST NOT 引入未登记依赖）
 *
 * `research.md` D9 的最小实现——零依赖，把本子项目 `package.json` 的
 * `dependencies` / `devDependencies` 与 `research.md` D2 的登记清单逐一比对，
 * 出现**未登记依赖**即非零退出。
 *
 * 白名单来源：`specs/001-digital-human-platform/research.md` § D2 与 § D7。
 * 与 `admin-frontend/scripts/check-deps.mjs` **MUST 保持对称**（原则八）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** D2 + D7 登记的运行时依赖 */
const ALLOWED_DEPENDENCIES = new Set([
  'fastify',
  '@fastify/cors',
  '@fastify/multipart',
  'zod',
  'pino',
  'pino-pretty',
  'yaml',
  '@modelcontextprotocol/sdk',
  'yauzl', // D7：唯一新增依赖（SKILL ZIP 安全解压）
]);

/** D2 登记的开发依赖 */
const ALLOWED_DEV_DEPENDENCIES = new Set([
  'typescript',
  'eslint',
  '@eslint/js',
  'typescript-eslint',
  'prettier',
  'vitest',
  '@vitest/coverage-v8',
  'tsx',
  '@types/node',
  '@types/yauzl',
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
  console.error('[check:deps] 出现 research.md D2/D7 未登记的依赖（原则六），请先登记再引入：');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log('[check:deps] 通过：全部依赖均已在 research.md D2/D7 登记');

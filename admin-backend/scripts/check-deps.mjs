#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ALLOWED_DEPENDENCIES = new Set([
  'fastify',
  '@fastify/cors',
  '@fastify/multipart',
  'zod',
  'pino',
  'pino-pretty',
  '@modelcontextprotocol/sdk',
  'yauzl', // D7：SKILL ZIP 安全解压
  'yaml',
  'jose',
]);

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

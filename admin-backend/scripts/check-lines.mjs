#!/usr/bin/env node
/**
 * 硬门禁：单文件行数 ≤ 500（宪章原则二）
 *
 * `research.md` D9 的最小实现——零依赖，遍历 `src/**` 与 `tests/**` 的
 * `.ts` / `.vue` / `.js` / `.mjs`，任一文件超过 500 行即以非零退出码失败。
 *
 * 与 `admin-frontend/scripts/check-lines.mjs` **MUST 保持对称**（原则八）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const MAX_LINES = 500;
const SCAN_DIRS = ['src', 'tests'];
const EXTS = new Set(['.ts', '.vue', '.js', '.mjs']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'coverage', '.tmp']);

/** 递归收集待检文件（相对仓库子项目根的路径） */
function collect(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      collect(full, out);
    } else if (EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

const root = process.cwd();
const files = [];
for (const dir of SCAN_DIRS) collect(path.join(root, dir), files);

const offenders = [];
for (const file of files) {
  // 按 \n 计数即可满足门禁口径（CRLF 同样按一行计）
  const lines = fs.readFileSync(file, 'utf8').split('\n').length;
  if (lines > MAX_LINES) offenders.push({ file: path.relative(root, file), lines });
}

if (offenders.length > 0) {
  console.error(`[check:lines] 以下文件超过 ${MAX_LINES} 行（原则二），请拆分：`);
  for (const o of offenders) console.error(`  ${o.lines} 行  ${o.file}`);
  process.exit(1);
}

console.log(`[check:lines] 通过：${files.length} 个文件均未超过 ${MAX_LINES} 行`);

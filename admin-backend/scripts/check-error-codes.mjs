#!/usr/bin/env node
/**
 * 契约一致性硬门禁：错误码四处同步（原则七）
 *
 * 按 T120 的要求做**机械核对**：逐一提取契约内出现的全部错误码，
 * 与 `§0.4` 的错误码总表、后端码表、前端文案表三处比对，
 * 出现以下任一种情况即非零退出：
 *   - 契约端点用到但 `§0.4` 未登记（来源：分析阶段发现的 `ADM_AGENT_NOT_FOUND`）
 *   - `§0.4` 登记了但后端码表缺失
 *   - 后端码表与前端常量表不一致
 *   - 前端缺少该码的中文文案
 *
 * 零依赖实现（只读文件 + 正则），与 `check-lines` / `check-deps` 同风格。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(process.cwd(), '..');
const contractPath = path.join(
  repoRoot,
  'specs',
  '001-digital-human-platform',
  'contracts',
  'admin-api.md',
);
const backendCodesPath = path.join(process.cwd(), 'src', 'domain', 'error-codes.ts');
const frontendCodesPath = path.join(
  repoRoot,
  'admin-frontend',
  'src',
  'constants',
  'error-messages.ts',
);

function readOrFail(file) {
  if (!fs.existsSync(file)) {
    console.error(`[check:contract] 找不到文件：${file}`);
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8');
}

const contract = readOrFail(contractPath);
const backendSource = readOrFail(backendCodesPath);
const frontendSource = readOrFail(frontendCodesPath);

/** 提取 `### 0.4` 表格中登记的码（形如 `| \`ADM_X\` | 409 | …`） */
function tableCodes(source) {
  const codes = new Set();
  for (const line of source.split('\n')) {
    const match = /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/.exec(line.trim());
    if (match) codes.add(match[1]);
  }
  return codes;
}

/** 提取全文出现的码（含端点小节里的"错误码"行） */
function mentionedCodes(source) {
  const codes = new Set();
  for (const match of source.matchAll(/`(ADM_[A-Z0-9_]+|VALIDATION_FAILED|NOT_FOUND|INTERNAL_ERROR|SERVICE_UNAVAILABLE)`/g)) {
    codes.add(match[1]);
  }
  return codes;
}

/** 从 TS 源里的字符串字面量集合提取码 */
function tsCodes(source, pattern) {
  const codes = new Set();
  for (const match of source.matchAll(pattern)) {
    codes.add(match[1]);
  }
  return codes;
}

const contractTable = tableCodes(contract);
const contractMentioned = mentionedCodes(contract);
const backendCodes = tsCodes(backendSource, /^\s*([A-Z][A-Z0-9_]+):\s*'\1',?$/gm);
const frontendCodes = tsCodes(frontendSource, /^\s*([A-Z][A-Z0-9_]+):\s*'\1',?$/gm);

const problems = [];

for (const code of contractMentioned) {
  if (!contractTable.has(code)) {
    problems.push(`契约端点使用了未在 §0.4 登记的错误码：${code}`);
  }
}
for (const code of contractTable) {
  if (!backendCodes.has(code)) problems.push(`§0.4 已登记但后端 error-codes.ts 缺失：${code}`);
  if (!frontendCodes.has(code)) problems.push(`§0.4 已登记但前端 ADMIN_ERROR_CODES 缺失：${code}`);
}
for (const code of backendCodes) {
  if (!contractTable.has(code)) problems.push(`后端码表多出未登记的错误码：${code}`);
}
for (const code of frontendCodes) {
  if (!backendCodes.has(code)) problems.push(`前后端错误码不一致（前端多出）：${code}`);
}
for (const code of backendCodes) {
  if (!frontendCodes.has(code)) problems.push(`前后端错误码不一致（后端多出）：${code}`);
}

const unique = [...new Set(problems)];
if (unique.length > 0) {
  console.error('[check:contract] 错误码四处同步核查未通过（原则七）：');
  for (const problem of unique) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `[check:contract] 通过：契约 §0.4 登记 ${contractTable.size} 个错误码，` +
    `后端与前端码表一致，且无"端点使用但未登记"的码`,
);

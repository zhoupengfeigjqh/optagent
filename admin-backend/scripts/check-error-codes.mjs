#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(process.cwd(), '..');
const contractPath = path.join(repoRoot, 'specs', '001-digital-human-platform', 'contracts', 'admin-api.md');
const backendCodesPath = path.join(process.cwd(), 'src', 'domain', 'error-codes.ts');
const frontendCodesPath = path.join(repoRoot, 'admin-frontend', 'src', 'constants', 'error-messages.ts');

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

function tableCodes(source) {
  const codes = new Set();
  for (const line of source.split('\n')) {
    const match = /^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/.exec(line.trim());
    if (match) codes.add(match[1]);
  }
  return codes;
}

function mentionedCodes(source) {
  const codes = new Set();
  for (const match of source.matchAll(
    /`(ADM_[A-Z0-9_]+|VALIDATION_FAILED|NOT_FOUND|INTERNAL_ERROR|SERVICE_UNAVAILABLE)`/g,
  )) {
    codes.add(match[1]);
  }
  return codes;
}

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
    problems.push(`契约中出现了未在 §0.4 登记的错误码：${code}`);
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
    `后端与前端码表一致，且无"契约提到但未登记"的码`,
);

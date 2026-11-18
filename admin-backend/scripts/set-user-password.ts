#!/usr/bin/env tsx
/**
 * 运维脚本：为**存量用户**补设/重置密码（024）。
 *
 * 背景：024 之前创建的用户记录没有 `password` 字段，按 `FR-013` 默认不可登录。
 * 本脚本按项目自身 `hashPassword`（`src/domain/auth/password.ts`，唯一实现来源）
 * 生成 scrypt 摘要，写回 `.platform-data/users/{uid}.json`：
 * - **非破坏性**：保留 `user_id`、`agents` 等既有字段，只增/改 `password`；
 * - **幂等**：可反复执行以重置密码；
 * - **UTF-8 安全**：用 Node `fs` 读写，避免 PowerShell 默认编码破坏中文 `agents`。
 *
 * 用法（在 `admin-backend/` 下）：
 *   npm run set:user-password -- <user_id> <password>
 * 或：
 *   npx tsx scripts/set-user-password.ts admin 你的新密码
 *
 * 数据目录取 `PLATFORM_DATA_DIR`；未设置时回退本地默认 `./.platform-data`。
 * 容器形态请在容器内执行（`PLATFORM_DATA_DIR=/app/.platform-data`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../src/domain/auth/password.js';

function fail(message: string): never {
  console.error(`[set-user-password] ${message}`);
  process.exit(1);
}

const [, , userIdArg, passwordArg] = process.argv;

if (!userIdArg || !passwordArg) {
  fail(
    '用法：tsx scripts/set-user-password.ts <user_id> <password>\n' +
      '  例：npm run set:user-password -- admin 你的新密码',
  );
}

const userId = userIdArg.trim();
const password = passwordArg;

if (userId === '') fail('user_id 不能为空');
if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
  fail(`密码长度须为 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH} 个字符`);
}

const dataDir = process.env.PLATFORM_DATA_DIR ?? './.platform-data';
const file = path.join(path.resolve(process.cwd(), dataDir), 'users', `${userId}.json`);

if (!fs.existsSync(file)) {
  fail(`用户记录不存在：${file}\n（请先在管理台新建该用户，或确认 PLATFORM_DATA_DIR）`);
}

let doc: Record<string, unknown>;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
} catch (err) {
  fail(`读取用户记录失败：${(err as Error).message}`);
}
if (typeof doc.user_id !== 'string' || doc.user_id !== userId) {
  fail(`用户记录与 user_id 不匹配（文件内 user_id=${String(doc.user_id)}）`);
}

doc.password = hashPassword(password);
fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

console.log(`[set-user-password] 已为「${userId}」设置密码（scrypt 摘要已写入 ${file}）`);
console.log('[set-user-password] 提示：旧会话不会自动失效，但该账号需用新密码重新登录。');

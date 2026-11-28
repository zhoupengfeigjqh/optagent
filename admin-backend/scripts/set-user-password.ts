#!/usr/bin/env tsx
/**
 * 重置账号密码（028/029）：按当前 `STORAGE_DRIVER` 生效。
 *
 * 用法：`npm run set:user-password -- <user_id> <password>`（读 `.env.local`）。
 *
 * 走与主程序同一套装配（`scripts/lib/account-stores.ts`）：file 驱动写
 * `accounts/users/{uid}.json`，mysql 驱动写 `users.password`——切换存储后
 * 运维命令不会"写进没人读的文件"（029 FR-024）。
 */
import process from 'node:process';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../src/domain/auth/password.js';
import { createAccountStores } from './lib/account-stores.js';

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

const stores = await createAccountStores();
try {
  if (!stores.users.exists(userId)) {
    fail(
      `用户记录不存在：${userId}\n` +
        `（当前存储：${stores.config.storageDriver}；请先在管理台新建该用户，` +
        'mysql 模式还需确认已执行 npm run migrate:mysql）',
    );
  }
  await stores.users.setPassword(userId, password);
  console.log(
    `[set-user-password] 已为「${userId}」设置密码（写入 ${stores.config.storageDriver} 存储）`,
  );
  console.log('[set-user-password] 提示：旧会话不会自动失效，该账号需用新密码重新登录。');
} finally {
  await stores.close();
}

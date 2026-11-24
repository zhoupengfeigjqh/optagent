/**
 * 存量账号迁移：`.platform-data/{users,sessions}/*.json` → MySQL `optagent` 库
 * （028 特性，阶段 1）。
 *
 * 用法：
 *   1. 先在 `.env.local` 配好 `STORAGE_DRIVER=mysql` 与 `MYSQL_*`（脚本按此装配连接）；
 *   2. `npm run migrate:mysql`；
 *   3. 迁移后直接启动服务（mysql 驱动读库，JSON 原样保留作回滚备份）。
 *
 * 语义：**复制而非移动**——源 JSON 不删除；重复执行为幂等 upsert。
 * 校验：迁移后 `users` / `sessions` 行数与源文件数一致，逐条 `user_id` 对账。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { MysqlConnection } from '../src/infra/mysql.js';
import type { PasswordRecord } from '../src/domain/auth/password.js';
import type { UserLinkDocument } from '../src/domain/config-center/user-links.js';

interface FileSessionRecord {
  user_id: string;
  session_id: string;
  issued_at: string;
}

function readJsonFiles<T>(dir: string): Array<{ id: string; doc: T }> {
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ id: string; doc: T }> = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const id = file.slice(0, -'.json'.length);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as T;
    out.push({ id, doc });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.storageDriver !== 'mysql' || !config.mysql) {
    console.error(
      '[migrate] 请先在 .env.local 设置 STORAGE_DRIVER=mysql 及 MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE，再执行迁移',
    );
    process.exit(1);
  }

  const conn = new MysqlConnection({ ...config.mysql, logger: undefined });
  try {
    await conn.ping();
  } catch (err) {
    console.error(`[migrate] MySQL 不可达：${(err as Error).message}`);
    process.exit(1);
  }

  const usersDir = path.join(config.platformDataDir, 'users');
  const sessionsDir = path.join(config.platformDataDir, 'sessions');
  const userFiles = readJsonFiles<UserLinkDocument>(usersDir);
  const sessionFiles = readJsonFiles<FileSessionRecord>(sessionsDir);
  console.log(`[migrate] 源数据：users=${userFiles.length} 个（${usersDir}），sessions=${sessionFiles.length} 个（${sessionsDir}）`);

  // ---- users：幂等 upsert（agents 与密码摘要；其余列保持缺省）----
  for (const { id, doc } of userFiles) {
    if (doc.user_id !== id) {
      console.error(`[migrate] 用户文件名与内容不一致：${id}.json → user_id=${doc.user_id}，跳过并退出`);
      process.exit(1);
    }
    const password: PasswordRecord | undefined = doc.password;
    await conn.modify(
      `INSERT INTO users (user_id, agents, password_record)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE agents = VALUES(agents), password_record = VALUES(password_record)`,
      [doc.user_id, JSON.stringify(doc.agents), password ? JSON.stringify(password) : null],
    );
    console.log(
      `  + users: ${doc.user_id}（agents=${doc.agents.length} 个，${password ? '含密码摘要' : '不可登录'}）`,
    );
  }

  // ---- sessions：幂等 upsert（issued_at 缺省 NOW(3)）----
  for (const { doc } of sessionFiles) {
    await conn.modify(
      `INSERT INTO sessions (user_id, session_id, issued_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE session_id = VALUES(session_id)`,
      [doc.user_id, doc.session_id, new Date(doc.issued_at)],
    );
    console.log(`  + sessions: ${doc.user_id}`);
  }

  // ---- 校验：行数 + 逐条对账 ----
  const [userCount] = await conn.select<{ c: number }>('SELECT COUNT(*) AS c FROM users');
  const [sessionCount] = await conn.select<{ c: number }>('SELECT COUNT(*) AS c FROM sessions');
  const userRows = await conn.select<{ user_id: string; agents: unknown }>(
    'SELECT user_id, agents FROM users',
  );
  const dbUserIds = new Set(userRows.map((row) => row.user_id));
  const sourceUserIds = new Set(userFiles.map((f) => f.doc.user_id));

  const problems: string[] = [];
  if (userCount?.c !== userFiles.length) {
    problems.push(`users 行数不符：库 ${userCount?.c} vs 文件 ${userFiles.length}`);
  }
  if (sessionCount?.c !== sessionFiles.length) {
    problems.push(`sessions 行数不符：库 ${sessionCount?.c} vs 文件 ${sessionFiles.length}`);
  }
  for (const id of sourceUserIds) {
    if (!dbUserIds.has(id)) problems.push(`users 缺少 ${id}`);
  }
  for (const row of userRows) {
    const source = userFiles.find((f) => f.doc.user_id === row.user_id);
    if (!source) continue;
    const dbAgents = typeof row.agents === 'string' ? JSON.parse(row.agents) : row.agents;
    if (JSON.stringify(dbAgents) !== JSON.stringify(source.doc.agents)) {
      problems.push(`users.${row.user_id} 的 agents 不一致`);
    }
  }

  if (problems.length > 0) {
    console.error('[migrate] 校验失败：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `[migrate] 完成：users ${userCount?.c} 行、sessions ${sessionCount?.c} 行，逐条对账一致；源 JSON 已保留（回滚：STORAGE_DRIVER=file）`,
  );
  await conn.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

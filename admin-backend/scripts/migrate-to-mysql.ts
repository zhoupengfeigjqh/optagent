/**
 * 存量搬运：`.platform-data/accounts/**` → MySQL 账号库（028 建立，029 补齐）。
 *
 * 用法：先在 `.env.local` 配好 `STORAGE_DRIVER=mysql` 与 `MYSQL_*`，再 `npm run migrate:mysql`。
 *
 * 语义：**复制而非移动**（源文件不删不改）；四类实体按
 * `specs/029-account-mysql-alignment/data-model.md` §必迁列清单 逐列搬运，
 * 顺序 `服务 → 账号 → 链接 → 会话`，全部"存在即更新"（`created_at` 以源为准——
 * 源是唯一权威，重复执行写同一值，故幂等；`db:init` 的种子行也据此被纠正）。
 * 写完逐列对账，任何差异都打印明细并以退出码 1 结束（不报告"部分成功"）。
 *
 * 重跑安全：写入前不做任何删除，中断后直接重跑即可（不产生重复行）。
 * 列口径与时间转换只在 `scripts/lib/migrate-mapping.ts`，勿在此另写一份。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { MysqlConnection } from '../src/infra/mysql.js';
import type { UserLinkDocument } from '../src/domain/config-center/user-links.js';
import type { AgentServiceRecord, RegisterLinkRecord } from '../src/domain/account/account-store.js';
import {
  AGENT_SERVICES_FILE,
  LEGACY_SESSIONS_DIR,
  LEGACY_USERS_DIR,
  REGISTER_LINKS_FILE,
  SESSIONS_DIR,
  USERS_DIR,
} from '../src/domain/account/paths.js';
import {
  diffColumns,
  linkRow,
  normalizeJsonRow,
  resolveSourceDir,
  serviceRow,
  sessionRow,
  userRow,
  type Row,
} from './lib/migrate-mapping.js';

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
    out.push({ id, doc: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as T });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function readJsonArray<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T[];
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.storageDriver !== 'mysql' || !config.mysql) {
    throw new Error(
      '请先在 .env.local 设置 STORAGE_DRIVER=mysql 及 MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE 再执行搬运',
    );
  }

  const conn = new MysqlConnection({ ...config.mysql, logger: undefined });
  await conn.ping();

  const root = config.platformDataDir;
  const userFiles = readJsonFiles<UserLinkDocument>(resolveSourceDir(root, USERS_DIR, LEGACY_USERS_DIR));
  const sessionFiles = readJsonFiles<FileSessionRecord>(resolveSourceDir(root, SESSIONS_DIR, LEGACY_SESSIONS_DIR));
  const services = readJsonArray<AgentServiceRecord>(path.join(root, ...AGENT_SERVICES_FILE.split('/')));
  const links = readJsonArray<RegisterLinkRecord>(path.join(root, ...REGISTER_LINKS_FILE.split('/')));
  console.log(
    `[migrate] 源数据：服务 ${services.length}、账号 ${userFiles.length}、链接 ${links.length}、会话 ${sessionFiles.length}`,
  );

  // ---- 1. 服务 ----
  // created_at 也以源为准：db:init 的种子行带的是执行时刻，若保留它则与源永远对不上；
  // 源是唯一权威，重复执行写同一值，故仍然幂等。
  for (const service of services) {
    await conn.modify(
      `INSERT INTO agent_services (code, name, platform_agent_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         platform_agent_name = VALUES(platform_agent_name),
         status = VALUES(status),
         created_at = VALUES(created_at),
         updated_at = VALUES(updated_at)`,
      [service.code, service.name, service.platform_agent_name, service.status, service.created_at, service.updated_at],
    );
  }

  // ---- 2. 账号（时间列无源，由表默认值填充）----
  for (const { id, doc } of userFiles) {
    if (doc.user_id !== id) {
      throw new Error(`用户文件名与内容不一致：${id}.json → user_id=${doc.user_id}`);
    }
    await conn.modify(
      `INSERT INTO users (user_id, phone, display_name, role, \`password\`, agents, source_agent_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         phone = VALUES(phone),
         display_name = VALUES(display_name),
         role = VALUES(role),
         \`password\` = VALUES(\`password\`),
         agents = VALUES(agents),
         source_agent_code = VALUES(source_agent_code)`,
      [
        doc.user_id,
        doc.phone ?? null,
        doc.display_name ?? '',
        doc.role ?? 'user',
        doc.password ? JSON.stringify(doc.password) : null,
        JSON.stringify(doc.agents ?? []),
        doc.source_agent_code ?? null,
      ],
    );
  }

  // ---- 3. 链接（created_at 同服务：以源为准，重复执行同一值）----
  for (const link of links) {
    await conn.modify(
      `INSERT INTO register_links (token, agent_code, created_by, expires_at, revoked_at, use_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         agent_code = VALUES(agent_code),
         created_by = VALUES(created_by),
         expires_at = VALUES(expires_at),
         revoked_at = VALUES(revoked_at),
         use_count = VALUES(use_count),
         created_at = VALUES(created_at)`,
      [
        link.token,
        link.agent_code,
        link.created_by ?? null,
        link.expires_at ?? null,
        link.revoked_at ?? null,
        link.use_count ?? 0,
        link.created_at,
      ],
    );
  }

  // ---- 4. 会话 ----
  for (const { doc } of sessionFiles) {
    await conn.modify(
      `INSERT INTO sessions (user_id, session_id, issued_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE session_id = VALUES(session_id), issued_at = VALUES(issued_at)`,
      [doc.user_id, doc.session_id, sessionRow(doc).issued_at],
    );
  }

  const problems = [
    ...(await verify(conn, 'agent_services', 'code', COLUMN_SQL.services, services.map(serviceRow))),
    ...(await verify(conn, 'users', 'user_id', COLUMN_SQL.users, userFiles.map((file) => userRow(file.doc)))),
    ...(await verify(conn, 'register_links', 'token', COLUMN_SQL.links, links.map(linkRow))),
    ...(await verify(conn, 'sessions', 'user_id', COLUMN_SQL.sessions, sessionFiles.map((file) => sessionRow(file.doc)))),
  ];
  if (problems.length > 0) {
    console.error(`[migrate] 对账失败，共 ${problems.length} 项差异：`);
    for (const problem of problems) console.error(`  - ${problem}`);
    throw new Error('搬运结果与源数据不一致，请勿切换（修好后可直接重跑本命令）');
  }
  console.log(
    `[migrate] 完成：服务 ${services.length}、账号 ${userFiles.length}、链接 ${links.length}、会话 ${sessionFiles.length} 逐列一致；源文件未改动（回滚：STORAGE_DRIVER=file）`,
  );
  await conn.close();
}

const COLUMN_SQL = {
  services: 'code, name, platform_agent_name, status, created_at, updated_at',
  users: 'user_id, phone, display_name, role, `password`, agents, source_agent_code',
  links: 'token, agent_code, created_by, expires_at, revoked_at, use_count, created_at',
  sessions: 'user_id, session_id, issued_at',
} as const;

/** 读回整表按主键比对：行缺失与列差异都由 `diffColumns` 报出 */
async function verify(
  conn: MysqlConnection,
  table: string,
  keyColumn: string,
  columns: string,
  expected: Row[],
): Promise<string[]> {
  const rows = await conn.select<Row>(`SELECT ${columns} FROM ${table}`);
  const byKey = new Map(rows.map((row) => [String(row[keyColumn]), normalizeJsonRow(row)]));
  return expected.flatMap((row) => diffColumns(`${table}[${String(row[keyColumn])}]`, row, byKey.get(String(row[keyColumn]))));
}

main().catch((err: unknown) => {
  console.error(`[migrate] 失败：${(err as Error).message}`);
  process.exit(1);
});

/**
 * 单元测试：账号域 MySQL 驱动（028 阶段 1）
 *
 * 连**真实本地 MySQL**（独立测试库 `optagent_test`，用后即删，不触碰 `optagent`）；
 * 建表走 `schema.sql`（与 `npm run db:init` 同一份 DDL，避免用例侧维护副本）；
 * MySQL 不可达时整套自动跳过（不因环境缺失而红）。
 *
 * 覆盖：`MysqlUserLinkService`（创建/更新/重置密码/删除/投影重启加载/重复冲突）
 * 与 `MysqlSessionStore`（登记/覆盖/清除幂等/内省）。
 * 连接参数可用环境变量覆盖：TEST_MYSQL_HOST / PORT / USER / PASSWORD。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../src/domain/auth/password.js';
import { MysqlSessionStore } from '../../src/domain/auth/mysql-session-store.js';
import { MysqlUserLinkService, MysqlUserRepository } from '../../src/domain/config-center/mysql-user-link-service.js';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { MysqlConnection } from '../../src/infra/mysql.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { recreateSchema } from '../helpers/mysql-schema.js';

const HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const USER = process.env.TEST_MYSQL_USER ?? 'root';
const PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '123456';
const TEST_DB = 'optagent_test';

/** 顶层连通性探测：不可达 → 整套跳过 */
let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  available = false;
}

describe.skipIf(!available)('账号域 MySQL 驱动（真实本地 MySQL，测试库 optagent_test）', () => {
  let conn: MysqlConnection;
  let admin: mysql.Connection; // 建库/清库用
  let root: string;
  let store: PlatformStore;
  let users: MysqlUserLinkService;
  let sessions: MysqlSessionStore;

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD, multipleStatements: true });
    await recreateSchema(admin, TEST_DB);

    conn = new MysqlConnection({
      host: HOST, port: PORT, user: USER, password: PASSWORD, database: TEST_DB, poolSize: 4, logger: undefined,
    });
    await conn.ping();

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-users-'));
    store = new PlatformStore(root);
    store.ensureLayout();

    users = new MysqlUserLinkService(new MysqlUserRepository(conn), store);
    await users.init();
    sessions = new MysqlSessionStore(conn);
    await sessions.init();

    // fk_sessions_user（schema.sql 保留）：会话所属账号必须先存在
    await users.create('zpf', []);
    await users.create('persist', []);
  });

  afterAll(async () => {
    await conn.close();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('create：落库并可读回（agents/密码摘要），投影同步', async () => {
    await users.create('ops', ['demo'], undefined, 'secret-1');
    expect(users.exists('ops')).toBe(true);
    const doc = users.read('ops');
    expect(doc.agents).toEqual(['demo']);
    expect(verifyPassword('secret-1', doc.password)).toBe(true);

    // SQL 层面直接核对（非仅内存投影）
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      'SELECT user_id, agents, `password` FROM users WHERE user_id = ?',
      ['ops'],
    );
    const row = rows[0] as { user_id: string; agents: string | string[]; password: string | Record<string, unknown> } | undefined;
    expect(row?.user_id).toBe('ops');
    const agents = typeof row?.agents === 'string' ? JSON.parse(row?.agents) : row?.agents;
    expect(agents).toEqual(['demo']);
  });

  it('create：重复标识 → ADM_USER_ID_TAKEN', async () => {
    await expect(users.create('ops', [])).rejects.toMatchObject({
      code: ERROR_CODES.ADM_USER_ID_TAKEN,
    });
  });

  it('create：非法标识（file 版同口径）→ ADM_USER_ID_TAKEN', async () => {
    for (const bad of ['a/b', '..', '']) {
      await expect(users.create(bad, [])).rejects.toMatchObject({
        code: ERROR_CODES.ADM_USER_ID_TAKEN,
      });
    }
  });

  it('update：覆盖 agents 且保留密码摘要', async () => {
    await users.create('ops2', ['a'], undefined, 'secret-2');
    await users.update('ops2', ['b', 'c'], store.revision());
    const doc = users.read('ops2');
    expect(doc.agents).toEqual(['b', 'c']);
    expect(verifyPassword('secret-2', doc.password)).toBe(true);
  });

  it('setPassword：替换摘要、保留 agents、不占设计态 revision', async () => {
    await users.create('ops3', ['demo'], undefined, 'old-1');
    const before = store.revision();
    await users.setPassword('ops3', 'new-1');
    const doc = users.read('ops3');
    expect(doc.agents).toEqual(['demo']);
    expect(verifyPassword('new-1', doc.password)).toBe(true);
    expect(verifyPassword('old-1', doc.password)).toBe(false);
    expect(store.revision()).toBe(before);
  });

  it('remove：删除记录；再删 → ADM_USER_NOT_FOUND', async () => {
    await users.create('ops4', [], undefined, 'x-12345');
    await users.remove('ops4');
    expect(users.exists('ops4')).toBe(false);
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS c FROM users WHERE user_id = ?',
      ['ops4'],
    );
    expect((rows[0] as { c: number }).c).toBe(0);
    await expect(users.remove('ops4')).rejects.toMatchObject({
      code: ERROR_CODES.ADM_USER_NOT_FOUND,
    });
  });

  it('投影重启加载：新实例 init 后读到既有数据（等价服务重启）', async () => {
    await users.create('ops5', ['demo'], undefined, 'keep-1');
    const reborn = new MysqlUserLinkService(new MysqlUserRepository(conn), store);
    await reborn.init();
    const doc = reborn.read('ops5');
    expect(doc.agents).toEqual(['demo']);
    expect(verifyPassword('keep-1', doc.password)).toBe(true);
  });

  it('usersOfAgent / listAll：与 file 版同语义', async () => {
    await users.create('ua', ['demo', 'demo2'], undefined, 'p-12345');
    await users.create('ub', ['demo'], undefined, 'p-12345');
    await users.create('uc', [], undefined, 'p-12345');
    expect(users.usersOfAgent('demo').sort()).toEqual(['ops', 'ops3', 'ops5', 'ua', 'ub']);
    expect(users.usersOfAgent('demo2')).toEqual(['ua']);
    expect(users.listAll().map((d) => d.user_id)).toEqual(
      [...users.listAll().map((d) => d.user_id)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    );
  });

  it('用户标识区分大小写：CaseOne 与 caseone 可共存，查找精确匹配', async () => {
    // 修复前三列沿用 `_ai_ci`：第二次会撞唯一键 → ADM_USER_ID_TAKEN（file 驱动则允许）
    await users.create('CaseOne', []);
    await users.create('caseone', []);
    expect(users.exists('CaseOne')).toBe(true);
    expect(users.exists('caseone')).toBe(true);
    expect(users.exists('CASEONE')).toBe(false);
    expect(users.readOrNull('CASEONE')).toBeNull();
  });

  it('SessionStore（MySQL）：登记→读取→判定；覆盖（后登踢前登）；清除幂等', async () => {
    expect(await sessions.getCurrentSession('zpf')).toBeNull();
    await sessions.setCurrentSession('zpf', 's1');
    expect(await sessions.getCurrentSession('zpf')).toBe('s1');
    expect(await sessions.isCurrentSession('zpf', 's1')).toBe(true);
    expect(await sessions.isCurrentSession('zpf', 's2')).toBe(false);

    await sessions.setCurrentSession('zpf', 's2');
    expect(await sessions.isCurrentSession('zpf', 's1')).toBe(false);
    expect(await sessions.isCurrentSession('zpf', 's2')).toBe(true);

    await sessions.clearSession('zpf');
    expect(await sessions.getCurrentSession('zpf')).toBeNull();
    await expect(sessions.clearSession('zpf')).resolves.toBeUndefined();
  });

  it('MySQL 驱动：DB 错误转可读 ApiError（ADM_STORAGE_UNAVAILABLE）', async () => {
    const broken = new MysqlConnection({
      host: HOST, port: PORT, user: USER, password: 'wrong-password', database: TEST_DB, poolSize: 1, logger: undefined,
    });
    await expect(broken.ping()).rejects.toMatchObject({ code: ERROR_CODES.ADM_STORAGE_UNAVAILABLE });
    await broken.close();
  });

  it('会话以库为准：另一实例（= 另一进程）写入后本实例立即可见', async () => {
    const other = new MysqlSessionStore(conn);
    await other.init();

    await sessions.setCurrentSession('persist', 's9');
    // 修复前读的是启动期内存投影，这里会是 null → 跨进程登录/登出全部失效
    expect(await other.getCurrentSession('persist')).toBe('s9');

    // 别处登录 = 踢掉旧会话；本实例必须立刻判定旧会话无效
    await other.setCurrentSession('persist', 's10');
    expect(await sessions.isCurrentSession('persist', 's9')).toBe(false);
    expect(await sessions.isCurrentSession('persist', 's10')).toBe(true);

    // 别处登出也必须真删行（不能因为"本实例不认识这条"就跳过）
    await sessions.clearSession('persist');
    expect(await other.getCurrentSession('persist')).toBeNull();
  });
});

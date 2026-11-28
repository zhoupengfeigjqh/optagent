/**
 * 配置版本语义（029 T026，真库）：数据库模式的 `revision` 必须与 file 模式一致。
 *
 * 规则（contracts §2）：新建/改授权/删号推进；改密不推进；基于过期版本的写入被拒且不写入。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { MysqlConnection } from '../../src/infra/mysql.js';
import {
  MysqlUserLinkService,
  MysqlUserRepository,
} from '../../src/domain/config-center/mysql-user-link-service.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { recreateSchema } from '../helpers/mysql-schema.js';

const HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.TEST_MYSQL_PORT ?? 3306);
const USER = process.env.TEST_MYSQL_USER ?? 'root';
const PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? '123456';
/** 独立库：与其它真库用例文件并行时互不干扰 */
const TEST_DB = 'optagent_test_revision';

let available: boolean;
try {
  const probe = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  await probe.ping();
  await probe.end();
  available = true;
} catch {
  console.warn(`[mysql-user-link-revision] 本地 MySQL 不可达（${HOST}:${PORT}），已跳过`);
  available = false;
}

describe.skipIf(!available)('MysqlUserLinkService 的配置版本语义（真库）', () => {
  let root: string;
  let platform: PlatformStore;
  let users: MysqlUserLinkService;
  let conn: MysqlConnection;
  let admin: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
    await recreateSchema(admin, TEST_DB);

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-'));
    platform = new PlatformStore(root);
    platform.ensureLayout({ accounts: false });
    conn = new MysqlConnection({
      host: HOST, port: PORT, user: USER, password: PASSWORD, database: TEST_DB, poolSize: 2, logger: undefined,
    });
    users = new MysqlUserLinkService(new MysqlUserRepository(conn), platform);
    await users.init();
  });

  afterAll(async () => {
    await conn.close();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('新建（不带版本）推进版本，并以新版本回包', async () => {
    const before = platform.revision();
    const view = await users.create('u1', ['demo']);
    expect(view.revision).toBe(before + 1);
    expect(platform.revision()).toBe(before + 1);
  });

  it('新建（带过期版本）→ 409 且不写入', async () => {
    const stale = platform.revision() - 1;
    await expect(users.create('u2', [], stale)).rejects.toMatchObject({
      code: ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT,
    });
    expect(users.exists('u2')).toBe(false);
  });

  it('新建（带正确版本）→ 写入并推进', async () => {
    const current = platform.revision();
    const view = await users.create('u3', ['demo'], current);
    expect(view.revision).toBe(current + 1);
    expect(users.exists('u3')).toBe(true);
  });

  it('改授权（带过期版本）→ 409 且授权未被改写', async () => {
    const stale = platform.revision() - 1;
    await expect(users.update('u1', ['changed'], stale)).rejects.toMatchObject({
      code: ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT,
    });
    expect(users.read('u1').agents).toEqual(['demo']);
  });

  it('改授权（带正确版本）→ 生效并推进', async () => {
    const current = platform.revision();
    const view = await users.update('u1', ['b', 'c'], current);
    expect(view.revision).toBe(current + 1);
    expect(users.read('u1').agents).toEqual(['b', 'c']);
  });

  it('改密不推进版本', async () => {
    const before = platform.revision();
    await users.setPassword('u1', 'new-pass-1');
    expect(platform.revision()).toBe(before);
  });

  it('删号推进版本', async () => {
    const before = platform.revision();
    await users.remove('u3');
    expect(users.exists('u3')).toBe(false);
    expect(platform.revision()).toBe(before + 1);
  });
});

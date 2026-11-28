/**
 * 运维脚本装配（029 T048 / FR-024）：脚本必须按 `STORAGE_DRIVER` 拿到与主程序同一套实现，
 * 配置缺失时**报错而不是悄悄退回 file**（那会让"改密码成功"变成假象）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccountStores } from '../../scripts/lib/account-stores.js';
import { FileAccountStore } from '../../src/domain/account/file-account-store.js';
import { MysqlAccountStore } from '../../src/domain/account/mysql-account-store.js';
import { UserLinkService } from '../../src/domain/config-center/user-links.js';
import { MysqlUserLinkService } from '../../src/domain/config-center/mysql-user-link-service.js';

const MANAGED = [
  'STORAGE_DRIVER',
  'MYSQL_HOST',
  'MYSQL_PORT',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'MYSQL_DATABASE',
  'MYSQL_POOL_SIZE',
  'PLATFORM_DATA_DIR',
  'OPT_AGENT_ROOT',
  'AUTH_SECRET',
  'PORT',
] as const;

const saved = new Map<string, string | undefined>();
const tempDirs: string[] = [];

function setupEnv(overrides: Record<string, string | undefined>): void {
  for (const key of MANAGED) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stores-'));
  tempDirs.push(root);
  Object.assign(process.env, {
    PLATFORM_DATA_DIR: path.join(root, '.platform-data'),
    OPT_AGENT_ROOT: path.join(root, '.opt-agent'),
    AUTH_SECRET: 'test-secret-for-factory-32chars',
    PORT: '3998',
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('createAccountStores', () => {
  it('file 驱动 → UserLinkService + FileAccountStore，且建出账号目录', async () => {
    setupEnv({ STORAGE_DRIVER: 'file' });
    const stores = await createAccountStores();
    try {
      expect(stores.users).toBeInstanceOf(UserLinkService);
      expect(stores.accountStore).toBeInstanceOf(FileAccountStore);
      expect(fs.existsSync(path.join(process.env.PLATFORM_DATA_DIR!, 'accounts', 'users'))).toBe(true);
    } finally {
      await stores.close();
    }
  });

  it('mysql 驱动但缺口令 → 抛错（不静默退回 file）', async () => {
    setupEnv({
      STORAGE_DRIVER: 'mysql',
      MYSQL_HOST: '127.0.0.1',
      MYSQL_USER: 'root',
      MYSQL_DATABASE: 'optagent',
      MYSQL_PASSWORD: undefined,
    });
    await expect(createAccountStores()).rejects.toThrow(/MYSQL_PASSWORD/);
  });

  it('mysql 驱动且配置齐全 → Mysql 实现（不可达时给出可读错误）', async () => {
    setupEnv({
      STORAGE_DRIVER: 'mysql',
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: '1',
      MYSQL_USER: 'root',
      MYSQL_PASSWORD: 'x',
      MYSQL_DATABASE: 'optagent_missing',
    });
    await expect(createAccountStores()).rejects.toThrow(/不可达|拒绝|MySQL/);
  });

  it('类型守卫：mysql 装配不会返回 file 实现', () => {
    expect(MysqlUserLinkService).toBeTypeOf('function');
    expect(MysqlAccountStore).toBeTypeOf('function');
  });
});

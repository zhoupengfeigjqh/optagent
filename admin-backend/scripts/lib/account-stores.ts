/**
 * 运维脚本的账号域装配（029 T050）：与主程序同一口径，按 `STORAGE_DRIVER` 选实现。
 *
 * 脚本自己 new 一套存储是"看起来能用、实际写错地方"的经典来源（改密码写进没人读的
 * JSON），故装配只留这一份。
 */
import type { AppConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { MysqlConnection } from '../../src/infra/mysql.js';
import { FileAccountStore } from '../../src/domain/account/file-account-store.js';
import { MysqlAccountStore } from '../../src/domain/account/mysql-account-store.js';
import type { AccountStorePort } from '../../src/domain/account/account-store.js';
import { UserLinkService, type UserLinkPort } from '../../src/domain/config-center/user-links.js';
import {
  MysqlUserLinkService,
  MysqlUserRepository,
} from '../../src/domain/config-center/mysql-user-link-service.js';
import { SessionStore, type SessionPort } from '../../src/domain/auth/session-store.js';
import { MysqlSessionStore } from '../../src/domain/auth/mysql-session-store.js';

export interface AccountStores {
  config: AppConfig;
  platform: PlatformStore;
  users: UserLinkPort;
  sessions: SessionPort;
  accountStore: AccountStorePort;
  /** 关闭连接池（file 驱动为空操作） */
  close(): Promise<void>;
}

export async function createAccountStores(): Promise<AccountStores> {
  const config = loadConfig();
  const platform = new PlatformStore(config.platformDataDir);
  platform.ensureLayout({ accounts: config.storageDriver === 'file' });

  let users: UserLinkPort;
  let sessions: SessionPort;
  let accountStore: AccountStorePort;
  let mysql: MysqlConnection | undefined;

  if (config.storageDriver === 'mysql') {
    if (!config.mysql) {
      throw new Error('STORAGE_DRIVER=mysql 时缺少 MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE');
    }
    mysql = new MysqlConnection({ ...config.mysql, logger: undefined });
    await mysql.ping();
    const mysqlUsers = new MysqlUserLinkService(new MysqlUserRepository(mysql), platform);
    await mysqlUsers.init();
    const mysqlSessions = new MysqlSessionStore(mysql);
    await mysqlSessions.init();
    users = mysqlUsers;
    sessions = mysqlSessions;
    accountStore = new MysqlAccountStore(mysql);
  } else {
    users = new UserLinkService(platform);
    sessions = new SessionStore(platform);
    accountStore = new FileAccountStore(platform);
  }
  await accountStore.init();

  return {
    config,
    platform,
    users,
    sessions,
    accountStore,
    async close() {
      await mysql?.close();
    },
  };
}

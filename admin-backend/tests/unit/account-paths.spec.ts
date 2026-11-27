/**
 * 单元测试：账号域落盘路径常量（`src/domain/account/paths.ts`）
 *
 * 这些常量是 file 驱动的唯一来源，任何一处漂移都会让"用户能看到自己却登不上"，
 * 因此逐字断言，不做模糊匹配。
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS_DIR,
  AGENT_SERVICES_FILE,
  LEGACY_SESSIONS_DIR,
  LEGACY_USERS_DIR,
  REGISTER_LINKS_FILE,
  SESSIONS_DIR,
  USERS_DIR,
} from '../../src/domain/account/paths.js';

describe('账号域路径常量', () => {
  it('users / sessions 挂在 accounts 下', () => {
    expect(ACCOUNTS_DIR).toBe('accounts');
    expect(USERS_DIR).toBe('accounts/users');
    expect(SESSIONS_DIR).toBe('accounts/sessions');
  });

  it('两份集合文件与账号主档同处 accounts 根（授权集合已随 2026-11-27 收敛删除）', () => {
    expect(AGENT_SERVICES_FILE).toBe('accounts/agent-services.json');
    expect(REGISTER_LINKS_FILE).toBe('accounts/register-links.json');
  });

  it('历史目录仅保留旧名，供迁移脚本与告警读取', () => {
    expect(LEGACY_USERS_DIR).toBe('users');
    expect(LEGACY_SESSIONS_DIR).toBe('sessions');
    // 历史目录 MUST NOT 出现在新路径里（否则结构收敛等于没做）
    expect(USERS_DIR.startsWith(`${LEGACY_USERS_DIR}/`)).toBe(false);
    expect(SESSIONS_DIR.startsWith(`${LEGACY_SESSIONS_DIR}/`)).toBe(false);
  });
});

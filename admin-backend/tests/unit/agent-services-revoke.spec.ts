/**
 * 删除数字人的级联撤销（029 T039）：一次调用撤销端口，入参是**全部**相关编码，
 * 时间戳同批一致；影响面统计与实际撤销共用同一判据。
 */
import { describe, expect, it, vi } from 'vitest';
import { AgentServiceCatalog } from '../../src/domain/account/agent-services.js';
import type {
  AccountStorePort,
  AgentServiceRecord,
  RegisterLinkRecord,
} from '../../src/domain/account/account-store.js';
import type { UserLinkPort } from '../../src/domain/config-center/user-links.js';

const STAMP = '2026-11-28 09:00:00.000';

function service(code: string, platformAgentName = 'demo'): AgentServiceRecord {
  return {
    code,
    name: platformAgentName,
    platform_agent_name: platformAgentName,
    status: 'enabled',
    created_at: STAMP,
    updated_at: STAMP,
  };
}

function linkRecord(token: string, code: string, overrides: Partial<RegisterLinkRecord> = {}): RegisterLinkRecord {
  return {
    token,
    agent_code: code,
    created_by: null,
    expires_at: null,
    revoked_at: null,
    use_count: 0,
    created_at: STAMP,
    ...overrides,
  };
}

function makeCatalog(input: { services: AgentServiceRecord[]; links: RegisterLinkRecord[] }) {
  const revokeLinksOf = vi.fn().mockResolvedValue(2);
  const removeAgentService = vi.fn().mockResolvedValue(undefined);
  const store = {
    listAgentServices: async () => input.services,
    listRegisterLinks: async () => input.links,
    findAgentService: async (code: string) => input.services.find((item) => item.code === code) ?? null,
    revokeLinksOf,
    removeAgentService,
    saveAgentService: vi.fn().mockResolvedValue(undefined),
    insertAgentService: vi.fn().mockResolvedValue(undefined),
  } as unknown as AccountStorePort;
  const users = {
    listAll: () => [],
    usersOfAgent: () => [],
  } as unknown as UserLinkPort;
  return { catalog: new AgentServiceCatalog(store, users), revokeLinksOf, removeAgentService };
}

describe('服务字段校验（同一文件的边界）', () => {
  it('name / platform_agent_name 非法时抛 VALIDATION_FAILED', async () => {
    const { requireAgentServiceName, requirePlatformAgentName } = await import(
      '../../src/domain/account/account-store.js'
    );
    expect(() => requireAgentServiceName('')).toThrow(/服务名称/);
    expect(() => requireAgentServiceName('x'.repeat(129))).toThrow(/服务名称/);
    expect(requireAgentServiceName('  BOM 数字人 ')).toBe('BOM 数字人');
    expect(() => requirePlatformAgentName('  ')).toThrow(/platform_agent_name/);
    expect(requirePlatformAgentName(' demo ')).toBe('demo');
  });

  it('撞码错误带编码信息（仓储用它区分插入失败）', async () => {
    const { DuplicateAgentCodeError } = await import('../../src/domain/account/account-store.js');
    const err = new DuplicateAgentCodeError('DH-DUP01');
    expect(err.code).toBe('DH-DUP01');
    expect(err.name).toBe('DuplicateAgentCodeError');
    expect(err.message).toContain('DH-DUP01');
  });
});

describe('删除数字人：级联撤销与影响面', () => {
  it('同一数字人的多条历史服务记录一并撤销，且只调一次撤销端口', async () => {
    const { catalog, revokeLinksOf, removeAgentService } = makeCatalog({
      services: [service('DH-OLD01'), service('DH-NEW02')],
      links: [linkRecord('tok-1', 'DH-OLD01'), linkRecord('tok-2', 'DH-NEW02')],
    });

    const result = await catalog.removeForAgent('demo');

    expect(result.removed).toBe(true);
    expect(revokeLinksOf).toHaveBeenCalledTimes(1);
    const [codes, revokedAt] = revokeLinksOf.mock.calls[0] as [string[], string];
    expect([...codes].sort()).toEqual(['DH-NEW02', 'DH-OLD01']);
    // 同一批：时间戳只有一个值，且形如 DATETIME(3)
    expect(revokedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(result.revokedLinks).toBe(2);
    expect(removeAgentService).toHaveBeenCalledTimes(2);
  });

  it('影响面统计与级联撤销用同一判据（未撤销即计入）', async () => {
    const { catalog } = makeCatalog({
      services: [service('DH-OLD01')],
      links: [
        linkRecord('tok-1', 'DH-OLD01'),
        linkRecord('tok-2', 'DH-OLD01', { revoked_at: STAMP }),
        linkRecord('tok-3', 'DH-OLD01', { expires_at: '2020-01-01 00:00:00.000' }),
      ],
    });

    const impact = await catalog.deletionImpact('demo');
    expect(impact.activeLinks).toBe(2);
    expect(impact.code).toBe('DH-OLD01');
  });
});

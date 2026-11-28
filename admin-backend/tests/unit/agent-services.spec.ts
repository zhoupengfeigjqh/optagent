/**
 * 单元测试：数字人服务删除的引用判据（`remove`）。
 *
 * 2026-11-28：锁定「已撤销 / 已过期链接不算引用」——单独删除服务时，只有
 * **未撤销且未过期**的链接或用户关联才会 `ADM_AGENT_SERVICE_IN_USE` 阻断删除；
 * 过期未撤销的链接不再误判为 in-use（与契约 §0.4 对齐）。
 */
import { describe, expect, it, vi } from 'vitest';
import { AgentServiceCatalog } from '../../src/domain/account/agent-services.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import type {
  AccountStorePort,
  AgentServiceRecord,
  RegisterLinkRecord,
} from '../../src/domain/account/account-store.js';
import type { UserLinkPort, UserLinkDocument } from '../../src/domain/config-center/user-links.js';

const SERVICE: AgentServiceRecord = {
  code: 'DH-TST01',
  name: '测试服务',
  platform_agent_name: 'demo',
  status: 'enabled',
  created_at: '2026-01-01 00:00:00.000',
  updated_at: '2026-01-01 00:00:00.000',
};

function link(overrides: Partial<RegisterLinkRecord> = {}): RegisterLinkRecord {
  return {
    token: 'tok-1',
    agent_code: 'DH-TST01',
    created_by: null,
    expires_at: null,
    revoked_at: null,
    use_count: 0,
    created_at: '2026-01-01 00:00:00.000',
    ...overrides,
  };
}

function makeCatalog(input: {
  links?: RegisterLinkRecord[];
  users?: Pick<UserLinkDocument, 'agents'>[];
}): { catalog: AgentServiceCatalog; removeAgentService: ReturnType<typeof vi.fn> } {
  const removeAgentService = vi.fn().mockResolvedValue(undefined);
  const store = {
    findAgentService: async () => SERVICE,
    listRegisterLinks: async () => input.links ?? [],
    removeAgentService,
  } as unknown as AccountStorePort;
  const users = {
    listAll: () => (input.users ?? []) as UserLinkDocument[],
  } as unknown as UserLinkPort;

  return { catalog: new AgentServiceCatalog(store, users), removeAgentService };
}

describe('AgentServiceCatalog.remove —— 引用判据（过期链接不算引用）', () => {
  it('存在未撤销且未过期的链接 → ADM_AGENT_SERVICE_IN_USE，不删除', async () => {
    const { catalog, removeAgentService } = makeCatalog({
      links: [link({ expires_at: '2999-01-01 00:00:00.000' })],
    });
    await expect(catalog.remove('DH-TST01')).rejects.toMatchObject({
      code: ERROR_CODES.ADM_AGENT_SERVICE_IN_USE,
    });
    expect(removeAgentService).not.toHaveBeenCalled();
  });

  it('已过期但未撤销的链接 → 不算引用，可删除（2026-11-28 修复）', async () => {
    const { catalog, removeAgentService } = makeCatalog({
      links: [link({ expires_at: '2020-01-01 00:00:00.000' })],
    });
    await expect(catalog.remove('DH-TST01')).resolves.toBeUndefined();
    expect(removeAgentService).toHaveBeenCalledWith('DH-TST01');
  });

  it('已撤销的链接 → 不算引用，可删除', async () => {
    const { catalog, removeAgentService } = makeCatalog({
      links: [link({ revoked_at: '2026-01-02 00:00:00.000' })],
    });
    await expect(catalog.remove('DH-TST01')).resolves.toBeUndefined();
    expect(removeAgentService).toHaveBeenCalledWith('DH-TST01');
  });

  it('存在用户关联 → ADM_AGENT_SERVICE_IN_USE（即使没有有效链接）', async () => {
    const { catalog, removeAgentService } = makeCatalog({ users: [{ agents: ['demo'] }] });
    await expect(catalog.remove('DH-TST01')).rejects.toMatchObject({
      code: ERROR_CODES.ADM_AGENT_SERVICE_IN_USE,
    });
    expect(removeAgentService).not.toHaveBeenCalled();
  });
});

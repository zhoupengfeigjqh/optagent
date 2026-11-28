/**
 * 单元测试：专属注册链接的公开校验、注册计数与清单顺序（`lookup` / `consume` / `list`）。
 *
 * 2026-11-28（029）：`consume` 的计数下沉为存储端口的一次自增
 * （`incrementUseCount`），不再"读出→加一→整条写回"，并发注册因此不会丢计数；
 * 清单顺序固定在领域层（`created_at` 升序、同刻按 `token`），不依赖存储返回顺序。
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { RegisterLinkService } from '../../src/domain/account/register-links.js';
import type {
  AccountStorePort,
  AgentServiceRecord,
  RegisterLinkRecord,
} from '../../src/domain/account/account-store.js';

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

interface Spy {
  incrementUseCount: ReturnType<typeof vi.fn>;
  saveRegisterLink: ReturnType<typeof vi.fn>;
}

function makeService(input: {
  link?: RegisterLinkRecord | null;
  links?: RegisterLinkRecord[];
  service?: AgentServiceRecord | null;
}): { service: RegisterLinkService; spy: Spy } {
  const spy: Spy = {
    incrementUseCount: vi.fn().mockResolvedValue(undefined),
    saveRegisterLink: vi.fn().mockResolvedValue(undefined),
  };
  const store = {
    listAgentServices: async () => [input.service ?? SERVICE],
    findAgentService: async () => input.service ?? SERVICE,
    listRegisterLinks: async () => input.links ?? (input.link ? [input.link] : []),
    findRegisterLink: async () => input.link ?? null,
    saveRegisterLink: spy.saveRegisterLink,
    incrementUseCount: spy.incrementUseCount,
    revokeLinksOf: vi.fn().mockResolvedValue(0),
  } as unknown as AccountStorePort;

  return {
    service: new RegisterLinkService(store, { defaultTtlSeconds: null, publicBaseUrl: '' }),
    spy,
  };
}

describe('RegisterLinkService.consume —— 计数前二次校验（TOCTOU 修复）', () => {
  it('有效链接：调用自增端口（不再整条写回）', async () => {
    const { service, spy } = makeService({ link: link() });
    await service.consume('tok-1');
    expect(spy.incrementUseCount).toHaveBeenCalledWith('tok-1');
    expect(spy.saveRegisterLink).not.toHaveBeenCalled();
  });

  it('已撤销链接：抛 ADM_INVALID_LINK，且不计数', async () => {
    const { service, spy } = makeService({
      link: link({ revoked_at: '2026-01-02 00:00:00.000' }),
    });
    await expect(service.consume('tok-1')).rejects.toMatchObject({
      code: ERROR_CODES.ADM_INVALID_LINK,
    });
    expect(spy.incrementUseCount).not.toHaveBeenCalled();
  });

  it('已过期链接：抛 ADM_INVALID_LINK，且不计数', async () => {
    const { service, spy } = makeService({
      link: link({ expires_at: '2020-01-01 00:00:00.000' }),
    });
    await expect(service.consume('tok-1')).rejects.toMatchObject({
      code: ERROR_CODES.ADM_INVALID_LINK,
    });
    expect(spy.incrementUseCount).not.toHaveBeenCalled();
  });

  it('服务已停用：抛 ADM_INVALID_LINK，且不计数', async () => {
    const { service, spy } = makeService({
      link: link(),
      service: { ...SERVICE, status: 'disabled' },
    });
    await expect(service.consume('tok-1')).rejects.toMatchObject({
      code: ERROR_CODES.ADM_INVALID_LINK,
    });
    expect(spy.incrementUseCount).not.toHaveBeenCalled();
  });

  it('链接不存在：抛 ADM_INVALID_LINK（不再静默 return）', async () => {
    const { service, spy } = makeService({ link: null });
    await expect(service.consume('ghost')).rejects.toMatchObject({
      code: ERROR_CODES.ADM_INVALID_LINK,
    });
    expect(spy.incrementUseCount).not.toHaveBeenCalled();
  });

  it('抛出的错误是 ApiError 实例（供注册编排按 code 回滚）', async () => {
    const { service } = makeService({ link: link({ revoked_at: '2026-01-02 00:00:00.000' }) });
    let caught: unknown;
    try {
      await service.consume('tok-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
  });
});

describe('RegisterLinkService.list —— 顺序与存储无关', () => {
  it('按 created_at 升序、同刻按 token', async () => {
    const links = [
      link({ token: 'b', created_at: '2026-01-02 00:00:00.000' }),
      link({ token: 'c', created_at: '2026-01-01 00:00:00.000' }),
      link({ token: 'a', created_at: '2026-01-02 00:00:00.000' }),
    ];
    const { service } = makeService({ links });
    const listed = await service.list();
    expect(listed.map((item) => item.token)).toEqual(['c', 'a', 'b']);
  });

  it('按数字人过滤后顺序不变', async () => {
    const links = [
      link({ token: 'z', agent_code: 'DH-TST01', created_at: '2026-01-03 00:00:00.000' }),
      link({ token: 'y', agent_code: 'DH-OTHER', created_at: '2026-01-01 00:00:00.000' }),
      link({ token: 'x', agent_code: 'DH-TST01', created_at: '2026-01-02 00:00:00.000' }),
    ];
    const { service } = makeService({ links });
    const listed = await service.list('DH-TST01');
    expect(listed.map((item) => item.token)).toEqual(['x', 'z']);
  });
});

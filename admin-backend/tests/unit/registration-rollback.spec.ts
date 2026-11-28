/**
 * 注册失败回滚与留痕（029 FR-017 / T034）。
 *
 * 计数失败必须删掉已建账号（不留"有账号无授权"）；删不掉时**结构化告警**，
 * 错误本身照旧抛给调用方，不能因为回滚失败就吞掉原始错误。
 */
import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { RegistrationService } from '../../src/domain/account/registration.js';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import type { RegisterLinkService } from '../../src/domain/account/register-links.js';
import type { UserLinkPort } from '../../src/domain/config-center/user-links.js';

type LogLine = { event?: string; user_id?: string; token?: string };

const AGENT = {
  code: 'DH-TST01',
  name: '测试服务',
  platform_agent_name: 'demo',
  status: 'enabled' as const,
  created_at: '2026-01-01 00:00:00.000',
  updated_at: '2026-01-01 00:00:00.000',
};

function memoryLogger(lines: LogLine[]) {
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') lines.push(JSON.parse(line) as LogLine);
      }
      cb();
    },
  });
  return pino({ level: 'warn' }, stream);
}

function makeService(input: {
  consumeError: Error;
  removeError?: Error;
  lines: LogLine[];
}) {
  const remove = vi.fn(async () => {
    if (input.removeError) throw input.removeError;
  });
  const users = {
    exists: () => false,
    findByPhone: () => null,
    create: vi.fn(async () => undefined),
    remove,
  } as unknown as UserLinkPort;

  const links = {
    lookup: vi.fn(async () => ({ agent: AGENT, link: { token: 'tok-1' } })),
    consume: vi.fn(async () => {
      throw input.consumeError;
    }),
  } as unknown as RegisterLinkService;

  return {
    service: new RegistrationService(users, links, memoryLogger(input.lines)),
    remove,
  };
}

const VALID_INPUT = {
  linkToken: 'tok-1',
  phone: '13800000000',
  displayName: '张三',
  password: '123456',
};

describe('注册编排的失败路径（校验与撞号）', () => {
  function makeStrict(options: {
    findByPhone?: () => { user_id: string } | null;
    createErrors?: Error[];
  } = {}) {
    const create = vi.fn(async () => {
      const next = options.createErrors?.shift();
      if (next) throw next;
    });
    const users = {
      exists: () => false,
      findByPhone: options.findByPhone ?? (() => null),
      create,
      remove: async () => undefined,
    } as unknown as UserLinkPort;
    const lookup = vi.fn(async () => ({ agent: AGENT, link: { token: 'tok-1' } }));
    const links = {
      lookup,
      consume: async () => undefined,
    } as unknown as RegisterLinkService;
    return { service: new RegistrationService(users, links), create, lookup };
  }

  it('链接为空 → ADM_INVALID_LINK（不查库）', async () => {
    const { service, lookup } = makeStrict();
    await expect(service.register({ ...VALID_INPUT, linkToken: '  ' })).rejects.toMatchObject({
      code: 'ADM_INVALID_LINK',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('手机号格式非法 → VALIDATION_FAILED', async () => {
    const { service } = makeStrict();
    await expect(service.register({ ...VALID_INPUT, phone: '123' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('用户名为空 → VALIDATION_FAILED', async () => {
    const { service } = makeStrict();
    await expect(service.register({ ...VALID_INPUT, displayName: '  ' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('密码过短 → VALIDATION_FAILED', async () => {
    const { service } = makeStrict();
    await expect(service.register({ ...VALID_INPUT, password: '1' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('手机号已被占用 → ADM_PHONE_TAKEN（建号前拦下）', async () => {
    const { service, create } = makeStrict({ findByPhone: () => ({ user_id: 'u_x' }) });
    await expect(service.register(VALID_INPUT)).rejects.toMatchObject({ code: 'ADM_PHONE_TAKEN' });
    expect(create).not.toHaveBeenCalled();
  });

  it('撞号一次 → 换 user_id 重试成功', async () => {
    const { service, create } = makeStrict({
      createErrors: [new ApiError(ERROR_CODES.ADM_USER_ID_TAKEN, 'user_id 已存在')],
    });
    const result = await service.register(VALID_INPUT);
    expect(result.user_id).toMatch(/^u_[0-9a-f]{12}$/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('撞号两次 → 第二次错误如实抛出', async () => {
    const { service, create } = makeStrict({
      createErrors: [
        new ApiError(ERROR_CODES.ADM_USER_ID_TAKEN, 'user_id 已存在'),
        new ApiError(ERROR_CODES.ADM_USER_ID_TAKEN, 'user_id 已存在'),
      ],
    });
    await expect(service.register(VALID_INPUT)).rejects.toMatchObject({ code: 'ADM_USER_ID_TAKEN' });
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('注册第 5 步失败时的补偿', () => {
  it('计数失败 → 删除刚建的账号，并抛出原始错误', async () => {
    const lines: LogLine[] = [];
    const consumeError = new Error('链路中断');
    const { service, remove } = makeService({ consumeError, lines });

    await expect(service.register(VALID_INPUT)).rejects.toBe(consumeError);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(lines.filter((line) => line.event === 'registration.rollback.failed')).toHaveLength(0);
  });

  it('回滚也失败 → 记 warn（含 user_id 与 token），错误仍是原始的', async () => {
    const lines: LogLine[] = [];
    const consumeError = new Error('链路中断');
    const { service } = makeService({ consumeError, removeError: new Error('库连接断开'), lines });

    await expect(service.register(VALID_INPUT)).rejects.toBe(consumeError);
    const warnings = lines.filter((line) => line.event === 'registration.rollback.failed');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ token: 'tok-1' });
    expect(warnings[0]?.user_id).toBeTypeOf('string');
  });

  it('注入 logger 缺省时不因回滚失败而抛错（仍然抛原始错误）', async () => {
    const users = {
      exists: () => false,
      findByPhone: () => null,
      create: async () => undefined,
      remove: async () => {
        throw new Error('库连接断开');
      },
    } as unknown as UserLinkPort;
    const links = {
      lookup: async () => ({ agent: AGENT, link: { token: 'tok-1' } }),
      consume: async () => {
        throw new Error('链路中断');
      },
    } as unknown as RegisterLinkService;

    const service = new RegistrationService(users, links);
    await expect(service.register(VALID_INPUT)).rejects.toThrow('链路中断');
  });
});

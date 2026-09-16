/**
 * 单元测试：MCP 客户端（T107 的第二半）
 *
 * 用注入的假客户端覆盖两条关键路径：
 * - `listTools`（`FR-045`）：成功与失败的可读原因；
 * - `test`（`FR-047`）：**连通性 + 能力验证**两步判定，
 *   并守住"**MUST NOT 把失败误报为成功**"与"失败必须给出明确原因"。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  McpClientService,
  classifyMcpError,
  type McpClientLike,
  type McpConnectionTarget,
} from '../../src/infra/mcp-client.js';

const HTTP_TARGET: McpConnectionTarget = { transport: 'http', url: 'http://ocr:8000/mcp' };

function fake(overrides: Partial<McpClientLike> = {}, onCreate?: () => void): McpClientService {
  return new McpClientService({
    timeoutMs: 100,
    createClient: async () => {
      onCreate?.();
      return {
        listTools: async () => [],
        ping: async () => undefined,
        close: async () => undefined,
        ...overrides,
      };
    },
  });
}

describe('classifyMcpError', () => {
  it('把常见故障归类为可读原因（超时 / 连接被拒 / 主机不可解析 / 协议不匹配）', () => {
    expect(classifyMcpError(new Error('aborted: timeout after 100ms')).code).toBe('MCP_TIMEOUT');
    expect(classifyMcpError(new Error('connect ECONNREFUSED 1.2.3.4:8000')).code).toBe(
      'MCP_CONNECTION_REFUSED',
    );
    expect(classifyMcpError(new Error('getaddrinfo ENOTFOUND ocr')).code).toBe('MCP_HOST_UNRESOLVED');
    expect(classifyMcpError(new Error('Unexpected status 404')).code).toBe('MCP_PROTOCOL_ERROR');
    expect(classifyMcpError(new Error('别的问题')).code).toBe('MCP_ERROR');
  });

  it('展开 fetch（undici）的 cause 链：顶层只有 "fetch failed" 也能归类出真实原因', () => {
    // undici fetch 失败时顶层 message 是 "fetch failed"，ECONNREFUSED 在 cause 上
    const inner = Object.assign(new Error('connect ECONNREFUSED 172.18.0.5:9999'), {
      code: 'ECONNREFUSED',
    });
    const outer = Object.assign(new Error('fetch failed'), { cause: inner });
    const classified = classifyMcpError(outer);
    expect(classified.code).toBe('MCP_CONNECTION_REFUSED');
    expect(classified.message).toContain('ECONNREFUSED');
  });

  it('非 Error 抛出物也不会崩', () => {
    expect(classifyMcpError('纯字符串').code).toBe('MCP_ERROR');
  });
});

describe('McpClientService.listTools', () => {
  it('成功时返回工具清单', async () => {
    const service = fake({
      listTools: async () => [{ name: 'ocr_image', description: '识别', parameters: {} }],
    });
    expect((await service.listTools('ocr', HTTP_TARGET))[0]?.name).toBe('ocr_image');
  });

  it('失败时抛 ADM_RUNTIME_UNREACHABLE 且带服务名与原因（FR-009 可读）', async () => {
    const service = fake({
      listTools: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    let caught: unknown;
    try {
      await service.listTools('ocr', HTTP_TARGET);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_RUNTIME_UNREACHABLE);
    expect((caught as ApiError).message).toContain('ocr');
    expect((caught as ApiError).message).toContain('连接被拒绝');
  });

  it('连接目标不合法：http 缺 url → ADM_RUNTIME_FORM_NOT_CONFIGURED', async () => {
    let caught: unknown;
    try {
      await fake().listTools('ocr', { transport: 'http', url: null });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_RUNTIME_FORM_NOT_CONFIGURED);
  });

  it('连接目标不合法：stdio 缺 command → VALIDATION_FAILED', async () => {
    let caught: unknown;
    try {
      await fake().listTools('ocr', { transport: 'stdio', command: '' });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('无论成功失败都会关闭客户端（不留连接泄漏）', async () => {
    let closed = 0;
    const service = fake({
      listTools: async () => {
        throw new Error('boom');
      },
      close: async () => {
        closed += 1;
      },
    });
    await service.listTools('ocr', HTTP_TARGET).catch(() => undefined);
    expect(closed).toBe(1);
  });
});

describe('McpClientService.test —— 连通性 + 能力验证（FR-047）', () => {
  it('两步都通过 → ok: true', async () => {
    const report = await fake().test('ocr', HTTP_TARGET);
    expect(report.ok).toBe(true);
    expect(report.connectivity.ok).toBe(true);
    expect(report.capability.ok).toBe(true);
    expect(report.capability.method).toBe('ping');
    expect(report.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('**连通性失败 → MUST NOT 误报为成功**，且能力验证明确标注为未执行', async () => {
    const service = new McpClientService({
      timeoutMs: 100,
      createClient: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const report = await service.test('ocr', HTTP_TARGET);

    expect(report.ok).toBe(false);
    expect(report.connectivity.ok).toBe(false);
    expect(report.connectivity.error_code).toBe('MCP_CONNECTION_REFUSED');
    expect(report.capability.ok).toBe(false);
    expect(report.capability.error_code).toBe('MCP_NOT_ATTEMPTED');
  });

  it('连通性通过但能力验证失败 → ok: false，原因归到能力验证一步', async () => {
    const service = fake({
      ping: async () => {
        throw new Error('Unexpected status 405');
      },
    });
    const report = await service.test('ocr', HTTP_TARGET);

    expect(report.ok).toBe(false);
    expect(report.connectivity.ok).toBe(true);
    expect(report.capability.ok).toBe(false);
    expect(report.capability.error_code).toBe('MCP_PROTOCOL_ERROR');
  });

  it('配置不合法（缺目标形态地址）→ 两步都失败并给出配置原因，不发起连接', async () => {
    let created = 0;
    const service = fake({}, () => {
      created += 1;
    });
    const report = await service.test('ocr', { transport: 'http', url: null });

    expect(report.ok).toBe(false);
    expect(report.connectivity.error_code).toBe(ERROR_CODES.ADM_RUNTIME_FORM_NOT_CONFIGURED);
    expect(created).toBe(0);
  });

  it('调用超时 → 归类为超时（有界，不挂住界面）', async () => {
    const service = new McpClientService({
      timeoutMs: 50,
      createClient: () => new Promise(() => undefined),
    });
    const report = await service.test('ocr', HTTP_TARGET);
    expect(report.connectivity.error_code).toBe('MCP_TIMEOUT');
  });
});

/**
 * 单元测试：运行环境只读投影客户端（T048 的第二半）
 *
 * 用本进程内的 HTTP 服务扮演运行环境，覆盖两条只读端点与全部失败分支——
 * 这些分支直接决定"读不到"是否被误当成"没问题"。
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { RuntimeClient } from '../../src/infra/runtime-client.js';

let baseUrl = '';
let mode: 'ok' | 'http-500' | 'not-json' | 'bad-shape' | 'no-groups' = 'ok';

const server = http.createServer((req, res) => {
  if (mode === 'http-500') {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('boom');
    return;
  }
  if (mode === 'not-json') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>维护中</html>');
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url?.startsWith('/api/builtin-tools')) {
    res.end(
      JSON.stringify(
        mode === 'bad-shape'
          ? { total: 0 }
          : {
              items: [
                {
                  name: 'read_file',
                  label: '读取文件',
                  description_template: '如 "{示例路径}"',
                  parameters: { type: 'object' },
                  writable: false,
                },
              ],
              total: 1,
            },
      ),
    );
    return;
  }
  res.end(
    JSON.stringify(
      mode === 'bad-shape'
        ? { items: [] }
        : mode === 'no-groups'
          ? // 2026-09-23：`groups` 是必填结构——缺失即"结构不合法"，
            // 不能让平台静默显示空表、冒称"没调用过"
            { stats_available: true, items: [] }
          : {
              stats_available: true,
              items: [
                {
                  name: 'ocr',
                  calls_total: 2,
                  calls_ok: 2,
                  calls_failed: 0,
                  last_called_at: '2026-09-15T06:00:00Z',
                },
              ],
              groups: [
                {
                  service: 'ocr',
                  tool_name: 'ocr_image',
                  user_id: 'admin',
                  calls_total: 2,
                  calls_ok: 2,
                  calls_failed: 0,
                  last_called_at: '2026-09-15T06:00:00Z',
                  windows: { d365: { ok: 2, failed: 0, total: 2 } },
                },
              ],
            },
    ),
  );
});

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(timeoutMs = 2000): RuntimeClient {
  return new RuntimeClient({ baseUrl, timeoutMs });
}

describe('RuntimeClient.builtinTools', () => {
  it('正常返回工具目录，且**原样保留占位符模板**（FR-012）', async () => {
    mode = 'ok';
    const tools = await client().builtinTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.description_template).toContain('{示例路径}');
  });

  it('结构不合法 → ADM_RUNTIME_UNREACHABLE（不静默返回空数组）', async () => {
    mode = 'bad-shape';
    let caught: unknown;
    try {
      await client().builtinTools();
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_RUNTIME_UNREACHABLE);
  });

  it('非 JSON 响应 → ADM_RUNTIME_UNREACHABLE', async () => {
    mode = 'not-json';
    let caught: unknown;
    try {
      await client().builtinTools();
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_RUNTIME_UNREACHABLE);
  });

  it('HTTP 500 → ADM_RUNTIME_UNREACHABLE 并带上状态码', async () => {
    mode = 'http-500';
    let caught: unknown;
    try {
      await client().builtinTools();
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).message).toContain('500');
  });
});

describe('RuntimeClient.mcpCallStats', () => {
  it('正常返回统计：服务级汇总 + 分组行都取到', async () => {
    mode = 'ok';
    const stats = await client().mcpCallStats();
    expect(stats.stats_available).toBe(true);
    expect(stats.items[0]?.calls_total).toBe(2);
    expect(stats.groups[0]?.tool_name).toBe('ocr_image');
  });

  it('结构不合法 → ADM_RUNTIME_UNREACHABLE', async () => {
    mode = 'bad-shape';
    await expect(client().mcpCallStats()).rejects.toThrow(ApiError);
  });

  it('缺 groups 字段（旧运行环境）→ ADM_RUNTIME_UNREACHABLE，不静默当空表', async () => {
    mode = 'no-groups';
    await expect(client().mcpCallStats()).rejects.toThrow(ApiError);
  });

  it('不可达（端口不通）→ ADM_RUNTIME_UNREACHABLE，供上层显示"未知"', async () => {
    const unreachable = new RuntimeClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 300 });
    let caught: unknown;
    try {
      await unreachable.mcpCallStats();
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_RUNTIME_UNREACHABLE);
  });

  it('超时 → ADM_RUNTIME_UNREACHABLE（有界，不会挂住管理界面）', async () => {
    const slow = http.createServer((_req, _res) => {
      /* 故意不响应 */
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    const address = slow.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      const c = new RuntimeClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 200 });
      await expect(c.builtinTools()).rejects.toThrow(ApiError);
    } finally {
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });

  it('baseUrl 结尾斜杠被规范化（避免出现 //api）', () => {
    expect(new RuntimeClient({ baseUrl: 'http://x:1/', timeoutMs: 10 }).getBaseUrl()).toBe(
      'http://x:1',
    );
  });
});

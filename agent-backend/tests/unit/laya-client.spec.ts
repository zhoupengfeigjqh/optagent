/**
 * 单元测试：Laya System One 线协议适配器（013 · noul 口径）。
 *
 * 守住四条口径：
 * - 只打 `/v1/systemone`，带 Bearer 与 JSON body，**只发一次**（不重试）；
 * - 只依赖 `answers[qid].noul`（qid = 工具名），坏形状一律归为 `invalid_response`；
 * - 单题坏掉只跳过该题，不让整批丢失；
 * - 超时 / 网络异常不外抛，返回可区分原因（上层据此降级）。
 */
import { describe, expect, it, vi } from 'vitest';
import { LayaClient, type SystemOneQuestion } from '../../src/infra/laya-client.js';

const QUESTIONS: Record<string, SystemOneQuestion> = {
  order_query: {
    type: 'noul',
    instructions: '本轮用户发起的任务是否需要使用 查询订单 ？',
    criteria: { true: '需要', false: '不需要' },
  },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchImpl: typeof fetch): LayaClient {
  return new LayaClient(
    {
      baseUrl: 'http://laya:8000/',
      model: 'laya-multilingual',
      apiKey: 'dev-key',
      timeoutMs: 3_000,
    },
    { fetchImpl },
  );
}

describe('正常路径', () => {
  it('取 answers[qid].noul，并以**问题键（工具名）**为键', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        answers: { order_query: { type: 'noul', noul: 0.871 } },
        model: 'decis/laya-multilingual@0.3.29',
      }),
    ) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('这批订单能不能插单', QUESTIONS);
    expect(result).toEqual({
      ok: true,
      scores: { order_query: 0.871 },
      model: 'decis/laya-multilingual@0.3.29',
    });
  });

  it('请求形状固定：去尾斜杠 / Bearer / JSON body / 只调一次', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ answers: { order_query: { noul: 0.5 } } });
    }) as unknown as typeof fetch;

    await makeClient(fetchImpl).decide('输入', QUESTIONS);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://laya:8000/v1/systemone');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer dev-key');
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      state: string;
      model: string;
      questions: Record<string, unknown>;
    };
    expect(body.state).toBe('输入');
    expect(body.model).toBe('laya-multilingual');
    expect(Object.keys(body.questions)).toEqual(['order_query']);
  });

  it('多题一次返回，全部收下（批量是 noul 的基本用法）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        answers: {
          a: { noul: 0.9 },
          b: { noul: 0.2 },
          c: { noul: 0.55 },
        },
      }),
    ) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('输入', QUESTIONS);
    expect(result).toEqual({ ok: true, scores: { a: 0.9, b: 0.2, c: 0.55 }, model: '' });
  });

  it('单题坏形状只跳过该题，其余照常返回', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        answers: {
          a: { noul: 0.7 },
          b: { noul: 'high' },
          c: {},
          d: null,
        },
      }),
    ) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('输入', QUESTIONS);
    expect(result).toMatchObject({ ok: true, scores: { a: 0.7 } });
  });
});

describe('失败路径（一律不抛错）', () => {
  it('HTTP 401 → http + status', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('unauthorized', { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('输入', QUESTIONS);
    expect(result).toMatchObject({ ok: false, reason: 'http', status: 401 });
  });

  it('HTTP 失败把响应体摘要带进 message（422 这类 schema 拒绝要靠它定位）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            detail: [{ msg: "Question 't1' is about 320 tokens, over this model's limit of 256" }],
          }),
          { status: 422 },
        ),
    ) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('输入', QUESTIONS);
    expect(result).toMatchObject({ ok: false, reason: 'http', status: 422 });
    expect(result.ok ? '' : result.message).toContain('320 tokens');
  });

  it('响应体读取失败时仍给出状态码（诊断信息不能盖掉主因）', async () => {
    const broken = {
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('stream broken')),
    } as unknown as Response;
    const result = await makeClient((async () => broken) as unknown as typeof fetch).decide(
      '输入',
      QUESTIONS,
    );
    expect(result).toMatchObject({ ok: false, reason: 'http', status: 500 });
    expect(result.ok ? '' : result.message).toBe('判定服务返回 500');
  });

  it('非 JSON 响应 → invalid_response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html></html>', { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('输入', QUESTIONS);
    expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
  });

  it('缺少 answers → invalid_response', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ model: 'laya-multilingual' }),
    ) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('输入', QUESTIONS);
    expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
  });

  it('一条可用分数都没有 → invalid_response', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ answers: { a: { noul: 'high' }, b: {} } }),
    ) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('输入', QUESTIONS);
    expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
  });

  it('超时（TimeoutError）→ timeout，且只调一次', async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('输入', QUESTIONS);
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('网络错误 → network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).decide('输入', QUESTIONS);
    expect(result).toMatchObject({ ok: false, reason: 'network' });
  });
});

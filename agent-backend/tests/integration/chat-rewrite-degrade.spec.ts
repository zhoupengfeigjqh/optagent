/**
 * 集成测试：指代改写（027）**降级矩阵**端到端。
 *
 * 四个失败点各一条：判定服务故障 / 改写抛错 / 改写超时 / 改写空输出。
 * 每条都必须满足同一组不变量（契约 §10）：
 * - HTTP 200、SSE 照常输出回答、`history.jsonl` 只有原话；
 * - 聚焦退回原文（Laya 收到的评分素材 = 原话）；
 * - 留档给出**可区分**的原因（`judge_failed` / `llm_failed` / `empty_output`）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { IntentFocusStore } from '../../src/domain/intent-focus/store.js';
import { AGENT, USER, ctxOf, send, setupRewriteEnv, type RewriteEnv } from './support/rewrite-env.js';

const FOLLOW_UP = '请根据上述结果分析';
const REWRITTEN = '分析上批原材料采购单的到货延迟';

let current: RewriteEnv | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function setup(options: Parameters<typeof setupRewriteEnv>[0]): Promise<RewriteEnv> {
  current = await setupRewriteEnv({ rewrite: true, ...options });
  return current;
}

function firstRecord(env: RewriteEnv, threadId: string) {
  return new IntentFocusStore(env.root).readAll(USER, AGENT, threadId)[0];
}

describe('027 降级：判定服务故障', () => {
  it('Laya 503 → judge_failed、零改写、回答照常', async () => {
    const env = await setup({ laya: { failStatus: 503 } });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    const res = await send(env.app, thread.threadId, FOLLOW_UP);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('本轮回答');
    expect(env.llmLog.rewritePrompts).toHaveLength(0);
    expect(firstRecord(env, thread.threadId)).toMatchObject({
      need_rewrite: null,
      rewrite_score: null,
      rewrite_query: '',
      rewrite_reason: 'judge_failed',
    });
  });
});

describe('027 降级：改写调用失败', () => {
  it('改写抛错 → llm_failed，聚焦素材退回原话', async () => {
    const env = await setup({ llm: { rewriteFails: true } });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    const res = await send(env.app, thread.threadId, FOLLOW_UP);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('本轮回答');
    expect(res.payload).not.toContain(REWRITTEN);
    expect(env.llmLog.rewritePrompts).toHaveLength(1);
    // 改写失败 ⇒ 评分素材全是原话
    expect(env.laya.states.every((state) => state === FOLLOW_UP)).toBe(true);
    expect(firstRecord(env, thread.threadId)).toMatchObject({
      input: FOLLOW_UP,
      need_rewrite: true,
      rewrite_query: '',
      rewrite_reason: 'llm_failed',
    });
  });

  it('改写超时（受 rewrite_timeout_ms 约束）→ llm_failed，且耗时确实被截断', async () => {
    const env = await setup({
      llm: { rewriteHangs: true },
      intentFocusLines: ['  rewrite_timeout_ms: 400'],
    });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    const res = await send(env.app, thread.threadId, FOLLOW_UP);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('本轮回答');
    const record = firstRecord(env, thread.threadId);
    expect(record).toMatchObject({ rewrite_reason: 'llm_failed', rewrite_query: '' });
    // 400ms 超时 + 少量调度开销；给足余量但必须远小于整轮 10s
    expect(record!.rewrite_ms).toBeGreaterThanOrEqual(390);
    expect(record!.rewrite_ms).toBeLessThan(3_000);
  });

  it('改写只回思考、不回正文 → empty_output', async () => {
    const env = await setup({ llm: { rewriteEmpty: true } });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    const res = await send(env.app, thread.threadId, FOLLOW_UP);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('本轮回答');
    expect(firstRecord(env, thread.threadId)).toMatchObject({
      need_rewrite: true,
      rewrite_query: '',
      rewrite_reason: 'empty_output',
    });
  });
});

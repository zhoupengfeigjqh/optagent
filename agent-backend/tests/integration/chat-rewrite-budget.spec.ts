/**
 * 集成测试：指代改写（027）的阶段预算。
 *
 * 断言的是"预算"而不是"超时"：判定 + 改写共用**同一份**阶段预算，
 * 判定把这笔预算几乎吃光时，改写必须**直接放弃**（`budget_exhausted`），
 * 而不是再开一次注定赶不上的调用——否则整轮回答会被拖过 deadline（契约 C-4）。
 *
 * 手法：把 `timeout_ms` 压到 600ms，并让 Laya 对**改写命题那一批**延迟 350ms，
 * 判定返回后只剩 250ms（< 300ms 的下限），改写通道应当一次都不被调用。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { IntentFocusStore } from '../../src/domain/intent-focus/store.js';
import { MIN_REWRITE_BUDGET_MS } from '../../src/domain/intent-focus/rewrite.js';
import { AGENT, USER, ctxOf, send, setupRewriteEnv, type RewriteEnv } from './support/rewrite-env.js';

const FOLLOW_UP = '请根据上述结果分析';

let current: RewriteEnv | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

describe('027 阶段预算：判定吃光预算后放弃改写', () => {
  it('剩余 < 300ms → budget_exhausted、零改写调用、回答照常且在预算内收尾', async () => {
    current = await setupRewriteEnv({
      rewrite: true,
      intentFocusLines: ['  timeout_ms: 600'],
      laya: { rewriteDelayMs: 350 },
    });
    const env = current;
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    const started = Date.now();
    const res = await send(env.app, thread.threadId, FOLLOW_UP);
    const elapsed = Date.now() - started;

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('本轮回答');
    // 改写一次都没发（判为需要改写，但预算不够）
    expect(env.llmLog.rewritePrompts).toHaveLength(0);

    const [record] = new IntentFocusStore(env.root).readAll(USER, AGENT, thread.threadId);
    expect(record).toMatchObject({
      need_rewrite: true,
      rewrite_score: 0.95,
      rewrite_query: '',
      rewrite_ms: null,
      rewrite_reason: 'budget_exhausted',
    });

    // 兜底：整轮不得因为"多一次改写"被拖到远超阶段预算
    expect(elapsed).toBeLessThan(5_000);
    // 与实现里的下限同源，避免"改了常量、测试还绿"
    expect(MIN_REWRITE_BUDGET_MS).toBe(300);
  });
});

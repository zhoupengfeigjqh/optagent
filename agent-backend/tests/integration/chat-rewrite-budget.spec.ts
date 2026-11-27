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

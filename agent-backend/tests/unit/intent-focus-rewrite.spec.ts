/**
 * 单元测试：指代改写阶段编排（027）。
 *
 * 这一层守的是**降级矩阵（契约 §10）与预算切分（契约 §6）**：
 * 每一行都必须"回退原文、回答不受影响、记录原因准确"，且关闭 / 短路 / 超预算轮
 * **零新增调用**。文字处理本身在 `intent-focus-rewrite-prompt.spec.ts`。
 */
import { describe, expect, it, vi } from 'vitest';
import type { IntentFocusConfig } from '../../src/config.js';
import {
  MIN_REWRITE_BUDGET_MS,
  REWRITE_BUDGET_MARGIN_MS,
  runRewriteStage,
  type RewriteStageDeps,
} from '../../src/domain/intent-focus/rewrite.js';
import { REWRITE_MAX_CHARS } from '../../src/domain/intent-focus/rewrite-prompt.js';
import type { LayaDecideResult } from '../../src/infra/laya-client.js';

const CONFIG: IntentFocusConfig = {
  baseUrl: 'http://laya:8000',
  model: 'laya-multilingual',
  apiKey: 'k',
  timeoutMs: 10_000,
  skillThreshold: 0.6,
  ontologyBehaviorThreshold: 0.6,
  ontologyFunctionThreshold: 0.6,
  maxSkills: 32,
  maxCapabilities: 96,
  rewriteThreshold: 0.8,
  rewriteTimeoutMs: 5000,
};

const INPUT = '请根据上述结果分析';

interface Harness {
  deps: RewriteStageDeps;
  judgeCalls: Array<{ state: string; timeoutMs?: number }>;
  rewriteCalls: Array<{ systemPrompt: string; content: string; timeoutMs: number }>;
  infos: Array<Record<string, unknown>>;
  warns: Array<Record<string, unknown>>;
}

function harness(options: {
  enabled?: boolean;
  decided?: LayaDecideResult;
  rewrite?: (req: { messages: Array<{ content: string }> }) => Promise<string>;
  history?: () => ReadonlyArray<{ role: 'user' | 'assistant'; content: string; status?: 'completed' | 'failed' }>;
  now?: () => number;
  config?: Partial<IntentFocusConfig>;
} = {}): Harness {
  const judgeCalls: Harness['judgeCalls'] = [];
  const rewriteCalls: Harness['rewriteCalls'] = [];
  const infos: Harness['infos'] = [];
  const warns: Harness['warns'] = [];

  const deps: RewriteStageDeps = {
    config: { ...CONFIG, ...options.config },
    enabled: options.enabled ?? true,
    client: {
      decide: async (state, _questions, timeoutMs) => {
        judgeCalls.push({ state, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
        return (
          options.decided ?? {
            ok: true,
            scores: { need_rewrite: 0.95 },
            model: 'laya-multilingual',
          }
        );
      },
    },
    rewriteLlm: {
      complete: async (req) => {
        rewriteCalls.push({
          systemPrompt: req.systemPrompt,
          content: req.messages[0]!.content,
          timeoutMs: req.timeoutMs,
        });
        return options.rewrite ? options.rewrite(req) : '分析上批原材料采购单的到货延迟';
      },
    },
    ...(options.history
      ? { readHistory: () => options.history!() }
      : {
          readHistory: () => [
            { role: 'user', content: '创建一笔采购单', status: 'completed' },
            { role: 'assistant', content: '已创建', status: 'completed' },
          ],
        }),
    logger: {
      info: (obj) => infos.push(obj),
      warn: (obj) => warns.push(obj),
    },
    ...(options.now ? { now: options.now } : {}),
  };

  return { deps, judgeCalls, rewriteCalls, infos, warns };
}

function input(overrides: Partial<Parameters<typeof runRewriteStage>[1]> = {}) {
  return {
    userId: 'u1',
    agentName: 'a1',
    threadId: 't1',
    userInput: INPUT,
    deadline: Date.now() + 10_000,
    ...overrides,
  };
}

describe('runRewriteStage —— 开关矩阵', () => {
  it('开关关闭：零判定、零改写、零读历史，state = 原文（尾部 200 字）', async () => {
    const readHistory = vi.fn();
    const h = harness({ enabled: false, history: readHistory });

    const outcome = await runRewriteStage(h.deps, input());

    expect(h.judgeCalls).toHaveLength(0);
    expect(h.rewriteCalls).toHaveLength(0);
    expect(readHistory).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      state: INPUT,
      truncated: false,
      origin: 'original',
      needRewrite: null,
      rewrite: '',
      rewriteMs: null,
      historyTurns: 0,
      // "未执行"不是"失败"：记录里的原因必须为空（契约 §8）
      reason: null,
    });
    expect(h.infos[0]).toMatchObject({ event: 'intent-focus.rewrite.skipped', reason: 'switch_off' });
  });

  it('开关开启且需要改写：判定 1 次、改写 1 次，state 换成改写文本', async () => {
    const h = harness();

    const outcome = await runRewriteStage(h.deps, input());

    expect(h.judgeCalls).toHaveLength(1);
    expect(h.judgeCalls[0]!.state).toBe(INPUT);
    expect(h.rewriteCalls).toHaveLength(1);
    expect(outcome).toMatchObject({
      state: '分析上批原材料采购单的到货延迟',
      origin: 'rewrite',
      needRewrite: true,
      score: 0.95,
      rewrite: '分析上批原材料采购单的到货延迟',
      rewriteTruncated: false,
      historyTurns: 1,
      reason: null,
    });
    expect(outcome.rewriteMs).toBeGreaterThanOrEqual(0);
    expect(h.infos.at(-1)).toMatchObject({
      event: 'intent-focus.rewrite.done',
      need_rewrite: true,
      history_turns: 1,
    });
  });
});

describe('runRewriteStage —— 判定分支', () => {
  it('分数 ≤ 阈值：不改写，need_rewrite=false、reason=below_threshold', async () => {
    const h = harness({ decided: { ok: true, scores: { need_rewrite: 0.8 }, model: 'laya' } });

    const outcome = await runRewriteStage(h.deps, input());

    expect(h.rewriteCalls).toHaveLength(0);
    expect(outcome).toMatchObject({
      state: INPUT,
      origin: 'original',
      needRewrite: false,
      score: 0.8,
      rewrite: '',
      rewriteMs: null,
      reason: 'below_threshold',
    });
  });

  it('判定失败（HTTP / 超时）：按原文继续，need_rewrite=null、reason=judge_failed、不重试', async () => {
    const h = harness({ decided: { ok: false, reason: 'timeout', message: '判定超时' } });

    const outcome = await runRewriteStage(h.deps, input());

    expect(h.judgeCalls).toHaveLength(1);
    expect(h.rewriteCalls).toHaveLength(0);
    expect(outcome).toMatchObject({
      state: INPUT,
      needRewrite: null,
      score: null,
      reason: 'judge_failed',
    });
    expect(h.warns[0]).toMatchObject({
      event: 'intent-focus.rewrite.degraded',
      stage: 'judge',
      reason: 'judge_failed',
    });
  });

  it('判定响应缺该题分数：同样按 judge_failed 处理（不猜分数）', async () => {
    const h = harness({ decided: { ok: true, scores: { s1: 0.9 }, model: 'laya' } });

    const outcome = await runRewriteStage(h.deps, input());

    expect(h.rewriteCalls).toHaveLength(0);
    expect(outcome.reason).toBe('judge_failed');
    expect(outcome.needRewrite).toBeNull();
  });

  it('判定阈值取配置值（0.5 时 0.6 分也改写）', async () => {
    const h = harness({
      decided: { ok: true, scores: { need_rewrite: 0.6 }, model: 'laya' },
      config: { rewriteThreshold: 0.5 },
    });

    expect((await runRewriteStage(h.deps, input())).origin).toBe('rewrite');
  });
});

describe('runRewriteStage —— 改写失败矩阵', () => {
  it('改写抛错 → 回退原文、reason=llm_failed、need_rewrite 仍为 true', async () => {
    const h = harness({
      rewrite: async () => {
        throw new Error('上游 503');
      },
    });

    const outcome = await runRewriteStage(h.deps, input());

    expect(outcome).toMatchObject({
      state: INPUT,
      origin: 'original',
      needRewrite: true,
      score: 0.95,
      rewrite: '',
      reason: 'llm_failed',
    });
    expect(outcome.rewriteMs).not.toBeNull();
    expect(h.warns[0]).toMatchObject({
      event: 'intent-focus.rewrite.degraded',
      stage: 'rewrite',
      reason: 'llm_failed',
    });
  });

  it('归一化后为空（只有引号 / 空白）→ reason=empty_output，回退原文', async () => {
    const h = harness({ rewrite: async () => '""' });

    const outcome = await runRewriteStage(h.deps, input());

    expect(outcome).toMatchObject({ state: INPUT, needRewrite: true, rewrite: '', reason: 'empty_output' });
    expect(h.warns[0]).toMatchObject({ reason: 'empty_output' });
  });

  it('改写超 100 码点 → 截断后采用（仍只用于聚焦）', async () => {
    const long = '字'.repeat(REWRITE_MAX_CHARS + 20);
    const h = harness({ rewrite: async () => long });

    const outcome = await runRewriteStage(h.deps, input());

    expect(Array.from(outcome.state)).toHaveLength(REWRITE_MAX_CHARS);
    expect(outcome.rewriteTruncated).toBe(true);
    expect(outcome.origin).toBe('rewrite');
  });

  it('每轮至多一次改写：改写结果里再出现代指，也不重新判定（不递归）', async () => {
    const h = harness({ rewrite: async () => '结合上述原材料采购单分析到货延迟' });

    await runRewriteStage(h.deps, input());

    expect(h.judgeCalls).toHaveLength(1);
    expect(h.rewriteCalls).toHaveLength(1);
  });
});

describe('runRewriteStage —— 预算与素材', () => {
  it('剩余预算 <300ms：不发起改写，reason=budget_exhausted', async () => {
    const h = harness({ now: () => 10_000 });

    const outcome = await runRewriteStage(
      h.deps,
      input({ deadline: 10_000 + MIN_REWRITE_BUDGET_MS - 1 }),
    );

    expect(h.judgeCalls).toHaveLength(1);
    expect(h.rewriteCalls).toHaveLength(0);
    expect(outcome).toMatchObject({ state: INPUT, needRewrite: true, reason: 'budget_exhausted' });
    expect(h.infos.at(-1)).toMatchObject({
      event: 'intent-focus.rewrite.skipped',
      reason: 'budget_exhausted',
    });
  });

  it('改写超时取 min(rewriteTimeoutMs, 剩余 - 100)', async () => {
    const now = 1_000;
    const h = harness({ now: () => now });

    await runRewriteStage(h.deps, input({ deadline: now + 2_000 }));

    // 剩余 2000 → 2000 - 100 = 1900 < 5000
    expect(h.rewriteCalls[0]!.timeoutMs).toBe(2_000 - REWRITE_BUDGET_MARGIN_MS);
  });

  it('剩余预算充裕时用配置上限', async () => {
    const h = harness();

    await runRewriteStage(h.deps, input());

    expect(h.rewriteCalls[0]!.timeoutMs).toBe(CONFIG.rewriteTimeoutMs);
  });

  it('改写素材：最近 2 轮（时间正序）+ 当前输入，且只含正文', async () => {
    const h = harness({
      history: () => [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2', status: 'failed' },
        { role: 'user', content: 'u3' },
        { role: 'assistant', content: 'a3' },
        { role: 'user', content: 'u4' },
        { role: 'assistant', content: 'a4' },
      ],
    });

    const outcome = await runRewriteStage(h.deps, input());

    // 失败轮（u2/a2）整组不进素材；u2 因此变成孤立 user，被跳过，
    // 剩下 u1/a1、u3/a3、u4/a4 —— 上限 2 组，只保留最近的 u3/a3、u4/a4
    expect(outcome.historyTurns).toBe(2);
    const content = h.rewriteCalls[0]!.content;
    expect(content.indexOf('用户：u3')).toBeLessThan(content.indexOf('用户：u4'));
    expect(content).toContain('【当前输入】\n请根据上述结果分析');
    expect(content).not.toContain('a1');
    expect(content).not.toContain('a2');
    expect(content).not.toContain('用户：u1');
    expect(content).not.toContain('用户：u2');
  });

  it('无历史：素材只有当前输入，historyTurns=0，reason=no_history（说明素材受限）', async () => {
    const h = harness({ history: () => [] });

    const outcome = await runRewriteStage(h.deps, input());

    expect(outcome.historyTurns).toBe(0);
    expect(outcome.reason).toBe('no_history');
    expect(h.rewriteCalls[0]!.content).not.toContain('【最近对话】');
  });

  it('历史读失败：降级为"只有当前输入"，改写照常进行', async () => {
    const h = harness({
      history: () => {
        throw new Error('history.jsonl 损坏');
      },
    });

    const outcome = await runRewriteStage(h.deps, input());

    expect(outcome.origin).toBe('rewrite');
    expect(outcome.historyTurns).toBe(0);
    expect(h.warns.some((warn) => warn['reason'] === 'history_failed')).toBe(true);
  });
});

describe('runRewriteStage —— 日志不含正文', () => {
  it('done / degraded / skipped 的字段里都不出现用户原文与改写全文', async () => {
    const cases = [
      harness(),
      harness({ decided: { ok: false, reason: 'timeout', message: '超时' } }),
      harness({ rewrite: async () => '改写出来的完整句子内容' }),
      harness({ enabled: false }),
    ];

    for (const h of cases) {
      await runRewriteStage(h.deps, input());
      const logged = JSON.stringify([...h.infos, ...h.warns]);
      expect(logged).not.toContain(INPUT);
      expect(logged).not.toContain('改写出来的完整句子内容');
    }
  });
});

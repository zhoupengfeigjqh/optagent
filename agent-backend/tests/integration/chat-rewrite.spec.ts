import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { threadDir } from '../../src/domain/dirs.js';
import { HistoryStore } from '../../src/domain/history.js';
import { IntentFocusRunner } from '../../src/domain/intent-focus/runner.js';
import { IntentFocusStore } from '../../src/domain/intent-focus/store.js';
import { RunManager, type AgentRunRequest, type RunAgentLike } from '../../src/domain/run-manager.js';
import { isInputRewriteEnabled, isIntentFocusEnabled } from '../../src/domain/soul.js';
import type { LlmChatRequest, LlmProvider } from '../../src/infra/llm/llm-provider.js';
import { createRewriteLlm } from '../../src/infra/rewrite-llm.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import type { LlmEvent, ModelSelection } from '../../src/types.js';
import {
  AGENT,
  USER,
  ctxOf,
  send,
  setupRewriteEnv,
  writeAgent,
  type RewriteEnv,
} from './support/rewrite-env.js';

const ORIGINAL = '帮我创建一笔原材料采购单';
const FOLLOW_UP = '请根据上述结果分析';
const REWRITTEN = '分析上批原材料采购单的到货延迟';

let current: RewriteEnv | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function setup(options: Parameters<typeof setupRewriteEnv>[0]): Promise<RewriteEnv> {
  current = await setupRewriteEnv(options);
  return current;
}

function historyRaw(root: string, threadId: string): string {
  const file = path.join(threadDir(root, USER, AGENT, threadId), 'history.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

describe('027 指代改写：端到端（成功路径）', () => {
  it('第二轮含有指代：改写只用于聚焦，SSE / 正文 / 历史都只有原话', async () => {
    const env = await setup({ rewrite: true });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    const first = await send(env.app, thread.threadId, ORIGINAL);
    expect(first.statusCode).toBe(200);
    const second = await send(env.app, thread.threadId, FOLLOW_UP);

    expect(second.statusCode).toBe(200);
    expect(second.payload).toContain('本轮回答');
    expect(second.payload).not.toContain(REWRITTEN);

    expect(env.llmLog.rewritePrompts).toHaveLength(2);
    const material = env.llmLog.rewritePrompts[1]!;
    expect(material).toContain('【最近对话】');
    expect(material).toContain(`用户：${ORIGINAL}`);
    expect(material).toContain('助手：本轮回答');
    expect(material).toContain(`【当前输入】\n${FOLLOW_UP}`);

    expect(env.laya.states[0]).toBe(ORIGINAL);
    const followUpIndex = env.laya.states.indexOf(FOLLOW_UP);
    expect(followUpIndex).toBeGreaterThan(0);
    expect(env.laya.states.filter((state) => state === FOLLOW_UP)).toHaveLength(1);
    expect(env.laya.states.slice(1, followUpIndex).every((state) => state === REWRITTEN)).toBe(true);
    expect(env.laya.states.slice(followUpIndex + 1).every((state) => state === REWRITTEN)).toBe(
      true,
    );

    const raw = historyRaw(env.root, thread.threadId);
    expect(raw).toContain(ORIGINAL);
    expect(raw).toContain(FOLLOW_UP);
    expect(raw).not.toContain(REWRITTEN);

    const records = new IntentFocusStore(env.root).readAll(USER, AGENT, thread.threadId);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      input: FOLLOW_UP,
      need_rewrite: true,
      rewrite_score: 0.95,
      rewrite_query: REWRITTEN,
      rewrite_truncated: false,
      rewrite_history_turns: 1,
      rewrite_reason: null,
      error: null,
    });
    expect(records[1]!.rewrite_ms).toBeGreaterThanOrEqual(0);
  });

  it('开关关闭：判定照常，零改写调用、零读历史', async () => {
    const env = await setup({ rewrite: false });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    const res = await send(env.app, thread.threadId, FOLLOW_UP);

    expect(res.statusCode).toBe(200);
    expect(env.llmLog.rewritePrompts).toHaveLength(0);
    expect(env.laya.states).toHaveLength(2);
    const [record] = new IntentFocusStore(env.root).readAll(USER, AGENT, thread.threadId);
    expect(record).toMatchObject({ need_rewrite: null, rewrite_query: '', rewrite_reason: null });
  });

  it('阈值由配置驱动：0.99 时 0.95 分不改写', async () => {
    const env = await setup({
      rewrite: true,
      laya: { needRewrite: 0.95 },
      intentFocusLines: ['  rewrite_threshold: 0.99'],
    });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    const res = await send(env.app, thread.threadId, FOLLOW_UP);

    expect(res.statusCode).toBe(200);
    expect(env.llmLog.rewritePrompts).toHaveLength(0);
    const [record] = new IntentFocusStore(env.root).readAll(USER, AGENT, thread.threadId);
    expect(record).toMatchObject({
      need_rewrite: false,
      rewrite_score: 0.95,
      rewrite_query: '',
      rewrite_reason: 'below_threshold',
    });
  });
});

describe('027 指代改写：采用口径与零回归', () => {
  it('改写结果是陈述句 / 指令时正常采用（不强制问句）', async () => {
    const env = await setup({ rewrite: true, llm: { rewriteText: '把上批采购单按交期重排一遍' } });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    const res = await send(env.app, thread.threadId, FOLLOW_UP);

    expect(res.statusCode).toBe(200);
    const [record] = new IntentFocusStore(env.root).readAll(USER, AGENT, thread.threadId);
    expect(record).toMatchObject({
      need_rewrite: true,
      rewrite_query: '把上批采购单按交期重排一遍',
      rewrite_truncated: false,
      rewrite_reason: 'no_history',
    });
    expect(env.laya.states).toContain('把上批采购单按交期重排一遍');
  });

  it('改写超 100 码点：截断后采用并置位 rewrite_truncated', async () => {
    const long = '字'.repeat(130);
    const env = await setup({ rewrite: true, llm: { rewriteText: long } });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    await send(env.app, thread.threadId, FOLLOW_UP);

    const [record] = new IntentFocusStore(env.root).readAll(USER, AGENT, thread.threadId);
    expect(Array.from(record!.rewrite_query)).toHaveLength(100);
    expect(record!.rewrite_truncated).toBe(true);
    expect(record!.rewrite_reason).toBe('no_history');
  });

  it('独立问句（判定 false）：判定 1 次、改写 0 次、评分素材仍是原文尾部 200 字', async () => {
    const env = await setup({ rewrite: true, laya: { needRewrite: 0.05 } });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    await send(env.app, thread.threadId, FOLLOW_UP);

    expect(env.llmLog.rewritePrompts).toHaveLength(0);
    expect(env.laya.states[0]).toBe(FOLLOW_UP);
    expect(env.laya.states.every((state) => state === FOLLOW_UP)).toBe(true);

    const [record] = new IntentFocusStore(env.root).readAll(USER, AGENT, thread.threadId);
    expect(record).toMatchObject({
      need_rewrite: false,
      rewrite_score: 0.05,
      rewrite_query: '',
      rewrite_ms: null,
      rewrite_reason: 'below_threshold',
    });
  });

  it('零回归：改写关闭 vs 判定 false 两条路径的聚焦产物逐字一致', async () => {
    const offEnv = await setupRewriteEnv({ rewrite: false });
    const falseEnv = await setupRewriteEnv({ rewrite: true, laya: { needRewrite: 0.05 } });
    try {
      const runOnce = async (env: typeof offEnv) => {
        const thread = ctxOf(env.app).threadStore.create(USER, AGENT);
        await send(env.app, thread.threadId, FOLLOW_UP);
        return new IntentFocusStore(env.root).readAll(USER, AGENT, thread.threadId)[0]!;
      };

      const off = await runOnce(offEnv);
      const judgedFalse = await runOnce(falseEnv);

      expect(judgedFalse.skills).toEqual(off.skills);
      expect(judgedFalse.behaviors).toEqual(off.behaviors);
      expect(judgedFalse.prompt).toBe(off.prompt);
      expect(judgedFalse.prompt_truncated).toBe(off.prompt_truncated);
      expect(judgedFalse.truncated).toBe(off.truncated);
      expect(judgedFalse.disposition).toBe(off.disposition);
      expect(judgedFalse.batches).toBe(off.batches);
    } finally {
      await offEnv.close();
      await falseEnv.close();
    }
  });

  it('重新生成同一轮：每轮各自判定与改写，留档两条（不复用上一轮）', async () => {
    const env = await setup({ rewrite: true });
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    await send(env.app, thread.threadId, FOLLOW_UP);
    await send(env.app, thread.threadId, FOLLOW_UP);

    expect(env.llmLog.rewritePrompts).toHaveLength(2);
    const records = new IntentFocusStore(env.root).readAll(USER, AGENT, thread.threadId);
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.need_rewrite === true)).toBe(true);
    expect(records.every((record) => record.rewrite_query === REWRITTEN)).toBe(true);
    expect(env.llmLog.rewritePrompts[1]).toContain('【最近对话】');
  });

  it('术语替换关闭时：判定素材就是提交原文（运行期不做第二次替换）', async () => {
    const env = await setup({ rewrite: true });
    const tableDir = path.join(env.root, 'users', USER, 'agents', AGENT, 'ontology', '生产调度', '原材料采购和库存');
    fs.writeFileSync(
      path.join(tableDir, 'term_mapping.json'),
      JSON.stringify({ 采购单: '订单' }, null, 2),
      'utf8',
    );
    const thread = ctxOf(env.app).threadStore.create(USER, AGENT);

    await send(env.app, thread.threadId, FOLLOW_UP);

    expect(env.laya.states[0]).toBe(FOLLOW_UP);
  });
});

describe('027 指代改写：请求级模型选择', () => {
  it('本轮指定模型时，改写走该模型的 provider（与主对话同源）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-chat-rewrite-model-'));
    const usage = new UsageDb(path.join(root, 'usage.db'));
    try {
      writeAgent(root, { rewrite: true });

      const seen: string[] = [];
      const provider = (label: string): LlmProvider => ({
        async *streamChat(req: LlmChatRequest) {
          if (req.systemPrompt.includes('输入改写助手')) seen.push(label);
          yield { type: 'content_delta', delta: 'x' } as LlmEvent;
          yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } } as LlmEvent;
        },
      });
      const rewriteLlm = createRewriteLlm({
        llm: () => provider('default'),
        providerFor: () => provider('selected'),
      });

      const runner = new IntentFocusRunner({
        root,
        config: {
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
        },
        client: {
          decide: async (_state, questions) => {
            const scores: Record<string, number> = {};
            for (const qid of Object.keys(questions)) scores[qid] = qid === 'need_rewrite' ? 0.95 : 0.9;
            return { ok: true, scores, model: 'laya' };
          },
        },
        store: new IntentFocusStore(root),
        isEnabled: () => true,
        isRewriteEnabled: () => true,
        rewriteLlm,
        readHistory: () => [],
      });

      const manager = new RunManager({ history: new HistoryStore(root), usage, intentFocus: runner });
      const agent: RunAgentLike = {
        key: { userId: USER, agentName: AGENT },
        activeThreads: 0,
        async *run(_req: AgentRunRequest) {
          yield { type: 'content_delta', delta: 'ok' } as LlmEvent;
        },
      };
      const model: ModelSelection = { model: 'selected-model', apiKey: 'k2' };

      const run = manager.startRun({
        userId: USER,
        threadId: 'th_model',
        agent,
        userMessage: FOLLOW_UP,
        thinking: false,
        model,
      });
      await run.settled;

      expect(seen).toEqual(['selected']);
    } finally {
      usage.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('027 指代改写：SOUL 开关读取（部署后即生效）', () => {
  it('frontmatter 写入 input_rewrite 后，读取侧立即为 true', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-chat-rewrite-soul-'));
    try {
      writeAgent(root, { rewrite: false });
      expect(isIntentFocusEnabled(root, USER, AGENT)).toBe(true);
      expect(isInputRewriteEnabled(root, USER, AGENT)).toBe(false);

      writeAgent(root, { rewrite: true });

      expect(isInputRewriteEnabled(root, USER, AGENT)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

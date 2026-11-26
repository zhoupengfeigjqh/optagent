import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryStore } from '../../src/domain/history.js';
import type { InteractionSink } from '../../src/domain/interaction-gate.js';
import {
  RunManager,
  type RunAgentLike,
  type SsePayload,
  type StartRunOptions,
} from '../../src/domain/run-manager.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import type { AgentRunRequest, LlmEvent } from '../../src/types.js';

const SCHEMA = {
  type: 'object',
  properties: { n: { type: 'integer' } },
  required: ['n'],
  additionalProperties: false,
} as const;

const AGENT = 'demo';

let root: string;
let history: HistoryStore;
let usage: UsageDb;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manager-interaction-'));
  history = new HistoryStore(root);
  usage = new UsageDb(path.join(root, 'usage.db'));
});

afterEach(() => {
  usage.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function interactionAgent(
  script: (sink: InteractionSink | undefined) => AsyncIterable<LlmEvent>,
): RunAgentLike {
  return {
    key: { userId: 'admin', agentName: 'demo' },
    activeThreads: 0,
    run: (req: AgentRunRequest) => script(req.interactionSink),
  };
}

function manager() {
  return new RunManager({ history, usage });
}

function startOpts(agent: RunAgentLike): StartRunOptions {
  return { userId: 'admin', threadId: 'th_1', agent, userMessage: '查一下', thinking: false };
}

async function* confirmScript(sink: InteractionSink | undefined): AsyncIterable<LlmEvent> {
  await new Promise((r) => setTimeout(r, 10));
  const outcome = await sink!.request({
    callId: 'c1',
    toolName: 'svc__query',
    schema: SCHEMA,
    proposedArgs: { n: 1 },
  });
  if (outcome.kind === 'submit') {
    yield { type: 'content_delta', delta: `确认后执行 n=${outcome.args.n}` };
  } else {
    yield { type: 'content_delta', delta: '调用未执行' };
  }
  yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } };
}

describe('run-manager × 交互门', () => {
  it('全链路：SSE 事件 → 快照 → submit 终验通过 → 工具以用户 args 继续并 done', async () => {
    const m = manager();
    const run = m.startRun(startOpts(interactionAgent(confirmScript)));
    const events: SsePayload[] = [];
    run.subscribe((e) => events.push(e));

    await vi.waitFor(() => expect(events.some((e) => e.type === 'interaction_request')).toBe(true));
    const ev = events.find((e) => e.type === 'interaction_request')!;
    if (ev.type !== 'interaction_request') throw new Error('unreachable');
    expect(ev.data.tool_name).toBe('svc__query');
    expect(ev.data.required).toEqual(['n']);
    expect(ev.data.proposed_args).toEqual({ n: 1 });
    expect(ev.data.timeout_seconds).toBe(300);

    const snapshot = m.pendingInteractionOf('th_1');
    expect(snapshot?.interaction_id).toBe(ev.data.interaction_id);
    expect(snapshot?.remaining_seconds).toBeGreaterThan(0);

    const bad = m.resolveInteraction('th_1', ev.data.interaction_id, 'submit', { n: 'x' });
    expect(bad).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(m.pendingInteractionOf('th_1')).not.toBeNull();

    const ok = m.resolveInteraction('th_1', ev.data.interaction_id, 'submit', { n: 5 });
    expect(ok).toEqual({ ok: true, result: 'settled' });

    await run.settled;
    const messages = history.readRecent('admin', AGENT, 'th_1', 10);
    const assistant = messages.filter((x) => x.role === 'assistant').at(-1);
    expect(assistant?.content).toContain('确认后执行 n=5');
    expect(m.pendingInteractionOf('th_1')).toBeNull();
  });

  it('幂等：重复 submit 返回 already-resolved', async () => {
    const m = manager();
    const run = m.startRun(startOpts(interactionAgent(confirmScript)));
    const id = vi
      .waitFor(() => {
        const s = m.pendingInteractionOf('th_1');
        expect(s).not.toBeNull();
        return s!;
      })
      .then((s) => s.interaction_id);

    const interactionId = await id;
    expect(m.resolveInteraction('th_1', interactionId, 'submit', { n: 1 })).toEqual({
      ok: true,
      result: 'settled',
    });
    expect(m.resolveInteraction('th_1', interactionId, 'submit', { n: 2 })).toEqual({
      ok: true,
      result: 'already-resolved',
    });
    await run.settled;
    const assistant = history
      .readRecent('admin', AGENT, 'th_1', 10)
      .filter((x) => x.role === 'assistant')
      .at(-1);
    expect(assistant?.content).toContain('n=1');
  });

  it('reject：工具收到拒绝 outcome，本轮以 done 收尾（模型自行组织话术）', async () => {
    const m = manager();
    const run = m.startRun(startOpts(interactionAgent(confirmScript)));
    const interactionId = await vi
      .waitFor(() => {
        const s = m.pendingInteractionOf('th_1');
        expect(s).not.toBeNull();
        return s!;
      })
      .then((s) => s.interaction_id);

    expect(m.resolveInteraction('th_1', interactionId, 'reject')).toEqual({
      ok: true,
      result: 'settled',
    });
    await run.settled;
    const assistant = history
      .readRecent('admin', AGENT, 'th_1', 10)
      .filter((x) => x.role === 'assistant')
      .at(-1);
    expect(assistant?.content).toContain('调用未执行');
  });

  it('无进行中 run：resolveInteraction 返回 NOT_FOUND', () => {
    const m = manager();
    expect(m.resolveInteraction('th_nope', 'i_x', 'reject')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('stop：挂起点被 drain，await sink 的工具不悬挂，本轮可收尾', async () => {
    const m = manager();
    const run = m.startRun(startOpts(interactionAgent(confirmScript)));
    await vi.waitFor(() => expect(m.pendingInteractionOf('th_1')).not.toBeNull());

    expect(m.stop('th_1')).toBe(true);
    await run.settled; // 不超时即证明挂起点已收尾
    const assistant = history
      .readRecent('admin', AGENT, 'th_1', 10)
      .filter((x) => x.role === 'assistant')
      .at(-1);
    expect(assistant?.content).toContain('调用未执行');
  });
});

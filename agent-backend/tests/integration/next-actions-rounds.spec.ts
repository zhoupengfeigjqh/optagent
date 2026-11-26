import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryStore } from '../../src/domain/history.js';
import { MAX_ACTIONS, NextActionsStore } from '../../src/domain/next-actions.js';
import {
  RunManager,
  type AgentRunRequest,
  type RunAgentLike,
} from '../../src/domain/run-manager.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import type { LlmEvent } from '../../src/types.js';

const USER = 'admin';
const THREAD = 'th_1';
const AGENT = 'demo';

let root: string;
let usage: UsageDb;

function snapshotFile(): string {
  return path.join(root, 'users', USER, 'user-data', AGENT, 'threads', THREAD, 'next-actions.json');
}

function tailFor(round: number): string {
  return `<next_actions>${JSON.stringify({
    actions: [
      {
        prompt: `第 ${round} 轮建议：核对交付日期`,
        tool_tips: [TOOL_TIP],
      },
    ],
  })}</next_actions>`;
}

const TOOL_TIP = {
  name: 'QueryPurchaseRecords',
  title: '查询采购订单信息',
  ontology_id: '1',
  ontology_name: '采购管理',
};

function intentFocusStub() {
  return { judge: async () => ({ prompt: '', toolTips: [TOOL_TIP] }) };
}

function stubAgent(round: number, recorder?: { maxes: Array<number | undefined> }): RunAgentLike {
  return {
    key: { userId: USER, agentName: AGENT },
    activeThreads: 0,
    // 注意签名：`RunAgentLike.run` 收**一个请求对象**（`{ threadId, messages, runtime, … }`），
    async *run(req: AgentRunRequest) {
      if (req.runtime)
        req.runtime.availableTools = [{ name: 'read_file', description: '读取文件' }];
      recorder?.maxes.push(req.nextActionsMax);
      yield { type: 'content_delta', delta: `第 ${round} 轮回答正文` } as LlmEvent;
      yield { type: 'content_delta', delta: tailFor(round) } as LlmEvent;
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 2 } } as LlmEvent;
    },
  };
}

function collectContent(run: {
  subscribe(cb: (e: { type: string; data: unknown }) => void): void;
}): {
  deltas: string[];
  doneData: Array<Record<string, unknown>>;
} {
  const deltas: string[] = [];
  const doneData: Array<Record<string, unknown>> = [];
  run.subscribe((e) => {
    if (e.type === 'content') deltas.push((e.data as { delta: string }).delta);
    if (e.type === 'done') doneData.push(e.data as Record<string, unknown>);
  });
  return { deltas, doneData };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'next-actions-rounds-'));
  usage = new UsageDb(path.join(root, 'usage.db'));
});

afterEach(() => {
  usage.close();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('连续两轮的下一步动作提示（Tail Protocol 全链路）', () => {
  it('两轮各自产出卡片：done 直推当轮卡片、快照覆盖、落盘正文不含尾部块', async () => {
    const store = new NextActionsStore(root, {});
    const history = new HistoryStore(root);
    const manager = new RunManager({
      history,
      usage,
      nextActions: store,
      nextActionsConfig: () => ({ enabled: true, max: MAX_ACTIONS }),
      intentFocus: intentFocusStub(),
    });

    const round1 = manager.startRun({
      userId: USER,
      threadId: THREAD,
      agent: stubAgent(1),
      userMessage: '帮我看看这批订单',
      thinking: false,
    });
    const sse1 = collectContent(round1);
    await round1.settled;

    expect(sse1.doneData[0]).toMatchObject({
      message_id: round1.assistantMessageId,
      next_actions: {
        message_id: round1.assistantMessageId,
        actions: [{ prompt: '第 1 轮建议：核对交付日期', tool_tips: [TOOL_TIP] }],
      },
    });
    expect(sse1.deltas.join('')).toBe('第 1 轮回答正文');
    expect(store.read(USER, AGENT, THREAD)?.message_id).toBe(round1.assistantMessageId);

    const round2 = manager.startRun({
      userId: USER,
      threadId: THREAD,
      agent: stubAgent(2),
      userMessage: '按交付日期梳理这批订单的风险',
      thinking: false,
    });
    expect(store.read(USER, AGENT, THREAD)).toBeUndefined();
    const sse2 = collectContent(round2);
    await round2.settled;

    expect(round2.assistantMessageId).not.toBe(round1.assistantMessageId);
    expect(sse2.doneData[0]).toMatchObject({
      message_id: round2.assistantMessageId,
      next_actions: {
        message_id: round2.assistantMessageId,
        actions: [{ prompt: '第 2 轮建议：核对交付日期', tool_tips: [TOOL_TIP] }],
      },
    });
    expect(store.read(USER, AGENT, THREAD)?.message_id).toBe(round2.assistantMessageId);
    const roles = history.readAll(USER, AGENT, THREAD);
    expect(roles.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(roles[1]!.content).toBe('第 1 轮回答正文');
    expect(roles[3]!.content).toBe('第 2 轮回答正文');
  });

  it('开关关闭（nextActionsConfig → null）→ 请求不带 nextActionsMax、done 不带卡片、无快照', async () => {
    const store = new NextActionsStore(root, {});
    const history = new HistoryStore(root);
    const manager = new RunManager({ history, usage, nextActions: store, intentFocus: intentFocusStub() });
    const maxes: Array<number | undefined> = [];

    const run = manager.startRun({
      userId: USER,
      threadId: THREAD,
      agent: stubAgent(1, { maxes }),
      userMessage: '你好',
      thinking: false,
    });
    const sse = collectContent(run);
    await run.settled;

    expect(maxes).toEqual([undefined]);
    expect(JSON.stringify(sse.doneData[0])).not.toContain('next_actions');
    expect(fs.existsSync(snapshotFile())).toBe(false);
    expect(sse.deltas.join('')).toBe('第 1 轮回答正文');
  });
});

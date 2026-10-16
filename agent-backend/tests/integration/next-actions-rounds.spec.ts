/**
 * 集成测试：**连续两轮**的「下一步动作提示」链路（007 修订 · Tail Protocol）。
 *
 * 修订前本文件守住的是"独立生成链的两轮时序"；修订后卡片与回答**同流产出**，
 * 这里改用真实 `RunManager` + `RunFinalizer` + `NextActionsStore`（只把模型换成桩）
 * 守住新链路的三条硬约束：
 *
 * 1. 尾部块对用户**不可见**：SSE content 逐字 = 落盘正文（不含块）；
 * 2. 卡片随 `done` **直推**（`settle` 后即可判定，无轮询、无窗口），
 *    快照归属当轮 assistant 消息；第 2 轮开始即清空第 1 轮快照；
 * 3. 开关关闭（`nextActionsConfig` 返回 `null`）→ 请求不带 `nextActionsMax`、
 *    done 不带卡片、无快照——提示词装配期是唯一门控。
 */
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
/** 本用例的数字人（009：会话/快照落在 user-data/{数字人}/threads/{会话}） */
const AGENT = 'demo';

let root: string;
let usage: UsageDb;

function snapshotFile(): string {
  return path.join(root, 'users', USER, 'user-data', AGENT, 'threads', THREAD, 'next-actions.json');
}

/**
 * 尾部块：每轮条目不同，便于确认"确实是本轮产出"。
 *
 * 条目必须绑定本轮可用工具（`stubAgent` 回填的 `read_file`）：2026-10-14 起，
 * 无工具绑定的条目会被定稿层整条丢弃（FR-009），卡片也就随 `done` 推不出去。
 */
function tailFor(round: number): string {
  return `<next_actions>${JSON.stringify({
    actions: [
      {
        prompt: `第 ${round} 轮建议：核对交付日期`,
        tools: [{ kind: 'builtin', name: 'read_file' }],
      },
    ],
  })}</next_actions>`;
}

/**
 * 假数字人：产出一段回答 + 尾部块 + done（并把 runtime 的可用工具按 `agent-factory` 的口径回填）。
 * `req.nextActionsMax` 由 RunManager 按 SOUL 配置注入——桩顺手记录，供开关断言使用。
 */
function stubAgent(round: number, recorder?: { maxes: Array<number | undefined> }): RunAgentLike {
  return {
    key: { userId: USER, agentName: AGENT },
    activeThreads: 0,
    // 注意签名：`RunAgentLike.run` 收**一个请求对象**（`{ threadId, messages, runtime, … }`），
    // 不是 `(messages, options)` —— 传错参数会让 generator 内部抛错、整轮走 error 分支
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

/** 收集 SSE content 增量（模拟前端"用户所见"） */
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

    // done 直推：卡片就绪且归属第 1 轮（无需任何轮询窗口）
    expect(sse1.doneData[0]).toMatchObject({
      message_id: round1.assistantMessageId,
      next_actions: {
        message_id: round1.assistantMessageId,
        actions: [{ prompt: '第 1 轮建议：核对交付日期' }],
      },
    });
    // 用户所见 = 落盘正文（不含尾部块）
    expect(sse1.deltas.join('')).toBe('第 1 轮回答正文');
    expect(store.read(USER, AGENT, THREAD)?.message_id).toBe(round1.assistantMessageId);

    // 第 2 轮：开始即清空第 1 轮快照（发起新一轮的瞬间旧卡片消失）
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
        actions: [{ prompt: '第 2 轮建议：核对交付日期' }],
      },
    });
    // 快照只归最新一轮：第 1 轮的消息 id 上不再有任何卡片（FR-015 / FR-017）
    expect(store.read(USER, AGENT, THREAD)?.message_id).toBe(round2.assistantMessageId);
    // 历史 jsonl 永不含卡片内容
    const roles = history.readAll(USER, AGENT, THREAD);
    expect(roles.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(roles[1]!.content).toBe('第 1 轮回答正文');
    expect(roles[3]!.content).toBe('第 2 轮回答正文');
  });

  it('开关关闭（nextActionsConfig → null）→ 请求不带 nextActionsMax、done 不带卡片、无快照', async () => {
    const store = new NextActionsStore(root, {});
    const history = new HistoryStore(root);
    const manager = new RunManager({ history, usage, nextActions: store });
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
    // 模型即便没守规矩照样输出了块：块内容也不应透给用户（捕获照常工作）
    expect(sse.deltas.join('')).toBe('第 1 轮回答正文');
  });
});

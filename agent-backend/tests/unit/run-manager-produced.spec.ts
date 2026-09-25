/**
 * 单元测试：正文池组装时注入「后台计算结果」段（R11，契约 §10.5 ③ / §10.6 不变式 5）
 *
 * 两条：
 * 1. 有产出 → 该段出现在 `systemExtra`，且与**摘要段并列**（摘要在前）；
 * 2. 无产出 → 段长度为 0（不占一个字符），`systemExtra` 不因"空产出段"而多出来。
 *
 * 独立成文件：`run-manager-tool-events.spec.ts` 已承载上下文池用例，新用例不再往里堆。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryStore } from '../../src/domain/history.js';
import {
  RunManager,
  type AgentRunRequest,
  type RunAgentLike,
  type StartRunOptions,
} from '../../src/domain/run-manager.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import type { LlmEvent } from '../../src/types.js';

let root: string;
let history: HistoryStore;
let usage: UsageDb;

async function* plainTurn(): AsyncIterable<LlmEvent> {
  yield { type: 'content_delta', delta: '好的' };
  yield { type: 'done', usage: { inputTokens: 3, outputTokens: 1 } };
}

/** 记录每次 run 收到的请求（用于断言提示词投影） */
function recordingAgent(captured: AgentRunRequest[]): RunAgentLike {
  return {
    key: { userId: 'admin', agentName: 'demo' },
    activeThreads: 0,
    run: (req: AgentRunRequest) => {
      captured.push(req);
      return plainTurn();
    },
  };
}

async function runOnce(manager: RunManager): Promise<AgentRunRequest[]> {
  const captured: AgentRunRequest[] = [];
  const opts: StartRunOptions = {
    userId: 'admin',
    threadId: 'th1',
    agent: recordingAgent(captured),
    userMessage: '继续',
    thinking: false,
  };
  await manager.startRun(opts).settled;
  return captured;
}

const PRODUCED_TEXT =
  '【后台计算结果】（需要内容时用 read_file 按路径读取）\n' +
  '- ocr__submit_ocr · 2 分钟前 · 已完成 · 128.0 KB · 临时空间/后台产出/th1_j_1.json';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manager-produced-'));
  history = new HistoryStore(root);
  usage = new UsageDb(path.join(root, 'usage.db'));
});

afterEach(() => {
  usage.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('后台计算结果清单注入（R11）', () => {
  it('有产出：整段文本进 systemExtra，且按当前用户与会话取', async () => {
    const asked: Array<[string, string]> = [];
    const manager = new RunManager({
      history,
      usage,
      produced: async (userId, threadId) => {
        asked.push([userId, threadId]);
        return PRODUCED_TEXT;
      },
    });

    const [req] = await runOnce(manager);

    expect(asked).toEqual([['admin', 'th1']]);
    expect(req!.systemExtra).toContain('【后台计算结果】');
    expect(req!.systemExtra).toContain('临时空间/后台产出/th1_j_1.json');
  });

  it('无产出（装配侧返回空串）：该段长度为 0，systemExtra 不因此出现（不变式 5）', async () => {
    const manager = new RunManager({ history, usage, produced: async () => '' });
    const [req] = await runOnce(manager);

    expect(req!.systemExtra).toBeUndefined();
    expect(req!.messages.map((m) => m.content).join('\n')).not.toContain('后台计算结果');
  });

  it('未装配 produced：与既有行为完全一致（不注入、不报错）', async () => {
    const manager = new RunManager({ history, usage });
    const [req] = await runOnce(manager);

    expect(req!.systemExtra).toBeUndefined();
  });

  it('与摘要段并列：摘要在前、产出清单在后', async () => {
    const manager = new RunManager({
      history,
      usage,
      summary: {
        read: () => ({ summary: '早前摘要', coveredCount: 0 }),
        trigger: async () => {},
      },
      produced: async () => PRODUCED_TEXT,
    });

    const [req] = await runOnce(manager);
    const extra = req!.systemExtra ?? '';

    expect(extra).toContain('早前摘要');
    expect(extra.indexOf('早前摘要')).toBeLessThan(extra.indexOf('【后台计算结果】'));
  });
});

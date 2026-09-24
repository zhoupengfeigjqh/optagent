/**
 * 单元测试：工具记录落盘与下一轮回灌（002 特性）
 *
 * 这是本特性的**主链路**验证：
 * 1. 工具调用 → 落 `tool-events.jsonl`，且 `message_id` 与该轮 assistant 消息一致
 * 2. 下一轮的 prompt 里能"看到"上一轮的工具结果（内联小结果按预算回灌）
 * 3. 外置大结果：正文不进 messages，只在 systemExtra 留一行索引（带路径）
 * 4. 未装配 toolEvents 时行为与既有完全一致（回灌与落盘都不发生）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileAccess } from '../../src/domain/file-access.js';
import { HistoryStore } from '../../src/domain/history.js';
import {
  RunManager,
  type AgentRunRequest,
  type RunAgentLike,
  type SsePayload,
  type StartRunOptions,
} from '../../src/domain/run-manager.js';
import { ToolEventStore } from '../../src/domain/tool-events.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import type { LlmEvent } from '../../src/types.js';

let root: string;
let history: HistoryStore;
let usage: UsageDb;
let toolEvents: ToolEventStore;

/** 记录每次 run 收到的请求（用于断言提示词投影），并按脚本产出事件 */
function recordingAgent(
  captured: AgentRunRequest[],
  script: (() => AsyncIterable<LlmEvent>) | AsyncIterable<LlmEvent>,
): RunAgentLike {
  return {
    key: { userId: 'admin', agentName: 'demo' },
    activeThreads: 0,
    run: (req: AgentRunRequest) => {
      captured.push(req);
      return typeof script === 'function' ? script() : script;
    },
  };
}

async function* toolTurn(resultText: string): AsyncIterable<LlmEvent> {
  yield { type: 'tool_call_start', callId: 'call_1', name: 'read_file', argsDigest: { path: '数据准备/x.csv' } };
  yield { type: 'tool_call_end', callId: 'call_1', name: 'read_file', status: 'success', resultText };
  yield { type: 'content_delta', delta: '我读到了计划量' };
  yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
}

async function* plainTurn(): AsyncIterable<LlmEvent> {
  yield { type: 'content_delta', delta: '好的' };
  yield { type: 'done', usage: { inputTokens: 3, outputTokens: 1 } };
}

function runTurn(
  manager: RunManager,
  agent: RunAgentLike,
  userMessage: string,
): { settled: Promise<void>; events: SsePayload[] } {
  const opts: StartRunOptions = { userId: 'admin', threadId: 'th1', agent, userMessage, thinking: false };
  const run = manager.startRun(opts);
  const events: SsePayload[] = [];
  run.subscribe((e) => events.push(e));
  return { settled: run.settled, events };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manager-tool-'));
  history = new HistoryStore(root);
  usage = new UsageDb(path.join(root, 'usage.db'));
  toolEvents = new ToolEventStore({
    root,
    artifacts: (userId: string) => new FileAccess({ optAgentRoot: root, userId }),
  });
});

afterEach(() => {
  usage.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('工具记录落盘', () => {
  it('工具调用落盘，且 message_id 与该轮 assistant 消息一致（前端据此挂卡片）', async () => {
    const manager = new RunManager({ history, usage, toolEvents });
    const captured: AgentRunRequest[] = [];
    const { settled, events } = runTurn(manager, recordingAgent(captured, () => toolTurn('车间,计划量\n冲压,1200')), '看下计划');
    await settled;

    const done = events.find((e) => e.type === 'done');
    const assistantId = (done as { data: { message_id: string } }).data.message_id;

    const records = toolEvents.readAll('admin', 'th1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      callId: 'call_1',
      messageId: assistantId,
      name: 'read_file',
      status: 'success',
      content: '车间,计划量\n冲压,1200',
      argsDigest: { path: '数据准备/x.csv' },
    });
    expect(records[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('工具记录按归属消息分组可查（详情接口挂卡片的入口）', async () => {
    const manager = new RunManager({ history, usage, toolEvents });
    const { settled } = runTurn(manager, recordingAgent([], () => toolTurn('ok')), '看下计划');
    await settled;

    const grouped = toolEvents.readByMessage('admin', 'th1');
    expect([...grouped.values()].flat()).toHaveLength(1);
  });
});

describe('下一轮回灌', () => {
  it('内联小结果：原文回灌到对应轮次的 assistant 消息（带工具名，位置感正确）', async () => {
    const manager = new RunManager({ history, usage, toolEvents });
    await runTurn(manager, recordingAgent([], () => toolTurn('车间,计划量\n冲压,1200')), '看下计划').settled;

    const captured: AgentRunRequest[] = [];
    await runTurn(manager, recordingAgent(captured, () => plainTurn()), '再确认下').settled;

    expect(captured).toHaveLength(1);
    const messages = captured[0]!.messages;
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toContain('我读到了计划量');
    expect(assistant?.content).toContain('[工具 read_file 结果]');
    expect(assistant?.content).toContain('冲压,1200');
    // 本轮新消息仍是最后一条，且不含工具结果
    expect(messages[messages.length - 1]).toMatchObject({ role: 'user', content: '再确认下' });
  });

  it('外置大结果：正文不进 messages，systemExtra 只留一行索引（含可读路径）', async () => {
    const big = '车间,计划量\n冲压,1200\n'.repeat(1500); // ~33KB > 内联阈值
    const manager = new RunManager({ history, usage, toolEvents });
    await runTurn(manager, recordingAgent([], () => toolTurn(big)), '看下计划').settled;

    const captured: AgentRunRequest[] = [];
    await runTurn(manager, recordingAgent(captured, () => plainTurn()), '第 3 页呢').settled;

    const req = captured[0]!;
    // 正文一个字节都不进 messages
    const joined = req.messages.map((m) => m.content).join('\n');
    expect(joined).not.toContain(big);
    expect(joined).not.toContain('冲压,1200\n冲压,1200');
    // 索引段给出名称、体积与路径
    expect(req.systemExtra).toContain('【可用的工具结果原文】');
    expect(req.systemExtra).toContain('read_file');
    expect(req.systemExtra).toContain('临时空间/th1_toolresult_call_1.txt');
  });

  it('未装配 toolEvents：不落盘也不回灌（既有行为零变化）', async () => {
    const manager = new RunManager({ history, usage });
    await runTurn(manager, recordingAgent([], () => toolTurn('内部结果')), '看下计划').settled;

    const captured: AgentRunRequest[] = [];
    await runTurn(manager, recordingAgent(captured, () => plainTurn()), '再确认下').settled;

    expect(captured[0]!.systemExtra).toBeUndefined();
    const joined = captured[0]!.messages.map((m) => m.content).join('\n');
    expect(joined).not.toContain('内部结果');
    expect(fs.existsSync(path.join(root, 'users', 'admin', 'user-data', 'threads', 'th1', 'tool-events.jsonl'))).toBe(false);
  });
});

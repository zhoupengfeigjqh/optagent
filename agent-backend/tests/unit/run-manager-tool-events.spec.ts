import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POOL_MAX_MESSAGES } from '../../src/domain/context-window.js';
import { threadDir } from '../../src/domain/dirs.js';
import { FileAccess } from '../../src/domain/file-access.js';
import { HistoryStore } from '../../src/domain/history.js';
import {
  RunManager,
  type AgentRunRequest,
  type RunAgentLike,
  type SsePayload,
  type StartRunOptions,
} from '../../src/domain/run-manager.js';
import { SummaryStore, type SummaryLlm } from '../../src/domain/summary.js';
import { ToolEventStore } from '../../src/domain/tool-events.js';
import { TOOL_INLINE_MAX_BYTES } from '../../src/domain/tool-result.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import type { LlmEvent } from '../../src/types.js';

/** 本用例使用的数字人（数据域一级目录名，009 会话/临时空间都在它下面） */
const AGENT = 'demo';

let root: string;
let history: HistoryStore;
let usage: UsageDb;
let toolEvents: ToolEventStore;

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

async function* toolTurn(resultText: string, name = 'read_file'): AsyncIterable<LlmEvent> {
  yield {
    type: 'tool_call_start',
    callId: 'call_1',
    name,
    argsDigest: { path: '数据准备/x.csv' },
  };
  yield {
    type: 'tool_call_end',
    callId: 'call_1',
    name,
    status: 'success',
    resultText,
  };
  yield { type: 'content_delta', delta: '我读到了计划量' };
  yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
}

async function* plainTurn(): AsyncIterable<LlmEvent> {
  yield { type: 'content_delta', delta: '好的' };
  yield { type: 'done', usage: { inputTokens: 3, outputTokens: 1 } };
}

async function* toolThenErrorTurn(resultText: string): AsyncIterable<LlmEvent> {
  yield {
    type: 'tool_call_start',
    callId: 'call_1',
    name: 'read_file',
    argsDigest: { path: '数据准备/x.csv' },
  };
  yield {
    type: 'tool_call_end',
    callId: 'call_1',
    name: 'read_file',
    status: 'success',
    resultText,
  };
  yield { type: 'content_delta', delta: '半截回答' };
  yield { type: 'error', code: 'LLM_ERROR', message: '上游模型不可用' };
}

function runTurn(
  manager: RunManager,
  agent: RunAgentLike,
  userMessage: string,
): { settled: Promise<void>; events: SsePayload[] } {
  const opts: StartRunOptions = {
    userId: 'admin',
    threadId: 'th1',
    agent,
    userMessage,
    thinking: false,
  };
  const run = manager.startRun(opts);
  const events: SsePayload[] = [];
  run.subscribe((e) => events.push(e));
  return { settled: run.settled, events };
}

async function seedHistory(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await history.append('admin', AGENT, 'th1', {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `h${i}`,
    });
  }
}

function writeSummary(covered: number, text = '早前摘要'): void {
  const dir = threadDir(root, 'admin', AGENT, 'th1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'summary.json'),
    JSON.stringify({ summary: text, covered_count: covered }),
    'utf8',
  );
}

const poolLlm: SummaryLlm = {
  async *streamChat() {
    yield { type: 'content_delta', delta: '摘要正文' };
  },
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manager-tool-'));
  history = new HistoryStore(root);
  usage = new UsageDb(path.join(root, 'usage.db'));
  toolEvents = new ToolEventStore({
    root,
    artifacts: (userId: string, agentName: string) =>
      new FileAccess({ optAgentRoot: root, userId, agentName }),
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
    const { settled, events } = runTurn(
      manager,
      recordingAgent(captured, () => toolTurn('车间,计划量\n冲压,1200')),
      '看下计划',
    );
    await settled;

    const done = events.find((e) => e.type === 'done');
    const assistantId = (done as { data: { message_id: string } }).data.message_id;

    const records = toolEvents.readAll('admin', AGENT, 'th1');
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

  it('失败轮：failed 行的 id 与工具记录的 message_id 一致（卡片同样能挂上，2026-11-18）', async () => {
    const manager = new RunManager({ history, usage, toolEvents });
    const { settled } = runTurn(
      manager,
      recordingAgent([], () => toolThenErrorTurn('车间,计划量')),
      '看下计划',
    );
    await settled;

    const failed = history.readAll('admin', AGENT, 'th1').find((m) => m.status === 'failed');
    const records = toolEvents.readAll('admin', AGENT, 'th1');
    expect(records).toHaveLength(1);
    // 两处 id 必须同源：否则详情接口按消息分组时找不到这条记录，失败轮的卡片永远点不开结果
    expect(failed?.id).toBe(records[0]!.messageId);
    expect(toolEvents.readByMessage('admin', AGENT, 'th1').get(failed!.id)).toHaveLength(1);
  });

  it('工具记录按归属消息分组可查（详情接口挂卡片的入口）', async () => {
    const manager = new RunManager({ history, usage, toolEvents });
    const { settled } = runTurn(
      manager,
      recordingAgent([], () => toolTurn('ok')),
      '看下计划',
    );
    await settled;

    const grouped = toolEvents.readByMessage('admin', AGENT, 'th1');
    expect([...grouped.values()].flat()).toHaveLength(1);
  });
});

describe('下一轮回灌', () => {
  it('内联小结果：原文回灌到对应轮次的 assistant 消息（带工具名，位置感正确）', async () => {
    const manager = new RunManager({ history, usage, toolEvents });
    await runTurn(
      manager,
      recordingAgent([], () => toolTurn('车间,计划量\n冲压,1200')),
      '看下计划',
    ).settled;

    const captured: AgentRunRequest[] = [];
    await runTurn(
      manager,
      recordingAgent(captured, () => plainTurn()),
      '再确认下',
    ).settled;

    expect(captured).toHaveLength(1);
    const messages = captured[0]!.messages;
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toContain('我读到了计划量');
    expect(assistant?.content).toContain('[工具 read_file 结果]');
    expect(assistant?.content).toContain('冲压,1200');
    expect(messages[messages.length - 1]).toMatchObject({ role: 'user', content: '再确认下' });
  });

  it('内置工具大结果：回灌截断版 + 说明"完整内容未保存"（2026-11-07）', async () => {
    const unit = '车间,计划量\n冲压,1200\n';
    const big = unit.repeat(
      Math.ceil((TOOL_INLINE_MAX_BYTES + 4096) / Buffer.byteLength(unit, 'utf8')),
    );
    const manager = new RunManager({ history, usage, toolEvents });
    await runTurn(
      manager,
      recordingAgent([], () => toolTurn(big)),
      '看下计划',
    ).settled;

    const captured: AgentRunRequest[] = [];
    await runTurn(
      manager,
      recordingAgent(captured, () => plainTurn()),
      '第 3 页呢',
    ).settled;

    const req = captured[0]!;
    const assistant = req.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).not.toContain(big);
    expect(assistant?.content).toContain('记录已截断');
    expect(assistant?.content).toContain('要查看更多请重新调用该工具');
    expect(assistant?.content).not.toContain('临时空间/');
  });

  it('外部来源（MCP）大结果：截断版进 messages 且带副本路径；systemExtra 无工具段', async () => {
    const unit = '车间,计划量\n冲压,1200\n';
    const big = unit.repeat(
      Math.ceil((TOOL_INLINE_MAX_BYTES + 4096) / Buffer.byteLength(unit, 'utf8')),
    );
    const manager = new RunManager({ history, usage, toolEvents });
    await runTurn(
      manager,
      recordingAgent([], () => toolTurn(big, 'mcp_sql_query')),
      '看下计划',
    ).settled;

    const captured: AgentRunRequest[] = [];
    await runTurn(
      manager,
      recordingAgent(captured, () => plainTurn()),
      '第 3 页呢',
    ).settled;

    const req = captured[0]!;
    const joined = req.messages.map((m) => m.content).join('\n');
    expect(joined).not.toContain(big);
    expect(joined).toContain('记录已截断');
    expect(joined).toContain('临时空间/th1_toolresult_call_1.txt');
    expect(joined).toContain('可用 read_file 读取');
    expect(req.systemExtra ?? '').not.toContain('临时空间/th1_toolresult_call_1.txt');
  });

  it('未装配 toolEvents：不落盘也不回灌（既有行为零变化）', async () => {
    const manager = new RunManager({ history, usage });
    await runTurn(
      manager,
      recordingAgent([], () => toolTurn('内部结果')),
      '看下计划',
    ).settled;

    const captured: AgentRunRequest[] = [];
    await runTurn(
      manager,
      recordingAgent(captured, () => plainTurn()),
      '再确认下',
    ).settled;

    expect(captured[0]!.systemExtra ?? '').not.toContain('记录已截断');
    const joined = captured[0]!.messages.map((m) => m.content).join('\n');
    expect(joined).not.toContain('内部结果');
    expect(
      fs.existsSync(
        path.join(
          root,
          'users',
          'admin',
          'user-data',
          AGENT,
          'threads',
          'th1',
          'tool-events.jsonl',
        ),
      ),
    ).toBe(false);
  });
});

describe('上下文池（方案 A）：正文按归档游标注入', () => {
  it('池子在保留量内：注入 [已归档, 总数) 全部，摘要同步进 systemExtra', async () => {
    await seedHistory(70);
    writeSummary(45);
    const summary = new SummaryStore(root, history, { llm: () => poolLlm });
    const manager = new RunManager({ history, usage, summary });

    const captured: AgentRunRequest[] = [];
    await runTurn(
      manager,
      recordingAgent(captured, () => plainTurn()),
      '继续',
    ).settled;

    const req = captured[0]!;
    expect(req.messages).toHaveLength(70 - 45 + 1);
    expect(req.messages[0]!.content).toBe('h45');
    expect(req.messages.at(-1)).toMatchObject({ role: 'user', content: '继续' });
    expect(req.systemExtra).toContain('早前摘要');
  });

  it('零空洞：摘要右边界与正文左边界相接（不重、不漏）', async () => {
    await seedHistory(100);
    writeSummary(40);
    const summary = new SummaryStore(root, history, { llm: () => poolLlm });
    const manager = new RunManager({ history, usage, summary });

    const captured: AgentRunRequest[] = [];
    await runTurn(
      manager,
      recordingAgent(captured, () => plainTurn()),
      '继续',
    ).settled;

    const req = captured[0]!;
    expect(req.messages).toHaveLength(100 - 40 + 1);
    expect(req.messages[0]!.content).toBe('h40');
    expect(req.messages.at(-2)).toMatchObject({ content: 'h99' });
    expect(req.systemExtra).toContain('早前摘要');
  });

  it('摘要不可用（未装配）：池子超上限时兜底截断到末尾 POOL_MAX 条', async () => {
    await seedHistory(80);
    const manager = new RunManager({ history, usage });

    const captured: AgentRunRequest[] = [];
    await runTurn(
      manager,
      recordingAgent(captured, () => plainTurn()),
      '继续',
    ).settled;

    const req = captured[0]!;
    expect(req.messages).toHaveLength(POOL_MAX_MESSAGES + 1);
    expect(req.messages[0]!.content).toBe('h20'); // 兜底取末尾 60 条 = h20..h79
    expect(req.systemExtra ?? '').not.toContain('以下是对话早期内容的摘要');
  });
});

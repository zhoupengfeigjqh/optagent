/**
 * 单元测试：每轮对话的收尾日志 `run.end`（任务 2026-09-16）
 *
 * 背景：逐请求访问日志关闭后，agent 侧只剩"实例崩溃"能查到——**正常/失败的一轮
 * 在日志里没有任何痕迹**，"回答很慢""这轮失败了"只能靠复现。
 *
 * 这里守住：每轮结束**恰好一条** `run.end`，带 `ok` / `duration_ms` / `error_code`
 * （失败时）与 run 身份（`user_id` / `thread_id` / `agent_name`），
 * 且**不含回答正文**（日志只记结果与耗时，不记内容）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryStore } from '../../src/domain/history.js';
import {
  RunManager,
  type RunAgentLike,
  type SsePayload,
  type StartRunOptions,
} from '../../src/domain/run-manager.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import type { LlmEvent } from '../../src/types.js';

type LogLine = Record<string, unknown>;

let root: string;
let lines: LogLine[];
let history: HistoryStore;
let usage: UsageDb;

/** 用**真实 pino** 写内存流：断言实际产出的日志行，而不是被 mock 的调用 */
function memoryLogger() {
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') lines.push(JSON.parse(line) as LogLine);
      }
      cb();
    },
  });
  return pino({ level: 'info' }, stream);
}

/** 只实现 run 的假实例：按脚本产出 LLM 事件 */
function fakeAgent(script: () => AsyncIterable<LlmEvent>): RunAgentLike {
  return {
    key: { userId: 'admin', agentName: 'demo' },
    activeThreads: 0,
    run: () => script(),
  };
}

async function* doneScript(): AsyncIterable<LlmEvent> {
  yield { type: 'content_delta', delta: '你好，我是答案正文' };
  yield { type: 'done', usage: { inputTokens: 11, outputTokens: 22 } };
}

async function* errorScript(): AsyncIterable<LlmEvent> {
  yield { type: 'content_delta', delta: '半截回答' };
  yield { type: 'error', code: 'LLM_ERROR', message: '上游模型不可用' };
}

async function* crashScript(): AsyncIterable<LlmEvent> {
  yield { type: 'content_delta', delta: 'x' };
  throw new Error('实例内部崩溃');
}

/** 只有正文、没有任何终结事件就结束的流（网关断连 / 上游半途断开的形态） */
async function* silentScript(): AsyncIterable<LlmEvent> {
  yield { type: 'content_delta', delta: '半截回答' };
}

function startRun(manager: RunManager, agent: RunAgentLike): Promise<void> {
  const opts: StartRunOptions = {
    userId: 'admin',
    threadId: 'th_1',
    agent,
    userMessage: '你好',
    thinking: false,
  };
  return manager.startRun(opts).settled;
}

const runEnd = (): LogLine[] => lines.filter((l) => l.event === 'run.end');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manager-log-'));
  lines = [];
  history = new HistoryStore(root);
  usage = new UsageDb(path.join(root, 'usage.db'));
});

afterEach(() => {
  usage.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('run.end —— 每轮一条收尾日志', () => {
  it('成功一轮：ok=true、带耗时与 run 身份，scope=run；不落回答正文', async () => {
    const manager = new RunManager({ history, usage, logger: memoryLogger() });

    await startRun(manager, fakeAgent(doneScript));

    expect(runEnd()).toHaveLength(1);
    const row = runEnd()[0]!;
    expect(row).toMatchObject({
      event: 'run.end',
      scope: 'run',
      ok: true,
      user_id: 'admin',
      thread_id: 'th_1',
      agent_name: 'demo',
    });
    expect(typeof row.duration_ms).toBe('number');
    expect(row.error_code).toBeUndefined();
    // 日志只记结果与耗时，MUST NOT 记回答内容
    expect(JSON.stringify(row)).not.toContain('答案正文');
  });

  it('失败一轮：ok=false、带 error_code（可与界面提示对齐）', async () => {
    const manager = new RunManager({ history, usage, logger: memoryLogger() });

    await startRun(manager, fakeAgent(errorScript));

    expect(runEnd()).toHaveLength(1);
    expect(runEnd()[0]).toMatchObject({ ok: false, error_code: 'LLM_ERROR' });
  });

  it('实例崩溃：除 agent.crashed 外，仍有 run.end 收尾（ok=false / INTERNAL_ERROR）', async () => {
    const crashed: unknown[] = [];
    const manager = new RunManager({
      history,
      usage,
      logger: memoryLogger(),
      onCrash: (_key, err) => crashed.push(err),
    });

    await startRun(manager, fakeAgent(crashScript));

    expect(crashed).toHaveLength(1);
    expect(lines.some((l) => l.event === 'agent.crashed')).toBe(true);
    expect(runEnd()).toHaveLength(1);
    expect(runEnd()[0]).toMatchObject({ ok: false, error_code: 'INTERNAL_ERROR' });
  });

  /**
   * 提示词组装失败（2026-10-27 回归）
   *
   * 修复前 `buildPrompt` 在 try 之外：读摘要/历史/产出一旦抛错，收尾全被跳过——
   * 活跃表永久占位（该会话此后每次发送恒 409）、SSE 不终结、实例却毫发无损。
   */
  it('提示词组装失败：记 PROMPT_BUILD_FAILED、不触发 onCrash，且活跃占位已释放', async () => {
    const crashed: unknown[] = [];
    const manager = new RunManager({
      history,
      usage,
      logger: memoryLogger(),
      onCrash: (_key, err) => crashed.push(err),
    });
    const readAll = vi
      .spyOn(history, 'readAll')
      .mockRejectedValueOnce(new Error('EIO: i/o error'));
    const agent = fakeAgent(doneScript);

    const first = manager.startRun({
      userId: 'admin',
      threadId: 'th_1',
      agent,
      userMessage: '你好',
      thinking: false,
    });
    const events: SsePayload[] = [];
    first.subscribe((e) => events.push(e));
    await first.settled;

    expect(readAll).toHaveBeenCalled();
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(events.find((e) => e.type === 'error')).toMatchObject({
      data: { error: { code: 'PROMPT_BUILD_FAILED' } },
    });
    expect(runEnd()[0]).toMatchObject({ ok: false, error_code: 'PROMPT_BUILD_FAILED' });
    // 读盘失败 ≠ 崩溃：实例不得被销毁
    expect(crashed).toHaveLength(0);

    // 关键回归：占位已释放，同一会话可立即再发（修复前此处会抛 409 THREAD_RUN_ACTIVE）
    await startRun(manager, agent);
    expect(runEnd()).toHaveLength(2);
    expect(runEnd()[1]).toMatchObject({ ok: true });
  });

  /**
   * 流无终结事件（2026-10-27 统一）
   *
   * 修复前：只手写一个 SSE 事件、**不落盘**——用户当场看到失败，刷新后那条提问凭空消失。
   */
  it('流无终结事件：按失败轮落盘（用户消息与失败留痕都在），run.end 记 LLM_ERROR', async () => {
    const manager = new RunManager({ history, usage, logger: memoryLogger() });

    await startRun(manager, fakeAgent(silentScript));

    const rows = await history.readAll('admin', 'demo', 'th_1');
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(rows[1]).toMatchObject({
      status: 'failed',
      content: '半截回答',
      error: { code: 'LLM_ERROR' },
    });
    expect(runEnd()).toHaveLength(1);
    expect(runEnd()[0]).toMatchObject({ ok: false, error_code: 'LLM_ERROR' });
  });
});

/**
 * run-manager 状态机单元测试（T017 + 002 特性：T007 耗时与工具事件、T012 失败轮落盘）。
 *
 * 事件源 × 状态转移表：
 * | 事件源 \ 状态 | running            | draining           |
 * | ------------- | ------------------ | ------------------ |
 * | 推理推进      | 广播+累积 → done   | 同左（收尾不新开） |
 * | 断连(退订)    | 照跑，落盘完成     | 同左               |
 * | stop          | → aborted，记 usage| → aborted          |
 * | LLM error     | → error，失败轮落盘| → error            |
 * | 未知异常      | → error + onCrash  | → error + onCrash  |
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryStore } from '../../src/domain/history';
import {
  RunManager,
  ThreadBusyLimitError,
  ThreadRunActiveError,
  type RunAgentLike,
  type SsePayload,
} from '../../src/domain/run-manager';
import type { UsageRecord, UsageStore } from '../../src/types';
import { FakeLlmProvider, simpleScript, type FakeStep } from '../helpers/fake-llm-provider';

class FakeUsageStore implements UsageStore {
  readonly records: Array<Omit<UsageRecord, 'id'>> = [];
  record(entry: Omit<UsageRecord, 'id'>): void {
    this.records.push(entry);
  }
  summary(): never {
    throw new Error('not implemented');
  }
  close(): void {}
}

function agentFrom(provider: FakeLlmProvider, agentName = 'demo'): RunAgentLike {
  return {
    key: { userId: 'admin', agentName },
    activeThreads: 0,
    run: (req) =>
      provider.streamChat({
        systemPrompt: '',
        messages: req.messages,
        tools: [],
        thinking: req.thinking,
        signal: req.signal,
      }),
  };
}

describe('run-manager 状态机', () => {
  let root: string;
  let history: HistoryStore;
  let usage: FakeUsageStore;
  let onCrash: ReturnType<typeof vi.fn>;
  let clock: { t: number };
  let manager: RunManager;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-rm-'));
    history = new HistoryStore(root);
    usage = new FakeUsageStore();
    onCrash = vi.fn();
    clock = { t: 1_000_000 };
    manager = new RunManager({ history, usage, onCrash, now: () => clock.t });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function start(provider: FakeLlmProvider, threadId = 't1', agentName = 'demo') {
    return manager.startRun({
      userId: 'admin',
      threadId,
      agent: agentFrom(provider, agentName),
      userMessage: '你好',
      thinking: true,
    });
  }

  it('正常完成：事件序列 content*→done，历史带元数据落盘，usage 记录，done 含耗时与 message_id', async () => {
    const provider = new FakeLlmProvider(simpleScript('你好呀', '思考一下'));
    const events: SsePayload[] = [];
    const run = start(provider);
    run.subscribe((e) => events.push(e));
    clock.t += 4200; // 整轮耗时 4.2s
    await run.settled;

    expect(run.state).toBe('done');
    expect(events.map((e) => e.type)).toEqual(['thinking', 'content', 'done']);
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: 'done',
      data: {
        finish_reason: 'completed',
        usage: { input_tokens: 10, output_tokens: 5 },
        duration_seconds: 4.2,
        agent_name: 'demo',
      },
    });
    const messageId = (done as Extract<SsePayload, { type: 'done' }>).data.message_id;
    expect(messageId).toMatch(/^m_[a-z0-9]+_[a-z0-9]{4}$/);

    const rows = history.readAll('admin', 't1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: 'user', content: '你好', agent_name: 'demo' });
    expect(rows[0]!.id).toBeTruthy();
    // 会话可跨数字人：本轮 user/assistant 成对带上当轮数字人
    expect(rows.map((r) => r.agent_name)).toEqual(['demo', 'demo']);
    expect(rows[0]!.ts).toBeTruthy();
    expect(rows[1]).toMatchObject({
      id: messageId,
      role: 'assistant',
      content: '你好呀',
      status: 'completed',
      usage: { input_tokens: 10, output_tokens: 5 },
      duration_ms: 4200,
    });
    expect(usage.records).toHaveLength(1);
    expect(usage.records[0]).toMatchObject({ userId: 'admin', threadId: 't1', agentName: 'demo', inputTokens: 10 });
    expect(manager.hasActive('t1')).toBe(false);
  });

  it('工具调用事件：tool_call/tool_call_end 成对转发，仅含工具名与标识（T007）', async () => {
    const provider = new FakeLlmProvider([
      { type: 'tool_call_start', callId: 'c1', name: 'read_file' },
      { type: 'tool_call_end', callId: 'c1', status: 'success' },
      { type: 'tool_call_start', callId: 'c2', name: 'grep_files' },
      { type: 'tool_call_end', callId: 'c2', status: 'error' },
      ...simpleScript('完成'),
    ]);
    const events: SsePayload[] = [];
    const run = start(provider);
    run.subscribe((e) => events.push(e));
    await run.settled;

    expect(events.map((e) => e.type)).toEqual([
      'tool_call',
      'tool_call_end',
      'tool_call',
      'tool_call_end',
      'content',
      'done',
    ]);
    expect(events[0]).toEqual({ type: 'tool_call', data: { call_id: 'c1', name: 'read_file', status: 'running' } });
    expect(events[1]).toEqual({ type: 'tool_call_end', data: { call_id: 'c1', status: 'success' } });
    expect(events[3]).toEqual({ type: 'tool_call_end', data: { call_id: 'c2', status: 'error' } });
    // 事件负载中不出现入参/结果字段
    for (const e of events.slice(0, 4)) {
      expect(JSON.stringify(e.data)).not.toMatch(/args|result/);
    }
  });

  it('断连（推一半退订）→ run 照跑并落盘完整内容', async () => {
    const provider = new FakeLlmProvider([
      { type: 'content_delta', delta: '前半' },
      { type: 'wait', id: 'mid' },
      { type: 'content_delta', delta: '后半' },
      { type: 'done', usage: { inputTokens: 7, outputTokens: 3 } },
    ]);
    const run = start(provider);
    const unsub = run.subscribe(() => {});
    await provider.reached('mid');
    unsub(); // 客户端断开 = 仅退订
    provider.resume('mid');
    await run.settled;

    expect(run.state).toBe('done');
    const rows = history.readAll('admin', 't1');
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ['user', '你好'],
      ['assistant', '前半后半'],
    ]);
    expect(usage.records).toHaveLength(1);
  });

  it('stop：推一半中断 → done(stop)，丢弃本轮消息，usage 照记，message_id 为 null', async () => {
    const provider = new FakeLlmProvider([
      { type: 'content_delta', delta: '未保存内容' },
      { type: 'wait', id: 'mid' },
      { type: 'content_delta', delta: '不应出现' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const events: SsePayload[] = [];
    const run = start(provider);
    run.subscribe((e) => events.push(e));
    await provider.reached('mid');
    clock.t += 1500;

    expect(manager.stop('t1')).toBe(true);
    await run.settled;

    expect(run.state).toBe('aborted');
    expect(events.at(-1)).toEqual({
      type: 'done',
      data: {
        finish_reason: 'stop',
        usage: { input_tokens: 3, output_tokens: 2 },
        duration_seconds: 1.5,
        message_id: null,
        agent_name: 'demo',
      },
    });
    // 本轮（user+assistant）均丢弃
    expect(history.readAll('admin', 't1')).toEqual([]);
    expect(usage.records[0]).toMatchObject({ inputTokens: 3, outputTokens: 2 });
    expect(manager.stop('t1')).toBe(false); // 幂等
  });

  it('关机 draining：当前消息继续写完落盘', async () => {
    const provider = new FakeLlmProvider([
      { type: 'content_delta', delta: '收尾内容' },
      { type: 'wait', id: 'mid' },
      { type: 'done', usage: { inputTokens: 5, outputTokens: 5 } },
    ]);
    const run = start(provider);
    await provider.reached('mid');
    manager.beginDrain();
    provider.resume('mid');
    await run.settled;

    expect(run.state).toBe('done');
    const rows = history.readAll('admin', 't1');
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ['user', '你好'],
      ['assistant', '收尾内容'],
    ]);
  });

  it('LLM error 事件 → state=error，error 含耗时与已消耗 usage，失败轮落盘（T012）', async () => {
    const provider = new FakeLlmProvider([
      { type: 'error', code: 'LLM_ERROR', message: '模型炸了', usage: { inputTokens: 6, outputTokens: 2 } },
    ]);
    const events: SsePayload[] = [];
    const run = start(provider);
    run.subscribe((e) => events.push(e));
    clock.t += 800;
    await run.settled;

    expect(run.state).toBe('error');
    expect(events.at(-1)).toEqual({
      type: 'error',
      data: {
        error: { code: 'LLM_ERROR', message: '模型炸了' },
        duration_seconds: 0.8,
        agent_name: 'demo',
        usage: { input_tokens: 6, output_tokens: 2 },
      },
    });
    const rows = history.readAll('admin', 't1');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      role: 'assistant',
      status: 'failed',
      error: { code: 'LLM_ERROR', message: '模型炸了' },
      usage: { input_tokens: 6, output_tokens: 2 },
      duration_ms: 800,
    });
    expect(usage.records).toHaveLength(1); // 已消耗 token 照记
    expect(onCrash).not.toHaveBeenCalled();
  });

  it('LLM error 无 usage → 不记 usage，失败轮仍落盘', async () => {
    const provider = new FakeLlmProvider([{ type: 'error', code: 'LLM_ERROR', message: '模型炸了' }]);
    const run = start(provider);
    await run.settled;

    expect(run.state).toBe('error');
    expect(usage.records).toHaveLength(0);
    const rows = history.readAll('admin', 't1');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ role: 'assistant', status: 'failed', error: { code: 'LLM_ERROR' } });
    expect(rows[1]!.usage).toBeUndefined();
  });

  it('未知异常（run 抛出）→ state=error + onCrash 销毁实例', async () => {
    const bad: RunAgentLike = {
      key: { userId: 'admin', agentName: 'demo' },
      activeThreads: 0,
      // eslint-disable-next-line require-yield
      async *run() {
        throw new Error('pi loop 崩溃');
      },
    };
    const events: SsePayload[] = [];
    const run = manager.startRun({ userId: 'admin', threadId: 't1', agent: bad, userMessage: '你好', thinking: false });
    run.subscribe((e) => events.push(e));
    await run.settled;

    expect(run.state).toBe('error');
    expect(onCrash).toHaveBeenCalledWith({ userId: 'admin', agentName: 'demo' }, expect.any(Error));
    expect(events.at(-1)?.type).toBe('error');
  });

  it('@ 文件引用：LLM 收到引用段，历史行保留结构化 attachments（T029）', async () => {
    const provider = new FakeLlmProvider(simpleScript('好的'));
    const run = manager.startRun({
      userId: 'admin',
      threadId: 't1',
      agent: agentFrom(provider),
      userMessage: '分析这份计划',
      thinking: false,
      attachments: [{ dir: '生产计划', filename: 'a_20260910_080000.csv' }],
    });
    await run.settled;

    // LLM 上下文 content 追加引用段
    const req = provider.requests[0]!;
    const last = req.messages.at(-1)!;
    expect(last.content).toBe('分析这份计划\n[引用文件] 生产计划/a_20260910_080000.csv');
    // 历史行：content 纯净 + 结构化 attachments
    const rows = history.readAll('admin', 't1');
    expect(rows[0]).toMatchObject({
      role: 'user',
      content: '分析这份计划',
      attachments: [{ dir: '生产计划', filename: 'a_20260910_080000.csv' }],
    });
  });

  it('同 thread 并发 run → ThreadRunActiveError', async () => {
    const provider = new FakeLlmProvider([{ type: 'wait', id: 'hold' } as FakeStep]);
    start(provider);
    await provider.reached('hold');
    expect(() => start(new FakeLlmProvider(simpleScript('x')))).toThrow(ThreadRunActiveError);
    manager.stop('t1');
  });

  it('activeThreadCount 按用户统计活跃 thread 数（跨数字人累计）', async () => {
    const p1 = new FakeLlmProvider([{ type: 'wait', id: 'h1' } as FakeStep]);
    const p2 = new FakeLlmProvider([{ type: 'wait', id: 'h2' } as FakeStep]);
    start(p1, 't1', 'demo');
    start(p2, 't2', 'other');
    await Promise.all([p1.reached('h1'), p2.reached('h2')]);
    // 两个数字人各 1 个进行中 run，但归属同一用户 → 累计为 2
    expect(manager.activeThreadCount('admin')).toBe(2);
    expect(manager.activeThreadCount('someone-else')).toBe(0);
    manager.stop('t1');
    manager.stop('t2');
  });

  it('acquireQuota：同步「检查+占位」——占位即计入并发额度，但不算活跃 run', () => {
    const release1 = manager.acquireQuota('admin', 't1', 3);
    manager.acquireQuota('admin', 't2', 3);
    manager.acquireQuota('admin', 't3', 3);
    // 关键：占位立刻计入额度，判定与注册之间不留窗口 → 消除 TOCTOU 超发
    expect(manager.activeThreadCount('admin')).toBe(3);
    expect(manager.hasActive('t1')).toBe(true);
    // 但占位不是真正的 run（监控口径 activeRunCount 不变）
    expect(manager.activeRunCount()).toBe(0);

    // 第 4 个 → 额度耗尽；其他用户不受影响
    expect(() => manager.acquireQuota('admin', 't4', 3)).toThrow(ThreadBusyLimitError);
    expect(manager.activeThreadCount('other')).toBe(0);

    // 归还一个 → 又能占
    release1();
    expect(manager.activeThreadCount('admin')).toBe(2);
    expect(() => manager.acquireQuota('admin', 't4', 3)).not.toThrow();
    // 幂等：重复归还不改变额度（不会把额度还成负数）
    release1();
    expect(manager.activeThreadCount('admin')).toBe(3);
  });

  it('acquireQuota：同 thread 重复占位抛 ThreadRunActiveError；startRun 转正后归还为 no-op', async () => {
    const provider = new FakeLlmProvider([{ type: 'wait', id: 'h1' } as FakeStep]);
    const release = manager.acquireQuota('admin', 't1', 3);
    expect(() => manager.acquireQuota('admin', 't1', 3)).toThrow(ThreadRunActiveError);

    const run = start(provider); // startRun：占位转正为活跃 run
    await provider.reached('h1');
    expect(manager.activeRunCount()).toBe(1);
    expect(manager.activeThreadCount('admin')).toBe(1); // 占位未重复计数

    release(); // 转正后归还必须是 no-op，不能误删活跃 run
    expect(manager.activeThreadCount('admin')).toBe(1);
    expect(manager.hasActive('t1')).toBe(true);

    manager.stop('t1');
    await run.settled;
    expect(manager.activeThreadCount('admin')).toBe(0);
  });
});

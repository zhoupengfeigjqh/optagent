/**
 * 单元测试：轮次收尾家族（007 从 `run-manager.ts` 拆分而来）。
 *
 * 收尾是**副作用密集**的地方，且三条入口的顺序是硬约束：
 * - `done`：卡片定稿（解析尾部块 + 写快照）→ 落盘（正文**不含**尾部块）→ 广播 `done`
 *   （负载带 `next_actions` 直推，007 修订）→ 摘要 fire-and-forget（FR-018）；
 * - `error` / `aborted`：失败与中断轮无卡片；
 * - `aborted`：只广播 + 记账（本轮消息丢弃，但已消耗 token 照记，FR-027）。
 *
 * 这里用假依赖直接驱动 `RunFinalizer`（不经 RunManager），把"未装配某依赖时不能崩"
 * 这类防御分支也钉住——它们在真实装配里几乎不会走到，但正是拆分后最容易坏的地方。
 */
import { describe, expect, it, vi } from 'vitest';
import type { HistoryMessage, UsageInfo } from '../../src/types.js';
import { RunImpl } from '../../src/domain/run-impl.js';
import { RunFinalizer, type FinalizeTurn } from '../../src/domain/run-finalize.js';
import type { HistoryStore } from '../../src/domain/history.js';
import type { ToolEventStore } from '../../src/domain/tool-events.js';
import type { NextActionsFinalizeInput, NextActionsView } from '../../src/domain/next-actions.js';
import type { SsePayload } from '../../src/domain/run-events.js';
import type { UsageStore } from '../../src/types.js';

const USAGE: UsageInfo = { inputTokens: 11, outputTokens: 22 };

/** 假落盘口：只记调用，不碰磁盘（009：入参为 用户 → 数字人 → 会话 → 消息） */
function fakeHistory() {
  const appended: Array<{
    userId: string;
    agentName: string;
    threadId: string;
    message: HistoryMessage;
  }> = [];
  return {
    appended,
    store: {
      append: (userId: string, agentName: string, threadId: string, message: HistoryMessage) => {
        appended.push({ userId, agentName, threadId, message });
        return undefined as unknown as Promise<void>;
      },
    } as unknown as HistoryStore,
  };
}

function fakeUsage() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    store: { record: (row: Record<string, unknown>) => rows.push(row) } as unknown as UsageStore,
  };
}

function makeRun(): RunImpl {
  const run = new RunImpl('th_1', 'admin', 'demo');
  run.startedAt = 1_000;
  run.assistantMessageId = 'm-assistant';
  run.buffer = '回答正文';
  run.calledTools.add('read_file');
  return run;
}

function turn(
  runtime: FinalizeTurn['runtime'] = { availableTools: [] },
  nextActionsMax?: number,
): FinalizeTurn {
  return {
    userId: 'admin',
    threadId: 'th_1',
    runtime,
    ...(nextActionsMax === undefined ? {} : { nextActionsMax }),
  };
}

function collect(run: RunImpl): SsePayload[] {
  const events: SsePayload[] = [];
  run.subscribe((e) => events.push(e));
  return events;
}

describe('RunFinalizer.done', () => {
  it('最小依赖：落两条消息 + 广播 done + 记账；未装配的后台任务一律不触发', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
    });
    const run = makeRun();

    const events = collect(run);
    await finalizer.done(run, turn(), { role: 'user', content: '你好' }, USAGE);

    expect(run.state).toBe('done');
    expect(history.appended.map((a) => a.message.role)).toEqual(['user', 'assistant']);
    // 009：落点取**本轮的**数字人（run.agentName），两条消息同域
    expect(history.appended.map((a) => a.agentName)).toEqual(['demo', 'demo']);
    // assistant 行用 run 启动时预生成的 id（工具事件行已按它归属）
    expect(history.appended[1]!.message.id).toBe('m-assistant');
    expect(history.appended[1]!.message).toMatchObject({
      status: 'completed',
      content: '回答正文',
      agent_name: 'demo',
      duration_ms: 4_000,
      usage: { input_tokens: 11, output_tokens: 22 },
    });
    expect(usage.rows).toHaveLength(1);
    expect(events).toEqual([
      {
        type: 'done',
        data: {
          finish_reason: 'completed',
          usage: { input_tokens: 11, output_tokens: 22 },
          duration_seconds: 4,
          message_id: 'm-assistant',
          agent_name: 'demo',
        },
      },
    ]);
  });

  it('全量依赖：工具记录 flush、摘要触发；卡片定稿先于广播并随 done 直推（007 修订）', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const flush = vi.fn(async () => undefined);
    const summaryTrigger = vi.fn(async () => undefined);
    const finalizeInputs: NextActionsFinalizeInput[] = [];
    const view: NextActionsView = {
      message_id: 'm-assistant',
      actions: [{ prompt: '整理表格', tools: [], guidance: '' }],
    };
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      toolEvents: { flush } as unknown as ToolEventStore,
      summary: { trigger: summaryTrigger },
      nextActions: {
        finalize: (input) => {
          finalizeInputs.push(input);
          return view;
        },
      },
      now: () => 5_000,
    });
    const run = makeRun();
    run.nextActionsTail = '{"actions":[{"prompt":"整理表格"}]}';
    const runtime = { availableTools: [{ name: 'read_file', description: '读取文件' }] };

    const events = collect(run);
    await finalizer.done(run, turn(runtime, 3), { role: 'user', content: '你好' }, USAGE);

    expect(flush).toHaveBeenCalledWith('admin', 'demo', 'th_1');
    expect(summaryTrigger).toHaveBeenCalledWith('admin', 'demo', 'th_1');
    // 素材取自本轮真相：捕获的尾部块原文 + 本轮可用工具；条数上限与提示词装配同源
    expect(finalizeInputs).toHaveLength(1);
    expect(finalizeInputs[0]).toMatchObject({
      userId: 'admin',
      threadId: 'th_1',
      messageId: 'm-assistant',
      agentName: 'demo',
      tailText: '{"actions":[{"prompt":"整理表格"}]}',
      availableTools: [{ name: 'read_file', description: '读取文件' }],
      max: 3,
    });
    // 定稿后归档清空（同一 run 不会被二次定稿）
    expect(run.nextActionsTail).toBe('');
    // 卡片随 done 直推（前端不再轮询拉取）
    expect(events[0]).toMatchObject({ type: 'done', data: { next_actions: view } });
  });

  it('未开启开关（nextActionsMax 缺省）→ 不定稿卡片、done 不带 next_actions', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const finalize = vi.fn(() => undefined);
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      nextActions: { finalize },
      now: () => 5_000,
    });
    const run = makeRun();
    run.nextActionsTail = '{"actions":[]}';

    const events = collect(run);
    await finalizer.done(run, turn(), { role: 'user', content: '你好' }, USAGE);

    expect(finalize).not.toHaveBeenCalled();
    expect(JSON.stringify(events[0])).not.toContain('next_actions');
  });
});

describe('RunFinalizer.error', () => {
  it('有 usage：留痕失败轮、记一次用量、error 载荷带 usage', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
    });
    const run = makeRun();

    const events = collect(run);
    await finalizer.error(
      run,
      turn(),
      { role: 'user', content: '你好' },
      {
        code: 'LLM_ERROR',
        message: '上游模型不可用',
        usage: USAGE,
      },
    );

    expect(run.state).toBe('error');
    expect(history.appended[1]!.message).toMatchObject({
      status: 'failed',
      error: { code: 'LLM_ERROR', message: '上游模型不可用' },
      usage: { input_tokens: 11, output_tokens: 22 },
    });
    expect(usage.rows).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      data: { error: { code: 'LLM_ERROR' }, usage: { input_tokens: 11, output_tokens: 22 } },
    });
  });

  it('无 usage（未消耗）：不记账、载荷里也不出现 usage 字段', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
    });
    const run = makeRun();

    const events = collect(run);
    await finalizer.error(
      run,
      turn(),
      { role: 'user', content: '你好' },
      {
        code: 'LLM_ERROR',
        message: '上游模型不可用',
      },
    );

    expect(usage.rows).toHaveLength(0);
    expect(history.appended[1]!.message.usage).toBeUndefined();
    expect(events[0]).toMatchObject({ type: 'error' });
    expect(JSON.stringify(events[0])).not.toContain('usage');
  });
});

describe('RunFinalizer.error：诊断字段与 llm.call.failed（2026-10-15）', () => {
  it('三个诊断字段写进失败行，且与 SSE error 事件**同形**（§19.5 不变式 5）', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
    });
    const run = makeRun();
    const expectedError = {
      code: 'LLM_UNAVAILABLE',
      message: '503 status code (no body)',
      upstream_status: 503,
      upstream_type: 'service_unavailable_error',
      request_id: 'rid-1',
    };

    const events = collect(run);
    await finalizer.error(run, turn(), { role: 'user', content: '你好' }, expectedError);

    expect(history.appended[1]!.message.error).toEqual(expectedError);
    expect(events[0]).toMatchObject({ type: 'error', data: { error: expectedError } });
  });

  it('没有诊断字段时**键不存在**（不是 `null` / `undefined` 占位）', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
    });
    const run = makeRun();

    const events = collect(run);
    await finalizer.error(
      run,
      turn(),
      { role: 'user', content: '你好' },
      {
        code: 'LLM_ERROR',
        message: 'LLM 流异常结束',
      },
    );

    const persisted = history.appended[1]!.message.error!;
    expect(Object.keys(persisted).sort()).toEqual(['code', 'message']);
    expect(JSON.stringify(events[0])).not.toContain('upstream_status');
  });

  it('llm.call.failed：字段齐备；请求级模型覆盖优先；"需人工介入"的两类带 alert', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const warn = vi.fn();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
      logger: { warn } as never,
      llmInfo: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }),
    });
    const run = makeRun();
    run.modelId = 'deepseek-v4-pro'; // 请求级覆盖（FR-023）

    await finalizer.error(
      run,
      turn(),
      { role: 'user', content: '你好' },
      {
        code: 'LLM_INSUFFICIENT_BALANCE',
        message: '402: {"error":{"message":"Insufficient Balance"}}',
        upstream_status: 402,
      },
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, text] = warn.mock.calls[0]! as [Record<string, unknown>, string];
    expect(fields).toMatchObject({
      event: 'llm.call.failed',
      scope: 'run',
      user_id: 'admin',
      thread_id: 'th_1',
      agent_name: 'demo',
      code: 'LLM_INSUFFICIENT_BALANCE',
      upstream_status: 402,
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      message: '402: {"error":{"message":"Insufficient Balance"}}',
      duration_ms: 4_000,
      alert: true,
    });
    expect('upstream_type' in fields).toBe(false); // 没有就不写，不塞 undefined
    expect('request_id' in fields).toBe(false);
    expect(text).toContain('LLM_INSUFFICIENT_BALANCE');
    expect(text).toContain('402');
  });

  it('5xx 不带 alert；未装配 llmInfo 时少 provider / model 两列；超长原文截断到 500 字符', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const warn = vi.fn();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
      logger: { warn } as never,
    });
    const run = makeRun();

    await finalizer.error(
      run,
      turn(),
      { role: 'user', content: '你好' },
      {
        code: 'LLM_UNAVAILABLE',
        message: 'x'.repeat(900),
        upstream_status: 503,
      },
    );

    const [fields] = warn.mock.calls[0]! as [Record<string, unknown>, string];
    expect(fields.alert).toBeUndefined();
    expect(fields.model).toBeUndefined();
    expect(fields.provider).toBeUndefined();
    expect((fields.message as string).length).toBe(500);
  });

  it('未装配 logger：收尾照常完成，不抛错（日志不致命）', async () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
    });
    const run = makeRun();

    await expect(
      finalizer.error(
        run,
        turn(),
        { role: 'user', content: '你好' },
        {
          code: 'LLM_UNAVAILABLE',
          message: '503 status code (no body)',
          upstream_status: 503,
        },
      ),
    ).resolves.toBeUndefined();
    expect(run.state).toBe('error');
    expect(history.appended).toHaveLength(2);
  });
});

describe('RunFinalizer.aborted', () => {
  it('有 usage：丢弃本轮消息（message_id=null）但照记 token（FR-027）', () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
    });
    const run = makeRun();

    const events = collect(run);
    finalizer.aborted(run, turn(), USAGE);

    expect(run.state).toBe('aborted');
    expect(history.appended).toHaveLength(0); // 中断轮不落盘
    expect(usage.rows[0]).toMatchObject({ inputTokens: 11, outputTokens: 22, agentName: 'demo' });
    expect(events[0]).toMatchObject({
      type: 'done',
      data: { finish_reason: 'stop', message_id: null },
    });
  });

  it('usage 缺省：按 0 记账（中断时的用量未知也不能漏记这一轮）', () => {
    const history = fakeHistory();
    const usage = fakeUsage();
    const finalizer = new RunFinalizer({
      history: history.store,
      usage: usage.store,
      now: () => 5_000,
    });
    const run = makeRun();

    finalizer.aborted(run, turn());

    expect(usage.rows[0]).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });
});

/**
 * 落盘失败（2026-10-27）
 *
 * 修复前：`append` 抛错会一路冒到 `consumeTurn` 的 catch，被归类为"实例崩溃"——
 * 销毁池内实例（连带重建全部 MCP 连接）+ 广播 `INTERNAL_ERROR`，且 `run.state`
 * 先从 `done` 改成 `error`（双终态）。磁盘满 / 权限不足与实例状态毫无关系。
 */
describe('RunFinalizer.done —— 落盘失败不是实例崩溃（2026-10-27）', () => {
  it('返回 false + 广播 HISTORY_WRITE_FAILED + 终态改 error；不抛错、不广播 done', async () => {
    const failingHistory = {
      append: () => Promise.reject(new Error('ENOSPC: no space left on device')),
    } as unknown as HistoryStore;
    const usage = fakeUsage();
    const errorLog = vi.fn();
    const finalizer = new RunFinalizer({
      history: failingHistory,
      usage: usage.store,
      now: () => 5_000,
      logger: { error: errorLog } as never,
    });
    const run = makeRun();
    const events = collect(run);

    const ok = await finalizer.done(run, turn(), { role: 'user', content: '你好' }, USAGE);

    expect(ok).toBe(false);
    expect(run.state).toBe('error');
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(events.find((e) => e.type === 'error')).toMatchObject({
      data: { error: { code: 'HISTORY_WRITE_FAILED' } },
    });
    // 结构化告警：落盘失败必须可被监控发现（宪章原则九）
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect((errorLog.mock.calls[0]![0] as Record<string, unknown>).event).toBe('run.persist.failed');
  });

  it('失败轮（error 路径）落盘失败：只记日志，不额外广播第二个 error 事件', async () => {
    const failingHistory = {
      append: () => Promise.reject(new Error('EACCES')),
    } as unknown as HistoryStore;
    const usage = fakeUsage();
    const errorLog = vi.fn();
    const finalizer = new RunFinalizer({
      history: failingHistory,
      usage: usage.store,
      now: () => 5_000,
      // error 路径还会调 `logger.warn` 记上游模型失败（`llm.call.failed`），需一并提供
      logger: { error: errorLog, warn: vi.fn() } as never,
    });
    const run = makeRun();
    const events = collect(run);

    await finalizer.error(run, turn(), { role: 'user', content: '你好' }, {
      code: 'LLM_UNAVAILABLE',
      message: '503',
    });

    // 恰好一个 error 事件（主因是 LLM 失败，落盘失败只进日志）
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'error')[0]).toMatchObject({
      data: { error: { code: 'LLM_UNAVAILABLE' } },
    });
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});

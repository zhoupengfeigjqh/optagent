/**
 * 单元测试：交互门（interaction-gate，HITL 挂起/恢复）。
 *
 * 守住的生命周期语义：
 * - request 挂起 → submit 返回确认参数 / reject、超时、drain 返回对应 outcome
 * - settle 幂等：重复提交返回首次结果；expired 后再 settle 返回 expired
 * - 并发上限默认 3：超出 FIFO 排队，前一落定才放行
 * - dispose：run 结束时全部清理，此后 request 立即 reject（防泄漏）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InteractionRequestPayload } from '../../src/domain/interaction-gate.js';
import { InteractionGate } from '../../src/domain/interaction-gate.js';

const INPUT = {
  callId: 'call_1',
  toolName: 'pricing__query_price',
  schema: { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] },
  proposedArgs: { line: 'L01' },
};

describe('InteractionGate：挂起与恢复', () => {
  it('submit：挂起点恢复并返回用户确认参数', async () => {
    const gate = new InteractionGate();
    const req = gate.request(INPUT);
    const id = gate.snapshot()!.interaction_id;

    expect(gate.settle(id, 'submit', { line: 'L02' })).toMatchObject({ result: 'settled' });
    await expect(req).resolves.toEqual({ kind: 'submit', args: { line: 'L02' } });
    // 落定后从等待快照中消失
    expect(gate.snapshot()).toBeNull();
  });

  it('reject：挂起点以 reject 收尾', async () => {
    const gate = new InteractionGate();
    const req = gate.request(INPUT);
    const id = gate.snapshot()!.interaction_id;

    gate.settle(id, 'reject');
    await expect(req).resolves.toEqual({ kind: 'reject' });
  });

  it('settle 幂等：重复提交返回首次结果', async () => {
    const gate = new InteractionGate();
    const req = gate.request(INPUT);
    const id = gate.snapshot()!.interaction_id;

    expect(gate.settle(id, 'submit', { line: 'A' })).toMatchObject({ result: 'settled' });
    expect(gate.settle(id, 'submit', { line: 'B' })).toMatchObject({
      result: 'already-resolved',
      outcome: { kind: 'submit', args: { line: 'A' } },
    });
    await expect(req).resolves.toEqual({ kind: 'submit', args: { line: 'A' } });
  });

  it('不存在的 interaction：settle 返回 not-found', () => {
    const gate = new InteractionGate();
    expect(gate.settle('i_nope', 'reject')).toEqual({ result: 'not-found' });
  });

  it('pendingOf 暴露状态与负载（提交前终验取 schema 用）', async () => {
    const gate = new InteractionGate();
    const req = gate.request(INPUT);
    const id = gate.snapshot()!.interaction_id;

    const pending = gate.pendingOf(id);
    expect(pending?.state).toBe('waiting');
    expect(pending?.payload.tool_name).toBe('pricing__query_price');
    expect(pending?.payload.required).toEqual(['line']);
    expect(pending?.payload.proposed_args).toEqual({ line: 'L01' });
    expect(pending?.payload.title).toContain('确认调用参数');

    gate.settle(id, 'reject');
    await req;
    expect(gate.pendingOf(id)?.state).toBe('resolved');
  });

  it('onCreated 回调收到完整 payload（SSE 广播用）', async () => {
    const created: InteractionRequestPayload[] = [];
    const gate = new InteractionGate({ onCreated: (p) => created.push(p) });
    const req = gate.request(INPUT);
    const id = gate.snapshot()!.interaction_id;

    expect(created).toHaveLength(1);
    expect(created[0]!.interaction_id).toBe(id);
    expect(created[0]!.timeout_seconds).toBe(300);
    gate.settle(id, 'reject');
    await req;
  });

  it('工具级描述进 payload（tool_description；缺省为空串）', async () => {
    const created: InteractionRequestPayload[] = [];
    const gate = new InteractionGate({ onCreated: (p) => created.push(p) });

    const req = gate.request({ ...INPUT, toolDescription: '识别图片中的文字' });
    const id = gate.snapshot()!.interaction_id;
    expect(created[0]!.tool_description).toBe('识别图片中的文字');
    gate.settle(id, 'reject');
    await req;

    const req2 = gate.request(INPUT);
    const id2 = gate.snapshot()!.interaction_id;
    expect(created[1]!.tool_description).toBe('');
    gate.settle(id2, 'reject');
    await req2;
  });
});

describe('InteractionGate：超时', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('超时未处理 → outcome expired，并释放等待中的工具', async () => {
    const gate = new InteractionGate();
    const req = gate.request({ ...INPUT, timeoutSeconds: 10 });

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(req).resolves.toEqual({ kind: 'expired' });
  });

  it('超时后再 settle 返回 expired（不可复活）', async () => {
    const gate = new InteractionGate();
    const req = gate.request({ ...INPUT, timeoutSeconds: 10 });
    const id = gate.snapshot()!.interaction_id;

    await vi.advanceTimersByTimeAsync(10_000);
    await req;
    expect(gate.settle(id, 'submit', { line: 'X' })).toEqual({ result: 'expired' });
    expect(gate.pendingOf(id)?.state).toBe('expired');
  });

  it('超时前 settle 则定时器不再触发', async () => {
    const gate = new InteractionGate();
    const req = gate.request({ ...INPUT, timeoutSeconds: 10 });
    const id = gate.snapshot()!.interaction_id;

    gate.settle(id, 'reject');
    await req;
    await vi.advanceTimersByTimeAsync(60_000); // 不抛错、无副作用即可
    expect(gate.waitingCount()).toBe(0);
  });
});

describe('InteractionGate：drain / dispose / 并发上限', () => {
  it('drain：全部挂起点按 reject 收尾（run 被 stop 场景）', async () => {
    const gate = new InteractionGate();
    const r1 = gate.request(INPUT);
    const r2 = gate.request({ ...INPUT, callId: 'call_2' });

    gate.drain();
    await expect(r1).resolves.toEqual({ kind: 'reject' });
    await expect(r2).resolves.toEqual({ kind: 'reject' });
  });

  it('dispose 后 request 立即 reject，不新建挂起点', async () => {
    const gate = new InteractionGate();
    gate.dispose();
    await expect(gate.request(INPUT)).resolves.toEqual({ kind: 'reject' });
    expect(gate.snapshot()).toBeNull();
  });

  it('并发上限 3：第 4 个请求 FIFO 排队，前一落定后放行', async () => {
    const created: string[] = [];
    const gate = new InteractionGate({
      maxPending: 3,
      onCreated: (p) => created.push(p.interaction_id),
    });
    const a = gate.request(INPUT);
    const b = gate.request({ ...INPUT, callId: 'c2' });
    const c = gate.request({ ...INPUT, callId: 'c3' });
    expect(created).toHaveLength(3);
    expect(gate.waitingCount()).toBe(3);

    // 第 4 个进入排队：不建挂起点、不发 SSE 事件
    const d = gate.request({ ...INPUT, callId: 'c4' });
    await Promise.resolve();
    expect(created).toHaveLength(3);

    // 第一个落定释放槽位 → 第 4 个放行并建立挂起点
    gate.settle(created[0]!, 'reject');
    await a;
    await vi.waitFor(() => expect(created).toHaveLength(4));

    gate.settle(created[3]!, 'submit', { line: 'L09' });
    await expect(d).resolves.toEqual({ kind: 'submit', args: { line: 'L09' } });

    gate.settle(created[1]!, 'reject');
    gate.settle(created[2]!, 'reject');
    await b;
    await c;
  });
});

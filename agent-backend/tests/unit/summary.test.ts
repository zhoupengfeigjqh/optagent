/**
 * summary 滚动摘要单元测试（T029 / FR-017/018）：
 * 窗口边界（窗口外未满 20 条不触发）、攒满 20 条增量重写
 * （旧摘要 + 新归档 20 条 → 新摘要）、失败降级用旧摘要、per-thread 串行互斥。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryStore } from '../../src/domain/history';
import { SummaryStore } from '../../src/domain/summary';
import { threadDir } from '../../src/domain/dirs';
import type { LlmChatRequest, LlmProvider } from '../../src/infra/llm/llm-provider';
import type { LlmEvent } from '../../src/types';
import { FakeLlmProvider, simpleScript, type FakeStep } from '../helpers/fake-llm-provider';

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** 每次 streamChat 取一个脚本的队列 provider */
class QueueProvider implements LlmProvider {
  private readonly queue: FakeStep[][] = [];
  readonly instances: FakeLlmProvider[] = [];
  push(s: FakeStep[]): void {
    this.queue.push(s);
  }
  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    const f = new FakeLlmProvider(this.queue.shift() ?? simpleScript('兜底摘要'));
    this.instances.push(f);
    yield* f.streamChat(req);
  }
}

describe('summary', () => {
  let root: string;
  let history: HistoryStore;
  let provider: QueueProvider;
  let warnings: string[];
  let store: SummaryStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-sum-'));
    history = new HistoryStore(root);
    provider = new QueueProvider();
    warnings = [];
    store = new SummaryStore(root, history, {
      llm: () => provider,
      logger: { warn: (msg: string) => warnings.push(msg) },
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function fill(n: number, threadId = 't1'): Promise<void> {
    for (let i = 1; i <= n; i++) {
      await history.append('admin', threadId, { role: i % 2 === 1 ? 'user' : 'assistant', content: `msg${i}` });
    }
  }

  const summaryFile = (threadId = 't1') => path.join(threadDir(root, 'admin', threadId), 'summary.json');

  it.each([19, 20, 21])('窗口边界：共 %i 条（窗口外不足 20）不触发摘要', async (n) => {
    await fill(n);
    await store.trigger('admin', 't1');
    expect(provider.instances.length).toBe(0);
    expect(store.read('admin', 't1')).toEqual({ summary: '', coveredCount: 0 });
  });

  it('窗口外攒满 20 条 → 增量重写，covered_count 推进', async () => {
    await fill(40); // 窗口外 20 条
    provider.push(simpleScript('摘要v1'));
    await store.trigger('admin', 't1');
    expect(store.read('admin', 't1')).toEqual({ summary: '摘要v1', coveredCount: 20 });
    const onDisk = JSON.parse(readFileSync(summaryFile(), 'utf8')) as { summary: string; covered_count: number };
    expect(onDisk).toEqual({ summary: '摘要v1', covered_count: 20 });
  });

  it('39 条（窗口外 19）不触发；再补 1 条到 40 触发', async () => {
    await fill(39);
    await store.trigger('admin', 't1');
    expect(provider.instances.length).toBe(0);
    await history.append('admin', 't1', { role: 'user', content: 'msg40' });
    provider.push(simpleScript('摘要v1'));
    await store.trigger('admin', 't1');
    expect(store.read('admin', 't1').coveredCount).toBe(20);
  });

  it('增量重写请求包含旧摘要与新归档的 20 条消息', async () => {
    await fill(40);
    provider.push(simpleScript('摘要v1'));
    await store.trigger('admin', 't1');
    await fill(20, 't1'); // 再攒 20 条到窗口外
    provider.push(simpleScript('摘要v2'));
    await store.trigger('admin', 't1');

    const req = provider.instances[1]!.requests[0]!;
    const text = req.messages.map((m) => m.content).join('\n');
    expect(text).toContain('摘要v1'); // 旧摘要并入
    expect(text).toContain('msg21'); // 新归档起点
    expect(text).toContain('msg40'); // 新归档终点
    expect(store.read('admin', 't1')).toEqual({ summary: '摘要v2', coveredCount: 40 });
  });

  it('摘要生成失败：保留旧摘要并告警，不抛出', async () => {
    await fill(40);
    provider.push([{ type: 'error', code: 'LLM_ERROR', message: '模型挂了' }]);
    await store.trigger('admin', 't1'); // 不 reject
    expect(store.read('admin', 't1')).toEqual({ summary: '', coveredCount: 0 });
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('per-thread 串行：第二次 trigger 等第一次完成后再发起 LLM 调用', async () => {
    await fill(60); // 窗口外 40，可连做两批
    provider.push([{ type: 'wait', id: 'w1' }, ...simpleScript('摘要v1')]);
    provider.push(simpleScript('摘要v2'));

    const p1 = store.trigger('admin', 't1');
    const p2 = store.trigger('admin', 't1');
    // 等第一次到达 wait 点；此刻第二批不应已发起
    await waitFor(() => provider.instances.length > 0);
    await provider.instances[0]!.reached('w1');
    expect(provider.instances.length).toBe(1);
    provider.instances[0]!.resume('w1');
    await Promise.all([p1, p2]);
    expect(provider.instances.length).toBe(2);
    expect(store.read('admin', 't1')).toEqual({ summary: '摘要v2', coveredCount: 40 });
  });

  it('不同 thread 互不影响', async () => {
    await fill(40, 't1');
    await fill(40, 't2');
    provider.push(simpleScript('t1摘要'));
    provider.push(simpleScript('t2摘要'));
    await Promise.all([store.trigger('admin', 't1'), store.trigger('admin', 't2')]);
    expect(store.read('admin', 't1').summary).toBe('t1摘要');
    expect(store.read('admin', 't2').summary).toBe('t2摘要');
  });

  it('read：文件不存在返回空摘要；损坏文件按空处理并告警', async () => {
    expect(store.read('admin', 'nope')).toEqual({ summary: '', coveredCount: 0 });
    await fill(1);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(summaryFile(), '不是json');
    expect(store.read('admin', 't1')).toEqual({ summary: '', coveredCount: 0 });
    expect(warnings.length).toBeGreaterThan(0);
  });
});

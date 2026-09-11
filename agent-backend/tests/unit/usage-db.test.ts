import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageDb } from '../../src/infra/usage-db';

describe('UsageDb', () => {
  let dir: string;
  let db: UsageDb;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'optagent-usage-'));
    db = new UsageDb(path.join(dir, 'sub', 'usage.db')); // 顺带验证目录自动创建
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const rec = (over: Partial<Record<string, string | number>> = {}) => ({
    userId: 'admin',
    threadId: 't1',
    agentName: 'helper',
    inputTokens: 10,
    outputTokens: 20,
    createdAt: '2026-09-09T10:00:00.000Z',
    ...over,
  });

  it('record + summary 汇总正确', () => {
    db.record(rec());
    db.record(rec({ threadId: 't2', inputTokens: 5, outputTokens: 7 }));
    const s = db.summary({ userId: 'admin' });
    expect(s.total).toEqual({ inputTokens: 15, outputTokens: 27, count: 2 });
    expect(s.grouped).toHaveLength(2);
  });

  it('按 thread_id / agent_name 过滤', () => {
    db.record(rec({ threadId: 't1' }));
    db.record(rec({ threadId: 't2', agentName: 'other' }));
    expect(db.summary({ userId: 'admin', threadId: 't1' }).total.count).toBe(1);
    expect(db.summary({ userId: 'admin', agentName: 'other' }).total.inputTokens).toBe(10);
  });

  it('按时间范围过滤', () => {
    db.record(rec({ createdAt: '2026-09-01T00:00:00.000Z' }));
    db.record(rec({ createdAt: '2026-09-09T00:00:00.000Z' }));
    const s = db.summary({ userId: 'admin', from: '2026-09-05', to: '2026-09-10' });
    expect(s.total.count).toBe(1);
  });

  it('多用户隔离：user_id 不串', () => {
    db.record(rec());
    db.record(rec({ userId: 'bob' }));
    expect(db.summary({ userId: 'admin' }).total.count).toBe(1);
  });

  it('空结果返回零值而非 null', () => {
    const s = db.summary({ userId: 'nobody' });
    expect(s.total).toEqual({ inputTokens: 0, outputTokens: 0, count: 0 });
  });

  it('grouped：按 thread+agent 聚合、SUM 正确、按 inputTokens 倒序（T045）', () => {
    // 同一 thread 两条记录应聚合为一组；不同 thread 各自成组
    db.record(rec({ threadId: 't1', agentName: 'a', inputTokens: 10, outputTokens: 20 }));
    db.record(rec({ threadId: 't1', agentName: 'a', inputTokens: 5, outputTokens: 7 }));
    db.record(rec({ threadId: 't2', agentName: 'b', inputTokens: 100, outputTokens: 1 }));
    db.record(rec({ userId: 'bob', threadId: 't1', agentName: 'a', inputTokens: 999, outputTokens: 999 }));

    const s = db.summary({ userId: 'admin' });
    expect(s.total).toEqual({ inputTokens: 115, outputTokens: 28, count: 3 });
    expect(s.grouped).toEqual([
      { threadId: 't2', agentName: 'b', inputTokens: 100, outputTokens: 1, count: 1 },
      { threadId: 't1', agentName: 'a', inputTokens: 15, outputTokens: 27, count: 2 },
    ]);
  });

  it('组合过滤：thread + agent + 时间范围同时生效（T045）', () => {
    db.record(rec({ threadId: 't1', agentName: 'a', createdAt: '2026-09-01T00:00:00.000Z' }));
    db.record(rec({ threadId: 't1', agentName: 'a', createdAt: '2026-09-08T00:00:00.000Z' }));
    db.record(rec({ threadId: 't1', agentName: 'b', createdAt: '2026-09-08T00:00:00.000Z' }));
    const s = db.summary({
      userId: 'admin',
      threadId: 't1',
      agentName: 'a',
      from: '2026-09-05',
      to: '2026-09-09',
    });
    expect(s.total.count).toBe(1);
    expect(s.grouped).toHaveLength(1);
  });

  it('record 失败不抛出（已关闭的库）', () => {
    db.close();
    expect(() => db.record(rec())).not.toThrow();
    db = new UsageDb(path.join(dir, 'usage2.db')); // 供 afterEach close
  });
});

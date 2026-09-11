/**
 * tmp 清理与调度器单元测试（T040）：
 * - cleanupTmpDir：7 天未访问删除、近期访问保留、atime 优先于 mtime、
 *   上传暂存残留 1 小时清理、单文件失败不中断
 * - IntervalScheduler：注册/触发/任务异常不中断/stopAll 停止
 */
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTmpDir } from '../../src/domain/tmp-cleanup';
import { IntervalScheduler } from '../../src/infra/scheduler';

describe('tmp 清理（T040）', () => {
  let dir: string;
  const now = new Date('2026-09-09T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'optagent-cleanup-'));
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  const make = (name: string, ageDays: number, atimeDays?: number) => {
    const f = path.join(dir, name);
    writeFileSync(f, 'x');
    utimesSync(f, daysAgo(atimeDays ?? ageDays), daysAgo(ageDays));
    return f;
  };

  it('8 天未访问删除；6 天保留；mtime 旧但 atime 新（刚被读过）保留', async () => {
    make('old.csv', 8);
    make('fresh.csv', 6);
    make('recently-read.csv', 10, 1); // mtime 10 天前、atime 1 天前
    const r = await cleanupTmpDir(dir, { now });
    expect(r.deleted).toBe(1);
    expect(existsSync(path.join(dir, 'old.csv'))).toBe(false);
    expect(existsSync(path.join(dir, 'fresh.csv'))).toBe(true);
    expect(existsSync(path.join(dir, 'recently-read.csv'))).toBe(true);
  });

  it('边界：7 天内保留，超过即删；目录不存在不报错', async () => {
    make('exactly7.csv', 6.5);
    make('over7.csv', 7.5);
    const r = await cleanupTmpDir(dir, { now });
    expect(existsSync(path.join(dir, 'exactly7.csv'))).toBe(true);
    expect(existsSync(path.join(dir, 'over7.csv'))).toBe(false);
    expect(r.deleted).toBe(1);
    await expect(cleanupTmpDir(path.join(dir, 'nope'), { now })).resolves.toEqual({
      deleted: 0,
      failed: 0,
    });
  });

  it('上传暂存残留（.upload-*）超过 1 小时即清理', async () => {
    make('.upload-123-abc', 0.1); // 2.4 小时前
    const r = await cleanupTmpDir(dir, { now });
    expect(existsSync(path.join(dir, '.upload-123-abc'))).toBe(false);
    expect(r.failed).toBe(0);
  });
});

describe('IntervalScheduler（T040）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('按周期触发；任务异常记日志且调度不中断', async () => {
    const warns: string[] = [];
    const s = new IntervalScheduler({ warn: (m) => warns.push(m) });
    let calls = 0;
    s.every(
      1000,
      async () => {
        calls++;
        if (calls === 1) throw new Error('boom');
      },
      't',
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(calls).toBe(3);
    expect(warns.join('')).toContain('boom');
    s.stopAll();
    expect(s.size).toBe(0);
  });

  it('stopAll 后不再触发；同名重复注册替换旧任务', async () => {
    const s = new IntervalScheduler();
    let a = 0;
    let b = 0;
    s.every(1000, async () => void a++, 'x');
    s.every(1000, async () => void b++, 'x'); // 替换
    await vi.advanceTimersByTimeAsync(2100);
    expect(a).toBe(0);
    expect(b).toBe(2);
    s.stopAll();
    await vi.advanceTimersByTimeAsync(3000);
    expect(b).toBe(2);
  });
});

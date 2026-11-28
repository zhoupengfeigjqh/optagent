/**
 * 单元测试：单会话登记（`FR-014`）
 * 028 阶段 1：写方法 async 化；2026-11-28 读取也 async 化（端口要求回源、不认缓存）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/domain/auth/session-store.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let sessions: SessionStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'));
  const store = new PlatformStore(root);
  store.ensureLayout();
  sessions = new SessionStore(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('SessionStore', () => {
  it('登记→读取→判定', async () => {
    expect(await sessions.getCurrentSession('zpf')).toBeNull();
    await sessions.setCurrentSession('zpf', 's1');
    expect(await sessions.getCurrentSession('zpf')).toBe('s1');
    expect(await sessions.isCurrentSession('zpf', 's1')).toBe(true);
    expect(await sessions.isCurrentSession('zpf', 's2')).toBe(false);
  });

  it('覆盖旧会话（后登踢前登）', async () => {
    await sessions.setCurrentSession('zpf', 's1');
    await sessions.setCurrentSession('zpf', 's2');
    expect(await sessions.isCurrentSession('zpf', 's1')).toBe(false);
    expect(await sessions.isCurrentSession('zpf', 's2')).toBe(true);
  });

  it('清除会话且幂等', async () => {
    await sessions.setCurrentSession('zpf', 's1');
    await sessions.clearSession('zpf');
    expect(await sessions.getCurrentSession('zpf')).toBeNull();
    await expect(sessions.clearSession('zpf')).resolves.toBeUndefined();
  });

  it('另一个实例（模拟另一进程）写入后，本实例立刻可见', async () => {
    // 同一目录、另一个 SessionStore 实例 = 另一个进程的等价物：读取必须回源，不能缓存
    const other = new SessionStore(new PlatformStore(root));
    await other.setCurrentSession('zpf', 's-other');
    expect(await sessions.getCurrentSession('zpf')).toBe('s-other');
    expect(await sessions.isCurrentSession('zpf', 's-other')).toBe(true);
  });
});

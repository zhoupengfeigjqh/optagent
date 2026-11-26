/**
 * 单元测试：删除会话前的有界等待（2026-11-26，S1 加固）。
 *
 * 背景：`stop()` 只是发 abort 信号，run 的收尾是异步的。删除接口若只排空"当时"的
 * 写入链就删目录，`finalize` 之后的 tool-events / history 写入仍会 `mkdirSync`，
 * 留下没有 `meta.json` 的孤儿目录。
 *
 * 这里只钉 `awaitIdle` 的两条语义：空闲立即 true；在途 run 有超时上界（不会挂住删除）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HistoryStore } from '../../src/domain/history.js';
import { RunManager } from '../../src/domain/run-manager.js';
import { UsageDb } from '../../src/infra/usage-db.js';

let root: string;
let usage: UsageDb;
let manager: RunManager;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manager-idle-'));
  usage = new UsageDb(path.join(root, 'usage.db'));
  manager = new RunManager({ history: new HistoryStore(root), usage });
});

afterEach(() => {
  usage.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** 直接放进 `active`：本用例只关心"有在途 run 时的等待语义"，不启动真实 run */
function registerFakeRun(threadId: string, settled: Promise<void>): void {
  (manager as unknown as { active: Map<string, { settled: Promise<void> }> }).active.set(threadId, {
    settled,
  });
}

describe('RunManager.awaitIdle', () => {
  it('没有在途 run → 立即 true（删除不必等）', async () => {
    await expect(manager.awaitIdle('th_none', 5_000)).resolves.toBe(true);
  });

  it('在途 run 收尾 → true', async () => {
    registerFakeRun('th_done', Promise.resolve());

    await expect(manager.awaitIdle('th_done', 5_000)).resolves.toBe(true);
  });

  it('在途 run 迟迟不收尾 → 到点 false（删除不被挂住）', async () => {
    registerFakeRun('th_hang', new Promise<void>(() => undefined));

    await expect(manager.awaitIdle('th_hang', 30)).resolves.toBe(false);
  });
});

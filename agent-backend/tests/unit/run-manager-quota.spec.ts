/**
 * 单元测试：并发额度占位与"启动窗口"（2026-10-27）
 *
 * 背景：`acquireQuota`（同步占位）与 `startRun`（run 注册）之间隔着实打实的 await——
 * 取实例 + 等 MCP 就绪，最长可达十几秒。这段窗口里：
 * 1. 用户点「停止」——修复前 `stop()` 只看 `active`，返回 false（界面已断流，后端照跑）；
 * 2. 用户删会话——`stop()` 同样无效，随后 run 会把刚删掉的目录重建出来；
 * 3. 优雅关闭——只按 `activeRunCount` 判"已排空"，与占位转正赛跑。
 *
 * 这里把三条口径钉住：取消标记的来源与清理、`inFlightCount` 的构成、drain 的等待条件。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryStore } from '../../src/domain/history.js';
import { RunManager } from '../../src/domain/run-manager.js';
import { gracefulShutdown } from '../../src/graceful-shutdown.js';
import { UsageDb } from '../../src/infra/usage-db.js';

const LIMIT = 3;

let root: string;
let usage: UsageDb;
let manager: RunManager;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manager-quota-'));
  usage = new UsageDb(path.join(root, 'usage.db'));
  manager = new RunManager({ history: new HistoryStore(root), usage });
});

afterEach(() => {
  usage.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** 让出事件循环（给 drain 的轮询推进一次） */
const tick = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('启动窗口内的停止（2026-10-27）', () => {
  it('占位阶段 stop：返回 true 并留下取消标记（修复前返回 false，停止无效）', () => {
    const release = manager.acquireQuota('admin', 'th_1', LIMIT);

    expect(manager.stop('th_1')).toBe(true);
    // 一次性消费：请求侧读到一次即失效，不会连累后续轮次
    expect(manager.takeCancel('th_1')).toBe(true);
    expect(manager.takeCancel('th_1')).toBe(false);

    release();
  });

  it('额度归还连带清掉取消标记（不给下一轮留幽灵取消）', () => {
    const release = manager.acquireQuota('admin', 'th_2', LIMIT);

    manager.stop('th_2');
    release(); // 请求因取消而放弃 → 归还额度

    expect(manager.takeCancel('th_2')).toBe(false);
    expect(manager.hasActive('th_2')).toBe(false);
  });

  it('无占位无活跃 run 时 stop 返回 false（保持既有语义）', () => {
    expect(manager.stop('th_none')).toBe(false);
  });
});

describe('在途计数口径（2026-10-27）', () => {
  it('inFlightCount 计入启动中占位；activeRunCount 仍是"活跃 run"指标', () => {
    const release = manager.acquireQuota('admin', 'th_3', LIMIT);

    expect(manager.activeRunCount()).toBe(0);
    expect(manager.inFlightCount()).toBe(1);

    release();
    expect(manager.inFlightCount()).toBe(0);
  });
});

describe('优雅关闭的等待条件（2026-10-27）', () => {
  it('占位未结束时不判定"已排空"；归还后才 drained', async () => {
    const release = manager.acquireQuota('admin', 'th_4', LIMIT);
    let closed = false;
    const app = {
      close: async (): Promise<void> => {
        closed = true;
      },
    };

    const draining = gracefulShutdown(app, manager, 5_000);
    let settled = false;
    void draining.then(() => {
      settled = true;
    });

    await tick();
    expect(closed).toBe(true); // close 已发起，但仍在等在途
    expect(settled).toBe(false);

    release();
    await expect(draining).resolves.toBe('drained');
    expect(settled).toBe(true);
  });
});

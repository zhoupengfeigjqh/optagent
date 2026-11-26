/**
 * 单元测试：计划留档（`plan.jsonl`）。
 *
 * 守住四条硬约束：与 `history.jsonl` 物理分离、同线程串行不交错、有界滚动、
 * 写盘失败只告警（留档失败绝不影响对话）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlanStore, PLAN_RECORD_KEEP, type PlanRunRecord } from '../../src/domain/plan/store.js';

const UID = 'u1';
const AGENT = '生产计划助手';
const THREAD = 't1';

let root: string;
let warnings: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-plan-store-'));
  warnings = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function newStore(): PlanStore {
  return new PlanStore(root, { warn: (msg) => warnings.push(msg) });
}

function record(goal = '补采购'): PlanRunRecord {
  return {
    goal,
    reason: 'completed',
    total_steps: 1,
    rolls: 0,
    replans: 0,
    duration_ms: 1200,
    done_summary: ['已查询库存 12 条'],
    steps: [
      {
        seq_id: 1,
        task_name: '查询库存',
        type: 'query',
        core_action: 'rawmcp__QueryInventory',
        status: 'done',
        attempts: 1,
      },
    ],
  };
}

describe('追加与落点', () => {
  it('追加一条后可读回，归属字段由 store 补齐', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, record());
    const records = store.readAll(UID, AGENT, THREAD);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      goal: '补采购',
      reason: 'completed',
      total_steps: 1,
      thread_id: THREAD,
      agent_name: AGENT,
      duration_ms: 1200,
    });
    expect(records[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(records[0]!.steps[0]!.core_action).toBe('rawmcp__QueryInventory');
  });

  it('写在独立侧车文件，不碰 history.jsonl', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, record());
    const file = store.filePathOf(UID, AGENT, THREAD);
    expect(file.endsWith('plan.jsonl')).toBe(true);
    expect(path.basename(path.dirname(file))).toBe(THREAD);
    expect(fs.existsSync(path.join(path.dirname(file), 'history.jsonl'))).toBe(false);
  });

  it('并发 5 条不交错（per-thread 串行）', async () => {
    const store = newStore();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => store.append(UID, AGENT, THREAD, record(`g-${i}`))),
    );
    const records = store.readAll(UID, AGENT, THREAD);
    expect(records.map((item) => item.goal)).toEqual(['g-0', 'g-1', 'g-2', 'g-3', 'g-4']);
  });

  it('坏行跳过，不影响其余记录', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, record());
    fs.appendFileSync(store.filePathOf(UID, AGENT, THREAD), '{ 坏行\n', 'utf8');
    await store.append(UID, AGENT, THREAD, record('g-2'));
    expect(store.readAll(UID, AGENT, THREAD)).toHaveLength(2);
  });

  it('文件不存在时 readAll 返回空数组', () => {
    expect(newStore().readAll(UID, AGENT, 'never-written')).toEqual([]);
  });
});

describe('有界', () => {
  it('超过保留条数即重写：收敛到上限且保留最新记录', async () => {
    const store = newStore();
    for (let i = 0; i < PLAN_RECORD_KEEP + 5; i += 1) {
      await store.append(UID, AGENT, THREAD, record(`g-${i}`));
    }
    const records = store.readAll(UID, AGENT, THREAD);
    expect(records).toHaveLength(PLAN_RECORD_KEEP);
    expect(records.at(-1)!.goal).toBe(`g-${PLAN_RECORD_KEEP + 4}`);
  });

  it('整理失败（临时路径被占用）只告警并保留原文件', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, record());
    const file = store.filePathOf(UID, AGENT, THREAD);
    fs.mkdirSync(`${file}.tmp`, { recursive: true });
    for (let i = 0; i < PLAN_RECORD_KEEP + 1; i += 1) {
      await store.append(UID, AGENT, THREAD, record(`g-${i}`));
    }
    expect(warnings.some((message) => message.includes('整理失败'))).toBe(true);
    expect(store.readAll(UID, AGENT, THREAD).length).toBeGreaterThan(0);
  });
});

describe('失败语义', () => {
  it('写盘失败只告警，不抛错', async () => {
    const store = newStore();
    // 线程目录被同名文件占用 → mkdir 失败
    const file = store.filePathOf(UID, AGENT, THREAD);
    fs.mkdirSync(path.dirname(path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.dirname(file), 'blocked');
    await expect(store.append(UID, AGENT, THREAD, record())).resolves.toBeUndefined();
    expect(warnings.some((message) => message.includes('写入失败'))).toBe(true);
  });

  it('未注入 logger 时：成功与失败路径都不抛错', async () => {
    const silent = new PlanStore(root);
    await expect(silent.append(UID, AGENT, THREAD, record())).resolves.toBeUndefined();

    const blockedRoot = path.join(root, 'blocked-root');
    fs.writeFileSync(blockedRoot, 'x');
    const blocked = new PlanStore(blockedRoot);
    await expect(blocked.append(UID, AGENT, THREAD, record())).resolves.toBeUndefined();
  });

  it('连续失败不会污染串行链：后续追加仍走同一 Promise 链且不抛错', async () => {
    const store = newStore();
    const file = store.filePathOf(UID, AGENT, THREAD);
    fs.mkdirSync(path.dirname(path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.dirname(file), 'blocked');
    await expect(store.append(UID, AGENT, THREAD, record('first'))).resolves.toBeUndefined();
    await expect(store.append(UID, AGENT, THREAD, record('second'))).resolves.toBeUndefined();
    expect(warnings.filter((message) => message.includes('写入失败'))).toHaveLength(2);
  });
});

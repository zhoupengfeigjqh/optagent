/**
 * 单元测试：意图聚焦留档（013）。
 *
 * 守住四条口径：
 * - 每轮一条 JSONL、`seq` 线程内自增且并发不交错；
 * - 五种处置（含空结果 / 跳过 / 降级 / 未配置）全部留档，内容为中文；
 * - 超过 256KB 或 200 行时滚动保留最近 100 条（不无限增长）；
 * - **写入失败不抛错**（只告警），因为记录失败绝不能影响对话。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IntentFocusStore,
  type IntentFocusRecordDraft,
} from '../../src/domain/intent-focus-store.js';
import type { IntentFocusDisposition } from '../../src/domain/intent-focus.js';

const UID = 'u1';
const AGENT = '生产计划助手';
const THREAD = 't1';

let root: string;
let warnings: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-focus-store-'));
  warnings = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function newStore(): IntentFocusStore {
  return new IntentFocusStore(root, { warn: (msg) => warnings.push(msg) });
}

function draft(overrides: Partial<IntentFocusRecordDraft> = {}): IntentFocusRecordDraft {
  return {
    thread_id: THREAD,
    agent_name: AGENT,
    message_id: 'm-1',
    input: '帮我看看这批订单还能不能插单',
    input_truncated: false,
    disposition: 'focused' as IntentFocusDisposition,
    reason: null,
    model: 'laya-multilingual',
    round_ms: 214,
    candidates: 3,
    batches: 1,
    truncated: false,
    probabilities: { order_query: 0.87 },
    actions: ['order_query'],
    focus_prompt: '本轮可优先考虑以下工具（仅供参考，不必局限）：order_query',
    error: null,
    ...overrides,
  };
}

describe('追加与序号', () => {
  it('每轮一条，seq 从 1 连续自增', async () => {
    const store = newStore();
    for (let i = 0; i < 3; i++) await store.append(UID, AGENT, THREAD, draft());

    const records = store.readAll(UID, AGENT, THREAD);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(records[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('并发追加不交错、seq 不重复', async () => {
    const store = newStore();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.append(UID, AGENT, THREAD, draft({ message_id: `m-${i}` })),
      ),
    );

    const records = store.readAll(UID, AGENT, THREAD);
    expect(records).toHaveLength(5);
    expect(new Set(records.map((r) => r.seq)).size).toBe(5);
  });

  it('新实例按现有行数续号（重启不重号）', async () => {
    await newStore().append(UID, AGENT, THREAD, draft());
    const second = newStore();
    await second.append(UID, AGENT, THREAD, draft());
    expect(second.readAll(UID, AGENT, THREAD).map((r) => r.seq)).toEqual([1, 2]);
  });
});

describe('处置与中文口径', () => {
  it('五种处置各留一行，中文原文保留', async () => {
    const store = newStore();
    const dispositions: IntentFocusDisposition[] = [
      'focused',
      'empty',
      'skipped',
      'degraded',
      'unconfigured',
    ];
    for (const disposition of dispositions) {
      await store.append(
        UID,
        AGENT,
        THREAD,
        draft({
          disposition,
          reason: disposition === 'focused' ? null : `${disposition}_reason`,
          focus_prompt: disposition === 'focused' ? '本轮可优先考虑以下工具（仅供参考，不必局限）：order_query' : '',
          actions: disposition === 'focused' ? ['order_query'] : [],
        }),
      );
    }

    const records = store.readAll(UID, AGENT, THREAD);
    expect(records.map((r) => r.disposition)).toEqual(dispositions);
    expect(records[0]!.focus_prompt).toContain('本轮可优先考虑以下工具（仅供参考，不必局限）');
    expect(records[2]!.reason).toBe('skipped_reason');
    expect(records[3]!.focus_prompt).toBe('');
  });

  it('坏行跳过，不影响其余记录', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, draft());
    fs.appendFileSync(store.filePathOf(UID, AGENT, THREAD), '{ 坏行\n', 'utf8');
    await store.append(UID, AGENT, THREAD, draft());

    expect(store.readAll(UID, AGENT, THREAD)).toHaveLength(2);
  });
});

describe('有界与失败', () => {
  it('超过 200 行滚动保留（不无限增长）', async () => {
    const store = newStore();
    for (let i = 0; i < 205; i++) await store.append(UID, AGENT, THREAD, draft());

    const records = store.readAll(UID, AGENT, THREAD);
    expect(records.length).toBeLessThanOrEqual(200);
    expect(records.length).toBeGreaterThanOrEqual(100);
    expect(records.at(-1)!.seq).toBe(205);
  });

  it('写入失败（路径被目录占用）不抛错，只告警', async () => {
    const store = newStore();
    const file = store.filePathOf(UID, AGENT, THREAD);
    fs.mkdirSync(file, { recursive: true });

    await expect(store.append(UID, AGENT, THREAD, draft())).resolves.toBeUndefined();
    expect(warnings.some((w) => w.includes('记录写入失败'))).toBe(true);
  });

  it('文件不存在时 readAll 返回空数组', () => {
    expect(newStore().readAll(UID, AGENT, 'missing-thread')).toEqual([]);
  });
});

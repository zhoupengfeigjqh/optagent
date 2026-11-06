/**
 * 单元测试：意图聚焦留档（016 记录 schema）。
 *
 * 守住四条硬约束：与会话历史物理分离、seq 连续、并发不交错、有界滚动；
 * 以及写盘失败只告警（记录失败绝不影响对话）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IntentFocusStore,
  MAX_RECORD_BYTES,
  type IntentFocusRecordDraft,
} from '../../src/domain/intent-focus/store.js';
import type { IntentFocusDisposition } from '../../src/domain/intent-focus/state.js';

const UID = 'u1';
const AGENT = '生产计划助手';
const THREAD = 't1';

let root: string;
let warnings: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-intent-store-'));
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
    input: '帮我创建一笔原材料采购单',
    input_truncated: false,
    disposition: 'focused' as IntentFocusDisposition,
    reason: null,
    model: 'laya-multilingual',
    round_ms: 214,
    candidates: 5,
    batches: 2,
    truncated: false,
    skills: [
      {
        name: 'raw-material-inventory-new',
        description: '原材料采购和库存本体技能',
        is_ontology: true,
        ontology_id: '1',
        score: 0.88,
        selected: true,
        reason: null,
      },
    ],
    behaviors: [
      {
        name: 'CreatePurchaseRecord',
        title: '创建原材料采购单',
        ontology_id: '1',
        ontology_name: '原材料采购和库存',
        score: 0.88,
      },
      {
        name: 'QueryPurchaseRecords',
        title: '查询原材料采购单信息',
        ontology_id: '1',
        ontology_name: '原材料采购和库存',
        score: 0.81,
      },
    ],
    prompt:
      "本轮的任务与以下技能或本体行为密切相关，请重点关注（仅供参考，不必局限）\n1）raw-material-inventory-new（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）",
    prompt_truncated: false,
    warnings: [],
    error: null,
    ...overrides,
  };
}

describe('追加与序号', () => {
  it('每轮一条，seq 从 1 连续自增', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, draft());
    await store.append(UID, AGENT, THREAD, draft({ disposition: 'empty' }));
    const records = store.readAll(UID, AGENT, THREAD);
    expect(records.map((record) => record.seq)).toEqual([1, 2]);
    expect(records[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('记录写在独立侧车文件，不碰历史文件', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, draft());
    const file = store.filePathOf(UID, AGENT, THREAD);
    expect(file.endsWith('intent-focus.jsonl')).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(file), 'history.jsonl'))).toBe(false);
  });

  it('并发 5 条不交错（per-thread 串行）', async () => {
    const store = newStore();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => store.append(UID, AGENT, THREAD, draft({ message_id: `m-${i}` }))),
    );
    const records = store.readAll(UID, AGENT, THREAD);
    expect(records).toHaveLength(5);
    expect(records.map((record) => record.seq)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('记录 schema', () => {
  it('只写技能与入选行为；不写函数 / 数据补充 / 恒定字段', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, draft());
    const record = store.readAll(UID, AGENT, THREAD)[0]!;

    expect(record.skills[0]!.name).toBe('raw-material-inventory-new');
    expect(record.behaviors.map((item) => item.name)).toEqual([
      'CreatePurchaseRecord',
      'QueryPurchaseRecords',
    ]);
    expect(record.behaviors[0]).not.toHaveProperty('kind');
    expect(record.behaviors[0]).not.toHaveProperty('selected');
    expect(record.behaviors[0]).not.toHaveProperty('source');
    expect(record).not.toHaveProperty('functions');
    expect(record).not.toHaveProperty('data_supplements');
    expect(record).not.toHaveProperty('selected_behaviors');
    expect(record).not.toHaveProperty('ontology_files');
    expect(record).not.toHaveProperty('probabilities');
    expect(record).not.toHaveProperty('actions');
    expect(record).not.toHaveProperty('focus_prompt');
  });

  it('五种处置都能落档，reason 可区分', async () => {
    const store = newStore();
    const dispositions: IntentFocusDisposition[] = ['focused', 'empty', 'skipped', 'degraded', 'unconfigured'];
    for (const disposition of dispositions) {
      await store.append(
        UID,
        AGENT,
        THREAD,
        draft({
          disposition,
          reason: disposition === 'focused' ? null : `${disposition}_reason`,
          prompt: disposition === 'focused' ? draft().prompt : '',
        }),
      );
    }
    const records = store.readAll(UID, AGENT, THREAD);
    expect(records.map((record) => record.disposition)).toEqual(dispositions);
    expect(records[1]!.reason).toBe('empty_reason');
  });

  it('坏行跳过，不影响其余记录', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, draft());
    fs.appendFileSync(store.filePathOf(UID, AGENT, THREAD), '{ 坏行\n', 'utf8');
    await store.append(UID, AGENT, THREAD, draft());
    expect(store.readAll(UID, AGENT, THREAD)).toHaveLength(2);
  });

  it('旧行（缺新字段）可读且不报错', async () => {
    const store = newStore();
    const file = store.filePathOf(UID, AGENT, THREAD);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', seq: 1, disposition: 'focused' })}\n`);
    expect(store.readAll(UID, AGENT, THREAD)).toHaveLength(1);
  });
});

describe('有界与失败语义', () => {
  it('超过上限触发重写：总行数收敛到 200 以内且保留最新记录', async () => {
    const store = newStore();
    for (let i = 0; i < 205; i++) {
      await store.append(UID, AGENT, THREAD, draft({ message_id: `m-${i}` }));
    }
    const records = store.readAll(UID, AGENT, THREAD);
    expect(records.length).toBeLessThan(205);
    expect(records.length).toBeLessThanOrEqual(200);
    expect(records.at(-1)!.message_id).toBe('m-204');
  });

  it('未注入 logger 时：成功与失败路径都不抛错', async () => {
    const silent = new IntentFocusStore(root);
    await expect(silent.append(UID, AGENT, THREAD, draft())).resolves.toBeUndefined();

    // 根目录位置被普通文件占用 → mkdir 必失败，走 catch 且 logger 缺省
    const blockedRoot = path.join(root, 'blocked-root');
    fs.writeFileSync(blockedRoot, 'x');
    const blocked = new IntentFocusStore(blockedRoot);
    await expect(blocked.append(UID, AGENT, THREAD, draft())).resolves.toBeUndefined();
  });

  it('文件不存在时 readAll 返回空数组', () => {
    expect(newStore().readAll(UID, AGENT, 'never-written')).toEqual([]);
  });

  it('新实例接着已有文件写：按现有行数对齐 seq（不重置为 1）', async () => {
    await newStore().append(UID, AGENT, THREAD, draft());
    await newStore().append(UID, AGENT, THREAD, draft());
    const store = newStore();
    await store.append(UID, AGENT, THREAD, draft());
    expect(store.readAll(UID, AGENT, THREAD).map((record) => record.seq)).toEqual([1, 2, 3]);
  });

  it('显式传入 at 时不再覆盖（测试注入时间）', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, draft({ at: '2026-01-02T03:04:05.000Z' }));
    expect(store.readAll(UID, AGENT, THREAD)[0]!.at).toBe('2026-01-02T03:04:05.000Z');
  });

  it('整理失败且未注入 logger：静默保留原文件', async () => {
    const silent = new IntentFocusStore(root);
    await silent.append(UID, AGENT, THREAD, draft());
    const file = silent.filePathOf(UID, AGENT, THREAD);
    fs.mkdirSync(`${file}.tmp`, { recursive: true });
    for (let i = 0; i < 205; i++) {
      await silent.append(UID, AGENT, THREAD, draft({ message_id: `m-${i}` }));
    }
    expect(silent.readAll(UID, AGENT, THREAD).length).toBeGreaterThan(0);
  });

  it('整理失败（临时路径被占用）只告警并保留原文件', async () => {
    const store = newStore();
    // 先写入一条，占住 `${file}.tmp` 这个路径（目录 → writeFileSync 必失败）
    await store.append(UID, AGENT, THREAD, draft());
    const file = store.filePathOf(UID, AGENT, THREAD);
    fs.mkdirSync(`${file}.tmp`, { recursive: true });
    for (let i = 0; i < 205; i++) {
      await store.append(UID, AGENT, THREAD, draft({ message_id: `m-${i}` }));
    }
    expect(warnings.some((message) => message.includes('整理失败'))).toBe(true);
    expect(store.readAll(UID, AGENT, THREAD).length).toBeGreaterThan(0);
  });

  it('单条超大记录不抛错，仍可读回（字节上限只触发整理，不截断内容）', async () => {
    const store = newStore();
    await store.append(UID, AGENT, THREAD, draft({ input: 'x'.repeat(MAX_RECORD_BYTES + 1024) }));
    const records = store.readAll(UID, AGENT, THREAD);
    expect(records).toHaveLength(1);
    expect(records[0]!.input.length).toBeGreaterThan(MAX_RECORD_BYTES);
  });

  it('写盘失败只告警，不抛错', async () => {
    const store = newStore();
    // 线程目录被同名文件占用 → mkdir 失败
    const file = store.filePathOf(UID, AGENT, THREAD);
    fs.mkdirSync(path.dirname(path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.dirname(file), 'blocked');
    await expect(store.append(UID, AGENT, THREAD, draft())).resolves.toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
  });
});

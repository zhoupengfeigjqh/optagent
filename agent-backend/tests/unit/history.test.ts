/**
 * history.jsonl 读写测试（T023）：追加写、坏行跳过、整体损坏重建告警、并发追加。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryStore } from '../../src/domain/history';
import { threadDir } from '../../src/domain/dirs';

describe('history', () => {
  let root: string;
  let store: HistoryStore;
  const file = () => path.join(threadDir(root, 'admin', 't1'), 'history.jsonl');

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-hist-'));
    store = new HistoryStore(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('追加写 user/assistant 并按序读回', async () => {
    await store.append('admin', 't1', { role: 'user', content: '问' });
    await store.append('admin', 't1', { role: 'assistant', content: '答' });
    expect(store.readAll('admin', 't1')).toEqual([
      { role: 'user', content: '问' },
      { role: 'assistant', content: '答' },
    ]);
  });

  it('坏行跳过并告警，合法行正常返回', async () => {
    await store.append('admin', 't1', { role: 'user', content: '好行' });
    const raw = readFileSync(file(), 'utf8');
    writeFileSync(file(), raw + '这不是json\n{"role":"weird","content":1}\n');
    const warnings: string[] = [];
    store = new HistoryStore(root, { warn: (msg: string) => warnings.push(msg) });
    expect(store.readAll('admin', 't1')).toEqual([{ role: 'user', content: '好行' }]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('整体损坏：备份原文件、重建为空并告警', () => {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), '全部乱码\n\n');
    const alerts: string[] = [];
    store = new HistoryStore(root, { warn: (msg: string) => alerts.push(msg) });
    expect(store.readAll('admin', 't1')).toEqual([]);
    expect(readFileSync(file(), 'utf8')).toBe('');
    const backups = readdirSync(path.dirname(file())).filter((f) => f.startsWith('history.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('并发追加不丢行', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.append('admin', 't1', { role: 'user', content: `m${i}` })),
    );
    const all = store.readAll('admin', 't1');
    expect(all).toHaveLength(20);
    expect(new Set(all.map((m) => m.content)).size).toBe(20);
  });

  it('readRecent 取最近 N 条', async () => {
    for (let i = 0; i < 25; i++) await store.append('admin', 't1', { role: 'user', content: `m${i}` });
    const recent = store.readRecent('admin', 't1', 20);
    expect(recent).toHaveLength(20);
    expect(recent[0]!.content).toBe('m5');
  });

  it('文件不存在 → 空数组', () => {
    expect(store.readAll('admin', 'nope')).toEqual([]);
  });

  // ---- 002 特性：消息元数据与反馈 ----

  it('新格式行（元数据/附件）写入后原样读回', async () => {
    await store.append('admin', 't1', {
      id: 'm_abc_0001',
      role: 'user',
      content: '分析这个',
      ts: '2026-09-10T08:00:00.000Z',
      attachments: [{ dir: '生产计划', filename: 'a.csv' }],
    });
    await store.append('admin', 't1', {
      id: 'm_abc_0002',
      role: 'assistant',
      content: '结论',
      ts: '2026-09-10T08:00:04.000Z',
      status: 'completed',
      usage: { input_tokens: 10, output_tokens: 5 },
      duration_ms: 4200,
    });
    const all = store.readAll('admin', 't1');
    expect(all[0]).toMatchObject({ id: 'm_abc_0001', attachments: [{ dir: '生产计划', filename: 'a.csv' }] });
    expect(all[1]).toMatchObject({ status: 'completed', usage: { input_tokens: 10, output_tokens: 5 }, duration_ms: 4200 });
  });

  it('未知字段（思考/工具信息）解析时丢弃（FR-009 兜底）', async () => {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(
      file(),
      JSON.stringify({ role: 'assistant', content: '答', thinking: 'secret', tool_calls: [{ name: 'x' }] }) + '\n',
    );
    const all = store.readAll('admin', 't1');
    expect(all).toEqual([{ role: 'assistant', content: '答' }]);
    expect(JSON.stringify(all)).not.toMatch(/thinking|tool/);
  });

  it('反馈行：readAll 过滤、readFeedback 按行序合并（后者覆盖、null 取消）', async () => {
    await store.append('admin', 't1', { id: 'm1', role: 'assistant', content: '答' });
    await store.appendFeedback('admin', 't1', 'm1', 'up');
    await store.appendFeedback('admin', 't1', 'm1', 'down');
    expect(store.readFeedback('admin', 't1').get('m1')).toBe('down');
    await store.appendFeedback('admin', 't1', 'm1', null);
    expect(store.readFeedback('admin', 't1').get('m1')).toBeUndefined();
    // 反馈行不出现在消息列表中
    expect(store.readAll('admin', 't1')).toEqual([{ id: 'm1', role: 'assistant', content: '答' }]);
  });

  it('反馈行不构成坏行，也不触发整体损坏重建', async () => {
    await store.appendFeedback('admin', 't1', 'm1', 'up');
    const warnings: string[] = [];
    store = new HistoryStore(root, { warn: (msg: string) => warnings.push(msg) });
    expect(store.readAll('admin', 't1')).toEqual([]);
    expect(store.readFeedback('admin', 't1').get('m1')).toBe('up');
    expect(warnings).toHaveLength(0);
  });
});

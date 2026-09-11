/**
 * thread-store 单元测试（T028）：meta.json 读写、列表 updated_at 倒序、
 * 标题默认取首条 user 消息前 20 字、重命名、删除连带清理（thread 目录 +
 * tmp 下 thread_id 前缀文件）。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { threadDir, TMP_DIR, userDataDir } from '../../src/domain/dirs';
import { HistoryStore } from '../../src/domain/history';
import { ThreadNotFoundError, ThreadStore } from '../../src/domain/thread-store';

describe('thread-store', () => {
  let root: string;
  let history: HistoryStore;
  let store: ThreadStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-ts-'));
    history = new HistoryStore(root);
    store = new ThreadStore(root, history);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('创建后可读回 meta（title 初始 null）', () => {
    const meta = store.create('admin', 'demo');
    expect(meta.threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(meta.title).toBeNull();
    const got = store.get('admin', meta.threadId);
    expect(got.agentName).toBe('demo');
    expect(got.createdAt).toBe(meta.createdAt);
  });

  it('get 不存在 → ThreadNotFoundError', () => {
    expect(() => store.get('admin', 'nope')).toThrow(ThreadNotFoundError);
  });

  it('列表按 updated_at 倒序；touch 后顺序变化', async () => {
    const a = store.create('admin', 'demo');
    const b = store.create('admin', 'demo');
    await new Promise((r) => setTimeout(r, 5));
    store.touch('admin', a.threadId); // a 变最新
    const list = store.list('admin');
    expect(list.map((m) => m.threadId)).toEqual([a.threadId, b.threadId]);
  });

  it('列表可按 agent_name 过滤', () => {
    const a = store.create('admin', 'demo');
    store.create('admin', 'other');
    const list = store.list('admin', 'demo');
    expect(list.map((m) => m.threadId)).toEqual([a.threadId]);
  });

  it('touch 传 agentName 时更新为最近一轮使用的数字人（会话可跨数字人）', () => {
    const meta = store.create('admin', 'demo');
    expect(store.get('admin', meta.threadId).agentName).toBe('demo');

    store.touch('admin', meta.threadId, 'other');
    expect(store.get('admin', meta.threadId).agentName).toBe('other');

    // 不传 agentName 时保持原值（仅刷新 updated_at）
    store.touch('admin', meta.threadId);
    expect(store.get('admin', meta.threadId).agentName).toBe('other');
  });

  it('title 为空时默认取首条 user 消息前 20 字', async () => {
    const meta = store.create('admin', 'demo');
    const long = '这是一条非常非常长的用户消息用来验证标题截取二十个字符上限';
    await history.append('admin', meta.threadId, { role: 'user', content: long });
    await history.append('admin', meta.threadId, { role: 'assistant', content: '答' });
    const [item] = store.list('admin');
    expect(item!.title).toBe([...long].slice(0, 20).join(''));
  });

  it('无历史消息时 title 保持 null；重命名后列表显示新标题', async () => {
    const meta = store.create('admin', 'demo');
    expect(store.list('admin')[0]!.title).toBeNull();
    store.rename('admin', meta.threadId, '排产讨论');
    expect(store.get('admin', meta.threadId).title).toBe('排产讨论');
    // 重命名后不再回落默认标题
    await history.append('admin', meta.threadId, { role: 'user', content: '后续消息' });
    expect(store.list('admin')[0]!.title).toBe('排产讨论');
  });

  it('rename 不存在 → ThreadNotFoundError', () => {
    expect(() => store.rename('admin', 'nope', 'x')).toThrow(ThreadNotFoundError);
  });

  it('删除连带清理：thread 目录（history/summary/meta）+ tmp 前缀文件', async () => {
    const meta = store.create('admin', 'demo');
    await history.append('admin', meta.threadId, { role: 'user', content: '问' });
    writeFileSync(path.join(threadDir(root, 'admin', meta.threadId), 'summary.json'), '{}');
    const tmpDir = path.join(userDataDir(root, 'admin'), TMP_DIR);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, `${meta.threadId}_产出.csv`), 'a,b');
    writeFileSync(path.join(tmpDir, 'other-thread_保留.csv'), 'c,d');

    store.delete('admin', meta.threadId);

    expect(existsSync(threadDir(root, 'admin', meta.threadId))).toBe(false);
    expect(existsSync(path.join(tmpDir, `${meta.threadId}_产出.csv`))).toBe(false);
    expect(existsSync(path.join(tmpDir, 'other-thread_保留.csv'))).toBe(true);
    expect(() => store.get('admin', meta.threadId)).toThrow(ThreadNotFoundError);
  });

  it('删除不存在 → ThreadNotFoundError', () => {
    expect(() => store.delete('admin', 'nope')).toThrow(ThreadNotFoundError);
  });
});

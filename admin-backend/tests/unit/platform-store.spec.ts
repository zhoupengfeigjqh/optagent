/**
 * 单元测试：平台设计态存储（T021）
 *
 * 覆盖原则五要求的三个关键性质：**原子替换**、**revision 乐观锁**、**并发写拒绝**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let store: PlatformStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-store-'));
  store = new PlatformStore(root);
  store.ensureLayout();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('PlatformStore', () => {
  it('ensureLayout 幂等：重复调用不重置 revision', () => {
    const before = store.revision();
    store.ensureLayout();
    store.ensureLayout();
    expect(store.revision()).toBe(before);
  });

  it('写入后读出一致，且 meta.revision 递增', () => {
    const r1 = store.revision();
    const { revision } = store.withRevision(r1, () => {
      store.writeJson('agents/demo.json', { name: 'demo', soul: '你好\n世界' });
    });
    expect(revision).toBe(r1 + 1);
    expect(store.readJson<{ soul: string }>('agents/demo.json')?.soul).toBe('你好\n世界');
    expect(store.revision()).toBe(r1 + 1);
  });

  it('原子替换：写入过程中不留临时文件，目标文件始终是完整 JSON', () => {
    store.writeJson('agents/a.json', { name: 'a' });
    store.writeJson('agents/a.json', { name: 'a', soul: '第二版' });
    const files = fs.readdirSync(store.abs('agents'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
    expect(files).toEqual(['a.json']);
    expect(store.readJson<{ soul?: string }>('agents/a.json')?.soul).toBe('第二版');
  });

  it('并发写拒绝：版本不符抛 ADM_CONFIG_REVISION_CONFLICT', () => {
    const current = store.revision();
    // 第一个写者先提交，版本前移
    store.withRevision(current, () => store.writeJson('agents/a.json', { name: 'a' }));
    // 第二个写者仍持旧版本 → 必须被拒绝（而不是覆盖别人的修改）
    let caught: unknown;
    try {
      store.withRevision(current, () => store.writeJson('agents/a.json', { name: 'a2' }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT);
    expect((caught as ApiError).statusCode).toBe(409);
    // 拒绝后内容未被改写
    expect(store.readJson<{ name: string }>('agents/a.json')?.name).toBe('a');
  });

  it('变更函数抛错时不递增版本（失败不留痕）', () => {
    const before = store.revision();
    expect(() =>
      store.withRevision(before, () => {
        throw new Error('业务校验失败');
      }),
    ).toThrow('业务校验失败');
    expect(store.revision()).toBe(before);
  });

  it('读取不存在的文档返回 null（不视为错误）', () => {
    expect(store.readJson('agents/none.json')).toBeNull();
    expect(store.readText('agents/none.json')).toBeNull();
  });

  it('损坏的 JSON 文档以 ADM_STORAGE_UNAVAILABLE 报错并给出文件名', () => {
    fs.writeFileSync(store.abs('agents/broken.json'), '{ 不是 JSON', 'utf8');
    let caught: unknown;
    try {
      store.readJson('agents/broken.json');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
    expect((caught as ApiError).message).toContain('agents/broken.json');
  });

  it('拒绝越界相对路径', () => {
    expect(() => store.abs('../../etc/passwd')).toThrow(ApiError);
    expect(() => store.abs('/etc/passwd')).toThrow(ApiError);
  });

  it('JSONL 追加与读取：损坏行被跳过而不影响其余记录', () => {
    store.appendJsonl('deploy/history.jsonl', { id: 'h1' });
    fs.appendFileSync(store.abs('deploy/history.jsonl'), '{坏行\n', 'utf8');
    store.appendJsonl('deploy/history.jsonl', { id: 'h2' });
    expect(store.readJsonl<{ id: string }>('deploy/history.jsonl').map((r) => r.id)).toEqual([
      'h1',
      'h2',
    ]);
  });

  it('设计态目录不可写时以 ADM_STORAGE_UNAVAILABLE 拒绝（health 据此上报）', () => {
    const missingRoot = path.join(root, 'nested', 'deep');
    const s = new PlatformStore(missingRoot);
    expect(s.isWritable()).toBe(true);
    // 把父目录变成文件，使 mkdir 必然失败
    fs.writeFileSync(path.join(root, 'blocked'), 'x', 'utf8');
    const blocked = new PlatformStore(path.join(root, 'blocked', 'sub'));
    expect(blocked.isWritable()).toBe(false);
    expect(() => blocked.ensureLayout()).toThrow(ApiError);
  });

  it('writeText 目标不可写时以 ADM_STORAGE_UNAVAILABLE 报错（且不留临时文件）', () => {
    fs.writeFileSync(path.join(root, 'blocked'), 'x', 'utf8');
    let caught: unknown;
    try {
      store.writeText('blocked/sub/a.json', '{}');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
    expect((caught as ApiError).message).toContain('blocked');
  });

  it('appendJsonl 目标不可写时以 ADM_STORAGE_UNAVAILABLE 报错', () => {
    fs.writeFileSync(path.join(root, 'blocked2'), 'x', 'utf8');
    expect(() => store.appendJsonl('blocked2/x.jsonl', { a: 1 })).toThrow(ApiError);
  });

  it('listDir：目录存在返回条目名；不存在返回空数组（不抛错）', () => {
    store.writeJson('agents/a.json', { name: 'a' });
    expect(store.listDir('agents')).toEqual(['a.json']);
    expect(store.listDir('no-such-dir')).toEqual([]);
  });

  it('remove 幂等：不存在也不报错', () => {
    store.writeJson('agents/a.json', { name: 'a' });
    store.remove('agents/a.json');
    expect(store.exists('agents/a.json')).toBe(false);
    expect(() => store.remove('agents/a.json')).not.toThrow();
  });

  it('meta 文档缺 revision 字段时回退初始态（revision=1，不抛错）', () => {
    store.writeJson('meta.json', { schema_version: 'x' });
    expect(store.revision()).toBe(1);
  });

  it('meta.json 完全损坏时**显式报错**（MUST NOT 静默当作全新设计态：那会绕过乐观锁）', () => {
    fs.writeFileSync(store.abs('meta.json'), '{坏', 'utf8');
    let caught: unknown;
    try {
      store.revision();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
  });

  it('bumpRevision 保留既有 created_at 与 schema_version', () => {
    const before = store.meta();
    store.bumpRevision();
    const after = store.meta();
    expect(after.created_at).toBe(before.created_at);
    expect(after.schema_version).toBe(before.schema_version);
    expect(after.revision).toBe(before.revision + 1);
  });

  it('abs：接受含正斜杠的相对路径并归一为绝对路径', () => {
    expect(store.abs('agents/a.json')).toBe(path.join(root, 'agents', 'a.json'));
    expect(store.abs('deploy/history.jsonl')).toContain('deploy');
  });

  it('readJsonl：文件不存在返回空数组', () => {
    expect(store.readJsonl('deploy/missing.jsonl')).toEqual([]);
  });
});

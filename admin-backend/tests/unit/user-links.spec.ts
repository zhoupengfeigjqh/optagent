/**
 * 单元测试：用户与关联数字人（`FR-023`~`FR-025`）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { UserLinkService } from '../../src/domain/config-center/user-links.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let store: PlatformStore;
let users: UserLinkService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'user-links-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  users = new UserLinkService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('UserLinkService', () => {
  it('初始为空', () => {
    expect(users.listAll()).toEqual([]);
    expect(users.exists('admin')).toBe(false);
    expect(users.readOrNull('admin')).toBeNull();
  });

  it('create：写入并可读回，revision 递增', () => {
    const view = users.create('ops', ['demo'], store.revision());
    expect(view).toMatchObject({ user_id: 'ops', agents: ['demo'] });
    expect(users.read('ops').agents).toEqual(['demo']);
  });

  it('create：重复标识 → ADM_USER_ID_TAKEN', () => {
    users.create('ops', [], store.revision());
    let caught: unknown;
    try {
      users.create('ops', []);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_USER_ID_TAKEN);
  });

  it('非法标识（含分隔符 / .. / 控制字符 / 空）→ ADM_USER_ID_TAKEN', () => {
    for (const bad of ['a/b', 'a\\b', '..', '', 'x'.repeat(65), 'a\u0000b']) {
      let caught: unknown;
      try {
        users.create(bad, []);
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_USER_ID_TAKEN);
    }
  });

  it('create 无 revision 时不做乐观锁校验（新建无并发语义）', () => {
    expect(() => users.create('ops', [])).not.toThrow();
  });

  it('update：覆盖关联清单', () => {
    users.create('ops', ['a'], store.revision());
    const updated = users.update('ops', ['b', 'c'], store.revision());
    expect(updated.agents).toEqual(['b', 'c']);
    expect(users.read('ops').agents).toEqual(['b', 'c']);
  });

  it('update：不存在 → ADM_USER_NOT_FOUND', () => {
    let caught: unknown;
    try {
      users.update('ghost', [], store.revision());
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_USER_NOT_FOUND);
  });

  it('agents 含重复项或空值 → VALIDATION_FAILED', () => {
    expect(() => users.create('ops', ['a', 'a'])).toThrow(ApiError);
    expect(() => users.create('ops', [''])).toThrow(ApiError);
    expect(() => users.create('ops', 'a')).toThrow(ApiError);
  });

  it('agents 缺省视为空数组', () => {
    expect(users.create('ops').agents).toEqual([]);
  });

  it('usersOfAgent：反查关联了某数字人的用户（FR-021）', () => {
    users.create('a', ['demo', 'demo2'], store.revision());
    users.create('b', ['demo'], store.revision());
    users.create('c', [], store.revision());

    expect(users.usersOfAgent('demo').sort()).toEqual(['a', 'b']);
    expect(users.usersOfAgent('demo2')).toEqual(['a']);
    expect(users.usersOfAgent('nobody')).toEqual([]);
  });

  it('list：按名称排序并固定每页 8 项', () => {
    for (let i = 0; i < 10; i += 1) users.create(`u${i}`, [], store.revision());
    const page1 = users.list(1, (user) => user.user_id);
    expect(page1.total).toBe(10);
    expect(page1.items).toHaveLength(8);
    expect(page1.page_size).toBe(8);
    expect(users.list(2, (user) => user.user_id).items).toHaveLength(2);
  });

  it('remove：删除平台侧记录；不存在 → ADM_USER_NOT_FOUND', () => {
    users.create('ops', [], store.revision());
    users.remove('ops');
    expect(users.exists('ops')).toBe(false);

    let caught: unknown;
    try {
      users.remove('ops');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_USER_NOT_FOUND);
  });

  it('损坏的文档以 ADM_STORAGE_UNAVAILABLE **显式暴露**（不静默跳过，避免"少了一个用户"被忽略）', () => {
    users.create('good', [], store.revision());
    fs.writeFileSync(path.join(root, 'users', 'bad.json'), '{坏', 'utf8');

    let caught: unknown;
    try {
      users.listAll();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
  });
});

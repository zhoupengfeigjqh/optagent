/**
 * 搬运映射（029 T019/T020）：列口径、空值归一、会话时间转换、源目录布局。
 *
 * 列口径唯一来源是 `data-model.md` §必迁列清单；这里只断言"文件键与表列同名同义"，
 * 差异信息必须能定位到列名（否则对账失败时无从下手）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_USERS_DIR, USERS_DIR } from '../../src/domain/account/paths.js';
import {
  canonicalJson,
  COLUMNS,
  diffColumns,
  isoToLocalDatetime,
  linkRow,
  normalize,
  normalizeJsonRow,
  resolveSourceDir,
  serviceRow,
  sessionRow,
  userRow,
} from '../../scripts/lib/migrate-mapping.js';

const STAMP = '2026-11-28 09:00:00.000';

const store: string[] = [];
function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-'));
  store.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of store.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('搬运映射：列名与文件键同名同义', () => {
  it('账号 7 列且键名与文件字段一致（不得出现 password_record 之类的改名）', () => {
    const doc = {
      user_id: 'admin',
      phone: '13800000000',
      display_name: '管理员',
      role: 'admin' as const,
      password: { algo: 'scrypt', params: {}, salt: 's', hash: 'h' },
      agents: ['BOM数字人'],
      source_agent_code: 'DH-BOM001',
    };
    const row = userRow(doc);
    expect(Object.keys(row).sort()).toEqual([...COLUMNS.users].sort());
    for (const key of Object.keys(doc)) expect(row).toHaveProperty(key);
    expect(row.password).not.toBeNull();
  });

  it('账号缺省值：phone/password/source_agent_code = null，display_name = 空串，role = user', () => {
    const row = userRow({ user_id: 'u_1', agents: [] });
    expect(row).toMatchObject({
      phone: null,
      display_name: '',
      role: 'user',
      password: null,
      source_agent_code: null,
      agents: [],
    });
  });

  it('服务 6 列与链接 7 列、会话 3 列', () => {
    expect(Object.keys(serviceRow({
      code: 'DH-A1', name: 'n', platform_agent_name: 'p', status: 'enabled', created_at: STAMP, updated_at: STAMP,
    })).sort()).toEqual([...COLUMNS.services].sort());

    expect(Object.keys(linkRow({
      token: 't', agent_code: 'DH-A1', created_by: null, expires_at: null, revoked_at: null,
      use_count: 0, created_at: STAMP,
    })).sort()).toEqual([...COLUMNS.links].sort());

    expect(Object.keys(sessionRow({
      user_id: 'admin', session_id: 's1', issued_at: '2026-11-27T12:53:55.461Z',
    })).sort()).toEqual([...COLUMNS.sessions].sort());
  });

  it('链接缺省值归一为 NULL，使用次数为数字', () => {
    const row = linkRow({
      token: 't', agent_code: 'DH-A1', created_by: null, expires_at: null, revoked_at: null,
      use_count: 3, created_at: STAMP,
    });
    expect(row).toMatchObject({ created_by: null, expires_at: null, revoked_at: null, use_count: 3 });
  });
});

describe('会话 issued_at：ISO(UTC) → 本地时间字符串（唯一转换点）', () => {
  it('保留毫秒与本地时区，跨零点不偏移', () => {
    const local = new Date(2026, 10, 28, 0, 30, 5, 7);
    expect(isoToLocalDatetime(local.toISOString())).toBe('2026-11-28 00:30:05.007');
  });

  it('午后时间同样保持本地口径', () => {
    const local = new Date(2026, 10, 27, 23, 59, 59, 999);
    expect(isoToLocalDatetime(local.toISOString())).toBe('2026-11-27 23:59:59.999');
  });

  it('非法输入直接报错（不写入可疑时间）', () => {
    expect(() => isoToLocalDatetime('not-a-date')).toThrow(/无法解析/);
  });
});

describe('对账口径', () => {
  it('JSON 对象键序不影响比较（MySQL 会重排键）', () => {
    const a = { algo: 'scrypt', salt: 's', hash: 'h' };
    const b = { hash: 'h', salt: 's', algo: 'scrypt' };
    expect(normalize(a)).toBe(normalize(b));
    expect(canonicalJson([a])).toBe(canonicalJson([b]));
  });

  it('缺行与列差异都能定位到行与列名', () => {
    expect(diffColumns('users[admin]', { user_id: 'admin' }, undefined)[0]).toContain('缺少该行');
    const problems = diffColumns(
      'users[admin]',
      { user_id: 'admin', role: 'admin' },
      { user_id: 'admin', role: 'user' },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('users[admin].role');
  });

  it('库内 JSON 列以字符串返回时先解析再比较', () => {
    const row = normalizeJsonRow({ user_id: 'u', agents: '["a","b"]', password: '{"hash":"h","algo":"scrypt"}' });
    expect(row.agents).toEqual(['a', 'b']);
    expect(row.password).toEqual({ hash: 'h', algo: 'scrypt' });
    expect(
      diffColumns('users[u]', { agents: ['a', 'b'], password: { algo: 'scrypt', hash: 'h' } }, row),
    ).toEqual([]);
  });
});

describe('源目录布局（T020）', () => {
  it('新结构有数据时读新目录', () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, ...USERS_DIR.split('/')), { recursive: true });
    fs.writeFileSync(path.join(root, ...USERS_DIR.split('/'), 'a.json'), '{}');
    fs.mkdirSync(path.join(root, LEGACY_USERS_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, LEGACY_USERS_DIR, 'b.json'), '{}');
    expect(resolveSourceDir(root, USERS_DIR, LEGACY_USERS_DIR)).toBe(path.join(root, ...USERS_DIR.split('/')));
  });

  it('新目录为空而旧目录有数据 → 读旧目录并告警（不静默迁 0 条）', () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, ...USERS_DIR.split('/')), { recursive: true });
    fs.mkdirSync(path.join(root, LEGACY_USERS_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, LEGACY_USERS_DIR, 'b.json'), '{}');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveSourceDir(root, USERS_DIR, LEGACY_USERS_DIR)).toBe(path.join(root, LEGACY_USERS_DIR));
    expect(warn).toHaveBeenCalled();
  });

  it('两边都没有数据时返回新目录（不告警）', () => {
    const root = tempRoot();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveSourceDir(root, USERS_DIR, LEGACY_USERS_DIR)).toBe(path.join(root, ...USERS_DIR.split('/')));
    expect(warn).not.toHaveBeenCalled();
  });
});

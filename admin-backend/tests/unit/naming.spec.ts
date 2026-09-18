/**
 * 单元测试：名称与路径安全判据（`FR-015`、`FR-020`）
 *
 * 这两条判据被数字人名、用户标识、场景名、目录名与字段名**共用**，
 * 分叉即意味着"某一处能存进去、另一处存不进去"，因此在此单独守住。
 */
import { describe, expect, it } from 'vitest';
import { isSafeDirName, isSafeName } from '../../src/domain/config-center/naming.js';

describe('isSafeName', () => {
  it('接受常规名称（含中文与空格）', () => {
    expect(isSafeName('demo')).toBe(true);
    expect(isSafeName('生产计划助手')).toBe(true);
    expect(isSafeName('a b')).toBe(true);
  });

  it('拒绝空、超长、分隔符、..、控制字符', () => {
    expect(isSafeName('')).toBe(false);
    expect(isSafeName('x'.repeat(65))).toBe(false);
    expect(isSafeName('a/b')).toBe(false);
    expect(isSafeName('a\\b')).toBe(false);
    expect(isSafeName('..')).toBe(false);
    expect(isSafeName('a..b')).toBe(false);
    expect(isSafeName('a\u0000b')).toBe(false);
  });
});

describe('isSafeDirName', () => {
  it('目录名（与字段名）额外拒绝纯空白', () => {
    expect(isSafeDirName('  ')).toBe(false);
    expect(isSafeDirName('')).toBe(false);
    expect(isSafeDirName('正常目录')).toBe(true);
  });

  it('与 isSafeName 同一口径：分隔符 / .. / 超长一律拒绝', () => {
    for (const name of ['a/b', 'a\\b', '..', 'a..b', 'x'.repeat(65)]) {
      expect(isSafeDirName(name)).toBe(false);
    }
  });
});

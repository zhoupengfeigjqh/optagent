import { describe, expect, it } from 'vitest';
import { BUILTIN_ADMIN, getCurrentUser } from '../../src/domain/current-user';

describe('getCurrentUser', () => {
  it('本期固定返回 admin', () => {
    expect(getCurrentUser().userId).toBe('admin');
  });

  it('无认证信息时同样返回 admin（JWT 预留参数可忽略）', () => {
    expect(getCurrentUser(undefined).userId).toBe('admin');
    expect(getCurrentUser({ sub: 'whoever' }).userId).toBe('admin');
  });

  it('返回冻结的内置对象', () => {
    expect(Object.isFrozen(BUILTIN_ADMIN)).toBe(true);
    expect(getCurrentUser()).toBe(BUILTIN_ADMIN);
  });
});

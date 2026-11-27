import { describe, expect, it } from 'vitest';
import { authContext, BUILTIN_ADMIN, getCurrentUser } from '../../src/domain/current-user.js';

describe('getCurrentUser', () => {
  it('无请求上下文 → 回退 admin', () => {
    expect(getCurrentUser()).toEqual(BUILTIN_ADMIN);
  });

  it('有请求上下文 → 返回其 userId', () => {
    authContext.run({ userId: 'zpf' }, () => {
      expect(getCurrentUser()).toEqual({ userId: 'zpf' });
    });
  });
});

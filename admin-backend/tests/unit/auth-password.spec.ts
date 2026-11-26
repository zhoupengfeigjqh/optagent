import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, type PasswordRecord } from '../../src/domain/auth/password.js';

describe('password', () => {
  it('哈希可被校验通过', () => {
    const record = hashPassword('123456');
    expect(record.algo).toBe('scrypt');
    expect(verifyPassword('123456', record)).toBe(true);
  });

  it('同一明文两次哈希不同（随机盐）', () => {
    const a = hashPassword('123456');
    const b = hashPassword('123456');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it('错误密码不通过', () => {
    expect(verifyPassword('wrong', hashPassword('123456'))).toBe(false);
  });

  it('缺失或损坏记录返回 false 且不抛错', () => {
    expect(verifyPassword('x', null)).toBe(false);
    expect(verifyPassword('x', undefined)).toBe(false);
    const broken: PasswordRecord = { algo: 'scrypt', params: { N: 1, r: 1, p: 1 }, salt: '', hash: '' };
    expect(verifyPassword('x', broken)).toBe(false);
  });
});

/**
 * 密码哈希（`data-model.md` §1，`research.md` D3）。
 *
 * - 使用 Node 内置 `crypto.scryptSync`（零依赖、内存难解、无平台差异）。
 * - 记录自描述（`algo` + `params` + `salt` + `hash`），为未来换算法留迁移口。
 * - `verifyPassword` **永不抛错**：格式非法/损坏一律按 `false`（调用方据此拒绝登录）。
 *
 * 同步实现是刻意的：建用户与登录都是低频动作，一次 scrypt 约 50~100ms 可接受；
 * 同步避免把 `create()` 改成异步而波及大量存量调用点。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface PasswordRecord {
  algo: 'scrypt';
  params: { N: number; r: number; p: number };
  /** base64 随机盐 */
  salt: string;
  /** base64 摘要 */
  hash: string;
}

/** 密码明文长度约束（仅长度与空值，不强制字符集复杂度；`FR-003`）。 */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/** 明文是否满足长度约束（仅长度与空值；`FR-003` 不强制字符集复杂度）。 */
export function isPasswordLengthValid(plain: string): boolean {
  return plain.length >= PASSWORD_MIN_LENGTH && plain.length <= PASSWORD_MAX_LENGTH;
}

/** 生成密码摘要（每次随机盐；同一明文两次结果不同）。 */
export function hashPassword(plain: string): PasswordRecord {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_BYTES, { ...DEFAULT_PARAMS });
  return {
    algo: 'scrypt',
    params: { N: DEFAULT_PARAMS.N, r: DEFAULT_PARAMS.r, p: DEFAULT_PARAMS.p },
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
  };
}

/** 校验明文与记录是否匹配；记录缺失/损坏/算法不符一律 `false`。 */
export function verifyPassword(plain: string, record: PasswordRecord | null | undefined): boolean {
  try {
    if (
      !record ||
      record.algo !== 'scrypt' ||
      typeof record.salt !== 'string' ||
      typeof record.hash !== 'string'
    ) {
      return false;
    }
    const salt = Buffer.from(record.salt, 'base64');
    const expected = Buffer.from(record.hash, 'base64');
    if (salt.length === 0 || expected.length === 0) return false;
    const params = record.params ?? DEFAULT_PARAMS;
    const actual = scryptSync(plain, salt, expected.length, {
      N: params.N,
      r: params.r,
      p: params.p,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

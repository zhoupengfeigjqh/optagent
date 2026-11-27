import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface PasswordRecord {
  algo: 'scrypt';
  params: { N: number; r: number; p: number };
  salt: string;
  hash: string;
}

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function isPasswordLengthValid(plain: string): boolean {
  return plain.length >= PASSWORD_MIN_LENGTH && plain.length <= PASSWORD_MAX_LENGTH;
}

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

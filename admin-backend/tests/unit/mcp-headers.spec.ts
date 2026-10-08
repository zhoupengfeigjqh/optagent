/**
 * 单元测试：MCP 请求头（2026-10-08）
 *
 * 守住四件事：
 * 1. **保存期归一**：缺省 = 沿用存量（保存调用配置 MUST NOT 顺手清空令牌）、
 *    提供 = 全量替换（`{}` 即清空）；
 * 2. **逐项判据**：头名合法、大小写不敏感下不重复、值为单行非空字符串、
 *    头名与值两端空白一律 trim；
 * 3. **掩码不可提交**：把界面回显的 `6UuE…F3Z` / `••••` 原样写回即 400——
 *    那会把令牌静默换成掩码，现象上只是一串 401（几乎无法自查）；
 * 4. **回显只给掩码**：`maskHeaders` 的产物里 MUST NOT 出现明文。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  maskHeaderValue,
  maskHeaders,
  normalizeHeaders,
} from '../../src/domain/mcp/service-config-fields.js';

const TOKEN = '6UuE8_4nY683gZ13rNQbHDCfxgMgEF3Z';

/** 捕获抛出的错误（断言错误码与文案用） */
function caught(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

function codeOf(fn: () => unknown): string | undefined {
  const err = caught(fn);
  return err instanceof ApiError ? err.code : undefined;
}

function messageOf(fn: () => unknown): string {
  const err = caught(fn);
  return err instanceof Error ? err.message : '';
}

describe('normalizeHeaders（保存期归一）', () => {
  it('缺省（undefined / null）→ 沿用存量：保存调用配置不会顺手清空令牌', () => {
    const saved = { 'X-MCP-Token': TOKEN };
    expect(normalizeHeaders(undefined, saved)).toBe(saved);
    expect(normalizeHeaders(null, saved)).toBe(saved);
  });

  it('提供对象 → 全量替换；提供空对象 = 清空全部', () => {
    const saved = { 'X-MCP-Token': TOKEN };
    expect(normalizeHeaders({ 'X-Trace': 'abc' }, saved)).toEqual({ 'X-Trace': 'abc' });
    expect(normalizeHeaders({}, saved)).toEqual({});
  });

  it('头名与值两端空白一律 trim（粘贴带空白是最常见的"配了却 401"）', () => {
    expect(normalizeHeaders({ ' X-Token ': '  abc  ' }, {})).toEqual({ 'X-Token': 'abc' });
  });

  it('大小写不同的同一头名 → 拒绝（HTTP 头名大小写不敏感，"发哪个"不能是实现细节）', () => {
    expect(codeOf(() => normalizeHeaders({ 'X-A': 'a', 'x-a': 'b' }, {}))).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
    expect(messageOf(() => normalizeHeaders({ 'X-A': 'a', 'x-a': 'b' }, {}))).toContain('重复');
  });

  it('非对象 / 数组 / 字符串 → VALIDATION_FAILED', () => {
    for (const raw of ['x', 1, true, ['a'], 'X-Token: xxx']) {
      expect(codeOf(() => normalizeHeaders(raw, {}))).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });

  it('头名非法（含空格/冒号/中文/空）→ VALIDATION_FAILED', () => {
    for (const name of ['X Token', 'X:Token', '令牌', '']) {
      expect(codeOf(() => normalizeHeaders({ [name]: 'v' }, {}))).toBe(
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('值非字符串 / 空串 → VALIDATION_FAILED（并提示如何删除该头）', () => {
    expect(codeOf(() => normalizeHeaders({ 'X-Token': 123 }, {}))).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
    expect(codeOf(() => normalizeHeaders({ 'X-Token': '   ' }, {}))).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
    expect(messageOf(() => normalizeHeaders({ 'X-Token': '' }, {}))).toContain('不能为空');
  });

  it('掩码值不可作为请求头提交（长值掩码与短值占位符都拦）', () => {
    for (const masked of ['6UuE…F3Z', '••••', '••••••••']) {
      expect(codeOf(() => normalizeHeaders({ 'X-MCP-Token': masked }, {}))).toBe(
        ERROR_CODES.VALIDATION_FAILED,
      );
      expect(messageOf(() => normalizeHeaders({ 'X-MCP-Token': masked }, {}))).toContain('掩码');
    }
  });

  it('值含换行/控制字符 → VALIDATION_FAILED（header injection）', () => {
    for (const value of ['a\nb', 'a\rb', 'a\u0000b']) {
      expect(codeOf(() => normalizeHeaders({ 'X-Token': value }, {}))).toBe(
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });
});

describe('maskHeaderValue / maskHeaders（回显只给掩码）', () => {
  it('长值只露前 4 与后 2', () => {
    expect(maskHeaderValue(TOKEN)).toBe('6UuE…3Z');
  });

  it('短值整串掩掉（至少 4 个占位符，不泄露长度差异之外的任何字符）', () => {
    expect(maskHeaderValue('tk')).toBe('••••');
    expect(maskHeaderValue('abcdefgh')).toBe('••••••••');
    expect(maskHeaderValue('abcdefghij')).toBe('abcd…ij');
  });

  it('maskHeaders 保留头名、掩掉全部值；产物里 MUST NOT 出现明文', () => {
    const masked = maskHeaders({ 'X-MCP-Token': TOKEN, 'X-Trace': 'abcdefghij' });
    expect(Object.keys(masked)).toEqual(['X-MCP-Token', 'X-Trace']);
    expect(masked['X-MCP-Token']).toBe('6UuE…3Z');
    expect(JSON.stringify(masked)).not.toContain(TOKEN);
    expect(JSON.stringify(masked)).not.toContain('683gZ13rNQbHDCfxgMgEF3Z');
  });
});

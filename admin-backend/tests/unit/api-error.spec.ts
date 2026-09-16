/**
 * 单元测试：错误码与统一错误（原则七）
 *
 * 守住三条：
 * ① 错误码 → HTTP 状态码映射与契约 §0.4 一致；
 * ② 未知码回退 500（不出现"未知码配错状态码"）；
 * ③ 复用码与新增码零碰撞。
 */
import { describe, expect, it } from 'vitest';
import { ApiError, revisionConflict, validationFailed } from '../../src/domain/api-error.js';
import { ALL_ERROR_CODES, ERROR_CODES, ERROR_STATUS, PLATFORM_OPERATOR } from '../../src/domain/error-codes.js';

describe('错误码总表', () => {
  it('共 24 个码，且与 HTTP 状态映射一一对应（契约 §0.4）', () => {
    expect(ALL_ERROR_CODES).toHaveLength(24);
    for (const code of ALL_ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeTypeOf('number');
    }
  });

  it('码值唯一（原则七：MUST NOT 出现同码不同义）', () => {
    expect(new Set(ALL_ERROR_CODES).size).toBe(ALL_ERROR_CODES.length);
  });

  it('复用码保持既有语义的既定状态码', () => {
    expect(ERROR_STATUS[ERROR_CODES.VALIDATION_FAILED]).toBe(400);
    expect(ERROR_STATUS[ERROR_CODES.NOT_FOUND]).toBe(404);
    expect(ERROR_STATUS[ERROR_CODES.INTERNAL_ERROR]).toBe(500);
    expect(ERROR_STATUS[ERROR_CODES.SERVICE_UNAVAILABLE]).toBe(503);
  });

  it('ADM_ 前缀码与既有码零碰撞', () => {
    const reused = ['VALIDATION_FAILED', 'NOT_FOUND', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE'];
    for (const code of ALL_ERROR_CODES) {
      if (reused.includes(code)) continue;
      expect(code.startsWith('ADM_')).toBe(true);
    }
  });

  it('平台操作者标识固定为 zyw_admin（research.md D11）', () => {
    expect(PLATFORM_OPERATOR).toBe('zyw_admin');
  });
});

describe('ApiError', () => {
  it('按码自动取状态码，并携带 details', () => {
    const err = new ApiError(ERROR_CODES.ADM_DEPLOY_VALIDATION_FAILED, '校验未通过', {
      errors: [{ message: 'x' }],
    });
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('ADM_DEPLOY_VALIDATION_FAILED');
    expect(err.details).toEqual({ errors: [{ message: 'x' }] });
    expect(err).toBeInstanceOf(Error);
  });

  it('未知码回退 500（不误报为客户端错误）', () => {
    expect(new ApiError('TOTALLY_UNKNOWN_CODE', 'x').statusCode).toBe(500);
  });

  it('validationFailed 助手：400 + VALIDATION_FAILED', () => {
    const err = validationFailed('参数不合法', { field: 'name' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.details).toEqual({ field: 'name' });
  });

  it('revisionConflict 助手：409 + 可读版本对比（FR-008）', () => {
    const err = revisionConflict(3, 5);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe(ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT);
    expect(err.message).toContain('3');
    expect(err.message).toContain('5');
  });
});

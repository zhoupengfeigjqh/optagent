/**
 * 驱动错误 → 可读消息（029 FR-022 / T046）。
 *
 * 用户看到的必须是"该去改哪个配置"，不能是裸 `ER_`；错误码统一 `ADM_STORAGE_UNAVAILABLE`
 * （运维只需认一个码）。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { translateMysqlError } from '../../src/infra/mysql.js';

const OPTIONS = { database: 'optagent', user: 'optagent' } as const;

function translateWith(code: string, message = 'raw driver message'): ApiError {
  return translateMysqlError(Object.assign(new Error(message), { code }), OPTIONS);
}

describe('translateMysqlError', () => {
  it('认证失败 → 指向 MYSQL_USER / MYSQL_PASSWORD', () => {
    const err = translateWith('ER_ACCESS_DENIED_ERROR');
    expect(err.code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
    expect(err.message).toContain('MYSQL_PASSWORD');
    expect(err.message).not.toMatch(/ER_/);
  });

  it('连接被拒绝 / 超时 / 域名解析失败 → 指向服务是否运行', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
      const err = translateWith(code);
      expect(err.code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
      expect(err.message).toContain('不可达');
      expect(err.message).not.toMatch(/ER_/);
    }
  });

  it('库不存在 → 指向 db:init', () => {
    const err = translateWith('ER_BAD_DB_ERROR');
    expect(err.message).toContain('db:init');
    expect(err.message).toContain('optagent');
  });

  it('表不存在 → 指向 db:init（不是笼统的访问失败）', () => {
    const err = translateWith('ER_NO_SUCH_TABLE', "Table 'optagent.users' doesn't exist");
    expect(err.code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
    expect(err.message).toContain('表结构缺失');
    expect(err.message).toContain('db:init');
  });

  it('外键引用（被引用不可删 / 引用不存在） → 说明被引用，不暴露裸码', () => {
    for (const code of ['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2', 'ER_NO_REFERENCED_ROW']) {
      const err = translateWith(code);
      expect(err.code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
      expect(err.message).toContain('引用');
    }
  });

  it('未知错误 → 兜底仍带原始 message，便于定位', () => {
    const err = translateWith('ER_SOMETHING_NEW', 'boom detail');
    expect(err.code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
    expect(err.message).toContain('boom detail');
  });

  it('已是 ApiError 时原样返回（不二次包装）', () => {
    const original = new ApiError(ERROR_CODES.ADM_USER_ID_TAKEN, '账号已存在');
    expect(translateMysqlError(original, OPTIONS)).toBe(original);
  });
});

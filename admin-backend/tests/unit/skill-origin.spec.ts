/**
 * 单元测试：SKILL 来源标记与只读判据（2026-10-03，`FR-062`）
 *
 * 守住：市场来源只读（`ADM_SKILL_READ_ONLY` + 可读替代路径）、非市场来源放行、
 * 以及"缺省/脏值不误判为只读"（缺省 = 外部安装，可编辑）。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  assertSkillEditable,
  isReadOnlyOrigin,
  type SkillOrigin,
} from '../../src/domain/skill-library/origin.js';

const MARKET: SkillOrigin = {
  kind: 'onto_market',
  scenario: '生产调度',
  ontology: '原材料采购和库存',
  hash: 'h1',
};

describe('isReadOnlyOrigin', () => {
  it('市场来源 → true；缺省/空 → false（ZIP 安装等仍可编辑）', () => {
    expect(isReadOnlyOrigin(MARKET)).toBe(true);
    expect(isReadOnlyOrigin(undefined)).toBe(false);
    expect(isReadOnlyOrigin(null)).toBe(false);
    // 脏值（来源标记被外部改坏）：不误判为只读，避免"整库突然不可编辑"
    expect(isReadOnlyOrigin({ kind: 'other' } as unknown as SkillOrigin)).toBe(false);
  });
});

describe('assertSkillEditable', () => {
  it('市场来源 → 抛 ADM_SKILL_READ_ONLY，并给出替代路径', () => {
    let caught: unknown;
    try {
      assertSkillEditable('raw-material-inventory', MARKET);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_READ_ONLY);
    expect((caught as ApiError).statusCode).toBe(409);
    expect((caught as ApiError).message).toContain('只读');
    expect((caught as ApiError).message).toContain('更新');
  });

  it('非市场来源 → 不抛（放行在线编辑）', () => {
    expect(() => assertSkillEditable('local-skill', undefined)).not.toThrow();
    expect(() => assertSkillEditable('local-skill', null)).not.toThrow();
  });
});

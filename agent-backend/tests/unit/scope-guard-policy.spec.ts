/**
 * 单元测试：授权判定纯策略（020）。
 *
 * 覆盖 `data-model.md` §3.3 判定矩阵里与"策略"相关的行：
 * 非本体放行、`everyone`、`disable`（优先于 `everyone`）、用户名命中/未命中、
 * 空 `scope`、缺条目；以及 `FR-003` 的两形态匹配与归一化口径。
 */
import { describe, expect, it } from 'vitest';

import { decideScope, matchKeys, normalizeName } from '../../src/domain/scope-guard/policy.js';
import type { SecurityEntry } from '../../src/domain/scope-guard/types.js';

function entry(scope: string[]): SecurityEntry {
  return { actionName: 'CreatePurchaseRecord', scope, ignored: 0 };
}

describe('normalizeName', () => {
  it('去首尾空白并转小写', () => {
    expect(normalizeName('  CreatePurchaseRecord  ')).toBe('createpurchaserecord');
    expect(normalizeName('EVERYONE')).toBe('everyone');
    expect(normalizeName('   ')).toBe('');
  });
});

describe('matchKeys', () => {
  it('无服务前缀：只给完整名', () => {
    expect(matchKeys('CreatePurchaseRecord')).toEqual(['createpurchaserecord']);
    expect(matchKeys('read_file')).toEqual(['read_file']);
  });

  it('带服务前缀：完整名 + 去首个前缀名', () => {
    expect(matchKeys('mes__CreatePurchaseRecord')).toEqual([
      'mes__createpurchaserecord',
      'createpurchaserecord',
    ]);
  });

  it('工具名自身含 `__`：只剥第一段', () => {
    expect(matchKeys('a__b__c')).toEqual(['a__b__c', 'b__c']);
  });

  it('空前缀（`a__`）与空串：不产生多余候选', () => {
    expect(matchKeys('a__')).toEqual(['a__']);
    expect(matchKeys('')).toEqual([]);
    expect(matchKeys('   ')).toEqual([]);
  });

  it('首尾空白不影响匹配键', () => {
    expect(matchKeys('  mes__Query  ')).toEqual(['mes__query', 'query']);
  });
});

describe('decideScope', () => {
  it('条目缺失 → 管控不可用（fail-closed）', () => {
    expect(decideScope(undefined, 'admin')).toEqual({
      kind: 'deny',
      code: 'ONTOLOGY_SCOPE_UNAVAILABLE',
      reason: 'no_entry',
      scopeKind: 'unavailable',
      scopeSize: 0,
    });
  });

  it('含 disable → 拒绝，且优先于 everyone（对外按未授权码）', () => {
    expect(decideScope(entry(['disable']), 'admin')).toMatchObject({
      kind: 'deny',
      // 2026-11-09：对外统一「未授权」，不再单列"已停用"码；reason/scopeKind 仍区分
      code: 'ONTOLOGY_SCOPE_DENIED',
      reason: 'disabled',
      scopeKind: 'disable',
    });
    expect(decideScope(entry(['everyone', 'disable']), 'admin')).toMatchObject({
      code: 'ONTOLOGY_SCOPE_DENIED',
      reason: 'disabled',
    });
  });

  it('含 everyone → 放行（与用户名无关）', () => {
    expect(decideScope(entry(['everyone']), 'admin')).toEqual({ kind: 'allow', rule: 'everyone' });
    expect(decideScope(entry(['everyone']), '')).toEqual({ kind: 'allow', rule: 'everyone' });
  });

  it('用户名命中 → 放行', () => {
    expect(decideScope(entry(['admin', 'zpf']), 'admin')).toEqual({ kind: 'allow', rule: 'user' });
  });

  it('用户名不在 scope → 拒绝 not_in_scope', () => {
    expect(decideScope(entry(['zpf']), 'admin')).toMatchObject({
      kind: 'deny',
      code: 'ONTOLOGY_SCOPE_DENIED',
      reason: 'not_in_scope',
      scopeKind: 'users',
      scopeSize: 1,
    });
  });

  it('空 scope → 拒绝 empty_scope（不是"所有人可用"）', () => {
    expect(decideScope(entry([]), 'admin')).toMatchObject({
      kind: 'deny',
      code: 'ONTOLOGY_SCOPE_DENIED',
      reason: 'empty_scope',
      scopeSize: 0,
    });
  });

  it('未知标记按普通用户名比较（不猜语义）', () => {
    expect(decideScope(entry(['root']), 'admin')).toMatchObject({
      code: 'ONTOLOGY_SCOPE_DENIED',
    });
    expect(decideScope(entry(['root']), 'root')).toEqual({ kind: 'allow', rule: 'user' });
  });

  it('用户名为空 → 不能凭"空等于空"放行', () => {
    expect(decideScope(entry(['admin']), '')).toMatchObject({
      code: 'ONTOLOGY_SCOPE_DENIED',
    });
  });
});

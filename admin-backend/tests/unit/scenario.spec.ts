/**
 * 单元测试：文件空间场景（`FR-020`）
 *
 * 覆盖三块判据：场景名 / 目录清单 / **字段约束**（`data_prep_fields`）。
 * 字段约束同时有两个出口——保存路径严格抛错（`normalizeScenario`）、
 * 部署前校验收集全部问题（`scenarioFieldIssues`）——两者口径 MUST 一致。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  MAX_FIELDS_PER_DIR,
  normalizeScenario,
  scenarioFieldIssues,
} from '../../src/domain/config-center/scenario.js';

function expectCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ApiError);
  expect((caught as ApiError).code).toBe(code);
}

const base = { scenario: '生产', data_prep_dirs: ['生产计划', '产线电价'] };

describe('normalizeScenario —— 场景名与目录清单', () => {
  it('正向：归一化场景名并保留目录顺序', () => {
    const out = normalizeScenario({ scenario: '  生产  ', data_prep_dirs: ['产线电价', '生产计划'] });
    expect(out.scenario).toBe('生产');
    expect(out.data_prep_dirs).toEqual(['产线电价', '生产计划']);
  });

  it('异常：场景名为空 / 含分隔符', () => {
    for (const scenario of ['', '  ', 'a/b', 'a\\b', '..', 'a..b']) {
      expectCode(
        () => normalizeScenario({ scenario, data_prep_dirs: [] }),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('异常：目录清单缺字段 / 含空值 / 重复 / 含分隔符', () => {
    expectCode(() => normalizeScenario({ scenario: 'x' }), ERROR_CODES.VALIDATION_FAILED);
    for (const dirs of [['a', ''], ['a', 'a'], ['a/b'], ['a\\b'], ['..'], ['a', 'b..c']]) {
      expectCode(
        () => normalizeScenario({ scenario: 'x', data_prep_dirs: dirs }),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('边界：目录可为空数组（表示不开放任何数据准备子目录）', () => {
    expect(normalizeScenario({ scenario: 'x', data_prep_dirs: [] }).data_prep_dirs).toEqual([]);
  });
});

describe('normalizeScenario —— 字段约束（data_prep_fields）', () => {
  it('正向：按目录归置，条目顺序与类型原样保留', () => {
    const out = normalizeScenario({
      ...base,
      data_prep_fields: {
        生产计划: [
          { name: '产线编号', type: 'string', required: true },
          { name: '计划量', type: 'integer', required: false },
        ],
        产线电价: [{ name: '电价明细', type: 'object', required: true }],
      },
    });

    expect(out.data_prep_fields).toEqual({
      生产计划: [
        { name: '产线编号', type: 'string', required: true },
        { name: '计划量', type: 'integer', required: false },
      ],
      产线电价: [{ name: '电价明细', type: 'object', required: true }],
    });
  });

  it('边界：缺省 data_prep_fields 时归一化为空对象（兼容本字段引入前的输入）', () => {
    expect(normalizeScenario(base).data_prep_fields).toEqual({});
  });

  it('边界：某目录的字段清单为空 ⇒ 不写入该键（缺失即"无约束"）', () => {
    expect(normalizeScenario({ ...base, data_prep_fields: { 生产计划: [] } }).data_prep_fields).toEqual(
      {},
    );
  });

  it('异常：整体非对象 / 目录不在清单内 / 清单非数组 / 超过每目录上限', () => {
    for (const fields of [
      ['a'],
      { 不存在的目录: [{ name: 'x', type: 'string', required: true }] },
      { 生产计划: 'not-array' },
      {
        生产计划: Array.from({ length: MAX_FIELDS_PER_DIR + 1 }, (_, i) => ({
          name: `f${i}`,
          type: 'string',
          required: true,
        })),
      },
    ]) {
      expectCode(
        () => normalizeScenario({ ...base, data_prep_fields: fields }),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('异常：字段名非法 / 重复 / 类型非法 / required 非布尔', () => {
    const badFields = [
      [{ name: '', type: 'string', required: true }],
      [{ name: 'a/b', type: 'string', required: true }],
      [{ name: 'a..b', type: 'string', required: true }],
      [{ name: 'x'.repeat(65), type: 'string', required: true }],
      [
        { name: '同名字段', type: 'string', required: true },
        { name: '同名字段', type: 'integer', required: false },
      ],
      [{ name: '产线编号', type: 'text', required: true }],
      [{ name: '产线编号', type: 'string' }],
      [{ name: '产线编号', type: 'string', required: 'yes' }],
    ];
    for (const list of badFields) {
      expectCode(
        () => normalizeScenario({ ...base, data_prep_fields: { 生产计划: list } }),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });
});

describe('scenarioFieldIssues —— 部署前校验出口（收集全部问题，不抛错）', () => {
  it('正向：合法约束与缺省（历史文档）均无问题', () => {
    expect(scenarioFieldIssues(base)).toEqual([]);
    expect(
      scenarioFieldIssues({
        ...base,
        data_prep_fields: { 生产计划: [{ name: '产线编号', type: 'string', required: true }] },
      }),
    ).toEqual([]);
  });

  it('异常：一次性列出全部问题（类型非法 + 目录不在清单内 + 字段名重复）', () => {
    const issues = scenarioFieldIssues({
      scenario: '生产',
      data_prep_dirs: ['生产计划'],
      data_prep_fields: {
        生产计划: [
          { name: '产线编号', type: 'text' as never, required: true },
          { name: '产线编号', type: 'string', required: true },
          { name: '缺必填标志', type: 'string', required: undefined as never },
        ],
        不在清单: [{ name: 'x', type: 'string', required: true }],
      },
    });

    expect(issues.length).toBeGreaterThanOrEqual(4);
    expect(issues.join('；')).toContain('取值类型非法');
    expect(issues.join('；')).toContain('目录清单外');
    expect(issues.join('；')).toContain('字段名重复');
    expect(issues.join('；')).toContain('required 须为布尔值');
  });

  it('异常：某目录的字段清单不是数组 → 单独一条问题（不误判为目录越界）', () => {
    expect(
      scenarioFieldIssues({
        scenario: '生产',
        data_prep_dirs: ['生产计划'],
        data_prep_fields: { 生产计划: 'oops' as never },
      }),
    ).toEqual(['目录 生产计划 的字段清单须为数组']);
  });

  it('边界：data_prep_fields 非对象 / 场景缺失时给出可读结论且不抛错', () => {
    expect(scenarioFieldIssues({ scenario: 'x', data_prep_dirs: ['a'], data_prep_fields: [] as never })).toEqual([
      '字段约束（data_prep_fields）须为对象',
    ]);
    expect(scenarioFieldIssues(null)).toEqual([]);
  });
});

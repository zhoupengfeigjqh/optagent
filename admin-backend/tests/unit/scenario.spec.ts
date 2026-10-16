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
  scenarioUploadIssues,
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

const base = { scenario: '生产', data_prep_dirs: ['生产计划', '产线电价', '算法规则'] };

describe('normalizeScenario —— 场景名与目录清单', () => {
  it('正向：归一化场景名并保留目录顺序', () => {
    const out = normalizeScenario({
      scenario: '  生产  ',
      data_prep_dirs: ['产线电价', '生产计划', '算法规则'],
    });
    expect(out.scenario).toBe('生产');
    expect(out.data_prep_dirs).toEqual(['产线电价', '生产计划', '算法规则']);
  });

  it('异常：场景名为空 / 含分隔符', () => {
    for (const scenario of ['', '  ', 'a/b', 'a\\b', '..', 'a..b']) {
      expectCode(
        () => normalizeScenario({ scenario, data_prep_dirs: ['算法规则'] }),
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

  it('异常：缺少预定义二级目录（清单必须完整包含预定义目录）', () => {
    expectCode(() => normalizeScenario({ scenario: 'x', data_prep_dirs: [] }), ERROR_CODES.VALIDATION_FAILED);
    expectCode(
      () => normalizeScenario({ scenario: 'x', data_prep_dirs: ['生产计划'] }),
      ERROR_CODES.VALIDATION_FAILED,
    );
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
    expect(normalizeScenario({ ...base, data_prep_fields: { 生产计划: [] } }).data_prep_fields).toEqual({});
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
      data_prep_dirs: ['生产计划', '算法规则'],
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
        data_prep_dirs: ['生产计划', '算法规则'],
        data_prep_fields: { 生产计划: 'oops' as never },
      }),
    ).toEqual(['目录 生产计划 的字段清单须为数组']);
  });

  it('边界：data_prep_fields 非对象 / 场景缺失时给出可读结论且不抛错', () => {
    expect(
      scenarioFieldIssues({
        scenario: 'x',
        data_prep_dirs: ['a', '算法规则'],
        data_prep_fields: [] as never,
      }),
    ).toEqual(['字段约束（data_prep_fields）须为对象']);
    expect(scenarioFieldIssues(null)).toEqual([]);
  });

  it('异常：缺少预定义二级目录时列出缺失项（手工改过的文档兜底）', () => {
    expect(scenarioFieldIssues({ scenario: 'x', data_prep_dirs: ['生产计划'] })).toEqual([
      '缺少预定义二级目录：算法规则',
    ]);
    // 预定义目录本身不强制字段约束：存在即无问题
    expect(scenarioFieldIssues({ scenario: 'x', data_prep_dirs: ['算法规则'] })).toEqual([]);
  });
});

/* ---------- 2026-10-13：目录级可上传类型（data_prep_uploads，8 条归一规则） ---------- */

describe('normalizeScenario —— 可上传类型（data_prep_uploads）', () => {
  it('正向：去重 + 大小写归一 + 按候选枚举顺序重排', () => {
    const out = normalizeScenario({
      ...base,
      data_prep_uploads: {
        生产计划: ['.TXT', '.csv', '.csv', '.xls', '.XLS', '.xlsx'],
        产线电价: ['.JSON'],
      },
    });
    expect(out.data_prep_uploads).toEqual({
      // `.xls`（2026-10-14 新增候选）在 `.xlsx` 之后，且随枚举序重排、去重
      生产计划: ['.xlsx', '.xls', '.csv', '.txt'],
      产线电价: ['.json'],
    });
  });

  it('边界：缺省 / null ⇒ 归一为空对象（不写键，等价"用平台默认"）', () => {
    expect(normalizeScenario(base).data_prep_uploads).toEqual({});
    expect(normalizeScenario({ ...base, data_prep_uploads: null }).data_prep_uploads).toEqual({});
  });

  it('异常：空数组被拒（"至少一项"；"不配置"才是表达默认的方式）', () => {
    expectCode(
      () => normalizeScenario({ ...base, data_prep_uploads: { 生产计划: [] } }),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('异常：整体非对象（数组 / 字符串）', () => {
    for (const bad of [[], 'oops', 3]) {
      expectCode(() => normalizeScenario({ ...base, data_prep_uploads: bad }), ERROR_CODES.VALIDATION_FAILED);
    }
  });

  it('异常：孤儿键（引用了目录清单外的目录）', () => {
    expectCode(
      () => normalizeScenario({ ...base, data_prep_uploads: { 不存在的目录: ['.csv'] } }),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('异常：值非数组 / 含非字符串 / 空串 / 不在候选枚举内', () => {
    const badList = [
      { 生产计划: 'not-array' } as never,
      { 生产计划: [1] } as never,
      { 生产计划: ['  '] } as never,
      { 生产计划: ['.doc'] } as never,
      { 生产计划: ['csv'] } as never,
    ];
    for (const uploads of badList) {
      expectCode(
        () => normalizeScenario({ ...base, data_prep_uploads: uploads }),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });
});

describe('scenarioUploadIssues —— 部署前校验出口（收集全部问题，不抛错）', () => {
  it('正向：合法配置与缺省（历史文档）均无问题', () => {
    expect(scenarioUploadIssues(base)).toEqual([]);
    expect(scenarioUploadIssues({ ...base, data_prep_uploads: { 生产计划: ['.csv', '.xlsx'] } })).toEqual([]);
  });

  it('异常：一次性列出全部问题（孤儿键 + 非法项 + 空数组）', () => {
    const issues = scenarioUploadIssues({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '算法规则'],
      data_prep_uploads: {
        生产计划: ['.doc', 1 as never],
        算法规则: [],
        不在清单: ['.csv'],
      },
    });
    const joined = issues.join('；');
    expect(joined).toContain('目录清单外');
    expect(joined).toContain('至少选择一项');
    expect(joined).toContain('可上传类型非法');
    expect(joined).toContain('含非法项');
  });

  it('边界：非对象一条结论；缺省 / null 无问题', () => {
    expect(scenarioUploadIssues({ ...base, data_prep_uploads: [] as never })).toEqual([
      '可上传文件类型（data_prep_uploads）须为对象',
    ]);
    expect(scenarioUploadIssues(null)).toEqual([]);
  });
});

/**
 * 单元测试：结构化 SOUL 的校验与渲染（004）。
 *
 * 覆盖三类：
 * - **校验**：必填、字数 / 条数上限、工具引用合法性（拒绝式，不做隐式剔除）；
 * - **渲染**：frontmatter 只装展示数据、正文只装提示词、空字段不写空壳；
 * - **兼容**：存量自由文本 → `{ mission: 原文 }`，渲染出的正文与原文逐字一致。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import {
  SOUL_LIMITS,
  describeSoul,
  emptySoulDesign,
  fromLegacySoul,
  normalizeSoulDesign,
  renderSoulMd,
} from '../../src/domain/config-center/soul-design.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';

const OPTIONS = {
  enabledTools: ['read_file', 'grep_files'],
  mcpTools: new Map<string, ReadonlySet<string>>([
    ['erp', new Set(['query_order'])],
    ['ocr', new Set(['ocr_extract'])],
  ]),
};

function validRaw(): Record<string, unknown> {
  return {
    intro: '订单交付助理',
    welcome: '你好，我是交付助理',
    starters: [
      {
        prompt: '帮我梳理昨天订单的交付风险',
        tools: [
          { kind: 'builtin', name: 'read_file' },
          { kind: 'mcp', service: 'erp', name: 'query_order' },
        ],
      },
      { prompt: '这个月哪些订单可能延期？', tools: [] },
    ],
    mission: '你是交付助理。',
    capability_tags: ['订单排程'],
    forbidden: ['不得编造订单号'],
    prompt_extra: '回答先给结论。',
  };
}

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

describe('normalizeSoulDesign', () => {
  it('正向：完整结构通过，字段按 trim 归一化', () => {
    const soul = normalizeSoulDesign({ ...validRaw(), intro: '  订单交付助理  ' }, OPTIONS);
    expect(soul.intro).toBe('订单交付助理');
    expect(soul.starters).toHaveLength(2);
    expect(soul.starters[0]?.tools).toEqual([
      { kind: 'builtin', name: 'read_file' },
      { kind: 'mcp', service: 'erp', name: 'query_order' },
    ]);
    expect(soul.capability_tags).toEqual(['订单排程']);
  });

  it('异常：非对象 / 必填缺失 → VALIDATION_FAILED', () => {
    expectCode(() => normalizeSoulDesign('你是助手', OPTIONS), ERROR_CODES.VALIDATION_FAILED);
    expectCode(
      () => normalizeSoulDesign({ ...validRaw(), mission: '   ' }, OPTIONS),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () => normalizeSoulDesign({ ...validRaw(), intro: '' }, OPTIONS),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () => normalizeSoulDesign({ ...validRaw(), welcome: '' }, OPTIONS),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('异常：字数与条数上限 → VALIDATION_FAILED', () => {
    expectCode(
      () => normalizeSoulDesign({ ...validRaw(), intro: 'x'.repeat(SOUL_LIMITS.intro + 1) }, OPTIONS),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () =>
        normalizeSoulDesign(
          {
            ...validRaw(),
            starters: Array.from({ length: SOUL_LIMITS.starters + 1 }, (_, i) => ({
              prompt: `问题 ${i}`,
              tools: [],
            })),
          },
          OPTIONS,
        ),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () =>
        normalizeSoulDesign(
          {
            ...validRaw(),
            starters: [{ prompt: '', tools: [] }],
          },
          OPTIONS,
        ),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () => normalizeSoulDesign({ ...validRaw(), forbidden: ['a', 'a'] }, OPTIONS),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('异常：工具引用越界 → ADM_AGENT_INVALID_REF（拒绝式，不静默剔除）', () => {
    // 内置工具未启用
    expectCode(
      () =>
        normalizeSoulDesign(
          {
            ...validRaw(),
            starters: [{ prompt: '问题', tools: [{ kind: 'builtin', name: 'write_file' }] }],
          },
          OPTIONS,
        ),
      ERROR_CODES.ADM_AGENT_INVALID_REF,
    );
    // MCP 服务未挂载
    expectCode(
      () =>
        normalizeSoulDesign(
          {
            ...validRaw(),
            starters: [{ prompt: '问题', tools: [{ kind: 'mcp', service: 'ghost', name: 'x' }] }],
          },
          OPTIONS,
        ),
      ERROR_CODES.ADM_AGENT_INVALID_REF,
    );
    // 工具不在该服务的可见白名单内
    expectCode(
      () =>
        normalizeSoulDesign(
          {
            ...validRaw(),
            starters: [{ prompt: '问题', tools: [{ kind: 'mcp', service: 'erp', name: 'delete_all' }] }],
          },
          OPTIONS,
        ),
      ERROR_CODES.ADM_AGENT_INVALID_REF,
    );
  });

  it('异常：问题实例重复 / 同一实例重复关联同一工具 → VALIDATION_FAILED', () => {
    expectCode(
      () =>
        normalizeSoulDesign(
          {
            ...validRaw(),
            starters: [
              { prompt: '同一个问题', tools: [] },
              { prompt: '同一个问题', tools: [] },
            ],
          },
          OPTIONS,
        ),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () =>
        normalizeSoulDesign(
          {
            ...validRaw(),
            starters: [
              {
                prompt: '问题',
                tools: [
                  { kind: 'builtin', name: 'read_file' },
                  { kind: 'builtin', name: 'read_file' },
                ],
              },
            ],
          },
          OPTIONS,
        ),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });
});

describe('renderSoulMd', () => {
  it('frontmatter 只装展示数据，正文只装提示词', () => {
    const soul = normalizeSoulDesign(validRaw(), OPTIONS);
    const md = renderSoulMd(soul);

    // frontmatter：展示/引导
    expect(md.startsWith('---\nsoul_version: 1')).toBe(true);
    expect(md).toContain('intro: 订单交付助理');
    expect(md).toContain('welcome: 你好，我是交付助理');
    expect(md).toContain('- prompt: 帮我梳理昨天订单的交付风险');

    // 正文：提示词
    expect(md).toContain('## 主要使命\n\n你是交付助理。');
    expect(md).toContain('## 能力标签\n- 订单排程');
    expect(md).toContain('## 绝对禁止\n- 不得编造订单号');
    expect(md).toContain('## 补充说明\n\n回答先给结论。');
  });

  it('空的可选字段不渲染空壳小节', () => {
    const soul = normalizeSoulDesign(
      { intro: 'a', welcome: 'b', mission: 'm' },
      OPTIONS,
    );
    const md = renderSoulMd(soul);
    expect(md).not.toContain('## 能力标签');
    expect(md).not.toContain('## 绝对禁止');
    expect(md).not.toContain('## 补充说明');
    expect(md).not.toContain('starters:');
    // 只有 frontmatter + 主要使命
    expect(md.endsWith('## 主要使命\n\nm\n')).toBe(true);
  });
});

describe('fromLegacySoul / describeSoul', () => {
  it('存量自由文本整体作为主要使命，渲染后正文与原文一致（System Prompt 不变）', () => {
    const legacy = '# 生产计划助手\n\n你是助手。';
    const soul = fromLegacySoul(legacy);
    expect(soul.mission).toBe(legacy);
    const md = renderSoulMd(soul);
    // frontmatter 为空壳（旧文档没有展示数据），正文即原文
    expect(md).toContain(`## 主要使命\n\n${legacy}`);
  });

  it('空结构工厂每次返回新对象（避免共享引用被改）', () => {
    const a = emptySoulDesign();
    const b = emptySoulDesign();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.starters.push({ prompt: 'x', tools: [] });
    expect(b.starters).toEqual([]);
  });

  it('describeSoul：优先角色简介，缺省回退主要使命首行', () => {
    expect(describeSoul(fromLegacySoul('你是助手'))).toBe('你是助手');
    expect(describeSoul(normalizeSoulDesign({ ...validRaw(), intro: '简介优先' }, OPTIONS))).toBe(
      '简介优先',
    );
  });
});

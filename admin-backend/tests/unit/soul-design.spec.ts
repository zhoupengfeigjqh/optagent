/**
 * 单元测试：结构化 SOUL 的校验与渲染（004 / 007）。
 *
 * 覆盖四类：
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
  isSoulDesign,
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
    // 问题实例单条内容封顶（004 修订：150 字）：151 拒绝、150 通过
    expectCode(
      () =>
        normalizeSoulDesign(
          {
            ...validRaw(),
            starters: [{ prompt: 'x'.repeat(SOUL_LIMITS.starterPrompt + 1), tools: [] }],
          },
          OPTIONS,
        ),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expect(() =>
      normalizeSoulDesign(
        { ...validRaw(), starters: [{ prompt: 'x'.repeat(SOUL_LIMITS.starterPrompt), tools: [] }] },
        OPTIONS,
      ),
    ).not.toThrow();
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

describe('next_action_hints —— 下一步动作提示开关（007）', () => {
  it('缺省口径：键缺失 → false（老表单 / 存量文档照常保存）', () => {
    expect(normalizeSoulDesign(validRaw(), OPTIONS).next_action_hints).toBe(false);
    expect(
      normalizeSoulDesign({ ...validRaw(), next_action_hints: undefined }, OPTIONS).next_action_hints,
    ).toBe(false);
  });

  it('true / false 原样通过（拒绝式，不做隐式转换）', () => {
    expect(normalizeSoulDesign({ ...validRaw(), next_action_hints: true }, OPTIONS).next_action_hints).toBe(
      true,
    );
    expect(normalizeSoulDesign({ ...validRaw(), next_action_hints: false }, OPTIONS).next_action_hints).toBe(
      false,
    );
  });

  it('非布尔（字符串 / 数字 / null）→ VALIDATION_FAILED', () => {
    for (const value of ['true', 'false', 1, 0, null, {}]) {
      expectCode(
        () => normalizeSoulDesign({ ...validRaw(), next_action_hints: value }, OPTIONS),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('渲染：仅 `true` 时写 frontmatter 键；`false` / 缺省不写键（不残留未搭配的配置）', () => {
    const on = renderSoulMd(normalizeSoulDesign({ ...validRaw(), next_action_hints: true }, OPTIONS));
    expect(on).toContain('next_action_hints: true');

    const off = renderSoulMd(normalizeSoulDesign({ ...validRaw(), next_action_hints: false }, OPTIONS));
    expect(off).not.toContain('next_action_hints');

    const missing = renderSoulMd(normalizeSoulDesign(validRaw(), OPTIONS));
    expect(missing).not.toContain('next_action_hints');
    // 关闭态与缺省态产物**逐字一致**（同一份文档，不再有第三种形态）
    expect(off).toBe(missing);
  });

  it('开 / 关两态产物只差 frontmatter 那两行（开关 + 条数），正文逐字一致（System Prompt 恒等）', () => {
    const on = renderSoulMd(normalizeSoulDesign({ ...validRaw(), next_action_hints: true }, OPTIONS));
    const off = renderSoulMd(normalizeSoulDesign({ ...validRaw(), next_action_hints: false }, OPTIONS));

    const body = (md: string) => md.slice(md.indexOf('---', 3) + 3);
    expect(body(on)).toBe(body(off));
    // 差异**恰好是两行**（开关 + 条数）：把这两行删掉，开启态与关闭态逐字相同
    const strip = (md: string) =>
      md
        .split('\n')
        .filter((line) => !line.startsWith('next_action_hints'))
        .join('\n');
    expect(strip(on)).toBe(strip(off));
    expect(on.split('\n').length - off.split('\n').length).toBe(2);
  });

  it('存量兼容：旧自由文本升级路径落 false', () => {
    const legacy = fromLegacySoul('# 生产计划助手\n\n你是助手。');
    expect(legacy.next_action_hints).toBe(false);
    expect(renderSoulMd(legacy)).not.toContain('next_action_hints');
  });

  it('isSoulDesign：新字段在 / 不在都不影响"已结构化"判定（存量文档不被误判为旧文本）', () => {
    expect(isSoulDesign({ mission: '你是助手' })).toBe(true);
    expect(isSoulDesign({ mission: '你是助手', next_action_hints: true })).toBe(true);
    expect(isSoulDesign({ mission: '你是助手', next_action_hints: false })).toBe(true);
    // 仍按原判据拒绝非结构化形态
    expect(isSoulDesign({ intro: 'x' })).toBe(false);
    expect(isSoulDesign('你是助手')).toBe(false);
  });

  it('emptySoulDesign 带 `false`（新建默认关闭；与前端初值同形，脏检查才不会误报）', () => {
    expect(emptySoulDesign().next_action_hints).toBe(false);
  });

  it('条数：缺省 3；开启时写进 frontmatter，关闭 / 缺省一律不写', () => {
    expect(emptySoulDesign().next_action_hints_count).toBe(SOUL_LIMITS.nextActionHintsDefault);
    expect(normalizeSoulDesign(validRaw(), OPTIONS).next_action_hints_count).toBe(
      SOUL_LIMITS.nextActionHintsDefault,
    );

    const on = renderSoulMd(
      normalizeSoulDesign({ ...validRaw(), next_action_hints: true, next_action_hints_count: 5 }, OPTIONS),
    );
    expect(on).toContain('next_action_hints: true');
    expect(on).toContain('next_action_hints_count: 5');

    // 关闭态连"条数"都不出现（未搭配的内容不残留）
    const off = renderSoulMd(
      normalizeSoulDesign({ ...validRaw(), next_action_hints: false, next_action_hints_count: 5 }, OPTIONS),
    );
    expect(off).not.toContain('next_action_hints_count');
    expect(off).toBe(renderSoulMd(normalizeSoulDesign(validRaw(), OPTIONS)));

    // 开启但未给条数 → 落缺省值，产物仍是显式的
    const onDefault = renderSoulMd(normalizeSoulDesign({ ...validRaw(), next_action_hints: true }, OPTIONS));
    expect(onDefault).toContain(`next_action_hints_count: ${SOUL_LIMITS.nextActionHintsDefault}`);
  });

  it('条数取值口径：1~6 的整数通过；0 / 7 / 负数 / 小数 / 字符串 / null → 拒绝', () => {
    for (const value of [SOUL_LIMITS.nextActionHintsMin, 4, SOUL_LIMITS.nextActionHintsMax]) {
      expect(
        normalizeSoulDesign({ ...validRaw(), next_action_hints_count: value }, OPTIONS)
          .next_action_hints_count,
      ).toBe(value);
    }

    for (const value of [0, -1, 2.5, SOUL_LIMITS.nextActionHintsMax + 1, '3', null, {}, true]) {
      expectCode(
        () => normalizeSoulDesign({ ...validRaw(), next_action_hints_count: value }, OPTIONS),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('条数与开关独立：关闭时填的数字被保留（再次打开即恢复，不必重填）', () => {
    const saved = normalizeSoulDesign(
      { ...validRaw(), next_action_hints: false, next_action_hints_count: 2 },
      OPTIONS,
    );

    expect(saved.next_action_hints_count).toBe(2);
    expect(renderSoulMd(saved)).not.toContain('next_action_hints');
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
    const soul = normalizeSoulDesign({ intro: 'a', welcome: 'b', mission: 'm' }, OPTIONS);
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
    expect(describeSoul(normalizeSoulDesign({ ...validRaw(), intro: '简介优先' }, OPTIONS))).toBe('简介优先');
  });
});

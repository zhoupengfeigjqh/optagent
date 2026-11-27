/**
 * 单元测试：设计态输入校验与描述派生（纯函数）
 *
 * AgentDesignService 的读写/归一化用例已拆到 agent-design-service.spec.ts（原则二：单文件 ≤500 行）。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import {
  deriveDescription,
  validateAgentInput,
} from '../../src/domain/config-center/agent-design.js';
import { createReferenceIndex } from '../../src/domain/config-center/reference-index.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { soulDesign } from '../helpers/soul.js';


const index = createReferenceIndex({
  builtinTools: ['read_file', 'write_file', 'calculator'],
  mcpServices: ['ocr'],
  skills: ['pdf-parse'],
  mcpTools: [['ocr', ['ocr_extract']]],
});

const validRaw = {
  name: 'demo',
  soul: soulDesign('# 生产计划助手\n\n你是生产计划助手。', { intro: '生产计划助手' }),
  enabled_tools: ['read_file', 'calculator'],
  mcp_services: ['ocr'],
  skills: ['pdf-parse'],
  scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '产线电价', '算法规则'] },
};

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

describe('validateAgentInput', () => {
  it('正向：五类配置齐备时通过，且条目顺序原样保留', () => {
    const out = validateAgentInput(validRaw, { index, takenNames: new Set() });
    expect(out.name).toBe('demo');
    expect(out.enabled_tools).toEqual(['read_file', 'calculator']);
    expect(out.scenario.data_prep_dirs).toEqual(['生产计划', '产线电价', '算法规则']);
  });

  it('边界：三类引用可为空数组，且 MUST NOT 缺字段', () => {
    const out = validateAgentInput(
      {
        ...validRaw,
        enabled_tools: [],
        mcp_services: [],
        skills: [],
        scenario: { scenario: '空', data_prep_dirs: ['算法规则'] },
      },
      { index, takenNames: new Set() },
    );
    expect(out.enabled_tools).toEqual([]);
    expect(out.mcp_services).toEqual([]);
    expect(out.skills).toEqual([]);
    expect(out.scenario.data_prep_dirs).toEqual(['算法规则']);
  });

  it('边界：省略三类引用字段时按空集合处理（不报错）', () => {
    const out = validateAgentInput(
      {
        name: 'a',
        soul: soulDesign('s'),
        scenario: { scenario: 'x', data_prep_dirs: ['算法规则'] },
      },
      { index, takenNames: new Set() },
    );
    expect(out.enabled_tools).toEqual([]);
  });

  it('异常：结构化 SOUL 缺失或必填为空 → VALIDATION_FAILED（FR-019 / 004）', () => {
    expectCode(
      () => validateAgentInput({ ...validRaw, soul: 's' }, { index, takenNames: new Set() }),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () =>
        validateAgentInput({ ...validRaw, soul: soulDesign('   \n\t ') }, { index, takenNames: new Set() }),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () =>
        validateAgentInput(
          { ...validRaw, soul: soulDesign('使命', { intro: '' }) },
          { index, takenNames: new Set() },
        ),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('异常：名称含分隔符 / .. / 为空 → ADM_AGENT_NAME_TAKEN（FR-015）', () => {
    for (const bad of ['a/b', 'a\\b', '..', 'a..b', '', 'x'.repeat(65), '.']) {
      expectCode(
        () => validateAgentInput({ ...validRaw, name: bad }, { index, takenNames: new Set() }),
        ERROR_CODES.ADM_AGENT_NAME_TAKEN,
      );
    }
  });

  it('异常：名称已被占用 → ADM_AGENT_NAME_TAKEN', () => {
    expectCode(
      () => validateAgentInput(validRaw, { index, takenNames: new Set(['demo']) }),
      ERROR_CODES.ADM_AGENT_NAME_TAKEN,
    );
  });

  it('边界：改名场景下排除自身（takenNames 已剔除自身即可通过）', () => {
    const taken = new Set(['demo']);
    taken.delete('demo');
    expect(() =>
      validateAgentInput(validRaw, { index, takenNames: taken, currentName: 'demo' }),
    ).not.toThrow();
  });

  it('异常：引用清单外的内置工具 / MCP 服务 / SKILL → ADM_AGENT_INVALID_REF（FR-019）', () => {
    expectCode(
      () =>
        validateAgentInput(
          { ...validRaw, enabled_tools: ['read_file', 'nope_tool'] },
          { index, takenNames: new Set() },
        ),
      ERROR_CODES.ADM_AGENT_INVALID_REF,
    );
    expectCode(
      () => validateAgentInput({ ...validRaw, mcp_services: ['ocr2'] }, { index, takenNames: new Set() }),
      ERROR_CODES.ADM_AGENT_INVALID_REF,
    );
    expectCode(
      () => validateAgentInput({ ...validRaw, skills: ['ghost'] }, { index, takenNames: new Set() }),
      ERROR_CODES.ADM_AGENT_INVALID_REF,
    );
  });

  it('异常：三类引用含重复项或空值 → VALIDATION_FAILED', () => {
    expectCode(
      () =>
        validateAgentInput(
          { ...validRaw, enabled_tools: ['read_file', 'read_file'] },
          { index, takenNames: new Set() },
        ),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () => validateAgentInput({ ...validRaw, skills: [''] }, { index, takenNames: new Set() }),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () => validateAgentInput({ ...validRaw, mcp_services: 'ocr' }, { index, takenNames: new Set() }),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('异常：场景名为空 / 含分隔符 → VALIDATION_FAILED（FR-020）', () => {
    for (const scenario of ['', '  ', 'a/b', 'a\\b', '..', 'a..b']) {
      expectCode(
        () =>
          validateAgentInput(
            { ...validRaw, scenario: { scenario, data_prep_dirs: ['算法规则'] } },
            { index, takenNames: new Set() },
          ),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('异常：场景目录清单缺字段 / 含空值 / 重复 / 含分隔符 → VALIDATION_FAILED', () => {
    expectCode(
      () =>
        validateAgentInput({ ...validRaw, scenario: { scenario: 'x' } }, { index, takenNames: new Set() }),
      ERROR_CODES.VALIDATION_FAILED,
    );
    for (const dirs of [['a', ''], ['a', 'a'], ['a/b'], ['a\\b'], ['..'], ['a', 'b..c']]) {
      expectCode(
        () =>
          validateAgentInput(
            { ...validRaw, scenario: { scenario: 'x', data_prep_dirs: dirs } },
            { index, takenNames: new Set() },
          ),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('边界：清单仅含预定义目录合法（屏蔽与否由清单表达，见 scenario.spec）', () => {
    expect(() =>
      validateAgentInput(
        { ...validRaw, scenario: { scenario: 'x', data_prep_dirs: ['算法规则'] } },
        { index, takenNames: new Set() },
      ),
    ).not.toThrow();
  });

  it('原样保留：主要使命的换行与标点、条目顺序均不被规范化（FR-017）', () => {
    const mission = '第一行\n第二行，含标点！\r\n第三行\t制表符';
    const out = validateAgentInput(
      { ...validRaw, soul: soulDesign(mission), enabled_tools: ['calculator', 'read_file'] },
      { index, takenNames: new Set() },
    );
    expect(out.soul.mission).toBe(mission);
    expect(out.enabled_tools).toEqual(['calculator', 'read_file']);
  });
});

describe('deriveDescription（004：优先取角色简介）', () => {
  it('有角色简介时取简介', () => {
    expect(deriveDescription(soulDesign('使命正文', { intro: '生产计划助手' }))).toBe('生产计划助手');
  });

  it('无角色简介时回退使命首行并去掉 Markdown 井号', () => {
    expect(deriveDescription(soulDesign('\n# 生产计划助手\n正文', { intro: '' }))).toBe('生产计划助手');
    expect(deriveDescription(soulDesign('  普通首行  \n第二行', { intro: '' }))).toBe('普通首行');
  });

  it('超长时截断为 80 字符以内', () => {
    const text = deriveDescription(soulDesign('x'.repeat(200), { intro: '' }));
    expect(text.length).toBe(80);
    expect(text.endsWith('…')).toBe(true);
  });

  it('简介与使命都为空时返回空串', () => {
    expect(deriveDescription(soulDesign('', { intro: '' }))).toBe('');
    expect(deriveDescription(soulDesign('\n\n', { intro: '' }))).toBe('');
  });
});

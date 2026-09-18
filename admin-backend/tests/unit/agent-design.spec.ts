/**
 * 单元测试：数字人设计态的五类配置校验（T049）
 *
 * 每类校验都覆盖**正 / 异 / 边界**三类场景（宪章原则三）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import {
  AgentDesignService,
  deriveDescription,
  validateAgentInput,
} from '../../src/domain/config-center/agent-design.js';
import { createReferenceIndex } from '../../src/domain/config-center/reference-index.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

// 名称与场景判据已按 500 行门禁拆到独立模块（`naming.ts` / `scenario.ts`），
// 各自有对应单测（`naming.spec.ts` / `scenario.spec.ts`）。

const index = createReferenceIndex({
  builtinTools: ['read_file', 'write_file', 'calculator'],
  mcpServices: ['ocr'],
  skills: ['pdf-parse'],
});

const validRaw = {
  name: 'demo',
  soul: '# 生产计划助手\n\n你是生产计划助手。',
  enabled_tools: ['read_file', 'calculator'],
  mcp_services: ['ocr'],
  skills: ['pdf-parse'],
  scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '产线电价'] },
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
    expect(out.scenario.data_prep_dirs).toEqual(['生产计划', '产线电价']);
  });

  it('边界：三类引用可为空数组，且 MUST NOT 缺字段', () => {
    const out = validateAgentInput(
      { ...validRaw, enabled_tools: [], mcp_services: [], skills: [], scenario: { scenario: '空', data_prep_dirs: [] } },
      { index, takenNames: new Set() },
    );
    expect(out.enabled_tools).toEqual([]);
    expect(out.mcp_services).toEqual([]);
    expect(out.skills).toEqual([]);
    expect(out.scenario.data_prep_dirs).toEqual([]);
  });

  it('边界：省略三类引用字段时按空集合处理（不报错）', () => {
    const out = validateAgentInput(
      { name: 'a', soul: 's', scenario: { scenario: 'x', data_prep_dirs: [] } },
      { index, takenNames: new Set() },
    );
    expect(out.enabled_tools).toEqual([]);
  });

  it('异常：SOUL 为空或仅空白 → VALIDATION_FAILED（FR-019）', () => {
    expectCode(
      () =>
        validateAgentInput({ ...validRaw, soul: '' }, { index, takenNames: new Set() }),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () =>
        validateAgentInput({ ...validRaw, soul: '   \n\t ' }, { index, takenNames: new Set() }),
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
      () =>
        validateAgentInput({ ...validRaw, mcp_services: ['ocr2'] }, { index, takenNames: new Set() }),
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
      () =>
        validateAgentInput({ ...validRaw, skills: [''] }, { index, takenNames: new Set() }),
      ERROR_CODES.VALIDATION_FAILED,
    );
    expectCode(
      () =>
        validateAgentInput({ ...validRaw, mcp_services: 'ocr' }, { index, takenNames: new Set() }),
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('异常：场景名为空 / 含分隔符 → VALIDATION_FAILED（FR-020）', () => {
    for (const scenario of ['', '  ', 'a/b', 'a\\b', '..', 'a..b']) {
      expectCode(
        () =>
          validateAgentInput(
            { ...validRaw, scenario: { scenario, data_prep_dirs: [] } },
            { index, takenNames: new Set() },
          ),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('异常：场景目录清单缺字段 / 含空值 / 重复 / 含分隔符 → VALIDATION_FAILED', () => {
    expectCode(
      () =>
        validateAgentInput(
          { ...validRaw, scenario: { scenario: 'x' } },
          { index, takenNames: new Set() },
        ),
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

  it('边界：场景目录可为空数组（合法，表示不开放任何数据准备子目录）', () => {
    expect(() =>
      validateAgentInput(
        { ...validRaw, scenario: { scenario: 'x', data_prep_dirs: [] } },
        { index, takenNames: new Set() },
      ),
    ).not.toThrow();
  });

  it('原样保留：SOUL 的换行与标点、条目顺序均不被规范化（FR-017）', () => {
    const soul = '第一行\n第二行，含标点！\r\n第三行\t制表符\n'
    const out = validateAgentInput(
      { ...validRaw, soul, enabled_tools: ['calculator', 'read_file'] },
      { index, takenNames: new Set() },
    )
    expect(out.soul).toBe(soul)
    expect(out.enabled_tools).toEqual(['calculator', 'read_file'])
  })
});

describe('deriveDescription', () => {
  it('取 SOUL 首个非空行并去掉 Markdown 井号', () => {
    expect(deriveDescription('\n# 生产计划助手\n正文')).toBe('生产计划助手')
    expect(deriveDescription('  普通首行  \n第二行')).toBe('普通首行')
  })

  it('超长时截断为 80 字符以内', () => {
    const text = deriveDescription('x'.repeat(200))
    expect(text.length).toBe(80)
    expect(text.endsWith('…')).toBe(true)
  })

  it('空 SOUL 返回空串', () => {
    expect(deriveDescription('')).toBe('')
    expect(deriveDescription('\n\n')).toBe('')
  })
})

describe('AgentDesignService', () => {
  let root: string
  let store: PlatformStore
  let service: AgentDesignService

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-design-'))
    store = new PlatformStore(root)
    store.ensureLayout()
    service = new AgentDesignService(store)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('新建 → 读取 → 原样回显；revision 递增', () => {
    const created = service.create(validRaw, index, store.revision())
    expect(created.name).toBe('demo')
    expect(created.abnormal).toBe(false)
    const read = service.view('demo', index)
    expect(read.soul).toBe(validRaw.soul)
    expect(read.scenario.data_prep_dirs).toEqual(['生产计划', '产线电价'])
    expect(read.revision).toBe(created.revision)
  })

  it('不存在 → ADM_AGENT_NOT_FOUND', () => {
    expectCode(() => service.read('nope'), ERROR_CODES.ADM_AGENT_NOT_FOUND)
  })

  it('编辑改名：旧文档被移除，新文档可读（FR-015）', () => {
    service.create(validRaw, index, store.revision())
    service.update('demo', { ...validRaw, name: 'demo2' }, index, store.revision())
    expect(service.exists('demo')).toBe(false)
    expect(service.view('demo2', index).name).toBe('demo2')
  })

  it('编辑时版本不符 → ADM_CONFIG_REVISION_CONFLICT，且内容不变（FR-008）', () => {
    service.create(validRaw, index, store.revision())
    const stale = store.revision() - 1
    expectCode(
      () => service.update('demo', { ...validRaw, soul: '新内容' }, index, stale),
      ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT,
    )
    expect(service.read('demo').soul).toBe(validRaw.soul)
  })

  it('异常态：引用被移除后列表与详情均标记异常并指明失效对象（FR-013）', () => {
    service.create({ ...validRaw, skills: ['pdf-parse'] }, index, store.revision())
    const shrunk = createReferenceIndex({
      builtinTools: ['read_file', 'calculator'],
      mcpServices: ['ocr'],
      skills: [],
    })
    const list = service.list(1, shrunk)
    expect(list.items[0]?.abnormal).toBe(true)
    expect(list.items[0]?.abnormal_reason).toContain('pdf-parse')
    expect(service.view('demo', shrunk).abnormal_reason).toContain('SKILL')
  })

  it('列表按名称稳定排序并固定每页 8 项', () => {
    for (let i = 0; i < 10; i += 1) {
      service.create({ ...validRaw, name: `agent-${i}` }, index, store.revision())
    }
    const page1 = service.list(1, index)
    expect(page1.total).toBe(10)
    expect(page1.items).toHaveLength(8)
    expect(page1.page_size).toBe(8)
    expect(page1.total_pages).toBe(2)
    expect(service.list(2, index).items).toHaveLength(2)
  })

  it('读取归一化：历史文档缺 data_prep_fields 时对外恒补为空对象', () => {
    // 手工写入"本字段引入前"的文档形态，模拟线上既有数据
    store.writeJson('agents/legacy.json', {
      name: 'legacy',
      soul: '你是助手',
      enabled_tools: [],
      mcp_services: [],
      skills: [],
      scenario: { scenario: '生产', data_prep_dirs: ['生产计划'] },
      updated_at: '2026-09-15T00:00:00.000Z',
    });

    expect(service.read('legacy').scenario.data_prep_fields).toEqual({});
    expect(service.view('legacy', index).scenario.data_prep_fields).toEqual({});
  });

  it('删除后不再出现在列表与读取结果中', () => {
    service.create(validRaw, index, store.revision())
    service.remove('demo')
    expect(service.exists('demo')).toBe(false)
    expectCode(() => service.read('demo'), ERROR_CODES.ADM_AGENT_NOT_FOUND)
  })
})

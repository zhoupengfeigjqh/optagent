/**
 * 单元测试：部署前校验（T073）
 *
 * 五类校验项各自覆盖正 / 异 / 边界，并守住一条硬性口径：
 * **信息读取不到即按失败处理**，MUST NOT 视为通过。
 */
import { describe, expect, it } from 'vitest';
import { detectAnomalies } from '../../src/domain/config-center/references.js';
import { createReferenceIndex } from '../../src/domain/config-center/reference-index.js';
import type { AgentDesignDocument } from '../../src/domain/config-center/agent-design.js';
import { precheckPassed, runPrecheck, type PrecheckInput } from '../../src/domain/deploy/precheck.js';

const index = createReferenceIndex({
  builtinTools: ['read_file'],
  mcpServices: ['ocr'],
  skills: ['pdf-parse'],
});

function design(overrides: Partial<AgentDesignDocument> = {}): AgentDesignDocument {
  return {
    name: 'demo',
    soul: '你是助手',
    enabled_tools: ['read_file'],
    mcp_services: ['ocr'],
    skills: [],
    scenario: { scenario: '生产', data_prep_dirs: ['生产计划'] },
    updated_at: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
}

function input(overrides: Partial<PrecheckInput> = {}): PrecheckInput {
  const designs = new Map<string, AgentDesignDocument>([['demo', design()]]);
  return {
    users: [{ user_id: 'admin', agents: ['demo'] }],
    readDesign: (name) => designs.get(name) ?? null,
    index,
    toolsUnavailableReason: null,
    runtimeForm: 'container_network',
    endpointFor: (name) => (name === 'ocr' ? 'http://ocr:8000/mcp' : null),
    isWritable: () => true,
    ...overrides,
  };
}

describe('runPrecheck', () => {
  it('正向：五类校验全部通过时无错误项', () => {
    expect(runPrecheck(input())).toEqual([]);
  });

  it('① 配置完整性：SOUL 为空 → config_integrity', () => {
    const errors = runPrecheck(
      input({ readDesign: () => design({ soul: '   ' }) }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.category).toBe('config_integrity');
    expect(errors[0]?.user_id).toBe('admin');
    expect(errors[0]?.agent_name).toBe('demo');
  });

  it('① 配置完整性：场景配置不完整 → config_integrity', () => {
    const errors = runPrecheck(
      input({
        readDesign: () => design({ scenario: { scenario: '', data_prep_dirs: [] } }),
      }),
    );
    expect(errors.some((e) => e.category === 'config_integrity')).toBe(true);
  });

  it('① 边界：五类配置齐备但引用为空集合 → 不报错', () => {
    const errors = runPrecheck(
      input({
        readDesign: () =>
          design({ enabled_tools: [], mcp_services: [], skills: [], scenario: { scenario: 'x', data_prep_dirs: [] } }),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('① 配置完整性：场景字段约束非法（手工改过设计态文件）→ 逐条列出', () => {
    const errors = runPrecheck(
      input({
        readDesign: () =>
          design({
            scenario: {
              scenario: '生产',
              data_prep_dirs: ['生产计划'],
              data_prep_fields: {
                生产计划: [{ name: '产线编号', type: 'text' as never, required: true }],
                不在清单: [{ name: 'x', type: 'string', required: true }],
              },
            },
          }),
      }),
    );

    const integrity = errors.filter((e) => e.category === 'config_integrity');
    expect(integrity).toHaveLength(2);
    expect(integrity.map((e) => e.message).join('；')).toContain('取值类型非法');
    expect(integrity.map((e) => e.message).join('；')).toContain('不在清单');
  });

  it('① 边界：字段约束合法 / 缺省（历史文档）→ 不报错', () => {
    const errors = runPrecheck(
      input({
        readDesign: () =>
          design({
            scenario: {
              scenario: '生产',
              data_prep_dirs: ['生产计划'],
              data_prep_fields: {
                生产计划: [{ name: '产线编号', type: 'string', required: true }],
              },
            },
          }),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('① 关联了不存在的数字人 → config_integrity（按失败处理）', () => {
    const errors = runPrecheck(input({ readDesign: () => null }));
    expect(errors[0]?.category).toBe('config_integrity');
    expect(errors[0]?.code).toBe('ADM_AGENT_NOT_FOUND');
  });

  it('② 引用有效性：失效引用被逐条列出', () => {
    const shrunk = createReferenceIndex({ builtinTools: [], mcpServices: [], skills: [] });
    const errors = runPrecheck(
      input({
        index: shrunk,
        endpointFor: () => null,
        readDesign: () => design({ skills: ['ghost'] }),
      }),
    );
    const refErrors = errors.filter((e) => e.category === 'reference_validity');
    // read_file + ocr + ghost
    expect(refErrors).toHaveLength(3);
    expect(refErrors.map((e) => e.detail).sort()).toEqual(['ghost', 'ocr', 'read_file']);
  });

  it('② 信息读取不到（工具目录不可得）→ 按失败处理，MUST NOT 视为通过', () => {
    const errors = runPrecheck(
      input({ toolsUnavailableReason: '运行环境不可达', index: createReferenceIndex({ builtinTools: [], mcpServices: ['ocr'], skills: [] }) }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.category).toBe('reference_validity');
    expect(errors[0]?.code).toBe('ADM_RUNTIME_UNREACHABLE');
    expect(errors[0]?.detail).toBe('运行环境不可达');
  });

  it('② 边界：工具目录不可得但该数字人不引用任何工具 → 不报工具相关错误', () => {
    const errors = runPrecheck(
      input({
        toolsUnavailableReason: '运行环境不可达',
        readDesign: () => design({ enabled_tools: [], mcp_services: ['ocr'] }),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('③ 命名与路径安全：用户标识或数字人名非法 → name_path_safety', () => {
    const badUser = runPrecheck(input({ users: [{ user_id: 'a/b', agents: [] }] }));
    expect(badUser[0]?.category).toBe('name_path_safety');

    const badAgent = runPrecheck(input({ users: [{ user_id: 'admin', agents: ['../x'] }] }));
    expect(badAgent[0]?.category).toBe('name_path_safety');
  });

  it('④ 目标可写：不可写 → target_writable 且不继续校验该用户', () => {
    const errors = runPrecheck(input({ isWritable: () => false }));
    expect(errors[0]?.category).toBe('target_writable');
    expect(errors[0]?.code).toBe('ADM_DEPLOY_TARGET_NOT_WRITABLE');
  });

  it('⑤ 运行形态：目标形态缺地址 → runtime_form，且不静默回退', () => {
    const errors = runPrecheck(input({ runtimeForm: 'host_local', endpointFor: () => null }));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.category).toBe('runtime_form');
    expect(errors[0]?.code).toBe('ADM_RUNTIME_FORM_NOT_CONFIGURED');
    expect(errors[0]?.message).toContain('host_local');
    expect(errors[0]?.message).toContain('不会回退');
  });

  it('一次性列出全部错误项（不是发现一个就停）', () => {
    const errors = runPrecheck(
      input({
        users: [
          { user_id: 'admin', agents: ['demo'] },
          { user_id: 'ops', agents: ['demo2'] },
        ],
        readDesign: (name) => (name === 'demo' ? design({ soul: '' }) : design({ name: 'demo2' })),
        index: createReferenceIndex({ builtinTools: [], mcpServices: [], skills: [] }),
        endpointFor: () => null,
        isWritable: () => false,
      }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(new Set(errors.map((e) => e.category)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('precheckPassed', () => {
  it('无错误项即通过；有任何一项即不通过（供 passed 字段判定）', () => {
    expect(precheckPassed([])).toBe(true);
    expect(
      precheckPassed([
        {
          user_id: 'admin',
          agent_name: 'demo',
          category: 'config_integrity',
          code: 'VALIDATION_FAILED',
          message: 'x',
        },
      ]),
    ).toBe(false);
  });
});

describe('detectAnomalies —— 与预检同源', () => {
  it('预检的引用有效性判定与异常态判定一致（同一实现）', () => {
    const shrunk = createReferenceIndex({ builtinTools: [], mcpServices: [], skills: [] });
    const d = design();
    const anomalies = detectAnomalies(d, shrunk);
    const errors = runPrecheck(
      input({ index: shrunk, readDesign: () => d, endpointFor: () => 'http://x' }),
    );
    expect(anomalies.map((a) => a.target_name).sort()).toEqual(
      errors.filter((e) => e.category === 'reference_validity').map((e) => e.detail).sort(),
    );
  });
});

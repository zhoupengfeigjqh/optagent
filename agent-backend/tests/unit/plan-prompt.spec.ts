import { describe, expect, it } from 'vitest';

import {
  buildPlanPrompt,
  FOCUS_PROMPT_HARD_CAP_CHARS,
  HISTORY_MESSAGE_MAX_CHARS,
  renderRetryFeedback,
  ROLE_PROMPT,
} from '../../src/domain/plan/prompt.js';
import type { OntologyDefinition, OntologyIndex } from '../../src/domain/intent-focus/types.js';
import { buildToolNameIndex } from '../../src/domain/plan/normalize.js';
import type { BehaviorLookup } from '../../src/domain/rule-gate/types.js';

const REF = {
  ontologyKey: 'scenario-a/ontology-1',
  scenarioName: 'scenario-a',
  ontologyName: 'ontology-1',
  behaviorName: 'QueryInventory',
};

const DEFINITION: OntologyDefinition = {
  filePath: '/tmp/agent/ontology/scenario-a/ontology-1/ontology.yaml',
  ontologyId: '1',
  ontologyName: '原材料采购和库存',
  scenarioId: 's1',
  scenarioName: 'scenario-a',
  behaviors: [
    { name: 'QueryInventory', title: '查询库存', description: '', opType: 'query', concept: 'RawMaterialInventory' },
    { name: 'CreatePurchaseRecord', title: '创建采购记录', description: '', opType: 'command', concept: 'PurchaseRecord' },
    { name: 'UpdateDeliveryCapability', title: '更新交货能力', description: '', opType: 'command', concept: 'DeliveryCapability' },
  ],
  functions: [
    { name: 'sumRawNotArrivalQty', title: '原材料未到位数量', description: '', relatedConcepts: ['PurchaseRecord'] },
  ],
  concepts: [
    { name: 'RawMaterialInventory', title: '原材料库存' },
    { name: 'PurchaseRecord', title: '原材料采购记录' },
    { name: 'DeliveryCapability', title: '交货能力' },
  ],
  relations: [{ name: 'RecordsRawMaterial', source: 'PurchaseRecord', target: 'RawMaterial', relationType: [], cardinality: null }],
};

const ONTOLOGY: OntologyIndex = { byId: new Map([['1', [DEFINITION]]]), all: [DEFINITION], warnings: [] };

const TOOLS = [
  { name: 'rawmcp__QueryInventory' },
  { name: 'rawmcp__CreatePurchaseRecord' },
  { name: 'rawmcp__sumRawNotArrivalQty' },
  { name: 'read_file' },
];

const NAME_INDEX = buildToolNameIndex(TOOLS);

function behaviorOf(toolName: string): BehaviorLookup | null {
  if (toolName === 'rawmcp__CreatePurchaseRecord') {
    return { toolName, command: true, relatedFunctions: ['sumRawNotArrivalQty'], ref: REF };
  }
  if (toolName === 'rawmcp__QueryInventory') {
    return { toolName, command: false, relatedFunctions: [], ref: REF };
  }
  return null;
}

const BASE = {
  focusPrompt: '技能 raw-material-inventory → 本体 原材料采购和库存（ontology_id=1）',
  ontology: ONTOLOGY,
  toolNames: TOOLS.map((tool) => tool.name),
  nameIndex: NAME_INDEX,
  behaviorOf,
};

describe('buildPlanPrompt', () => {
  it('六段顺序：角色 → 聚焦 → 本体 → 函数 → 前置 → 输出格式', () => {
    const { system } = buildPlanPrompt({ ...BASE, history: [], userInput: '补采购' });
    const positions = [
      system.indexOf(ROLE_PROMPT),
      system.indexOf('［意图聚焦结果｜本轮规划的唯一起点］'),
      system.indexOf('［本体关系｜按本体分段］'),
      system.indexOf('［可用函数］'),
      system.indexOf('命令前置约束'),
      system.indexOf('［输出格式］'),
    ];
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
  });

  it('第 1、2 段都强调聚焦为起点，第 2 段标题含「起点」', () => {
    const { system } = buildPlanPrompt({ ...BASE, history: [], userInput: 'x' });
    expect(system).toContain('必须从下方「意图聚焦结果」出发');
    expect(system).toContain('请以此为起点设计计划');
    expect(system).toContain('唯一起点');
  });

  it('段 2 直通聚焦提示：6000 字也原样带入，「图路径」末行不丢（2026-11-26）', () => {
    const behaviors = Array.from({ length: 60 }, (_, index) => `· 关键行为 ${index} ${'x'.repeat(80)} @概念`);
    const paths = [
      '图路径（上游 1 跳；→/← 为本体边方向，按从左到右即本轮路径）',
      '查询库存 QueryInventory @RawMaterialInventory ←〔HasRawInventory〕— RawMaterial → 查询原材料 QueryRawMaterials',
    ];
    const focusPrompt = [...behaviors, ...paths].join('\n');
    expect(Array.from(focusPrompt).length).toBeGreaterThan(4000);
    expect(Array.from(focusPrompt).length).toBeLessThan(FOCUS_PROMPT_HARD_CAP_CHARS);

    const { system } = buildPlanPrompt({ ...BASE, focusPrompt, history: [], userInput: 'x' });
    expect(system).toContain(focusPrompt);
  });

  it('段 2 超防御性硬顶时按行截断，不留半截行', () => {
    const lines = Array.from({ length: 120 }, (_, index) => `${index} ${'y'.repeat(100)}`);
    const focusPrompt = lines.join('\n');
    expect(Array.from(focusPrompt).length).toBeGreaterThan(FOCUS_PROMPT_HARD_CAP_CHARS);

    const { system } = buildPlanPrompt({ ...BASE, focusPrompt, history: [], userInput: 'x' });
    const kept = lines.filter((line) => system.includes(line));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept).toEqual(lines.slice(0, kept.length));
    expect(system).not.toContain(lines[kept.length]!);
  });

  it('段 3 保留关系三元组与概念行为，未挂载行为标注', () => {
    const { system } = buildPlanPrompt({ ...BASE, history: [], userInput: 'x' });
    expect(system).toContain('- PurchaseRecord —RecordsRawMaterial→ RawMaterial');
    expect(system).toContain('command：UpdateDeliveryCapability（未挂载）');
  });

  it('段 4 本体函数标关联概念，非本体函数标来源', () => {
    const { system } = buildPlanPrompt({ ...BASE, history: [], userInput: 'x' });
    expect(system).toContain('- sumRawNotArrivalQty｜原材料未到位数量｜关联概念 PurchaseRecord');
    expect(system).toContain('- read_file｜内置');
  });

  it('段 5 覆盖全部 command，无前置者标「（无）」', () => {
    const behavior = (toolName: string): BehaviorLookup | null => {
      if (toolName === 'rawmcp__CreatePurchaseRecord') {
        return { toolName, command: true, relatedFunctions: ['sumRawNotArrivalQty'], ref: REF };
      }
      if (toolName === 'rawmcp__DeletePurchaseRecord') {
        return { toolName, command: true, relatedFunctions: [], ref: REF };
      }
      return null;
    };
    const tools = [...TOOLS, { name: 'rawmcp__DeletePurchaseRecord' }];
    const { system, commandCount } = buildPlanPrompt({
      ...BASE,
      toolNames: tools.map((tool) => tool.name),
      nameIndex: buildToolNameIndex(tools),
      behaviorOf: behavior,
      history: [],
      userInput: 'x',
    });
    expect(commandCount).toBe(2);
    expect(system).toContain('本轮可用 command 共 2 个');
    expect(system).toContain('- CreatePurchaseRecord：前置函数 sumRawNotArrivalQty');
    expect(system).toContain('- DeletePurchaseRecord：前置函数 （无）');
  });

  it('段 4 超 60 项不截断', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({ name: `mcp__svc__Tool${index}` }));
    const tools = [...TOOLS, ...many];
    const { system } = buildPlanPrompt({
      ...BASE,
      toolNames: tools.map((tool) => tool.name),
      nameIndex: buildToolNameIndex(tools),
      history: [],
      userInput: 'x',
    });
    expect(system).toContain('- svc__Tool79｜外部');
  });

  it('历史只取最近 3 轮，单条超限尾部截断', () => {
    const history = [
      { role: 'user' as const, content: '最早' },
      { role: 'assistant' as const, content: '最早答' },
      { role: 'user' as const, content: '第二' },
      { role: 'assistant' as const, content: '第二答' },
      { role: 'user' as const, content: '第三' },
      { role: 'assistant' as const, content: '第三答' },
      { role: 'user' as const, content: '字'.repeat(2000) },
      { role: 'assistant' as const, content: '最近答' },
    ];
    const { messages } = buildPlanPrompt({ ...BASE, history, userInput: '本轮' });
    expect(messages).toHaveLength(7);
    expect(messages[0]?.content).toBe('第二');
    const truncated = messages.find((message) => message.content.endsWith('（已截断）'));
    expect(truncated?.role).toBe('user');
    expect(Array.from(truncated?.content ?? '').length).toBe(HISTORY_MESSAGE_MAX_CHARS + 5);
    expect(messages.at(-1)).toEqual({ role: 'user', content: '本轮' });
  });

  it('历史末尾就是本轮原话时不重复（生产链路 req.messages 含本轮，2026-11-25 实测）', () => {
    const history = [
      { role: 'user' as const, content: '上一轮' },
      { role: 'assistant' as const, content: '上一轮答' },
      { role: 'user' as const, content: '本轮' },
    ];
    const { messages } = buildPlanPrompt({ ...BASE, history, userInput: '本轮' });

    expect(messages.map((message) => message.content)).toEqual(['上一轮', '上一轮答', '本轮']);
  });

  it('重试时追加反馈消息', () => {
    const feedback = renderRetryFeedback([{ code: 'C4', seqId: 2, field: 'coreAction', detail: '重复 command' }]);
    const { messages } = buildPlanPrompt({ ...BASE, history: [], userInput: '本轮', retryFeedback: feedback });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain('第 2 步 / coreAction（C4）');
  });

  it('技能文件正文不进任何段落', () => {
    const { system } = buildPlanPrompt({ ...BASE, history: [], userInput: 'x' });
    expect(system).not.toContain('## 技能');
  });
});

/**
 * 单元测试：意图聚焦编排（016）。
 *
 * 用真实临时目录（技能头部 + ontology.yaml）+ 桩判定客户端，覆盖：
 * - 开关关闭零动作；跳过 / 未配置 / 无技能 / 无可用本体 / 全低于阈值 的无调用路径；
 * - 成功链路：技能 → 行为 → 提示；记录字段与批数；
 * - 分批：33 个技能切 2 批；首批失败仍用剩余结果继续（部分降级）；
 * - 能力全批失败 → degraded + 空结果；记录写入抛错不影响返回值。
 *
 * 2026-11：`judge` 返回 `{ prompt, toolTips }`——非空态同时断言入选能力集合。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntentFocusConfig } from '../../src/config.js';
import { agentDir } from '../../src/domain/dirs.js';
import {
  IntentFocusRunner,
  type IntentFocusClient,
  type IntentFocusInput,
} from '../../src/domain/intent-focus/runner.js';
import type { IntentFocusRecordDraft } from '../../src/domain/intent-focus/store.js';

const USER = 'u1';
const AGENT = '生产计划助手';

const CONFIG: IntentFocusConfig = {
  baseUrl: 'http://laya:8000',
  model: 'laya-multilingual',
  apiKey: 'k',
  timeoutMs: 10_000,
  skillThreshold: 0.6,
  ontologyBehaviorThreshold: 0.6,
  ontologyFunctionThreshold: 0.6,
  maxSkills: 32,
  maxCapabilities: 96,
  // 027：改写参数（缺省关闭时不会被用到，但类型上必需）
  rewriteThreshold: 0.8,
  rewriteTimeoutMs: 5000,
};

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const ONTOLOGY_YAML = [
  'metadata:',
  '  ontology_id: 1',
  '  ontology_name: 原材料采购和库存',
  '  scenario_id: 2',
  '  scenario_name: 生产调度',
  'functions:',
  '  - name: F1',
  '    title: 校验采购单位一致性',
  'behaviors:',
  '  - name: B1',
  '    title: 创建采购单',
  '    op_type: command',
  '  - name: B2',
  '    title: 取消采购单',
  '    op_type: command',
  '  - name: Q1',
  '    title: 查询采购记录',
  '    op_type: query',
  '  - name: Q2',
  '    title: 查询原材料',
  '    op_type: query',
  'rules:',
  '  - behavior: B1',
  '    data_supplements: [Q1, Q2]',
  '  - behavior: Q1',
  '    data_supplements: [Q2]',
].join('\n');

function makeSkill(name: string, description: string, ontologyId?: string): string {
  const metadata = ontologyId
    ? `metadata:\n  ontology_id: ${ontologyId}\n  ontology_name: 原材料采购和库存\n  scenario_id: 2\n  scenario_name: 生产调度\n`
    : '';
  return `---\nname: ${name}\ndescription: ${description}\n${metadata}---\n\n# ${name}\n`;
}

interface Fixture {
  root: string;
  dir: string;
}

function fixture(options: {
  skills?: Array<{ dir: string; name: string; description: string; ontologyId?: string }>;
  ontology?: boolean;
  /** 同一 ontology_id 再物化一份（不同目录），用于验证提示不重复输出本体字段 */
  duplicateOntology?: boolean;
  /** 覆盖物化的本体文件内容（019 的阶数用例需要 concepts / relations） */
  ontologyYaml?: string;
} = {}): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-focus-'));
  tmpDirs.push(root);
  const dir = agentDir(root, USER, AGENT);
  fs.mkdirSync(dir, { recursive: true });

  const skills = options.skills ?? [
    { dir: 'onto', name: 'onto-skill', description: '原材料采购和库存本体技能', ontologyId: '1' },
    { dir: 'plain', name: 'plain-skill', description: '普通技能' },
  ];
  for (const skill of skills) {
    const skillDir = path.join(dir, 'skills', skill.dir);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      makeSkill(skill.name, skill.description, skill.ontologyId),
      'utf8',
    );
  }
  if (options.ontology !== false) {
    const ontoDir = path.join(dir, 'ontology', '生产调度', '原材料采购和库存');
    fs.mkdirSync(ontoDir, { recursive: true });
    fs.writeFileSync(
      path.join(ontoDir, 'ontology.yaml'),
      options.ontologyYaml ?? ONTOLOGY_YAML,
      'utf8',
    );
  }
  if (options.duplicateOntology) {
    const copyDir = path.join(dir, 'ontology', '生产调度', '原材料采购和库存副本');
    fs.mkdirSync(copyDir, { recursive: true });
    fs.writeFileSync(path.join(copyDir, 'ontology.yaml'), ONTOLOGY_YAML, 'utf8');
  }
  return { root, dir };
}

function input(overrides: Partial<IntentFocusInput> = {}): IntentFocusInput {
  return {
    userId: USER,
    agentName: AGENT,
    threadId: 't1',
    messageId: 'm-1',
    userInput: '帮我创建一笔原材料采购单',
    skip: false,
    ...overrides,
  };
}

/** 按题面里的名字给分：技能用「技能「description」，行为用「行为「title」」。 */
function scoreOf(instructions: string): number {
  if (instructions.includes('原材料采购和库存本体技能')) return 0.9;
  if (instructions.includes('普通技能')) return 0.3;
  if (instructions.includes('创建采购单')) return 0.9;
  if (instructions.includes('取消采购单')) return 0.1;
  if (instructions.includes('查询采购记录')) return 0.05;
  if (instructions.includes('查询原材料')) return 0.05;
  // 2026-11-20：函数恢复出题（题面措辞为「需要函数」），0.7 高于函数阈值 0.6
  if (instructions.includes('校验采购单位一致性')) return 0.7;
  return 0.05;
}

interface HarnessOptions {
  enabled?: boolean;
  configured?: boolean;
  config?: IntentFocusConfig;
  decide?: IntentFocusClient['decide'];
  withStore?: boolean;
  storeThrows?: boolean;
  /** 019：聚焦阶数（缺省 0） */
  depth?: number;
  logger?: { info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void };
  /**
   * 027：输入改写。缺省 = 开关关闭 / 端口未装配（与改造前行为一致），
   * 因此既有用例不需要任何改动。
   */
  rewrite?: {
    enabled?: boolean;
    /** 改写产物（缺省「改写后的意图」） */
    text?: string;
    /** 历史素材 */
    history?: ReadonlyArray<{
      role: 'user' | 'assistant';
      content: string;
      status?: 'completed' | 'failed';
    }>;
    /** 让改写调用抛错 */
    fail?: boolean;
  };
}

function harness(root: string, options: HarnessOptions = {}) {
  const records: IntentFocusRecordDraft[] = [];
  const defaultDecide: IntentFocusClient['decide'] = async (_state, questions) => {
    const scores: Record<string, number> = {};
    for (const [qid, question] of Object.entries(questions)) {
      scores[qid] = scoreOf((question as { instructions: string }).instructions);
    }
    return { ok: true, scores, model: 'laya-multilingual' };
  };
  const client: IntentFocusClient = { decide: options.decide ?? defaultDecide };
  const runner = new IntentFocusRunner({
    root,
    ...(options.configured === false ? {} : { config: options.config ?? CONFIG }),
    ...(options.configured === false ? {} : { client }),
    ...(options.withStore === false
      ? {}
      : {
          store: {
            append: (_u: string, _a: string, _t: string, draft: IntentFocusRecordDraft) => {
              if (options.storeThrows) return Promise.reject(new Error('disk full'));
              records.push(draft);
              return Promise.resolve();
            },
          },
        }),
    isEnabled: () => options.enabled ?? true,
    getDepth: () => options.depth ?? 0,
    // 027：缺省不开启改写（既有 013/016/019 用例不受影响）
    isRewriteEnabled: () => options.rewrite?.enabled === true,
    ...(options.rewrite
      ? {
          readHistory: () => options.rewrite!.history ?? [],
          rewriteLlm: {
            complete: async () => {
              if (options.rewrite!.fail) throw new Error('改写模型不可用');
              return options.rewrite!.text ?? '改写后的意图';
            },
          },
        }
      : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    now: () => 1_000,
  });
  return { runner, records, client };
}

describe('开关、跳过与未配置', () => {
  it('开关关闭：不读取、不判定、不留档', async () => {
    const { root } = fixture();
    const { runner, records, client } = harness(root, { enabled: false });
    const spy = vi.spyOn(client, 'decide');
    await expect(runner.judge(input())).resolves.toEqual({ prompt: '', toolTips: [] });
    expect(spy).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });

  it('预置动作入口：只留一条 skipped，且不调用判定', async () => {
    const { root } = fixture();
    const { runner, records, client } = harness(root);
    const spy = vi.spyOn(client, 'decide');
    await expect(runner.judge(input({ skip: true }))).resolves.toEqual({ prompt: '', toolTips: [] });
    expect(spy).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0]!.disposition).toBe('skipped');
    expect(records[0]!.prompt).toBe('');
  });

  it('跳过优先于未配置', async () => {
    const { root } = fixture();
    const { runner, records } = harness(root, { configured: false });
    await runner.judge(input({ skip: true }));
    expect(records[0]!.disposition).toBe('skipped');
  });

  it('未配置：留档 unconfigured，不发起调用', async () => {
    const { root } = fixture();
    const { runner, records, client } = harness(root, { configured: false });
    const spy = vi.spyOn(client, 'decide');
    await expect(runner.judge(input())).resolves.toEqual({ prompt: '', toolTips: [] });
    expect(spy).not.toHaveBeenCalled();
    expect(records[0]!.disposition).toBe('unconfigured');
    expect(records[0]!.reason).toBe('no_config');
  });
});

describe('空结果', () => {
  it('没有任何技能：empty/no_skills，且不调用判定', async () => {
    const { root } = fixture({ skills: [] });
    const { runner, records, client } = harness(root);
    const spy = vi.spyOn(client, 'decide');
    await runner.judge(input());
    expect(spy).not.toHaveBeenCalled();
    expect(records[0]!.disposition).toBe('empty');
    expect(records[0]!.reason).toBe('no_skills');
  });

  it('本体未物化：empty/no_focusable_skills，技能决策记原因', async () => {
    const { root } = fixture({
      skills: [{ dir: 'orphan', name: 'orphan-skill', description: '孤儿本体技能', ontologyId: '404' }],
      ontology: false,
    });
    const { runner, records, client } = harness(root);
    const spy = vi.spyOn(client, 'decide');
    await runner.judge(input());
    expect(spy).not.toHaveBeenCalled();
    expect(records[0]!.disposition).toBe('empty');
    expect(records[0]!.reason).toBe('no_focusable_skills');
    expect(records[0]!.skills[0]!.reason).toBe('no_matching_ontology');
  });

  it('全部低于阈值：empty/below_threshold', async () => {
    const { root } = fixture();
    const { runner, records } = harness(root, {
      decide: async () => ({ ok: true, scores: { s1: 0.3, s2: 0.2 }, model: 'm' }),
    });
    await expect(runner.judge(input())).resolves.toEqual({ prompt: '', toolTips: [] });
    expect(records[0]!.disposition).toBe('empty');
    expect(records[0]!.reason).toBe('below_threshold');
  });
});

describe('成功链路', () => {
  it('技能 + 行为 + 函数：函数进提示但不进卡片（FR-069 回归）', async () => {
    const { root } = fixture();
    const { runner, records } = harness(root);
    const { prompt, toolTips } = await runner.judge(input());

    expect(prompt).toBe(
      `${FOCUS_PREFIX}\n` +
        '技能 onto-skill → 本体 原材料采购和库存（ontology_id=1）\n\n' +
        '关键行为\n' +
        '· 创建采购单 B1\n\n' +
        '关键函数\n' +
        '· 校验采购单位一致性 F1',
    );
    // 卡片候选范围＝入选行为（顺序沿判定结果，字段原样透传）；函数 F1 不得出现
    expect(toolTips).toEqual([
      { name: 'B1', title: '创建采购单', ontology_id: '1', ontology_name: '原材料采购和库存' },
    ]);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.disposition).toBe('focused');
    expect(record.batches).toBe(2);
    // 技能 2 个 + 能力候选 5 个（4 个行为 + 1 个函数；rules 不参与）
    expect(record.candidates).toBe(2 + 5);
    expect(record.behaviors.map((item) => item.name)).toEqual(['B1']);
    expect(record.functions).toEqual([
      {
        name: 'F1',
        title: '校验采购单位一致性',
        ontology_id: '1',
        ontology_name: '原材料采购和库存',
        score: 0.7,
        related_concepts: [],
      },
    ]);
    // 卡片通道不含函数
    expect(record.tool_tip_behaviors.map((item) => item.name)).toEqual(['B1']);
    expect(record).not.toHaveProperty('data_supplements');
    expect(record.prompt).toBe(prompt);
  });

  it('同一 ontology_id 物化成多份文件：提示里只出现一组本体字段', async () => {
    const { root } = fixture({ duplicateOntology: true });
    const { runner } = harness(root);
    const { prompt } = await runner.judge(input());
    expect(prompt.match(/ontology_id=/g)).toHaveLength(1);
    expect(prompt.match(/本体 原材料采购和库存/g)).toHaveLength(1);
  });

  it('规则不再补入低于阈值的行为：Q1/Q2 得分 0.05，仍不出现', async () => {
    const { root } = fixture();
    const { runner, records } = harness(root);
    await runner.judge(input());
    const names = records[0]!.behaviors.map((item) => item.name);
    expect(names).toEqual(['B1']);
    expect(names).not.toContain('Q1');
    expect(names).not.toContain('Q2');
  });

  it('本体只有技能、没有能力：提示只有技能段，仍算 focused', async () => {
    const { root } = fixture({
      skills: [{ dir: 'plain', name: 'plain-skill', description: '普通技能' }],
      ontology: false,
    });
    // 用非本体技能验证"有技能但无能力"
    const { runner, records } = harness(root, {
      decide: async (_state, questions) => {
        const scores: Record<string, number> = {};
        for (const qid of Object.keys(questions)) scores[qid] = 0.9;
        return { ok: true, scores, model: 'm' };
      },
    });
    const { prompt, toolTips } = await runner.judge(input());
    expect(prompt).toContain('技能 plain-skill（非本体技能）');
    expect(prompt).not.toContain('→ 本体');
    expect(prompt).not.toContain('ontology_id');
    // 非本体技能没有能力：卡片范围为空的（调用方据此不产出卡片）
    expect(toolTips).toEqual([]);
    expect(records[0]!.disposition).toBe('focused');
  });

  it('超长输入：记录 input_truncated=true 且取尾部', async () => {
    const { root } = fixture();
    const { runner, records } = harness(root);
    await runner.judge(input({ userInput: `${'材料'.repeat(300)}创建采购单` }));
    expect(records[0]!.input_truncated).toBe(true);
    expect(records[0]!.input.endsWith('创建采购单')).toBe(true);
  });
});

/** 019 用例本体：3 个概念 / 2 条关系 / 3 条行为（与真实文件同形） */
const FOCUS_ONTOLOGY_YAML = [
  'metadata:',
  '  ontology_id: 7',
  '  ontology_name: 原材料采购和库存',
  '  scenario_id: 2',
  '  scenario_name: 生产调度',
  'concepts:',
  '  - name: RawMaterial',
  '    title: 原材料',
  '  - name: RawMaterialInventory',
  '    title: 原材料库存',
  '  - name: PurchaseRecord',
  '    title: 原材料采购记录',
  'relations:',
  '  - name: HasRawInventory',
  '    source: RawMaterial',
  '    target: RawMaterialInventory',
  '    cardinality: 1:1',
  '    relation_type: [Functional, InverseFunctional]',
  '  - name: RecordsRawMaterial',
  '    source: PurchaseRecord',
  '    target: RawMaterial',
  '    cardinality: N:1',
  '    relation_type: [Functional]',
  'behaviors:',
  '  - name: QueryInventory',
  '    title: 查询原材料库存信息',
  '    op_type: query',
  '    concept: RawMaterialInventory',
  '  - name: QueryRawMaterials',
  '    title: 查询原材料基本信息',
  '    op_type: query',
  '    concept: RawMaterial',
  '  - name: CreatePurchaseRecord',
  '    title: 创建原材料采购单',
  '    op_type: command',
  '    concept: PurchaseRecord',
].join('\n');

const FOCUS_PREFIX = '［聚焦参考］以下为背景知识，不是工具清单；工具调用仍以工具清单为准。';

function focusFixture(): Fixture {
  return fixture({
    skills: [
      { dir: 'inv', name: 'inventory-skill', description: '库存本体技能', ontologyId: '7' },
    ],
    ontologyYaml: FOCUS_ONTOLOGY_YAML,
  });
}

/** 只让「查询原材料库存信息」过阈值；可按需放开其它行为 */
function focusDecide(allow: readonly string[]): IntentFocusClient['decide'] {
  return async (_state, questions) => {
    const scores: Record<string, number> = {};
    for (const [qid, question] of Object.entries(questions)) {
      const text = (question as { instructions: string }).instructions;
      if (text.includes('库存本体技能')) scores[qid] = 0.9;
      else if (allow.some((keyword) => text.includes(keyword))) scores[qid] = 0.9;
      else scores[qid] = 0.05;
    }
    return { ok: true, scores, model: 'm' };
  };
}

describe('聚焦阶数（019）', () => {
  it('阶数 0：只有直接命中的概念与行为，卡片也只有直接命中', async () => {
    const { root } = focusFixture();
    const { runner, records } = harness(root, { decide: focusDecide(['查询原材料库存信息']) });
    const { prompt, toolTips } = await runner.judge(input());

    // 阶数 0：只有关键行为段，没有图路径段
    expect(prompt).toBe(
      `${FOCUS_PREFIX}\n技能 inventory-skill → 本体 原材料采购和库存（ontology_id=7）\n\n` +
        '关键行为\n' +
        '· 查询原材料库存信息 QueryInventory @RawMaterialInventory',
    );
    expect(toolTips).toEqual([
      { name: 'QueryInventory', title: '查询原材料库存信息', ontology_id: '7', ontology_name: '原材料采购和库存' },
    ]);
    expect(records[0]!.depth).toBe(0);
    expect(records[0]!.concepts.map((item) => [item.name, item.source, item.hop])).toEqual([
      ['RawMaterialInventory', 'direct', 0],
    ]);
    expect(records[0]!.behaviors.map((item) => item.name)).toEqual(['QueryInventory']);
    expect(records[0]!.tool_tip_behaviors.map((item) => item.name)).toEqual(['QueryInventory']);
  });

  it('阶数 1：上游发散只进提示（一条五元组），卡片保持直接命中', async () => {
    const { root } = focusFixture();
    const { runner, records } = harness(root, {
      decide: focusDecide(['查询原材料库存信息']),
      depth: 1,
    });
    const { prompt, toolTips } = await runner.judge(input());

    // 一行读完：行为 @起点概念 ←〔关系〕— 终点概念 → 终点概念下的行为；
    // 关系名在 yaml 里没写 title ⇒ 回退 name，且这一跳逆着本体边写，所以边方向朝左
    expect(prompt).toContain(
      '查询原材料库存信息 QueryInventory @RawMaterialInventory ' +
        '←〔HasRawInventory〕— RawMaterial → 查询原材料基本信息 QueryRawMaterials',
    );
    // 概念不再单独成段
    expect(prompt).not.toContain('关联概念：');
    expect(prompt).not.toContain('上游概念：');
    expect(prompt).not.toContain('上游参考：');
    // 下游：库存是 1:1 的明细端，没有更下游的对象
    expect(toolTips.map((item) => item.name)).toEqual(['QueryInventory']);

    const record = records[0]!;
    expect(record.depth).toBe(1);
    expect(record.concepts.map((item) => [item.name, item.source, item.hop])).toEqual([
      ['RawMaterialInventory', 'direct', 0],
      ['RawMaterial', 'upstream', 1],
    ]);
    // 提示通道：直接命中 + 上游
    expect(record.behaviors.map((item) => [item.name, item.source, item.score])).toEqual([
      ['QueryInventory', 'direct', 0.9],
      ['QueryRawMaterials', 'upstream', null],
    ]);
    // 卡片通道：只有直接命中
    expect(record.tool_tip_behaviors.map((item) => item.name)).toEqual(['QueryInventory']);
  });

  it('阶数 1：下游发散只进卡片（含写行为），提示不多一行', async () => {
    const { root } = focusFixture();
    const { runner, records } = harness(root, {
      decide: focusDecide(['查询原材料库存信息', '查询原材料基本信息']),
      depth: 1,
    });
    const { prompt, toolTips } = await runner.judge(input());

    // 两个直接命中概念把「原材料」变成锚点 → 上游无从发散（连路径段都不该出现）
    expect(prompt).not.toContain('图路径');

    // 下游：原材料 → 原材料采购记录（采购单）→ 创建采购单进卡片
    expect(toolTips.map((item) => item.name)).toEqual([
      'QueryInventory',
      'QueryRawMaterials',
      'CreatePurchaseRecord',
    ]);
    const record = records[0]!;
    expect(record.behaviors.map((item) => item.name)).toEqual(['QueryInventory', 'QueryRawMaterials']);
    expect(
      record.tool_tip_behaviors.map((item) => [
        item.name,
        item.source,
        item.score,
        item.via_concept,
        item.from_concept,
      ]),
    ).toEqual([
      // direct：via_concept 是自身概念，没有起点
      ['QueryInventory', 'direct', 0.9, 'RawMaterialInventory', null],
      ['QueryRawMaterials', 'direct', 0.9, 'RawMaterial', null],
      // 下游：via_concept 是终点（采购单），from_concept 才说明"因为问的是原材料"
      ['CreatePurchaseRecord', 'downstream', null, 'PurchaseRecord', 'RawMaterial'],
    ]);
  });
});

describe('分批与降级', () => {
  it('33 个技能切 2 批；首批失败仍用剩余结果继续（部分降级）', async () => {
    const skills = Array.from({ length: 33 }, (_, i) => ({
      dir: `s${i}`,
      name: `skill-${i}`,
      description: `技能${i}`,
    }));
    const { root } = fixture({ skills, ontology: false });
    const calls: number[] = [];
    const { runner, records } = harness(root, {
      config: { ...CONFIG, maxSkills: 64 },
      decide: async (_state, questions) => {
        calls.push(Object.keys(questions).length);
        // 第一批（32 题）失败，第二批（1 题）成功
        if (calls.length === 1) {
          return { ok: false as const, reason: 'timeout' as const, message: 'timeout' };
        }
        const scores: Record<string, number> = {};
        for (const qid of Object.keys(questions)) scores[qid] = 0.9;
        return { ok: true as const, scores, model: 'm' };
      },
    });
    const { prompt } = await runner.judge(input());
    expect(calls).toEqual([32, 1]);
    // 第二批只有一个候选入选（具体名字取决于目录枚举序，不写死）
    expect(prompt).toContain('技能 skill-');
    expect(prompt).toContain('（非本体技能）');
    expect(records[0]!.disposition).toBe('focused');
    expect(records[0]!.error).toContain('batch_0:timeout');
  });

  it('技能全批失败：degraded + 空串', async () => {
    const { root } = fixture();
    const { runner, records } = harness(root, {
      decide: async () => ({ ok: false, reason: 'timeout', message: 'timeout' }),
    });
    await expect(runner.judge(input())).resolves.toEqual({ prompt: '', toolTips: [] });
    expect(records[0]!.disposition).toBe('degraded');
    expect(records[0]!.reason).toBe('timeout');
    expect(records[0]!.prompt).toBe('');
  });

  it('能力全批失败：degraded + 空串（技能已选出也不给提示）', async () => {
    const { root } = fixture();
    let call = 0;
    const { runner, records } = harness(root, {
      decide: async (_state, questions) => {
        call += 1;
        if (call === 1) {
          const scores: Record<string, number> = {};
          for (const qid of Object.keys(questions)) scores[qid] = 0.9;
          return { ok: true, scores, model: 'm' };
        }
        return { ok: false, reason: 'http', status: 503, message: 'busy' };
      },
    });
    await expect(runner.judge(input())).resolves.toEqual({ prompt: '', toolTips: [] });
    expect(records[0]!.disposition).toBe('degraded');
    expect(records[0]!.skills.some((skill) => skill.selected)).toBe(true);
  });

  it('判定抛错按 network 降级，不冒泡', async () => {
    const { root } = fixture();
    const { runner } = harness(root, {
      decide: (async () => {
        throw new Error('boom');
      }) as IntentFocusClient['decide'],
    });
    await expect(runner.judge(input())).resolves.toEqual({ prompt: '', toolTips: [] });
  });

  it('记录写入抛错不影响返回值', async () => {
    const { root } = fixture();
    const { runner } = harness(root, { storeThrows: true });
    await expect(runner.judge(input())).resolves.toMatchObject({
      prompt: expect.stringContaining('技能 onto-skill'),
    });
  });

  it('未装配存储时不影响返回值', async () => {
    const { root } = fixture();
    const { runner } = harness(root, { withStore: false });
    await expect(runner.judge(input())).resolves.toMatchObject({
      prompt: expect.stringContaining('技能 onto-skill'),
    });
  });
});

describe('日志与本体名回退', () => {
  it('注入 logger 时：成功 / 空结果 / 降级各写一条日志', async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const logger = { info, warn };

    await harness(fixture().root, { logger }).runner.judge(input());
    expect(info).toHaveBeenCalled();

    const empty = harness(fixture().root, {
      logger,
      decide: async () => ({ ok: true, scores: { s1: 0.1, s2: 0.1 }, model: 'm' }),
    });
    await empty.runner.judge(input());

    const degraded = harness(fixture().root, {
      logger,
      decide: async () => ({ ok: false, reason: 'timeout', message: 'timeout' }),
    });
    await degraded.runner.judge(input());
    expect(warn).toHaveBeenCalled();
  });

  it('本体文件缺 ontology_name：提示回落到技能头部的本体名', async () => {
    const { root, dir } = fixture();
    fs.writeFileSync(
      path.join(dir, 'ontology', '生产调度', '原材料采购和库存', 'ontology.yaml'),
      ['metadata:', '  ontology_id: 1', 'behaviors:', '  - name: B1', '    title: 创建采购单'].join('\n'),
      'utf8',
    );
    const { runner } = harness(root);
    const { prompt } = await runner.judge(input());
    expect(prompt).toContain('本体 原材料采购和库存');
  });
});

/**
 * 027：指代改写在编排里的接入位置。
 *
 * 两件事必须能测出来：
 * - **短路先于改写**：无技能 / 无可聚焦技能轮次零判定零改写（契约 O-3）；
 * - **评分素材已切换**：改写成功后，技能与行为判定收到的 `state` 是改写文本，
 *   而留档的 `input` 仍是原文（C-1 / O-5）。
 */
describe('027 指代改写接入', () => {
  /** 判定桩：改写命题给 0.95，其余按题面打分（与默认桩同口径） */
  const decideWithRewrite: IntentFocusClient['decide'] = async (_state, questions) => {
    const scores: Record<string, number> = {};
    for (const [qid, question] of Object.entries(questions)) {
      scores[qid] =
        qid === 'need_rewrite' ? 0.95 : scoreOf((question as { instructions: string }).instructions);
    }
    return { ok: true, scores, model: 'laya-multilingual' };
  };

  it('无技能短路：零判定零改写，记录里 need_rewrite=null', async () => {
    const { root } = fixture({ skills: [] });
    const calls: Array<{ state: string }> = [];
    const { runner, records } = harness(root, {
      rewrite: { enabled: true },
      decide: async (state, questions) => {
        calls.push({ state });
        return decideWithRewrite(state, questions);
      },
    });

    await runner.judge(input());

    expect(calls).toHaveLength(0);
    expect(records[0]).toMatchObject({
      disposition: 'empty',
      reason: 'no_skills',
      need_rewrite: null,
      rewrite_query: '',
      rewrite_reason: null,
    });
  });

  it('无可聚焦技能短路：同样零判定零改写', async () => {
    const { root } = fixture({
      skills: [{ dir: 'orphan', name: 'orphan-skill', description: '孤儿本体技能', ontologyId: '404' }],
      ontology: false,
    });
    const calls: Array<{ state: string }> = [];
    const { runner, records } = harness(root, {
      rewrite: { enabled: true },
      decide: async (state, questions) => {
        calls.push({ state });
        return decideWithRewrite(state, questions);
      },
    });

    await runner.judge(input());

    expect(calls).toHaveLength(0);
    expect(records[0]).toMatchObject({ need_rewrite: null, rewrite_query: '' });
  });

  it('改写成功后：技能 / 行为评分用改写文本，留档 input 仍是原文', async () => {
    const { root } = fixture();
    const states: string[] = [];
    const { runner, records } = harness(root, {
      rewrite: {
        enabled: true,
        text: '分析上批原材料采购单的到货延迟',
        history: [{ role: 'user', content: '上一轮问的采购单', status: 'completed' }],
      },
      decide: async (state, questions) => {
        states.push(state);
        return decideWithRewrite(state, questions);
      },
    });

    await runner.judge(input());

    // 第 1 次是改写命题（素材仍是原文），之后是技能 / 行为（素材已切换）
    expect(states[0]).toBe('帮我创建一笔原材料采购单');
    expect(states.slice(1).every((state) => state === '分析上批原材料采购单的到货延迟')).toBe(true);

    const [record] = records;
    expect(record).toMatchObject({
      disposition: 'focused',
      input: '帮我创建一笔原材料采购单',
      need_rewrite: true,
      rewrite_score: 0.95,
      rewrite_query: '分析上批原材料采购单的到货延迟',
      rewrite_truncated: false,
      // 只有 user 一条历史、没有成对 assistant ⇒ 不构成完整轮
      rewrite_history_turns: 0,
      rewrite_reason: 'no_history',
    });
  });

  it('改写失败：评分退回原文，记录带原因，仍然完成聚焦', async () => {
    const { root } = fixture();
    const states: string[] = [];
    const { runner, records } = harness(root, {
      rewrite: { enabled: true, fail: true },
      decide: async (state, questions) => {
        states.push(state);
        return decideWithRewrite(state, questions);
      },
    });

    const result = await runner.judge(input());

    expect(result.prompt).toContain('onto-skill');
    expect(states.slice(1).every((state) => state === '帮我创建一笔原材料采购单')).toBe(true);
    expect(records[0]).toMatchObject({
      disposition: 'focused',
      need_rewrite: true,
      rewrite_query: '',
      rewrite_reason: 'llm_failed',
    });
  });
});

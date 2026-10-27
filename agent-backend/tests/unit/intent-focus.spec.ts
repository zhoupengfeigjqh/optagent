/**
 * 单元测试：意图聚焦纯逻辑（013 · noul 口径）。
 *
 * 守住确定性口径：
 * - 候选按原序截断到总数上限；空候选不构造命题；
 * - 每个候选**一条** `noul` 命题，qid = 工具名，命题正文用展示名（label 优先）；
 * - 分批按 32 切、末批可短；
 * - 分数筛选：阈值边界、降序、同分按候选原序、**全量保留不截断**；
 * - 聚焦提示格式逐字固定（工具名而非展示名）、去重、无入选时为空串；
 * - 处置判定五态，开关关闭时**不产生记录**。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLD,
  FOCUS_PROMPT_PREFIX,
  MAX_CANDIDATES,
  MAX_DISPLAY_CHARS,
  MAX_QUESTIONS_PER_BATCH,
  MAX_STATE_CHARS,
  buildQuestionBatches,
  buildQuestions,
  composeFocusPrompt,
  decideDisposition,
  displayNameOf,
  normalizeThreshold,
  prepareState,
  selectActions,
  selectCandidates,
  type ToolCandidate,
} from '../../src/domain/intent-focus.js';

function candidate(name: string, label?: string): ToolCandidate {
  return { name, description: `${name} 的用途`, ...(label !== undefined ? { label } : {}) };
}

const THREE: ToolCandidate[] = [
  candidate('order_query', '查询订单'),
  candidate('capacity_query', '查询产能'),
  candidate('bom_query', '查询物料清单'),
];

describe('阈值收敛', () => {
  it('缺省 / 非法值收敛到缺省阈值', () => {
    expect(normalizeThreshold(undefined)).toBe(DEFAULT_THRESHOLD);
    expect(normalizeThreshold(Number.NaN)).toBe(DEFAULT_THRESHOLD);
  });

  it('越界阈值收敛到 0~1', () => {
    expect(normalizeThreshold(-1)).toBe(0);
    expect(normalizeThreshold(2)).toBe(1);
  });
});

describe('输入与候选准备', () => {
  it('未超长时不截断', () => {
    expect(prepareState('你好')).toEqual({ state: '你好', truncated: false });
  });

  it('超长输入保留尾部并标注截断（取尾，避免丢掉末尾的问题）', () => {
    const input = `${'长'.repeat(MAX_STATE_CHARS + 50)}末尾的提问`;
    const prepared = prepareState(input);
    expect(prepared.truncated).toBe(true);
    expect(prepared.state.endsWith('末尾的提问')).toBe(true);
    expect(prepared.state.length).toBeLessThanOrEqual(MAX_STATE_CHARS);
  });

  it('截断点对齐到句首（去掉半句前缀）', () => {
    const input = `${'A'.repeat(300)}。${'B'.repeat(30)}`;
    const prepared = prepareState(input);
    expect(prepared.state).toBe('B'.repeat(30));
  });

  it('无标点可对齐时原样保留尾部', () => {
    const input = '字'.repeat(MAX_STATE_CHARS + 5);
    const prepared = prepareState(input);
    expect(prepared.state).toHaveLength(MAX_STATE_CHARS);
    expect(prepared.truncated).toBe(true);
  });

  it('候选超过总数上限时按原序截断并标注', () => {
    const many = Array.from({ length: MAX_CANDIDATES + 3 }, (_, i) => candidate(`tool_${i + 1}`));
    const picked = selectCandidates(many);
    expect(picked.truncated).toBe(true);
    expect(picked.candidates).toHaveLength(MAX_CANDIDATES);
    expect(picked.candidates[0]!.name).toBe('tool_1');
    expect(picked.candidates.at(-1)!.name).toBe(`tool_${MAX_CANDIDATES}`);
  });

  it('空候选返回空表', () => {
    expect(selectCandidates([])).toEqual({ candidates: [], truncated: false });
  });
});

describe('展示名', () => {
  it('label 优先，缺省回退工具名', () => {
    expect(displayNameOf(candidate('read_file', '读取文件'))).toBe('读取文件');
    expect(displayNameOf(candidate('read_file'))).toBe('read_file');
    expect(displayNameOf(candidate('read_file', '  '))).toBe('read_file');
  });

  it('展示名超长时截断', () => {
    expect(displayNameOf(candidate('x', '标'.repeat(MAX_DISPLAY_CHARS + 10)))).toHaveLength(
      MAX_DISPLAY_CHARS,
    );
  });
});

describe('命题构造', () => {
  it('每个候选一条 noul，qid = 工具名，正文用展示名', () => {
    const questions = buildQuestions(THREE);
    expect(Object.keys(questions)).toEqual(['order_query', 'capacity_query', 'bom_query']);
    expect(questions.order_query!.type).toBe('noul');
    expect(questions.order_query!.instructions).toBe('本轮用户发起的任务是否需要使用 查询订单 ？');
    expect(questions.order_query!.criteria).toEqual({
      true: '需要',
      false: '不需要',
    });
  });

  it('没有 label 时命题用工具名', () => {
    const questions = buildQuestions([candidate('erp__query_bom')]);
    expect(questions.erp__query_bom!.instructions).toContain('erp__query_bom');
  });

  it('空候选不构造任何命题', () => {
    expect(buildQuestions([])).toEqual({});
  });

  it('题面远低于单题 256 token 上限（32 题也不会 422）', () => {
    const many = Array.from({ length: MAX_QUESTIONS_PER_BATCH }, (_, i) =>
      candidate(`mcp__crm__query_customer_${i}`, `查询客户 ${i}`),
    );
    const questions = buildQuestions(many);
    for (const question of Object.values(questions)) {
      const total = question.instructions.length + 40;
      expect(total).toBeLessThanOrEqual(120);
    }
  });
});

describe('分批', () => {
  it('不超过单批上限时只有一批', () => {
    const batches = buildQuestionBatches(THREE);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.candidates).toHaveLength(3);
    expect(Object.keys(batches[0]!.questions)).toHaveLength(3);
  });

  it('超过单批上限时按 32 等分，末批可短', () => {
    const many = Array.from({ length: 70 }, (_, i) => candidate(`tool_${i + 1}`));
    const batches = buildQuestionBatches(many);
    expect(batches.map((b) => b.candidates.length)).toEqual([32, 32, 6]);
    const qids = batches.flatMap((b) => Object.keys(b.questions));
    expect(new Set(qids).size).toBe(70);
  });

  it('空候选不产生批次', () => {
    expect(buildQuestionBatches([])).toEqual([]);
  });
});

describe('分数 → 动作', () => {
  it('阈值以上的工具按分数降序入选，并铸成固定格式提示', () => {
    const selection = selectActions({
      candidates: THREE,
      scores: { order_query: 0.61, capacity_query: 0.87, bom_query: 0.09 },
      threshold: 0.5,
    });
    expect(selection.actions.map((a) => a.tools[0])).toEqual(['capacity_query', 'order_query']);
    expect(selection.focusPrompt).toBe(`${FOCUS_PROMPT_PREFIX}capacity_query，order_query`);
    expect(selection.dropped).toEqual(['bom_query']);
  });

  it('恰好等于阈值的工具入选（>= 而非 >）', () => {
    const selection = selectActions({
      candidates: THREE,
      scores: { order_query: 0.5 },
      threshold: 0.5,
    });
    expect(selection.actions).toHaveLength(1);
  });

  it('全部低于阈值 → 空动作、空提示', () => {
    const selection = selectActions({
      candidates: THREE,
      scores: { order_query: 0.1, capacity_query: 0.2, bom_query: 0.3 },
      threshold: 0.5,
    });
    expect(selection.actions).toEqual([]);
    expect(selection.focusPrompt).toBe('');
  });

  it('全量保留：命中几个就返回几个，不截断', () => {
    const many = Array.from({ length: 10 }, (_, i) => candidate(`tool_${i + 1}`));
    const scores = Object.fromEntries(many.map((c) => [c.name, 0.9]));
    const selection = selectActions({ candidates: many, scores, threshold: 0.5 });
    expect(selection.actions).toHaveLength(10);
    expect(selection.dropped).toEqual([]);
  });

  it('同分数按候选原序（确定性）', () => {
    const selection = selectActions({
      candidates: THREE,
      scores: { order_query: 0.8, capacity_query: 0.8, bom_query: 0.8 },
      threshold: 0.5,
    });
    expect(selection.actions.map((a) => a.tools[0])).toEqual([
      'order_query',
      'capacity_query',
      'bom_query',
    ]);
  });

  it('无效分数（非数字 / 缺键）被丢弃，不影响其它工具', () => {
    const selection = selectActions({
      candidates: THREE,
      scores: { order_query: Number.NaN, capacity_query: 0.9 } as unknown as Record<string, number>,
      threshold: 0.5,
    });
    expect(selection.actions.map((a) => a.tools[0])).toEqual(['capacity_query']);
    expect(selection.scores.order_query).toBeUndefined();
  });

  it('分数越界被收敛到 0~1', () => {
    const selection = selectActions({
      candidates: [candidate('a')],
      scores: { a: 1.7 },
      threshold: 0.5,
    });
    expect(selection.scores.a).toBe(1);
  });

  it('候选之外的键不参与入选', () => {
    const selection = selectActions({
      candidates: [candidate('a')],
      scores: { a: 0.1, ghost: 0.99 },
      threshold: 0.5,
    });
    expect(selection.actions).toEqual([]);
  });
});

describe('提示铸造', () => {
  it('无动作返回空串（不追加任何提示）', () => {
    expect(composeFocusPrompt([])).toBe('');
  });

  it('工具标识去重且保持顺序', () => {
    const prompt = composeFocusPrompt([
      { tools: ['order_query'], score: 0.9 },
      { tools: ['order_query', 'bom_query'], score: 0.8 },
    ]);
    expect(prompt).toBe(`${FOCUS_PROMPT_PREFIX}order_query，bom_query`);
  });
});

describe('处置判定', () => {
  it('开关关闭不产生记录', () => {
    expect(decideDisposition({ kind: 'disabled' })).toBeNull();
  });

  it('跳过 / 未配置 / 降级各自带原因', () => {
    expect(decideDisposition({ kind: 'skipped', reason: 'skip:preset_action' })).toEqual({
      disposition: 'skipped',
      reason: 'skip:preset_action',
    });
    expect(decideDisposition({ kind: 'unconfigured', reason: 'no_config' })).toEqual({
      disposition: 'unconfigured',
      reason: 'no_config',
    });
    expect(decideDisposition({ kind: 'failed', reason: 'timeout' })).toEqual({
      disposition: 'degraded',
      reason: 'timeout',
    });
  });

  it('无候选工具 → empty/no_tools（且不发起调用）', () => {
    expect(decideDisposition({ kind: 'ok', candidates: 0, selected: 0 })).toEqual({
      disposition: 'empty',
      reason: 'no_tools',
    });
  });

  it('有候选但全部低于阈值 → empty', () => {
    expect(decideDisposition({ kind: 'ok', candidates: 3, selected: 0 })).toEqual({
      disposition: 'empty',
      reason: 'below_threshold',
    });
  });

  it('有入选 → focused', () => {
    expect(decideDisposition({ kind: 'ok', candidates: 3, selected: 2 })).toEqual({
      disposition: 'focused',
      reason: null,
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  advanceBatch,
  appendSummary,
  classifyToolOutcome,
  createPlanState,
  recordToolCall,
  startBatch,
  type ToolCallFact,
} from '../../src/domain/plan/state.js';
import { REPLAN_MAX_PER_RUN, TOTAL_STEPS_MAX, type PlanStep } from '../../src/domain/plan/types.js';

function fact(overrides: Partial<ToolCallFact> = {}): ToolCallFact {
  return {
    callId: 'c1',
    toolName: 'rawmcp__QueryInventory',
    isError: false,
    errorCode: null,
    text: 'ok',
    ...overrides,
  };
}

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    seqId: 1,
    taskName: '查询库存',
    content: '内容',
    coreActionLabel: 'QueryInventory',
    coreAction: 'rawmcp__QueryInventory',
    type: 'query',
    dependTools: [],
    status: 'running',
    coreActionOk: false,
    attempts: 0,
    lastCoreActionTurn: -1,
    retryableStreak: 0,
    ...overrides,
  };
}

describe('classifyToolOutcome', () => {
  it('正常结果 → success', () => {
    expect(classifyToolOutcome(fact())).toBe('success');
  });

  it('前置函数缺失码 → retryable', () => {
    expect(
      classifyToolOutcome(fact({ isError: true, errorCode: 'ONTOLOGY_RULE_FUNCTIONS_MISSING' })),
    ).toBe('retryable');
  });

  it('规则拒绝码 / ABORTED → failed', () => {
    expect(classifyToolOutcome(fact({ isError: true, errorCode: 'ONTOLOGY_RULE_DENIED' }))).toBe('failed');
    expect(classifyToolOutcome(fact({ isError: true, errorCode: 'ABORTED' }))).toBe('failed');
  });

  it('SDK 无 code 的错误默认 retryable', () => {
    expect(classifyToolOutcome(fact({ isError: true, text: '参数不合法' }))).toBe('retryable');
  });

  it('仅 Tool <name> not found 不计入三态', () => {
    expect(classifyToolOutcome(fact({ isError: true, text: 'Tool rawmcp__X not found' }))).toBe('ignored');
    expect(classifyToolOutcome(fact({ isError: true, text: '工具 X 不存在' }))).toBe('retryable');
  });
});

describe('recordToolCall', () => {
  it('coreAction 成功 → 置 A 与 C 所需事实', () => {
    const state = createPlanState('目标');
    state.current = step();
    recordToolCall(state, fact(), 3);
    expect(state.current.coreActionOk).toBe(true);
    expect(state.current.lastCoreActionTurn).toBe(3);
    expect(state.current.attempts).toBe(1);
  });

  it('retryable 累加连续计数，成功清零', () => {
    const state = createPlanState('目标');
    state.current = step();
    recordToolCall(state, fact({ isError: true, errorCode: 'ONTOLOGY_RULE_FUNCTIONS_MISSING' }), 1);
    recordToolCall(state, fact({ isError: true, errorCode: 'ONTOLOGY_RULE_FUNCTIONS_MISSING' }), 2);
    expect(state.current.retryableStreak).toBe(2);
    recordToolCall(state, fact({ callId: 'c2' }), 3);
    expect(state.current.retryableStreak).toBe(0);
  });

  it('计划外工具记入 extraCalls（仅观测）', () => {
    const state = createPlanState('目标');
    state.current = step();
    recordToolCall(state, fact({ toolName: 'mcp__other__Thing' }), 1);
    expect(state.extraCalls).toEqual(['mcp__other__Thing']);
  });
});

describe('advanceBatch', () => {
  it('A 满足但 C 不满足 → 留驻，不出队', () => {
    const state = createPlanState('目标');
    startBatch(state, [step()]);
    recordToolCall(state, fact(), 1);
    const result = advanceBatch(state, { turnIndex: 1, coreOutcomes: ['success'] });
    expect(result.stepDone).toBe(false);
    expect(state.current?.status).toBe('running');
  });

  it('A + C 满足 → 完成、出队、追加摘要', () => {
    const state = createPlanState('目标');
    startBatch(state, [step(), step({ seqId: 2, taskName: '创建采购', coreAction: 'rawmcp__CreatePurchaseRecord', coreActionLabel: 'CreatePurchaseRecord', type: 'command' })]);
    recordToolCall(state, fact(), 1);
    const result = advanceBatch(state, { turnIndex: 2, coreOutcomes: ['success'], summaryText: '查到 3 种缺料' });
    expect(result.stepDone).toBe(true);
    expect(state.totalSteps).toBe(1);
    expect(state.doneSummary).toEqual(['查到 3 种缺料']);
    expect(state.current?.seqId).toBe(2);
    expect(state.current?.status).toBe('running');
  });

  it('模型正文为空时，摘要用「步骤名（行为名）已完成」兜底（2026-11-26）', () => {
    const state = createPlanState('目标');
    startBatch(state, [step()]);
    recordToolCall(state, fact(), 1);
    advanceBatch(state, { turnIndex: 2, coreOutcomes: ['success'], summaryText: '' });

    expect(state.doneSummary).toEqual(['查询库存（QueryInventory）已完成']);
  });

  it('连续 3 次 retryable → failed 并计一次失败重规划', () => {
    const state = createPlanState('目标');
    startBatch(state, [step()]);
    for (let turn = 1; turn <= 2; turn += 1) {
      recordToolCall(state, fact({ isError: true, errorCode: 'ONTOLOGY_RULE_FUNCTIONS_MISSING' }), turn);
    }
    expect(advanceBatch(state, { turnIndex: 2, coreOutcomes: ['retryable'] }).needsReplan).toBe(false);
    recordToolCall(state, fact({ isError: true, errorCode: 'ONTOLOGY_RULE_FUNCTIONS_MISSING' }), 3);
    const result = advanceBatch(state, { turnIndex: 3, coreOutcomes: ['retryable'] });
    expect(result.needsReplan).toBe(true);
    expect(state.replanCount).toBe(1);
  });

  it('failed → 立即失败并计重规划', () => {
    const state = createPlanState('目标');
    startBatch(state, [step()]);
    const result = advanceBatch(state, { turnIndex: 1, coreOutcomes: ['failed'] });
    expect(result.needsReplan).toBe(true);
    expect(state.replanCount).toBe(1);
  });

  it('指纹连续不变 → 卡死终止', () => {
    const state = createPlanState('目标');
    startBatch(state, [step()]);
    expect(advanceBatch(state, { turnIndex: 1, coreOutcomes: [] }).finish).toBeNull();
    expect(advanceBatch(state, { turnIndex: 2, coreOutcomes: [] }).finish).toBe('stalled');
  });

  it('总步数达 20 → steps_exhausted', () => {
    const state = createPlanState('目标');
    state.totalSteps = TOTAL_STEPS_MAX - 1;
    startBatch(state, [step()]);
    recordToolCall(state, fact(), 1);
    expect(advanceBatch(state, { turnIndex: 2, coreOutcomes: ['success'] }).finish).toBe('steps_exhausted');
  });

  it('失败重规划达 6 次 → replan_exhausted', () => {
    const state = createPlanState('目标');
    state.replanCount = REPLAN_MAX_PER_RUN - 1;
    startBatch(state, [step()]);
    expect(advanceBatch(state, { turnIndex: 1, coreOutcomes: ['failed'] }).finish).toBe('replan_exhausted');
  });

  it('正常滚动不计入 replanCount', () => {
    const state = createPlanState('目标');
    startBatch(state, [step()]);
    recordToolCall(state, fact(), 1);
    advanceBatch(state, { turnIndex: 2, coreOutcomes: ['success'] });
    state.queue = [];
    state.current = null;
    state.rollCount += 1;
    expect(state.replanCount).toBe(0);
    expect(state.rollCount).toBe(1);
  });
});

describe('appendSummary', () => {
  it('单条含省略号 ≤80 字，只保留最近 5 条', () => {
    const state = createPlanState('目标');
    appendSummary(state, '字'.repeat(100));
    expect(Array.from(state.doneSummary[0] ?? '').length).toBe(80);
    expect(state.doneSummary[0]?.endsWith('…')).toBe(true);

    for (const index of [0, 1, 2, 3, 4, 5]) appendSummary(state, `结论${index}`);
    expect(state.doneSummary).toHaveLength(5);
    expect(state.doneSummary[4]).toBe('结论5');
  });

  it('剥掉 Markdown 表格，只留结论句（2026-11-25 实测：表格被切在半个单元格上）', () => {
    const state = createPlanState('目标');
    appendSummary(
      state,
      '已完成库存查询： **高强度钢板（RM-001）** | 项目 | 数值 | |---|---| | 单位 | 吨 | | 可用库存 | 1810 | | 累计库存 | 2410',
    );

    expect(state.doneSummary).toEqual(['已完成库存查询： **高强度钢板（RM-001）**'.replace(/\s+/g, ' ')]);
    expect(state.doneSummary[0]).not.toContain('|');
  });

  it('截断优先退到断句点，不切在词中间', () => {
    const state = createPlanState('目标');
    appendSummary(state, `${'甲'.repeat(50)}，${'乙'.repeat(60)}`);

    const line = state.doneSummary[0] ?? '';
    expect(line.endsWith('，…')).toBe(true);
    expect(Array.from(line).length).toBeLessThanOrEqual(80);
  });

  it('整条都是表格时退回原文（不让结论消失）', () => {
    const state = createPlanState('目标');
    appendSummary(state, '| 项目 | 数值 | |---|---| | 可用库存 | 1810 |');

    expect(state.doneSummary).toHaveLength(1);
    expect(state.doneSummary[0]).toContain('可用库存');
  });

  it('「… **结果：** + 表格」只留实质结论，剥掉悬空引导语与复述开头（2026-11-26 实测）', () => {
    const state = createPlanState('目标');
    appendSummary(
      state,
      '当前这一步已执行完毕：查询原材料基本信息（QueryRawMaterials）。 **结果：** | 项目 | 数值 | |---|---| | 可用库存 | 1810 |',
      '查询原材料基本信息（QueryRawMaterials）已完成',
    );

    expect(state.doneSummary).toEqual(['查询原材料基本信息（QueryRawMaterials）。']);
  });

  it('剥完什么都不剩时用兜底句，不留空壳结论（2026-11-26）', () => {
    const state = createPlanState('目标');
    appendSummary(state, '**结果：** | 项目 | 数值 | |---|---| | 可用库存 | 1810 |', '查询库存（QueryInventory）已完成');

    expect(state.doneSummary).toEqual(['查询库存（QueryInventory）已完成']);
  });
});

/**
 * 写后失效（T502 / FR-024）：command 执行后 `invalidate()` 会把依赖它的函数记录
 * 打成「算过但不可见」。推进到下一步时若前置已过期，直接跑必然被闸门判缺前置而白耗一轮，
 * 所以必须在**推进点**识别并转失败重规划。
 */
describe('advanceBatch 的写后失效识别', () => {
  const COMMAND = step({
    seqId: 1,
    taskName: '创建采购单',
    coreAction: 'rawmcp__CreatePurchaseRecord',
    coreActionLabel: 'CreatePurchaseRecord',
    type: 'command',
  });
  const NEXT = step({
    seqId: 2,
    taskName: '提交审批',
    coreAction: 'rawmcp__SubmitApproval',
    coreActionLabel: 'SubmitApproval',
    type: 'command',
    status: 'pending',
    dependTools: ['rawmcp__sumRawNotArrivalQty'],
  });

  function afterCommand(isStale?: (toolName: string) => boolean) {
    const state = createPlanState('目标');
    startBatch(state, [COMMAND, NEXT]);
    recordToolCall(state, fact({ callId: 'c-1', toolName: COMMAND.coreAction }), 0);
    const result = advanceBatch(state, {
      turnIndex: 1,
      coreOutcomes: ['success'],
      ...(isStale !== undefined ? { isStale } : {}),
    });
    return { state, result };
  }

  it('依赖过期 → 转失败重规划，且不把该步标为失败', () => {
    const { state, result } = afterCommand((name) => name === 'rawmcp__sumRawNotArrivalQty');

    expect(result.stepDone).toBe(true);
    expect(result.needsReplan).toBe(true);
    expect(result.failedStep).toBeNull();
    expect(result.staleStep?.seqId).toBe(2);
    expect(result.staleFunctions).toEqual(['rawmcp__sumRawNotArrivalQty']);
    expect(state.replanCount).toBe(1);
    expect(state.rollCount).toBe(0);
    expect(state.current?.status).toBe('running');
  });

  it('依赖不过期 / 没有探测器 → 正常推进，零重规划', () => {
    expect(afterCommand(() => false).result.needsReplan).toBe(false);
    expect(afterCommand().result.needsReplan).toBe(false);
  });

  it('只有 dependTools 过期才算（coreAction 自身过期不触发）', () => {
    const { result } = afterCommand((name) => name === 'rawmcp__SubmitApproval');
    expect(result.needsReplan).toBe(false);
  });

  it('重规划次数已到上限 → 同批给出终止原因（软收尾）', () => {
    const state = createPlanState('目标');
    startBatch(state, [COMMAND, NEXT]);
    state.replanCount = REPLAN_MAX_PER_RUN - 1;
    recordToolCall(state, fact({ callId: 'c-1', toolName: COMMAND.coreAction }), 0);

    const result = advanceBatch(state, {
      turnIndex: 1,
      coreOutcomes: ['success'],
      isStale: () => true,
    });

    expect(result.needsReplan).toBe(true);
    expect(result.finish).toBe('replan_exhausted');
  });
});

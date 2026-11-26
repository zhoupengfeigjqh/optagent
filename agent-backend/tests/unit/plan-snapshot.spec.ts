/**
 * 单元测试：计划快照渲染（028 FR-016）。
 *
 * 守住的口径：
 * - 首行固定 `［执行进度］`，终态标签对齐到同一列，`running` 行带指向标记；
 * - `doneSummary` 最多 5 条；
 * - 总长 ≤ 1200 字符，**超限整行丢弃**（不留半截），`running` 行受保护；
 * - 快照可被 `isSnapshotText` 识别以便原地替换。
 */
import { describe, expect, it } from 'vitest';

import {
  applySnapshotMessage,
  isSnapshotText,
  renderSnapshot,
  SNAPSHOT_MARKER,
} from '../../src/domain/plan/snapshot.js';
import { SNAPSHOT_MAX_CHARS, type PlanStep } from '../../src/domain/plan/types.js';

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    seqId: 1,
    taskName: '查询库存',
    content: '内容',
    coreActionLabel: 'QueryInventory',
    coreAction: 'rawmcp__QueryInventory',
    type: 'query',
    dependTools: [],
    status: 'pending',
    coreActionOk: false,
    attempts: 0,
    lastCoreActionTurn: -1,
    retryableStreak: 0,
    ...overrides,
  };
}

describe('renderSnapshot', () => {
  it('逐字格式：头 / 步骤行 / 结论 / 约束', () => {
    const text = renderSnapshot({
      goal: '补采购',
      steps: [step({ seqId: 1, status: 'done' }), step({ seqId: 2, status: 'running', taskName: '创建采购', coreActionLabel: 'CreatePurchaseRecord' })],
      doneSummary: ['查到 3 种缺料'],
    });
    expect(text.startsWith(`${SNAPSHOT_MARKER}目标：补采购`)).toBe(true);
    expect(text).toContain('1. [done]    查询库存   QueryInventory');
    expect(text).toContain('2. [running] 创建采购   CreatePurchaseRecord   ← 你现在在这一步');
    expect(text).toContain('已完成结论：\n· 查到 3 种缺料');
    expect(text.endsWith('约束：只执行当前这一步；完成后系统会推进到下一步。')).toBe(true);
  });

  it('doneSummary 最多 5 条', () => {
    const text = renderSnapshot({
      goal: '目标',
      steps: [step({ status: 'running' })],
      doneSummary: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(text).not.toContain('· a');
    expect(text).toContain('· f');
  });

  it('超限整行丢弃，总长不超上限', () => {
    const steps = Array.from({ length: 60 }, (_, index) =>
      step({ seqId: index + 1, taskName: `步骤名称很长占位${index}`, status: index === 0 ? 'running' : 'pending' }),
    );
    const text = renderSnapshot({ goal: '目标', steps, doneSummary: [] });
    expect(Array.from(text).length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
    // 不留半截：每行都以步骤序号或固定文案开头
    for (const line of text.split('\n')) {
      if (line === '') continue;
      expect(/^(\d+\. |［执行进度］|约束：)/.test(line)).toBe(true);
    }
    // 当前步不可被丢
    expect(text).toContain('← 你现在在这一步');
  });

  it('isSnapshotText 可识别快照', () => {
    const text = renderSnapshot({ goal: '目标', steps: [step()], doneSummary: [] });
    expect(isSnapshotText(text)).toBe(true);
    expect(isSnapshotText('普通消息')).toBe(false);
  });
});

describe('applySnapshotMessage', () => {
  const base = [
    { role: 'user', content: '帮我补齐缺料采购' },
    { role: 'assistant', content: '先查库存' },
  ];

  it('找不到快照时追加一条，且不改入参', () => {
    const result = applySnapshotMessage(base, '［执行进度］目标：补采购');

    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ role: 'user', content: '［执行进度］目标：补采购' });
    expect(base).toHaveLength(2);
  });

  it('已有快照时原地替换（消息数不变，保留附加字段）', () => {
    const messages = [
      ...base,
      { role: 'user', content: '［执行进度］旧快照', timestamp: 1 },
      { role: 'assistant', content: '继续' },
    ];
    const result = applySnapshotMessage(messages, '［执行进度］新快照');

    expect(result).toHaveLength(4);
    expect(result[2]?.content).toBe('［执行进度］新快照');
    expect((result[2] as { timestamp?: number }).timestamp).toBe(1);
  });

  it('只替换最后一条快照，不误伤工具结果里的同名字样', () => {
    const messages = [
      { role: 'user', content: '［执行进度］旧 A' },
      { role: 'toolResult', content: '［执行进度］这是工具输出' },
      { role: 'user', content: '［执行进度］旧 B' },
    ];
    const result = applySnapshotMessage(messages, '［执行进度］新');

    expect(result[0]?.content).toBe('［执行进度］旧 A');
    expect(result[1]?.content).toBe('［执行进度］这是工具输出');
    expect(result[2]?.content).toBe('［执行进度］新');
  });
});

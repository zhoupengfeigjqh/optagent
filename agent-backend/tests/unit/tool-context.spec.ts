/**
 * 单元测试：工具记录的上下文投影（002 特性）
 *
 * 守住四条不变式：
 * 1. **只进 messages** —— 工具结果不进 systemPrompt（2026-11-07 删除索引段后不留残余）
 * 2. **预算有界** —— 从最近往前填，超出预算的降级为一行占位
 * 3. **占位不失联** —— 外置结果的占位带副本路径（模型才知道能 read_file 取回）
 * 4. **路径重算** —— 占位行路径由 `{threadId, callId}` 推导，不读数据里的路径
 */
import { describe, expect, it } from 'vitest';
import type { ToolCallRecord } from '../../src/domain/tool-events.js';
import {
  TOOL_REPLAY_BUDGET_BYTES,
  formatReplayBlock,
  selectReplay,
} from '../../src/domain/tool-context.js';
import { TOOL_INLINE_MAX_BYTES } from '../../src/domain/tool-result.js';

function record(partial: Partial<ToolCallRecord> & { callId: string }): ToolCallRecord {
  return {
    messageId: 'm_a1',
    name: 'read_file',
    status: 'success',
    startedAt: '2026-09-23T00:00:00.000Z',
    ...partial,
  } as ToolCallRecord;
}

describe('selectReplay —— 预算分配', () => {
  it('预算内的小结果回灌原文（时间正序返回）', () => {
    const selection = selectReplay(
      [record({ callId: 'c1', content: 'aaaa' }), record({ callId: 'c2', content: 'bbbb' })],
      'th1',
      { budgetBytes: 100 },
    );

    expect(selection.replay.map((r) => r.callId)).toEqual(['c1', 'c2']);
    expect(selection.placeholders).toHaveLength(0);
  });

  it('预算不足：从最近往前填，被挤出的降级为占位（不丢"曾经有结果"）', () => {
    const selection = selectReplay(
      [record({ callId: 'c1', content: 'aaaa' }), record({ callId: 'c2', content: 'bbbb' })],
      'th1',
      { budgetBytes: 5 },
    );

    expect(selection.replay.map((r) => r.callId)).toEqual(['c2']);
    expect(selection.placeholders.map((r) => r.callId)).toEqual(['c1']);
    expect(selection.placeholders[0]!.text).toContain('已省略');
  });

  it('running 记录不参与（无结果）；无正文的存量外置记录同样跳过', () => {
    const selection = selectReplay(
      [
        record({ callId: 'c1', status: 'running', content: '不完整' }),
        record({ callId: 'c2', artifactSize: 1843200 }),
        record({ callId: 'c3', content: 'ok' }),
      ],
      'th1',
    );

    expect(selection.replay.map((r) => r.callId)).toEqual(['c3']);
    expect(selection.placeholders).toHaveLength(0);
  });
});

describe('selectReplay —— 外置结果也走 messages', () => {
  it('截断版按预算回灌（与内置工具同一路径，不再另立索引）', () => {
    const truncated = 'x'.repeat(1024);
    const selection = selectReplay(
      [record({ callId: 'call_big', artifactSize: 1843200, truncated: true, content: truncated })],
      'th1',
    );

    expect(selection.replay).toHaveLength(1);
    expect(selection.replay[0]!.text).toBe(truncated);
  });

  it('被预算挤出时，占位行给出重算的副本路径（模型可 read_file 取回）', () => {
    const selection = selectReplay(
      [
        record({
          callId: 'call_big',
          artifactSize: 1843200,
          size: 1843200,
          truncated: true,
          content: 'x'.repeat(1024),
        }),
      ],
      'th1',
      { budgetBytes: 10 },
    );

    expect(selection.replay).toHaveLength(0);
    expect(selection.placeholders).toHaveLength(1);
    const text = selection.placeholders[0]!.text;
    expect(text).toContain('已省略');
    expect(text).toContain('1.8 MB');
    expect(text).toContain('临时空间/th1_toolresult_call_big.txt');
    expect(text).toContain('可用 read_file 读取');
  });

  it('内置工具的占位不带路径（磁盘上确实没有副本，不能给假地址）', () => {
    const selection = selectReplay(
      [record({ callId: 'c1', size: 40960, truncated: true, content: 'y'.repeat(1024) })],
      'th1',
      { budgetBytes: 10 },
    );

    const text = selection.placeholders[0]!.text;
    expect(text).toContain('已省略');
    expect(text).not.toContain('临时空间');
  });
});

describe('格式', () => {
  it('回灌块带工具名，便于模型区分来源', () => {
    expect(
      formatReplayBlock({ messageId: 'm1', callId: 'c1', name: 'grep', text: '命中 3 行' }),
    ).toBe('[工具 grep 结果]\n命中 3 行');
  });
});

describe('不变式：单条内联上限 ≤ 回灌总预算', () => {
  it('否则单条内联结果永远装不进预算，回灌会静默全部退化为占位', () => {
    expect(TOOL_INLINE_MAX_BYTES).toBeLessThanOrEqual(TOOL_REPLAY_BUDGET_BYTES);
  });
});

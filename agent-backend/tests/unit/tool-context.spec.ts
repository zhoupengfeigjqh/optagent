/**
 * 单元测试：工具记录的上下文投影（002 特性）
 *
 * 守住四条不变式：
 * 1. **预算有界** —— 从最近往前填，超出预算的内联结果降级为一行占位
 * 2. **外置只给索引** —— 正文永不进 prompt，只留名称/体积/摘要/路径
 * 3. **路径重算** —— 索引行路径由 `{threadId, callId}` 推导，不读数据里的路径
 * 4. **无内容即零成本** —— 没有外置结果时索引段是空串，不占一个字符
 */
import { describe, expect, it } from 'vitest';
import type { ToolCallRecord } from '../../src/domain/tool-events.js';
import { formatArtifactIndex, formatReplayBlock, selectReplay } from '../../src/domain/tool-context.js';

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
    expect(selection.index).toHaveLength(0);
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

  it('running 记录不参与（无结果）', () => {
    const selection = selectReplay(
      [record({ callId: 'c1', status: 'running', content: '不完整' }), record({ callId: 'c2', content: 'ok' })],
      'th1',
    );

    expect(selection.replay.map((r) => r.callId)).toEqual(['c2']);
  });
});

describe('selectReplay —— 外置结果只给索引', () => {
  it('外置结果进索引（含重算出的临时空间路径），正文不进 replay', () => {
    const selection = selectReplay(
      [
        record({
          callId: 'call_big',
          artifactSize: 1843200,
          summary: '识别到 12 页产能表',
        }),
      ],
      'th1',
    );

    expect(selection.replay).toHaveLength(0);
    expect(selection.index).toHaveLength(1);
    expect(selection.index[0]).toMatchObject({
      callId: 'call_big',
      size: 1843200,
      summary: '识别到 12 页产能表',
      relPath: '临时空间/th1_toolresult_call_big.txt',
    });
  });

  it('索引条数有上限：只保留最近的 N 条', () => {
    const records = Array.from({ length: 15 }, (_, i) =>
      record({ callId: `c${i}`, artifactSize: 1000 }),
    );

    const selection = selectReplay(records, 'th1', { indexMaxItems: 3 });
    expect(selection.index.map((r) => r.callId)).toEqual(['c12', 'c13', 'c14']);
  });
});

describe('格式', () => {
  it('回灌块带工具名，便于模型区分来源', () => {
    expect(formatReplayBlock({ messageId: 'm1', callId: 'c1', name: 'grep', text: '命中 3 行' })).toBe(
      '[工具 grep 结果]\n命中 3 行',
    );
  });

  it('无外置结果时索引段为空串（不占上下文）', () => {
    expect(formatArtifactIndex([])).toBe('');
  });

  it('索引段按"名称 · 体积 · 摘要 · 路径"排列', () => {
    const text = formatArtifactIndex([
      { callId: 'c1', name: 'ocr_image', size: 1843200, summary: '12 页', relPath: '临时空间/th1_toolresult_c1.txt' },
    ]);

    expect(text).toContain('read_file');
    expect(text).toContain('- ocr_image · 1.8 MB · 12 页 · 临时空间/th1_toolresult_c1.txt');
  });
});

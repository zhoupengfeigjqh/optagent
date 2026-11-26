import { describe, expect, it } from 'vitest';
import { buildPromptMessages, type PromptSources } from '../../src/domain/prompt-builder.js';
import type { HistoryMessage } from '../../src/types.js';

function msg(role: 'user' | 'assistant', content: string, id = 'm1'): HistoryMessage {
  return { role, content, id };
}

function sources(overrides: Partial<PromptSources> = {}): PromptSources {
  return {
    threadId: 't1',
    summaryData: { summary: '', coveredCount: 0 },
    allMessages: [],
    userMessage: msg('user', '帮我梳理昨天订单的交付风险'),
    records: [],
    producedText: '',
    ...overrides,
  };
}

describe('buildPromptMessages —— 请求级隐藏指引（004）', () => {
  it('有指引时进 systemExtra，且**只**进 systemExtra（不进 messages）', () => {
    const out = buildPromptMessages(
      sources({ guidance: '本轮请优先使用以下工具完成任务：erp__query_order' }),
    );

    expect(out.systemExtra).toBe('本轮请优先使用以下工具完成任务：erp__query_order');
    const last = out.messages[out.messages.length - 1];
    expect(last?.content).toBe('帮我梳理昨天订单的交付风险');
  });

  it('指引排在最后（紧邻用户消息，更容易被遵循）', () => {
    const out = buildPromptMessages(
      sources({
        summaryData: { summary: '早期摘要', coveredCount: 0 },
        producedText: '后台计算结果：xxx',
        guidance: '本轮请优先使用以下工具完成任务：read_file',
      }),
    );

    const extra = out.systemExtra ?? '';
    expect(extra.endsWith('本轮请优先使用以下工具完成任务：read_file')).toBe(true);
    expect(extra.indexOf('早期摘要')).toBeLessThan(extra.indexOf('本轮请优先使用'));
    expect(extra.indexOf('后台计算结果')).toBeLessThan(extra.indexOf('本轮请优先使用'));
  });

  it('无指引（缺省 / 空串）且无其它段 → 不产出 systemExtra', () => {
    expect(buildPromptMessages(sources()).systemExtra).toBeUndefined();
    expect(buildPromptMessages(sources({ guidance: '' })).systemExtra).toBeUndefined();
  });
});

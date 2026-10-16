/**
 * 单元测试：每轮注入 `【当前时间】` 段（契约 R18 / 002 `TR-29`）。
 *
 * 守住四件事：
 * 1. **格式与粒度**：`【当前时间】YYYY-MM-DD HH:mm:ss（周X，UTC±HH:MM）`，精确到秒；
 * 2. **位置**：后台产出段之后、`guidance` 之前（`guidance` 仍是末段，保持"本轮指令紧邻用户消息"）；
 * 3. **去向**：只进 `systemExtra`，MUST NOT 进 messages（用户气泡与 `history.jsonl` 保持干净）；
 * 4. **时钟由调用方注入**：纯函数层不读系统时钟——未传 `nowText` 时不注入该段（既有纯函数调用口径零变化）。
 */
import { describe, expect, it } from 'vitest';
import { formatCurrentTime } from '../../src/domain/message-format.js';
import { buildPromptMessages, type PromptSources } from '../../src/domain/prompt-builder.js';

/** 本地时区解析（ISO 串不带 Z 即按本地时区）——2026-10-14 是周三 */
const TIME = formatCurrentTime(new Date('2026-10-14T15:30:45'));

function sources(over: Partial<PromptSources> = {}): PromptSources {
  return {
    threadId: 'th1',
    summaryData: { summary: '', coveredCount: 0 },
    allMessages: [],
    userMessage: { role: 'user', content: '这批订单能按期交付吗' },
    records: [],
    producedText: '',
    ...over,
  };
}

describe('formatCurrentTime —— 当前时间段格式（R18）', () => {
  it('精确到秒 + 显式时区偏移 + 星期', () => {
    // 时区部分随运行环境而变，故只钉"结构 + 日期时间部分"
    expect(TIME).toMatch(/^【当前时间】2026-10-14 15:30:45（周三，UTC[+-]\d{2}:\d{2}）$/);
  });

  it('秒级差异可见（同一分钟内的两次调用不同）', () => {
    const a = formatCurrentTime(new Date('2026-10-14T15:30:45'));
    const b = formatCurrentTime(new Date('2026-10-14T15:30:46'));
    expect(a).not.toBe(b);
  });
});

describe('buildPromptMessages —— 当前时间段的拼装与去向', () => {
  it('段序：后台产出 → 当前时间 → guidance（guidance 仍是末段）', () => {
    const out = buildPromptMessages(
      sources({
        producedText:
          '【后台计算结果】（需要内容时用 read_file 按路径读取）\n- x · 已完成 · 1 KB · 临时空间/后台产出/a.json',
        nowText: TIME,
        guidance: '本轮请调用以下工具完成用户上一条消息要求的任务：erp__query_order（查询订单）。',
      }),
    );
    const extra = out.systemExtra ?? '';

    expect(extra.indexOf('【后台计算结果】')).toBeLessThan(extra.indexOf('【当前时间】'));
    expect(extra.indexOf('【当前时间】')).toBeLessThan(extra.indexOf('本轮请调用'));
    // guidance 仍是末段：本轮指令紧邻用户消息（R18 把时间放在它之前）
    expect(extra.split('\n\n').at(-1)).toContain('本轮请调用');
  });

  it('无 guidance 时当前时间即末段', () => {
    const extra = buildPromptMessages(sources({ nowText: TIME })).systemExtra ?? '';

    expect(extra).toContain('【当前时间】');
    expect(extra.split('\n\n').at(-1)).toBe(TIME);
  });

  it('只进 systemExtra，**不进 messages**（用户气泡与历史保持干净）', () => {
    const out = buildPromptMessages(sources({ nowText: TIME }));

    expect(out.systemExtra).toContain('【当前时间】');
    expect(out.messages.map((m) => m.content).join('\n')).not.toContain('【当前时间】');
  });

  it('未传 nowText（既有纯函数调用口径）→ 不注入该段', () => {
    expect(buildPromptMessages(sources()).systemExtra).toBeUndefined();
  });
});

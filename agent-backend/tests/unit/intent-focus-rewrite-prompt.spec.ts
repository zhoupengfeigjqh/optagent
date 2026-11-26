import { describe, expect, it } from 'vitest';
import {
  NEED_REWRITE_QID,
  REWRITE_MAX_CHARS,
  buildNeedRewriteQuestion,
  buildRewriteMessages,
  normalizeRewrite,
  pickRecentTurns,
  shouldRewrite,
  type RewriteHistoryMessage,
} from '../../src/domain/intent-focus/rewrite-prompt.js';

const msg = (
  role: 'user' | 'assistant',
  content: string,
  status?: 'completed' | 'failed',
): RewriteHistoryMessage => ({ role, content, ...(status ? { status } : {}) });

describe('buildNeedRewriteQuestion', () => {
  it('恒为 1 条 noul 命题，题面简短并带真假判据', () => {
    const question = buildNeedRewriteQuestion();

    expect(question.type).toBe('noul');
    expect(Array.from(question.instructions).length).toBeLessThanOrEqual(25);
    expect(question.criteria?.true).toContain('代指');
    expect(question.criteria?.false).toContain('自足');
  });

  it('题号是固定字面量（记录与桩都按它取分）', () => {
    expect(NEED_REWRITE_QID).toBe('need_rewrite');
  });
});

describe('shouldRewrite —— 严格大于阈值', () => {
  it('高于阈值 → 改写', () => {
    expect(shouldRewrite(0.81, 0.8)).toBe(true);
  });

  it('等于阈值 → 不改写（边界口径由本用例钉住）', () => {
    expect(shouldRewrite(0.8, 0.8)).toBe(false);
  });

  it('低于阈值 → 不改写', () => {
    expect(shouldRewrite(0.79, 0.8)).toBe(false);
  });

  it('null / undefined / NaN / Infinity → 不改写（判定不可用时不冒险）', () => {
    expect(shouldRewrite(null, 0.8)).toBe(false);
    expect(shouldRewrite(undefined, 0.8)).toBe(false);
    expect(shouldRewrite(Number.NaN, 0.8)).toBe(false);
    expect(shouldRewrite(Number.POSITIVE_INFINITY, 0.8)).toBe(false);
  });

  it('阈值为 0 时任何正分都改写（配置边界）', () => {
    expect(shouldRewrite(0.01, 0)).toBe(true);
    expect(shouldRewrite(0, 0)).toBe(false);
  });
});

describe('pickRecentTurns —— 最近 2 组完整问答轮', () => {
  it('无历史 → 空数组', () => {
    expect(pickRecentTurns([])).toEqual([]);
  });

  it('一组完整问答 → 一组（时间去空白）', () => {
    expect(pickRecentTurns([msg('user', ' 查库存 '), msg('assistant', ' 共 3 件 ')])).toEqual([
      { user: '查库存', assistant: '共 3 件' },
    ]);
  });

  it('超过 2 组时只取最近 2 组，且保持时间正序', () => {
    const messages = [
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      msg('user', 'u2'),
      msg('assistant', 'a2'),
      msg('user', 'u3'),
      msg('assistant', 'a3'),
      msg('user', 'u4'),
      msg('assistant', 'a4'),
    ];

    expect(pickRecentTurns(messages)).toEqual([
      { user: 'u3', assistant: 'a3' },
      { user: 'u4', assistant: 'a4' },
    ]);
  });

  it('过滤失败轮：assistant 为 failed 的整组不进素材', () => {
    const messages = [
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      msg('user', 'u2'),
      msg('assistant', 'a2', 'failed'),
    ];

    expect(pickRecentTurns(messages)).toEqual([{ user: 'u1', assistant: 'a1' }]);
  });

  it('过滤空正文（只有附件的轮次）与孤立 assistant', () => {
    const messages = [
      msg('assistant', '孤立助手'),
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      msg('user', '   '),
      msg('assistant', 'a2'),
    ];

    expect(pickRecentTurns(messages)).toEqual([{ user: 'u1', assistant: 'a1' }]);
  });

  it('尾部只有 user（本轮尚未有回复）时不会错配到上一条 assistant', () => {
    const messages = [msg('user', 'u1'), msg('assistant', 'a1'), msg('user', 'u2')];

    expect(pickRecentTurns(messages)).toEqual([{ user: 'u1', assistant: 'a1' }]);
  });

  it('连续 user 时向前跳过，不产生半组', () => {
    const messages = [
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      msg('user', 'u2'),
      msg('user', 'u3'),
      msg('assistant', 'a3'),
    ];

    expect(pickRecentTurns(messages)).toEqual([
      { user: 'u1', assistant: 'a1' },
      { user: 'u3', assistant: 'a3' },
    ]);
  });

  it('limit 可调（0 → 不取任何历史）', () => {
    const messages = [msg('user', 'u1'), msg('assistant', 'a1')];
    expect(pickRecentTurns(messages, 0)).toEqual([]);
  });
});

describe('buildRewriteMessages —— 恒 1 条 user 消息', () => {
  it('有历史时按模板拼装：最近对话在前、当前输入在后', () => {
    const messages = buildRewriteMessages(
      [
        { user: '查一下库存', assistant: '共 3 件' },
        { user: '那采购单呢', assistant: '有 2 张在途' },
      ],
      '请根据上述结果分析',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toBe(
      [
        '【最近对话】',
        '用户：查一下库存',
        '助手：共 3 件',
        '用户：那采购单呢',
        '助手：有 2 张在途',
        '',
        '【当前输入】',
        '请根据上述结果分析',
        '',
        '请只输出改写后的文本。',
      ].join('\n'),
    );
  });

  it('无历史时整个【最近对话】段省略（不是留下空标题）', () => {
    const messages = buildRewriteMessages([], '分析它');

    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).not.toContain('【最近对话】');
    expect(messages[0]!.content).toBe(
      ['【当前输入】', '分析它', '', '请只输出改写后的文本。'].join('\n'),
    );
  });
});

describe('normalizeRewrite —— 契约 §7 的七步', () => {
  it('去首尾空白', () => {
    expect(normalizeRewrite('  分析上批采购单  ')).toEqual({ text: '分析上批采购单', truncated: false });
  });

  it('剥代码围栏（含带语言标记的围栏）', () => {
    expect(normalizeRewrite('```\n分析上批采购单\n```').text).toBe('分析上批采购单');
    expect(normalizeRewrite('```text\n分析上批采购单\n```').text).toBe('分析上批采购单');
  });

  it('剥「改写为：」「重写:」「输出：」等前缀', () => {
    expect(normalizeRewrite('改写为：分析上批采购单').text).toBe('分析上批采购单');
    expect(normalizeRewrite('重写:分析上批采购单').text).toBe('分析上批采购单');
    expect(normalizeRewrite('输出：分析上批采购单').text).toBe('分析上批采购单');
    // 无冒号的"输出xxx"不是前缀格式，原样保留（避免误吃正文）
    expect(normalizeRewrite('输出分析上批采购单').text).toBe('输出分析上批采购单');
  });

  it('剥离成对包裹引号（ASCII / 中文 / 单引号 / 直角引号）', () => {
    expect(normalizeRewrite('"分析上批采购单"').text).toBe('分析上批采购单');
    expect(normalizeRewrite('“分析上批采购单”').text).toBe('分析上批采购单');
    expect(normalizeRewrite("'分析上批采购单'").text).toBe('分析上批采购单');
    expect(normalizeRewrite('「分析上批采购单」').text).toBe('分析上批采购单');
  });

  it('只引号不成句 → 归一为空串（调用方按 empty_output 处理）', () => {
    expect(normalizeRewrite('""').text).toBe('');
    expect(normalizeRewrite('   ').text).toBe('');
    expect(normalizeRewrite('```\n\n```').text).toBe('');
  });

  it('取第一条非空行（模型偶尔先输出一句说明）', () => {
    expect(normalizeRewrite('\n\n分析上批采购单\n以上是改写结果').text).toBe('分析上批采购单');
  });

  it('不强制问句：陈述句 / 指令原样保留，不补问号', () => {
    expect(normalizeRewrite('分析上批采购单的到货延迟').text).toBe('分析上批采购单的到货延迟');
    expect(normalizeRewrite('分析上批采购单的到货延迟').text).not.toContain('？');
  });

  it('按码点截断到 100：恰好 100 不截断，101 截断并置位', () => {
    const hundred = '字'.repeat(REWRITE_MAX_CHARS);
    expect(normalizeRewrite(hundred)).toEqual({ text: hundred, truncated: false });

    const overflow = '字'.repeat(REWRITE_MAX_CHARS + 1);
    const result = normalizeRewrite(overflow);
    expect(Array.from(result.text)).toHaveLength(REWRITE_MAX_CHARS);
    expect(result.truncated).toBe(true);
  });

  it('代理对（emoji）不被切开', () => {
    const emoji = '😀'.repeat(REWRITE_MAX_CHARS + 5);
    const result = normalizeRewrite(emoji);

    expect(Array.from(result.text)).toHaveLength(REWRITE_MAX_CHARS);
    expect(result.text).toBe('😀'.repeat(REWRITE_MAX_CHARS));
    expect(result.truncated).toBe(true);
  });
});

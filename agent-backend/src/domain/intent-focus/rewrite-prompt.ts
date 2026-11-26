import type { SystemOneQuestion } from '../../infra/laya-client.js';

export const NEED_REWRITE_QID = 'need_rewrite';

/** 改写结果字符上限（按 **Unicode 码点**计数，不是 UTF-16 长度） */
export const REWRITE_MAX_CHARS = 100;

/**
 * 参与改写的历史问答轮数上限（2 组 = 至多 4 条消息）。
 *
 * 2026-11-20 由 3 收紧为 2：更早的轮次对指代消解的边际收益很低，
 * 却按"每条正文全量"占用改写请求的输入长度；收紧后改写请求更短、更快。
 */
export const REWRITE_HISTORY_TURNS = 2;

/**
 * 改写助手的系统提示词（契约 §6 逐字口径）。
 *
 * 三句否定式（不要解释 / 不要加引号 / 不要多余内容）不是凑字数：
 * 实测模型最爱加"改写结果："前缀与书名号，两者都会被归一化剥掉——
 * 先在提示词里禁止，能减少一次无意义的截断。
 * 末句"可以是陈述句、指令或问句"是明确的产品要求（规格：不强制问句）。
 */
export const REWRITE_SYSTEM_PROMPT =
  '你是输入改写助手。把用户给的“当前输入”改写成一段简洁、清晰、可独立理解的表述，' +
  '不要解释、不要加引号、不要输出多余内容，不超过 100 字。' +
  '改写结果可以是陈述句、指令或问句，不要强行改成问句。';

/** 历史消息的结构子集（`HistoryStore.readAll` 的投影，避免域层依赖整份 HistoryMessage） */
export interface RewriteHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  status?: 'completed' | 'failed';
}

export interface RewriteTurn {
  user: string;
  assistant: string;
}

export function buildNeedRewriteQuestion(): SystemOneQuestion {
  return {
    type: 'noul',
    instructions: '该输入含有明确代指，需结合上文才能理解',
    criteria: {
      true: '含明确代指词（如上文、上述、这个、它、该结果）',
      false: '语义自足，不依赖上文即可理解',
    },
  };
}

export function shouldRewrite(score: number | null | undefined, threshold: number): boolean {
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  return score > threshold;
}

export function pickRecentTurns(
  messages: readonly RewriteHistoryMessage[],
  limit: number = REWRITE_HISTORY_TURNS,
): RewriteTurn[] {
  const usable = messages.filter(
    (message) => message.status !== 'failed' && message.content.trim() !== '',
  );
  const turns: RewriteTurn[] = [];
  let index = usable.length - 1;
  while (index >= 0 && turns.length < limit) {
    const assistant = usable[index]!;
    const user = index > 0 ? usable[index - 1]! : null;
    if (user && assistant.role === 'assistant' && user.role === 'user') {
      turns.push({ user: user.content.trim(), assistant: assistant.content.trim() });
      index -= 2;
      continue;
    }
    index -= 1;
  }
  return turns.reverse();
}

/**
 * 拼装改写请求的消息（**恒为 1 条 user 消息**，契约 §6）。
 *
 * 为什么塞进一条而不是多轮：多轮会被主模型的对话格式带上角色语义，
 * 模型可能"续写"最后一句而不是改写；单条模板让它只做文字改写这一件事，
 * 也让测试能逐字断言素材。
 */
export function buildRewriteMessages(
  turns: readonly RewriteTurn[],
  current: string,
): Array<{ role: 'user'; content: string }> {
  const lines: string[] = [];
  if (turns.length > 0) {
    lines.push('【最近对话】');
    for (const turn of turns) {
      lines.push(`用户：${turn.user}`, `助手：${turn.assistant}`);
    }
    lines.push('');
  }
  lines.push('【当前输入】', current, '', '请只输出改写后的文本。');
  return [{ role: 'user', content: lines.join('\n') }];
}

export interface NormalizedRewrite {
  text: string;
  truncated: boolean;
}

const FENCED_RE = /^```[^\n]*\r?\n([\s\S]*?)\r?\n```$/;

const PREFIX_RE = /^(?:改写|重写|输出)为?[：:]\s*/;

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ['“', '”'],
  ["'", "'"],
  ['「', '」'],
];

const FENCE_LINE_RE = /^```[\w-]*$/;

export function normalizeRewrite(raw: string): NormalizedRewrite {
  let text = raw.trim();

  const fenced = FENCED_RE.exec(text);
  if (fenced) text = fenced[1]!.trim();

  text = text.replace(PREFIX_RE, '').trim();

  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, text.length - close.length).trim();
      break;
    }
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '' && !FENCE_LINE_RE.test(line));
  text = (firstLine ?? '').trim();

  const chars = Array.from(text);
  const truncated = chars.length > REWRITE_MAX_CHARS;
  return {
    text: truncated ? chars.slice(0, REWRITE_MAX_CHARS).join('') : text,
    truncated,
  };
}

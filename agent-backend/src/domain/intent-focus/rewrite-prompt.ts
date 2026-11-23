/**
 * 指代改写（027）的**纯函数**层：命题构造、素材取材、消息拼装、输出归一化。
 *
 * 为什么单独成文件（宪章原则二）：这几个函数是"可逐项断言的文字处理"，
 * 与编排（`rewrite.ts` 的开关 / 预算 / 降级）没有共同职责；混在一起时，
 * 任何一处文案调整都要跑一遍带 IO 的编排测试。
 *
 * **本文件 MUST 保持纯函数**（无 IO、无时钟、无随机）：同输入必得同输出。
 * 模板常量的唯一落点也在这里（契约 §6）：素材格式只允许有一份实现。
 */
import type { SystemOneQuestion } from '../../infra/laya-client.js';

/** 指代判定题的固定题号（记录与断言都按它取分） */
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
  /** 缺省视为完成；`failed` 的轮次不进素材 */
  status?: 'completed' | 'failed';
}

/** 一组完整问答轮 */
export interface RewriteTurn {
  user: string;
  assistant: string;
}

/**
 * 构造指代判定命题（单条 `noul`，恒 1 题）。
 *
 * 题面控制在 25 字以内（实测越长越糟，见 `laya-client.ts` 的 SystemOneQuestion 注释）；
 * `criteria` 用朴素措辞并**给出代词例子**：不给例子时"该结果"这类词会被判成自足。
 */
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

/**
 * 是否应当改写：**严格大于**阈值（等号不改写）。
 *
 * 严格大于而非大于等于：阈值语义是"至少这么有把握"，
 * 等号边界上多一次模型调用不划算；该口径由单元测试钉住（契约 §5）。
 */
export function shouldRewrite(score: number | null | undefined, threshold: number): boolean {
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  return score > threshold;
}

/**
 * 取最近 N 个**完整问答轮**（时间正序返回）。
 *
 * 从尾部向前配对，三条过滤规则（data-model §3.4）：
 * - `status === 'failed'` 的轮次整体跳过（失败轮没有可参考的助手回复）；
 * - 空正文跳过（附件轮可能只有附件、没有文字）；
 * - assistant 没有前置 user 时丢弃（脏历史里出现过孤立 assistant 行）。
 *
 * 不在这里做去重 / 相似度过滤：素材是"最近说了什么"，不是"哪句最相关"。
 */
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
    // 无法配对（孤立 assistant / 连续 user）：向前挪一条，不推进结论
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

/** 归一化结果；`truncated` 表示因超 100 码点被截断 */
export interface NormalizedRewrite {
  text: string;
  truncated: boolean;
}

/** 代码围栏：整段被 ``` 包裹时去掉围栏行 */
const FENCED_RE = /^```[^\n]*\r?\n([\s\S]*?)\r?\n```$/;

/** 模型爱加的前缀（"改写为：" / "输出:" …） */
const PREFIX_RE = /^(?:改写|重写|输出)为?[：:]\s*/;

/** 成对包裹的引号：ASCII 双引号 / 中文双引号 / 单引号 / 直角引号 */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ['“', '”'],
  ["'", "'"],
  ['「', '」'],
];

/** 需要整行丢弃的围栏残行（``` 与 ```json） */
const FENCE_LINE_RE = /^```[\w-]*$/;

/**
 * 归一化改写输出（契约 §7 的七步，顺序不可调换）。
 *
 * 关键取舍：
 * - **按码点截断**（`Array.from`）而不是 `slice`：emoji / 生僻字是代理对，
 *   按 UTF-16 切会切出半个字符（写入 JSONL 后即成乱码）；
 * - **取第一条非空行**：模型偶尔先输出一行"以下是改写结果"，那句不是改写内容；
 * - **不补问号、不转问句**：规格明确禁止（改写可以是陈述句或指令）。
 */
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

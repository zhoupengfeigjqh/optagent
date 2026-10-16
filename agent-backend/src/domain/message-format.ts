/**
 * 消息标识与 LLM 上下文化（002 特性拆分：run-manager 单文件 ≤500 行，宪章原则二）。
 *
 * 这些是**无状态纯函数**：生成消息 id、把 `@` 引用渲染成提交给模型的引用段。
 * 与 `history.jsonl` 的落盘格式无关——落盘行的 `content` 始终保持纯净
 * （引用只在提交 LLM 时追加，见 `toLlmContent`）。
 */
import type { FileReference, HistoryMessage } from '../types.js';

/** 消息 ID：m_{base36时间戳}_{4位随机} */
export function genMessageId(now: number): string {
  return `m_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 引用段文本：提交给 LLM 时追加在 user content 末尾（历史行本体保持纯净）。
 *  统一只给 user-data 相对路径：内置工具与 MCP 工具（file_args 转换）同口径 */
export function refsText(attachments: FileReference[]): string {
  return `\n[引用文件] ${attachments.map((a) => `${a.dir}/${a.filename}`).join('；')}`;
}

/** LLM 上下文消息：user 消息若有 @ 引用则追加引用段 */
export function toLlmContent(m: HistoryMessage): string {
  return m.attachments && m.attachments.length > 0
    ? m.content + refsText(m.attachments)
    : m.content;
}

/** 毫秒 → 秒（保留小数，契约里的 `duration_seconds`） */
export function toSeconds(ms: number): number {
  return Math.round(ms) / 1000;
}

/**
 * 当前时间段（契约 R18）：`【当前时间】2026-10-14 15:30:45（周三，UTC+08:00）`。
 *
 * **每轮现算**：由调用方（`run-manager.buildPrompt`）读时钟后传入，本函数本身是纯函数
 * （`prompt-builder` 不读系统时钟，保住"同输入 → 同输出"的可测性）。
 *
 * 时区取运行环境**本地时区**并**显式标注偏移**：容器时区若不是东八区，模型仍能据此换算；
 * 需要固定北京时间请给运行环境设 `TZ=Asia/Shanghai`（无需改代码）。
 */
export function formatCurrentTime(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const offsetMin = -d.getTimezoneOffset(); // 东八区 = +480
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const tz = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const week = '日一二三四五六'[d.getDay()] ?? '';
  return `【当前时间】${ymd} ${hms}（周${week}，${tz}）`;
}

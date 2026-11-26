import type { FileReference, HistoryMessage } from '../types.js';

export function genMessageId(now: number): string {
  return `m_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function refsText(attachments: FileReference[]): string {
  return `\n[引用文件] ${attachments.map((a) => `${a.dir}/${a.filename}`).join('；')}`;
}

export function toLlmContent(m: HistoryMessage): string {
  return m.attachments && m.attachments.length > 0
    ? m.content + refsText(m.attachments)
    : m.content;
}

/** 毫秒 → 秒（保留小数，契约里的 `duration_seconds`） */
export function toSeconds(ms: number): number {
  return Math.round(ms) / 1000;
}

export function formatCurrentTime(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const tz = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const week = '日一二三四五六'[d.getDay()] ?? '';
  return `【当前时间】${ymd} ${hms}（周${week}，${tz}）`;
}

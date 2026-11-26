/**
 * 计划快照渲染（028 FR-016 / data-model §9）。
 *
 * 快照是「模型每一轮都能看到的执行进度」，因此：
 * - 固定在单条消息内，**替换**而非追加（避免上下文膨胀）；
 * - 总长 ≤ `SNAPSHOT_MAX_CHARS`，超限**整行丢弃**，不留半截；
 * - 终态标签对齐到同一列，`doing` 行带指向标记。
 */
import { SNAPSHOT_MAX_CHARS, SUMMARY_KEEP, type PlanStep } from './types.js';

/** 快照首行标记（用于定位并替换上一条快照） */
export const SNAPSHOT_MARKER = '［执行进度］';

/** 「你现在在这一步」的指向标记（截断时受保护，不会被优先丢弃） */
const CURRENT_MARK = '← 你现在在这一步';

/** 尾部固定约束 */
const TAIL = '约束：只执行当前这一步；完成后系统会推进到下一步。';

/** 渲染输入 */
export interface SnapshotInput {
  goal: string;
  /** 本批全部步骤（含已完成的），按执行顺序 */
  steps: readonly PlanStep[];
  /** 已完成结论（超出 `SUMMARY_KEEP` 的旧条目自动丢弃） */
  doneSummary: readonly string[];
}

/**
 * 渲染快照文本。
 *
 * 超限时按「先丢结论、再丢待办步骤行」的顺序收缩；头部与尾部约束始终保留。
 */
export function renderSnapshot(input: SnapshotInput): string {
  const stepLines = input.steps.map((step, index) => renderStepLine(step, index + 1));
  const summaryLines = input.doneSummary.slice(-SUMMARY_KEEP).map((line) => `· ${line}`);

  const steps = [...stepLines];
  const summaries = [...summaryLines];
  while (charLength(assemble(input.goal, steps, summaries)) > SNAPSHOT_MAX_CHARS) {
    if (summaries.length > 0) {
      summaries.shift();
      continue;
    }
    const removable = lastRemovableIndex(steps);
    if (removable < 0) break;
    steps.splice(removable, 1);
  }

  return assemble(input.goal, steps, summaries);
}

/** 判断一段文本是否是快照（用于替换定位） */
export function isSnapshotText(text: string): boolean {
  return text.trimStart().startsWith(SNAPSHOT_MARKER);
}

/** 结构最小化的消息（避免 domain 依赖 pi 的消息类型） */
interface SnapshotHost {
  role?: string;
  content?: unknown;
}

/**
 * 把快照放进消息数组：找到最后一条快照消息**原地替换**，没有则追加（FR-016）。
 *
 * 只认「`role: 'user'` + 字符串正文 + 以标记开头」，因此不会误伤工具结果里的同名字样。
 */
export function applySnapshotMessage<M extends SnapshotHost>(messages: readonly M[], snapshot: string): M[] {
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index];
    if (message?.role === 'user' && typeof message.content === 'string' && isSnapshotText(message.content)) {
      next[index] = { ...message, content: snapshot };
      return next;
    }
  }
  next.push({ role: 'user', content: snapshot } as M);
  return next;
}

function assemble(goal: string, stepLines: readonly string[], summaryLines: readonly string[]): string {
  const blocks = [`${SNAPSHOT_MARKER}目标：${goal}`, stepLines.join('\n')];
  if (summaryLines.length > 0) blocks.push(`已完成结论：\n${summaryLines.join('\n')}`);
  blocks.push(TAIL);
  return blocks.filter((block) => block !== '').join('\n\n');
}

function renderStepLine(step: PlanStep, ordinal: number): string {
  const tag = `[${step.status}]`.padEnd(10, ' ');
  const base = `${ordinal}. ${tag}${step.taskName}   ${step.coreActionLabel}`;
  return step.status === 'running' ? `${base}   ${CURRENT_MARK}` : base;
}

/** 最后一条可丢弃的行（`doing` 行不丢，它是当前进度） */
function lastRemovableIndex(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string;
    if (!line.includes(CURRENT_MARK)) return index;
  }
  return -1;
}

/** 按字符数计长（与 `check.ts` 同一口径） */
function charLength(text: string): number {
  return Array.from(text).length;
}

/**
 * 规划输出容错解析（028 FR-006/FR-004a）。
 *
 * 只做"把文本变成 `RawStep[]`"，**不做任何推断修补**：
 * - 围栏（```` ```json ````）剥离，前后空白忽略；
 * - JSON 非法 / 顶层非数组 / 步数超上限 / 字段缺失或类型错，一律返回结构化失败；
 * - 空数组 `[]` 是**合法输出**（首次 = 无需工具，滚动 = 已完成，见 FR-004a），
 *   不在这里判语义，由编排器按场景处理。
 */
import { PLAN_MAX_STEPS, type CheckFailure, type RawStep } from './types.js';

/** 解析结果 */
export type ParseResult =
  | { ok: true; steps: RawStep[] }
  | { ok: false; failure: CheckFailure };

/** 首个代码围栏内的内容（语言标记可省） */
const FENCE_PATTERN = /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/;

/**
 * 解析规划输出。
 *
 * @param text 模型原始回复（可能带围栏与前后空白）
 */
export function parsePlanOutput(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return fail('P_JSON', '输出为空，应为 JSON 数组');

  const payload = extractFenced(trimmed).trim();
  if (payload === '') return fail('P_JSON', '代码围栏内为空');

  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return fail('P_JSON', '不是合法 JSON');
  }

  if (!Array.isArray(data)) return fail('P_ARRAY', '顶层必须是 JSON 数组');

  if (data.length > PLAN_MAX_STEPS) {
    return fail('P_STEPS', `一次给出 ${data.length} 步，超过上限 ${PLAN_MAX_STEPS} 步`);
  }

  const steps: RawStep[] = [];
  for (let index = 0; index < data.length; index += 1) {
    const parsed = readStep(data[index], index);
    if (!parsed.ok) return parsed;
    steps.push(parsed.step);
  }
  return { ok: true, steps };
}

/** 取出首个围栏内容；无围栏时返回原文 */
function extractFenced(text: string): string {
  const matched = FENCE_PATTERN.exec(text);
  return matched === null ? text : (matched[1] ?? '');
}

/** 单条步骤的形状校验（不做默认值填充） */
function readStep(
  item: unknown,
  index: number,
): { ok: true; step: RawStep } | { ok: false; failure: CheckFailure } {
  const seqId = index + 1;
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return { ok: false, failure: fieldFail(seqId, null, `第 ${seqId} 项不是对象`) };
  }
  const record = item as Record<string, unknown>;

  const rawSeqId = record['seqId'];
  if (typeof rawSeqId !== 'number' || !Number.isFinite(rawSeqId)) {
    return { ok: false, failure: fieldFail(seqId, 'seqId', `第 ${seqId} 项缺少数值型 seqId`) };
  }

  for (const field of ['taskName', 'content', 'coreAction'] as const) {
    const value = record[field];
    if (typeof value !== 'string' || value.trim() === '') {
      return { ok: false, failure: fieldFail(seqId, field, `第 ${seqId} 项缺少非空字符串 ${field}`) };
    }
  }

  const type = record['type'];
  if (typeof type !== 'string' || type.trim() === '') {
    return { ok: false, failure: fieldFail(seqId, 'type', `第 ${seqId} 项缺少字符串 type`) };
  }

  return {
    ok: true,
    step: {
      seqId: rawSeqId,
      taskName: String(record['taskName']),
      content: String(record['content']),
      coreAction: String(record['coreAction']),
      type: type.trim(),
    },
  };
}

function fail(code: string, detail: string): ParseResult {
  return { ok: false, failure: { code, seqId: null, field: null, detail } };
}

function fieldFail(seqId: number, field: string | null, detail: string): CheckFailure {
  return { code: 'P_FIELD', seqId, field, detail };
}

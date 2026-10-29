/**
 * SOUL 设计态字段的**拒绝式读取器**（013 收尾时从 `soul-design.ts` 外移）。
 *
 * 为什么单独成文件：这些函数是「管理员填什么就存什么，填错就当场拒绝」的统一口径，
 * 与 SOUL 的**渲染**（`renderSoulMd`）和**归一化编排**（`normalizeSoulDesign`）是两件事。
 * 放在一起会让 `soul-design.ts` 顶到 510 行（超宪章 500 行门禁），也让
 * "一个字段怎么校验"需要在 500 行里翻找。
 *
 * 共同约定（与 007 / 013 的开关字段一脉相承）：
 * - **只对键缺失落缺省**：`undefined` 是"老文档没有这个键"，`null` 是"显式给了个空值"，后者一律拒绝；
 * - 不做隐式转换（`"3"` 不是 `3`、`"true"` 不是 `true`）、不做 round / clamp；
 * - 报错一律 `VALIDATION_FAILED`，文案带**字段名 + 合法区间 + 当前值**，管理员能照着改。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { SOUL_LIMITS } from './soul-limits.js';

/** 必填文本：去首尾空白后不得为空，且不超过 `max` 字 */
export function readRequiredText(raw: unknown, label: string, max: number): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}必填且不能为空`);
  }
  assertLength(text, label, max);
  return text;
}

/**
 * 布尔字段（007 / 013 的开关）。
 *
 * 三态口径与其它字段一致（**拒绝式校验**）：
 * - 键**缺失**（`undefined`）→ 缺省 `false`：老表单 / 存量文档不带这个键，照常保存；
 * - `true` / `false` → 原样；
 * - 其余（字符串 `"true"`、数字 `1`、`null`…）→ **拒绝**，不做隐式转换——
 *   `"false"` 这类值一旦被当成真值，界面显示关闭而运行环境已开启，属于最难排查的错配。
 */
export function readBool(raw: unknown, label: string): boolean {
  if (raw === undefined) return false;
  if (typeof raw !== 'boolean') {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${label}须为布尔值（true / false，当前：${JSON.stringify(raw)}）`,
    );
  }
  return raw;
}

/**
 * 提示条数（007）：正整数，1~`SOUL_LIMITS.nextActionHintsMax`，缺省 `SOUL_LIMITS.nextActionHintsDefault`。
 *
 * **拒绝式**，不做自动纠正（不四舍五入、不 clamp、不把 `"3"` 当 `3`）：
 * 管理员填错时应当立刻看到"保存被拒"，而不是存下一个与界面显示不一致的数字——
 * 这个数字直接决定后台生成几条提示、以及多花多少 token，静默改写属于最难的错配。
 */
export function readPositiveInt(raw: unknown): number {
  const { nextActionHintsMin: min, nextActionHintsMax: max, nextActionHintsDefault: fallback } = SOUL_LIMITS;
  // **只有键缺失**才落缺省（与 `readBool` 的口径一致）；`null` 按非法拒绝
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `下一步动作提示条数须为 ${min}~${max} 的整数（当前：${JSON.stringify(raw)}）`,
    );
  }
  return raw;
}

/** 可选文本：缺省 / `null` → `''`；非字符串拒绝；超长拒绝 */
export function readOptionalText(raw: unknown, label: string, max: number): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}须为字符串`);
  }
  const text = raw.trim();
  if (text === '') return '';
  assertLength(text, label, max);
  return text;
}

/** 长度上限（中文按字符数，与界面计数一致） */
export function assertLength(text: string, label: string, max: number): void {
  if (text.length > max) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}不得超过 ${max} 字（当前 ${text.length} 字）`);
  }
}

/** 字符串数组：非空、限长、去重（重复即拒，避免"配了两遍"的隐性错误） */
export function readTextList(raw: unknown, label: string, maxItemLength: number): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}须为字符串数组`);
  }
  if (raw.length > SOUL_LIMITS.listItems) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${label}最多 ${SOUL_LIMITS.listItems} 项（当前 ${raw.length} 项）`,
    );
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}含空值或非字符串项`);
    }
    const text = item.trim();
    if (text.length > maxItemLength) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `${label}单项不得超过 ${maxItemLength} 字：「${truncate(text)}」`,
      );
    }
    if (out.includes(text)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}含重复项：${text}`);
    }
    out.push(text);
  }
  return out;
}

/** 报错文案里的短摘要（避免把整段配置贴进错误信息） */
export function truncate(text: string, max = 20): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

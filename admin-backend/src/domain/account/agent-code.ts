/**
 * 数字人服务编码生成（028 §17，2026-11-27）。
 *
 * **语义**：`code` 是服务对外的**不可变标识**（注册链接、审计、用户来源都引用它），
 * 与 `platform_agent_name`（平台设计态数字人名 = 部署落点）是两个字段，不可合并。
 * 平台是编码的**唯一权威生成者**：调用方可以不传 `code`，但 MUST 以响应里的值为准。
 *
 * **形态**：`DH-` + 5 位 Crockford Base32（30 个字符，去掉易混的 `I/L/O/U/0/1`），
 * 共 30^5 ≈ 2430 万组合。去混淆是刻意的——编码会被贴进注册链接、口头传达、手工输入。
 * 长度 8 位既短到可读，又远离碰撞。
 *
 * **唯一性**：先查重再返回；查重与落库之间的极端并发由上层（`agent-services.ts`）
 * 以"插入冲突 → 重新生成"的有界重试兜住，绝不静默覆盖既有服务。
 */
import { randomInt } from 'node:crypto';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

/** 编码前缀：`DH` = Digital Human，与既有历史编码（`DH-BOM001` 等）同惯例 */
export const AGENT_CODE_PREFIX = 'DH-';

/** 随机段长度 */
export const AGENT_CODE_BODY_LENGTH = 5;

/** 随机段字符集：Crockford Base32 去掉 `I/L/O/U/0/1`（易与 1/0 混淆） */
export const AGENT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 单次生成的最大查重次数（30^5 空间下 8 次全撞的概率可忽略） */
export const AGENT_CODE_MAX_ATTEMPTS = 8;

/** 随机源：`[0, maxExclusive)`；注入以便单测可复现 */
export type RandomInt = (maxExclusive: number) => number;

export interface GenerateAgentCodeOptions {
  /** 该编码是否已被占用（查重；由调用方决定查哪儿） */
  isTaken: (code: string) => boolean | Promise<boolean>;
  /** 随机源，默认 `crypto.randomInt` */
  random?: RandomInt;
  /** 最大尝试次数，默认 `AGENT_CODE_MAX_ATTEMPTS` */
  attempts?: number;
}

/** 生成一个候选编码（不查重） */
export function randomAgentCode(random: RandomInt = (max) => randomInt(max)): string {
  let body = '';
  for (let index = 0; index < AGENT_CODE_BODY_LENGTH; index += 1) {
    body += AGENT_CODE_ALPHABET[random(AGENT_CODE_ALPHABET.length)];
  }
  return `${AGENT_CODE_PREFIX}${body}`;
}

/**
 * 生成一个**未被占用**的编码。
 *
 * 生成失败（连续 `attempts` 次全撞）属于平台内部问题，不是调用方的输入错误，
 * 因此抛 `INTERNAL_ERROR`（500）而不是 `VALIDATION_FAILED`（400）。
 */
export async function generateAgentCode(options: GenerateAgentCodeOptions): Promise<string> {
  const { isTaken, random, attempts = AGENT_CODE_MAX_ATTEMPTS } = options;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = randomAgentCode(random);
    if (!(await isTaken(code))) return code;
  }
  throw new ApiError(
    ERROR_CODES.INTERNAL_ERROR,
    `数字人服务编码生成失败（连续 ${attempts} 次均已被占用），请重试`,
  );
}

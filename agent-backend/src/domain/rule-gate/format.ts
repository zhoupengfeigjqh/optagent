/**
 * 中文文案与"规则全文"块的**唯一来源**（包装器与装配层不拼字）。
 *
 * 三条硬口径：
 * 1. `SC-005`：文案必须含**行为名**与**规则名**，日志另含时间；
 * 2. `FR-015` / `FR-028`：暂停与后置提示都要给**规则全文**（不是摘要）；
 * 3. 后置阻断（`FR-042`）必须声明"该行为已执行成功、业务数据已写入"，
 *    MUST NOT 让用户以为整轮什么都没发生。
 */
import type { BehaviorRef, DenyReason, FailedCondition, RuleSpec } from './types.js';

const UNNAMED_RULE = '（未命名规则）';
const EMPTY = '（无）';

/** `{场景}/{本体}/{行为}` 的展示口径 */
export function behaviorLabel(ref: BehaviorRef): string {
  return `${ref.ontologyKey}/${ref.behaviorName}`;
}

/** 规则全文块（字段顺序稳定，可作快照断言） */
export function ruleBlock(rule: RuleSpec): string {
  return [
    `规则：${ruleName(rule)}`,
    `标题：${rule.title || EMPTY}`,
    `描述：${rule.description || EMPTY}`,
    `绑定行为：${rule.behavior}`,
    `时机：${rule.position}`,
    `关联函数：${rule.relatedFunctions.length > 0 ? rule.relatedFunctions.join('、') : EMPTY}`,
    `数据补充：${rule.dataSupplements.length > 0 ? rule.dataSupplements.join('、') : EMPTY}`,
    `判定设计：${rule.design ? safeJson(rule.design) : '（未设计）'}`,
    `通过文案：${rule.passMessage || EMPTY}`,
    `失败文案：${rule.failMessage || EMPTY}`,
  ].join('\n');
}

/** 暂停：一句话结论 + 缺失函数 + 规则全文（模型据此补调后重试） */
export function pauseMessage(
  ref: BehaviorRef,
  rules: RuleSpec[],
  missing: ReadonlyArray<readonly string[]>,
): string {
  const functions = uniqueMissing(missing);
  return [
    `本体行为「${behaviorLabel(ref)}」的前置规则所需函数尚未执行，本次调用已暂停（该行为未执行）。`,
    `缺失函数：${functions.join('、')}`,
    '请先执行上述函数，然后重试该行为。',
    '',
    '—— 规则全文 ——',
    rules.map(ruleBlock).join('\n\n'),
  ].join('\n');
}

/** 暂停的明细（进日志与卡片展开；正文在 `message` 里） */
export function pauseDetails(
  ref: BehaviorRef,
  rules: RuleSpec[],
  missing: ReadonlyArray<readonly string[]>,
): string[] {
  return [
    `行为：${behaviorLabel(ref)}`,
    `规则：${ruleNames(rules)}`,
    `缺失函数：${uniqueMissing(missing).join('、')}`,
    '请先执行上述函数，再重试该行为。',
  ];
}

/**
 * 拒绝后的**终局指令**（2026-11-09，与 020 同口径的软收尾）。
 *
 * 追加在拒绝卡片的明细之后，**不进** `details.toolError.message`：结构化字段保持
 * "拒绝原因"的原样，这段话只给模型看，用来把"继续换工具试"引导成"总结收尾"。
 */
export const RULE_TERMINAL_NOTICE =
  '本轮已因规则校验停止执行工具，后续工具调用不再执行；请向用户说明原因并结束本轮回答。';

/**
 * 拒绝卡片的追加正文：**明细逐条 + 终局指令**（结论由 `denyMessage` 另行给出）。
 *
 * 为什么把明细放进正文：软收尾不再有失败轮，`details` 若只留在结构化字段里，
 * 用户在卡片上就只看到一句结论——契约要求"结论 + 明细 + 终局指令"三者齐备。
 */
export function denyCardBody(details: string[], notice: string = RULE_TERMINAL_NOTICE): string {
  return [...details, '', notice].join('\n');
}

/**
 * 拒绝的一句话结论（前置：求值不成立 / 函数未注册 / 规则不可用）。
 *
 * 2026-11-09 起不再说"本轮已中止"：软收尾下本轮继续，模型会向用户总结后正常结束，
 * 文案若仍宣称"中止整轮"会与用户实际看到的过程矛盾。
 */
export function denyMessage(ref: BehaviorRef, reason: DenyReason): string {
  if (reason === 'unregistered') {
    return `本体行为「${behaviorLabel(ref)}」的前置规则引用了未注册函数，本次调用已拒绝。`;
  }
  if (reason === 'config_unavailable') {
    return `本体行为「${behaviorLabel(ref)}」的规则配置不可用，本次调用已拒绝。`;
  }
  return `本体行为「${behaviorLabel(ref)}」未通过前置规则校验，本次调用已拒绝。`;
}

export interface DenyDetailInput {
  ref: BehaviorRef;
  reason: DenyReason;
  rules: RuleSpec[];
  /** `reason === 'unregistered'` 时必填 */
  unregistered?: string[];
  /** `reason === 'condition_false'` 时用于说明哪几条没成立 */
  failed?: FailedCondition[];
}

/** 中止的逐条原因（3~6 条；只在 `ONTOLOGY_RULE_DENIED` 时出现） */
export function denyDetails(input: DenyDetailInput): string[] {
  const { ref, reason, rules } = input;
  const head = [`行为：${behaviorLabel(ref)}`, `规则：${ruleNames(rules)}`];

  if (reason === 'unregistered') {
    const functions = input.unregistered ?? [];
    return [
      ...head,
      `未注册函数：${functions.length > 0 ? functions.join('、') : '（未知）'}`,
      '建议：检查该函数是否已在 MCP 服务注册、是否被工具白名单过滤，或本体的函数声明是否写错。',
    ];
  }

  if (reason === 'config_unavailable') {
    return [
      ...head,
      '原因：规则配置不可用（rules 段或 rule_design 结构非法）',
      '建议：检查该本体 ontology.yaml 中该行为的 rules 与 rule_design 结构。',
    ];
  }

  const failMessage = rules.map((rule) => rule.failMessage).find((text) => text !== '') ?? '';
  const failed = (input.failed ?? []).slice(0, 3).map(
    (item) => `未成立条件：${item.function}.${item.field} ${item.operator}`,
  );
  return [...head, `结论：${failMessage || '规则未通过'}`, ...failed].slice(0, 6);
}

/** 后置提示块：明确分界 + 规则全文 + 继续推导的引导 */
export function postBlock(rules: RuleSpec[]): string {
  return [
    '—— 后置规则提示（行为已执行，请继续调用相关函数完成推导）——',
    rules.map(ruleBlock).join('\n\n'),
  ].join('\n');
}

/** 后置阻断：必须说明"已执行成功、数据已写入" */
export function blockedPostMessage(ref: BehaviorRef): string {
  return `本体行为「${behaviorLabel(ref)}」已执行成功（业务数据已写入），但后置规则引用了未注册函数，本轮不再执行其他工具。`;
}

/** 后置阻断的逐条原因 */
export function blockedPostDetails(
  ref: BehaviorRef,
  rules: RuleSpec[],
  unregistered: string[],
): string[] {
  return [
    `行为：${behaviorLabel(ref)}`,
    `规则：${ruleNames(rules)}`,
    `未注册函数：${unregistered.join('、')}`,
    '状态：该行为已执行成功、业务数据已写入，后置提示未追加。',
  ];
}

function ruleName(rule: RuleSpec): string {
  return rule.name === '' ? UNNAMED_RULE : rule.name;
}

function ruleNames(rules: RuleSpec[]): string {
  if (rules.length === 0) return EMPTY;
  return rules.map(ruleName).join('、');
}

function uniqueMissing(missing: ReadonlyArray<readonly string[]>): string[] {
  const all = new Set<string>();
  for (const functions of missing) {
    for (const fn of functions) all.add(fn);
  }
  return [...all];
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

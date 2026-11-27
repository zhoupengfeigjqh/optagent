import type {
  BehaviorRef,
  DenyReason,
  FailedCondition,
  InvalidBehavior,
  RuleSpec,
} from './types.js';

const UNNAMED_RULE = '（未命名规则）';
const EMPTY = '（无）';

export function behaviorLabel(ref: BehaviorRef): string {
  return `${ref.ontologyKey}/${ref.behaviorName}`;
}

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

/**
 * 暂停：一句话结论 + 函数缺口 + 规则全文（模型据此补调后重试）。
 *
 * 2026-11-24：缺口分两类——`missing`（本世代从未执行）与
 * `stale`（执行过，但结果产生于上一次 command 之前）。两者文案必须不同，
 * 否则模型会以为"系统说我没算过，但我明明算过"而原地重试。
 */
export function pauseMessage(
  ref: BehaviorRef,
  rules: RuleSpec[],
  missing: ReadonlyArray<readonly string[]>,
  stale: ReadonlyArray<readonly string[]> = [],
): string {
  const missingFunctions = uniqueMissing(missing);
  const staleFunctions = uniqueMissing(stale).filter((fn) => !missingFunctions.includes(fn));

  const lines: string[] = [];
  if (missingFunctions.length === 0) {
    lines.push(
      `本体行为「${behaviorLabel(ref)}」的前置规则所需函数的结果已过期（产生于上一次写操作之前），本次调用已暂停（该行为未执行）。`,
    );
  } else if (staleFunctions.length > 0) {
    lines.push(
      `本体行为「${behaviorLabel(ref)}」的前置规则所需函数尚未执行或结果已过期，本次调用已暂停（该行为未执行）。`,
    );
  } else {
    lines.push(
      `本体行为「${behaviorLabel(ref)}」的前置规则所需函数尚未执行，本次调用已暂停（该行为未执行）。`,
    );
  }

  if (missingFunctions.length > 0) lines.push(`缺失函数：${missingFunctions.join('、')}`);
  if (staleFunctions.length > 0) {
    lines.push(`已过期函数：${staleFunctions.join('、')}（结果产生于上一次写操作之前，必须重新计算）`);
  }
  lines.push('请先执行上述函数，然后重试该行为。', '', '—— 规则全文 ——');
  lines.push(rules.map(ruleBlock).join('\n\n'));
  return lines.join('\n');
}

export function pauseDetails(
  ref: BehaviorRef,
  rules: RuleSpec[],
  missing: ReadonlyArray<readonly string[]>,
  stale: ReadonlyArray<readonly string[]> = [],
): string[] {
  const missingFunctions = uniqueMissing(missing);
  const staleFunctions = uniqueMissing(stale).filter((fn) => !missingFunctions.includes(fn));
  const details = [
    `行为：${behaviorLabel(ref)}`,
    `规则：${ruleNames(rules)}`,
    `缺失函数：${missingFunctions.length > 0 ? missingFunctions.join('、') : EMPTY}`,
  ];
  if (staleFunctions.length > 0) {
    details.push(`已过期函数：${staleFunctions.join('、')}（上一次写操作之前的结果，必须重新计算）`);
  }
  details.push('请先执行上述函数，再重试该行为。');
  return details;
}

export function fatalMessage(invalid: InvalidBehavior): string {
  const label = behaviorLabel(invalid.ref);
  if (invalid.reason === 'undeclared') {
    return `本体行为「${label}」被规则绑定但未在 behaviors[] 中声明，本次调用已拒绝，本轮已中止。`;
  }
  if (invalid.reason === 'op_type_conflict') {
    return `本体行为「${label}」在多个本体中的 op_type 不一致，规则闸门无法判定，本次调用已拒绝，本轮已中止。`;
  }
  return `本体行为「${label}」的 op_type 不是 query 或 command，规则闸门无法判定，本次调用已拒绝，本轮已中止。`;
}

export function fatalDetails(invalid: InvalidBehavior): string[] {
  const head = [`行为：${behaviorLabel(invalid.ref)}`];

  if (invalid.reason === 'undeclared') {
    return [
      ...head,
      '原因：该行为被某条规则的 behavior 绑定，但未在 behaviors[] 中声明',
      '建议：在该本体 ontology.yaml 的 behaviors[] 补齐声明并标注 op_type，或删除规则的 behavior 绑定，然后重新部署',
    ];
  }

  if (invalid.reason === 'op_type_conflict') {
    const sources = invalid.sources
      .map((source) => `${source.ontologyKey}: ${source.opType === '' ? '（缺失）' : source.opType}`)
      .join('，');
    return [
      ...head,
      `原因：多个本体对该行为的 op_type 不一致——${sources || '（未知来源）'}`,
      '建议：统一各本体 behaviors[] 中该行为的 op_type（command 或 query），然后重新部署',
    ];
  }

  const raw = invalid.sources
    .map((source) => `${source.ontologyKey}: ${source.opType === '' ? '（缺失）' : source.opType}`)
    .join('，');
  return [
    ...head,
    `原因：behaviors[].op_type 只能是 query 或 command（当前：${raw || '（缺失）'}）`,
    '建议：把该行为的 op_type 修正为 command 或 query，然后重新部署',
  ];
}

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
  unregistered?: string[];
  failed?: FailedCondition[];
}

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

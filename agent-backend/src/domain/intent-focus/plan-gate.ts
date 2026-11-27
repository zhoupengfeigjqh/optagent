/**
 * 规划门禁（028，2026-11-26）。
 *
 * 问题只有一个：**这句话是不是"一步就能完成"**。不是 → 值得走多步规划；
 * 是 → 直接直聊，省掉一次约 2s 的规划调用（规划提示词含全量工具与本体索引）。
 *
 * 放在意图聚焦里的原因：
 * - 输入天然现成（`focusState` 就是 rewrite 后的文本）；
 * - 复用同一个 laya 连接、凭据与整轮预算，不新增配置块与客户端；
 * - 失败口径一致（同一次调用的超时/降级）。
 *
 * 判据（2026-11-28 用户拍板翻转）：**多对象即多步**——同一动作查询多个对象
 * （如一次性查三种材料的库存）也按"一步完成不了"判 true，走多步规划。
 * 原先"批量查询算一个任务"的口径已废：每个对象独立执行、独立核对，宁可多花一次往返。
 */
import type { SystemOneQuestion } from '../../infra/laya-client.js';

/** 门禁在 `questions` 里的固定键名（与技能/能力题号不会冲突） */
export const PLAN_GATE_ID = 'plan_gate';

const INSTRUCTIONS =
  '判断用户这句话是否涉及多个对象或多个任务，也就是判断这件事是不是"一步就能完成"。' +
  '多个对象：同时提到两个及以上彼此独立的事物（如三种原材料、两家供应商、两张采购单）；' +
  '即使动作完全相同，只要对象不同，也属于多个对象，需要分步处理。' +
  '多个任务：需要两个及以上不同动作，或存在先后步骤（如先查库存再创建采购单、查询之后再修改）。' +
  '只有一个对象、一个动作，或闲聊、解释、写作、问概念，都不算。';

export const PLAN_GATE_QUESTION: SystemOneQuestion = {
  type: 'noul',
  instructions: INSTRUCTIONS,
  criteria: {
    true: '涉及两个及以上对象（即使动作相同）或多个任务，不是一步能完成，需要分步处理',
    false: '只有一个对象、一个动作，一轮即可完成',
  },
};

/**
 * 装配层的分流判据：**是否因为门禁而跳过规划**。
 *
 * 两条 fail-open：阈值没配（门禁关闭）、分数缺席（没判/判失败）→ 不跳过。
 * 单独抽成纯函数，是为了让"跳过/不跳过"的分支不必在工厂里靠集成测试碰运气。
 */
export function planGateBlocks(
  score: number | undefined,
  threshold: number | undefined,
): boolean {
  if (threshold === undefined || score === undefined) return false;
  if (!Number.isFinite(score)) return false;
  return score < threshold;
}

/**
 * 聚焦能力前置判据（2026-11-27）：**是否因为没有可依附的聚焦行为/函数而跳过规划**。
 *
 * 规划以聚焦行为或函数为起点，本轮一个都没命中时，规划没有可展开的 `coreAction`；
 * 这属于"事实上的不可规划"，不是判定失败，因此**不适用 fail-open**：
 * 只有显式 `false` 才阻断，缺席（未接入本判据的调用方）照旧允许规划。
 */
export function planCapabilityBlocks(hasCapability: boolean | undefined): boolean {
  return hasCapability === false;
}

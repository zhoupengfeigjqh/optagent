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
 * 判据刻意包含"同一动作查多个对象算一个任务"：把 3 个库存拆成 3 步会变成
 * 3 次 LLM 往返 + 3 次工具集切换，比一轮批量查询慢，属于负优化。
 */
import type { SystemOneQuestion } from '../../infra/laya-client.js';

/** 门禁在 `questions` 里的固定键名（与技能/能力题号不会冲突） */
export const PLAN_GATE_ID = 'plan_gate';

const INSTRUCTIONS =
  '判断用户这句话是否涉及多个对象或多个任务，也就是判断这件事是不是"一步就能完成"。' +
  '多个对象：同时提到两个及以上彼此独立的事物（如三种原材料、两家供应商、两张采购单）。' +
  '多个任务：需要两个及以上不同动作，或存在先后步骤（如先查库存再创建采购单、查询之后再修改）。' +
  '只有一个对象、一个动作，或闲聊、解释、写作、问概念，都不算。' +
  '同一动作查询多个对象（如一次性查三种材料的库存）属于一次批量查询，算一个任务。';

export const PLAN_GATE_QUESTION: SystemOneQuestion = {
  type: 'noul',
  instructions: INSTRUCTIONS,
  criteria: {
    true: '涉及多个对象或多个任务，不是一步能完成，需要分步处理',
    false: '只有一个对象或一个任务，一轮即可完成',
  },
};

/**
 * 阈值判定：**分数缺失或非法一律放行（fail-open）**。
 *
 * 门禁是性能优化，不是能力开关：判定服务超时/降级时，宁可多花 2s 走规划，
 * 也不能把复杂任务降级成直聊。
 */
export function judgePlanGate(score: number | null | undefined, threshold: number): boolean {
  if (score === null || score === undefined || !Number.isFinite(score)) return true;
  return score >= threshold;
}

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

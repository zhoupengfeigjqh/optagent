/**
 * 单元测试：规划常量与类型（028）。
 *
 * 守住的口径（data-model §5）：
 * - 单批 1~3 步、单批重试 2 次；
 * - **总步数 20**、失败重规划 6 次；
 * - **正常滚动无独立上限**（只受总步数约束）——`ROLL_MAX_PER_RUN` 必须是 `Infinity`，
 *   否则长任务会被"重规划超限"误杀；
 * - 内置工具清单取自目录唯一来源，不硬编码。
 */
import { describe, expect, it } from 'vitest';

import { builtinToolNames } from '../../src/domain/builtin-tool-catalog.js';
import {
  BUILTIN_TOOL_NAMES,
  CONTENT_MAX,
  HISTORY_TURNS,
  IDLE_TURNS_MAX,
  PLAN_MAX_STEPS,
  PLAN_MIN_STEPS,
  PLAN_RETRY_MAX,
  PLAN_TIMEOUT_MS,
  REPLAN_MAX_PER_RUN,
  RETRYABLE_MAX_PER_STEP,
  ROLL_MAX_PER_RUN,
  SNAPSHOT_MAX_CHARS,
  SUMMARY_KEEP,
  SUMMARY_LINE_MAX,
  TASK_NAME_MAX,
  TOTAL_STEPS_MAX,
} from '../../src/domain/plan/types.js';

describe('规划常量', () => {
  it('单批与重试预算', () => {
    expect(PLAN_MIN_STEPS).toBe(1);
    expect(PLAN_MAX_STEPS).toBe(3);
    expect(PLAN_RETRY_MAX).toBe(2);
  });

  it('总步数 20、失败重规划 6、滚动无上限', () => {
    expect(TOTAL_STEPS_MAX).toBe(20);
    expect(REPLAN_MAX_PER_RUN).toBe(6);
    expect(ROLL_MAX_PER_RUN).toBe(Number.POSITIVE_INFINITY);
  });

  it('卡死与重试口径', () => {
    expect(IDLE_TURNS_MAX).toBe(2);
    expect(RETRYABLE_MAX_PER_STEP).toBe(3);
  });

  it('字段长度与摘要口径', () => {
    expect(TASK_NAME_MAX).toBe(20);
    expect(CONTENT_MAX).toBe(300);
    expect(SUMMARY_LINE_MAX).toBe(80);
    expect(SUMMARY_KEEP).toBe(5);
    expect(SNAPSHOT_MAX_CHARS).toBe(1200);
    // 2026-11-26：5s → 20s（规划提示词含全量本体 + 全工具；超时不重试）
    expect(PLAN_TIMEOUT_MS).toBe(20_000);
    expect(HISTORY_TURNS).toBe(3);
  });

  it('内置工具清单等于目录唯一来源（不维护第二份名单）', () => {
    expect([...BUILTIN_TOOL_NAMES]).toEqual(builtinToolNames());
  });
});

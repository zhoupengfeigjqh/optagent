/**
 * 单元测试：意图聚焦编排（013 · noul 分批口径）。
 *
 * 守住五类处置与四条红线：
 * - 开关关闭 → 零调用零留档；预置动作入口 → 只留 `skipped` 一条；
 * - 未配置 / 无工具 / 全部批次失败 → 一律返回空串（本轮不聚焦），且**不抛错**；
 * - 超过单批上限时按 32 分批，**部分批次失败只丢那批**（部分降级）；
 * - 判定成功 → 提示格式固定，记录含全量分数（便于事后重算阈值）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { IntentFocusConfig } from '../../src/config.js';
import {
  IntentFocusRunner,
  type IntentFocusClient,
  type IntentFocusInput,
} from '../../src/domain/intent-focus-runner.js';
import type { IntentFocusRecordDraft } from '../../src/domain/intent-focus-store.js';
import {
  FOCUS_PROMPT_PREFIX,
  MAX_CANDIDATES,
  MAX_QUESTIONS_PER_BATCH,
  MAX_STATE_CHARS,
} from '../../src/domain/intent-focus.js';

const CONFIG: IntentFocusConfig = {
  baseUrl: 'http://laya:8000',
  model: 'laya-multilingual',
  apiKey: 'k',
  timeoutMs: 10_000,
  threshold: 0.5,
};

const TOOLS = [
  { name: 'order_query', description: '查询订单进度', label: '查询订单' },
  { name: 'capacity_query', description: '查询产能', label: '查询产能' },
  { name: 'bom_query', description: '查询 BOM', label: '查询物料清单' },
];

function input(overrides: Partial<IntentFocusInput> = {}): IntentFocusInput {
  return {
    userId: 'u1',
    agentName: '生产计划助手',
    threadId: 't1',
    messageId: 'm-1',
    userInput: '这批订单还能不能插单',
    skip: false,
    tools: TOOLS,
    ...overrides,
  };
}

function harness(
  options: {
    enabled?: boolean;
    configured?: boolean;
    decide?: IntentFocusClient['decide'];
    logger?: {
      info: (obj: Record<string, unknown>, msg: string) => void;
      warn: (obj: Record<string, unknown>, msg: string) => void;
    };
    /** false = 不装配留档存储（验证"没有存储也不影响对话"） */
    withStore?: boolean;
    /** true = 不注入 `now`（走默认 `Date.now`） */
    withoutNow?: boolean;
  } = {},
) {
  const records: IntentFocusRecordDraft[] = [];
  const client: IntentFocusClient = {
    decide:
      options.decide ??
      (async () => ({ ok: true, scores: { order_query: 0.9 }, model: 'laya-multilingual' })),
  };
  const runner = new IntentFocusRunner({
    ...(options.configured === false ? {} : { config: CONFIG }),
    ...(options.configured === false ? {} : { client }),
    ...(options.withStore === false
      ? {}
      : {
          store: {
            append: (_u: string, _a: string, _t: string, draft: IntentFocusRecordDraft) => {
              records.push(draft);
              return Promise.resolve();
            },
          },
        }),
    isEnabled: () => options.enabled ?? true,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.withoutNow === true ? {} : { now: () => 1_000 }),
  });
  return { runner, records, client };
}

/** 记录型 logger：既让可选链的两侧都被走到，也便于断言告警语义 */
function spyLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

describe('开关与跳过', () => {
  it('开关关闭：不判定、不留档', async () => {
    const { runner, records, client } = harness({ enabled: false });
    const spy = vi.spyOn(client, 'decide');
    await expect(runner.judge(input())).resolves.toBe('');
    expect(spy).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });

  it('预置动作入口：只留一条 skipped，且不调用判定', async () => {
    const { runner, records, client } = harness();
    const spy = vi.spyOn(client, 'decide');
    await expect(runner.judge(input({ skip: true }))).resolves.toBe('');
    expect(spy).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0]!.disposition).toBe('skipped');
    expect(records[0]!.focus_prompt).toBe('');
  });

  it('跳过优先于"未配置"（确定行为不该记成故障）', async () => {
    const { runner, records } = harness({ configured: false });
    await runner.judge(input({ skip: true }));
    expect(records[0]!.disposition).toBe('skipped');
  });
});

describe('不可用与空候选', () => {
  it('判定模型未配置：留档 unconfigured 且返回空串', async () => {
    const { runner, records } = harness({ configured: false });
    await expect(runner.judge(input())).resolves.toBe('');
    expect(records[0]!.disposition).toBe('unconfigured');
    expect(records[0]!.reason).toBe('no_config');
  });

  it('数字人无可用工具：不调用判定，留档 empty/no_tools', async () => {
    const { runner, records, client } = harness();
    const spy = vi.spyOn(client, 'decide');
    await expect(runner.judge(input({ tools: [] }))).resolves.toBe('');
    expect(spy).not.toHaveBeenCalled();
    expect(records[0]!.disposition).toBe('empty');
    expect(records[0]!.reason).toBe('no_tools');
  });
});

describe('判定成功', () => {
  it('按阈值筛出工具并铸成固定格式提示，记录含全量分数', async () => {
    const { runner, records } = harness({
      decide: async () => ({
        ok: true,
        scores: { order_query: 0.87, capacity_query: 0.61, bom_query: 0.09 },
        model: 'laya-multilingual',
      }),
    });

    const prompt = await runner.judge(input());

    expect(prompt).toBe(`${FOCUS_PROMPT_PREFIX}order_query，capacity_query`);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.disposition).toBe('focused');
    expect(record.actions).toEqual(['order_query', 'capacity_query']);
    expect(record.focus_prompt).toBe(prompt);
    expect(record.probabilities).toEqual({
      order_query: 0.87,
      capacity_query: 0.61,
      bom_query: 0.09,
    });
    expect(record.model).toBe('laya-multilingual');
    expect(record.round_ms).toBe(0);
    expect(record.batches).toBe(1);
  });

  it('全量入选：不设条数上限（3 个都过阈值就都进提示）', async () => {
    const { runner } = harness({
      decide: async () => ({
        ok: true,
        scores: { order_query: 0.9, capacity_query: 0.8, bom_query: 0.7 },
        model: 'laya-multilingual',
      }),
    });

    await expect(runner.judge(input())).resolves.toBe(
      `${FOCUS_PROMPT_PREFIX}order_query，capacity_query，bom_query`,
    );
  });

  it('全部低于阈值：空串 + empty/below_threshold', async () => {
    const { runner, records } = harness({
      decide: async () => ({ ok: true, scores: { order_query: 0.1 }, model: 'laya-multilingual' }),
    });
    await expect(runner.judge(input())).resolves.toBe('');
    expect(records[0]!.disposition).toBe('empty');
    expect(records[0]!.reason).toBe('below_threshold');
  });
});

describe('分批与部分降级', () => {
  const many = Array.from({ length: 70 }, (_, i) => ({ name: `tool_${i}`, description: 'x' }));

  it('超过单批上限时按 32 分批串行调用', async () => {
    const calls: number[] = [];
    const { runner, records } = harness({
      decide: async (_state, questions) => {
        calls.push(Object.keys(questions).length);
        return { ok: true, scores: { tool_0: 0.9 }, model: 'laya-multilingual' };
      },
    });

    await runner.judge(input({ tools: many }));

    expect(calls).toEqual([32, 32, 6]);
    expect(records[0]!.batches).toBe(3);
    expect(records[0]!.candidates).toBe(70);
  });

  it('部分批次失败：用剩余批次的结果继续，留档记 error', async () => {
    let call = 0;
    const { runner, records } = harness({
      decide: async () => {
        call += 1;
        if (call === 2) return { ok: false, reason: 'timeout', message: 'aborted' };
        return { ok: true, scores: { tool_0: 0.9 }, model: 'laya-multilingual' };
      },
    });

    await expect(runner.judge(input({ tools: many }))).resolves.toBe(
      `${FOCUS_PROMPT_PREFIX}tool_0`,
    );
    const record = records[0]!;
    expect(record.disposition).toBe('focused');
    expect(record.error).toBe('batch_1:timeout');
  });

  it('部分批次失败时告警 alert（可观测）', async () => {
    const logger = spyLogger();
    let call = 0;
    const { runner } = harness({
      logger,
      decide: async () => {
        call += 1;
        if (call === 1) return { ok: false, reason: 'http', status: 503, message: 'unavailable' };
        return { ok: true, scores: { tool_0: 0.9 }, model: 'laya-multilingual' };
      },
    });

    await runner.judge(input({ tools: many }));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'intent-focus.partial', alert: true, failed: 1 }),
      expect.any(String),
    );
  });

  it('全部批次失败：degraded + 空串', async () => {
    const { runner, records } = harness({
      decide: async () => ({ ok: false, reason: 'network', message: 'boom' }),
    });

    await expect(runner.judge(input({ tools: many }))).resolves.toBe('');
    expect(records[0]!.disposition).toBe('degraded');
    // 全批同一根因时记根因本身（data-model §6.1 的可读原因），不再是笼统的 all_batches_failed
    expect(records[0]!.reason).toBe('network');
    expect(records[0]!.error).toContain('batch_0:network');
  });
});

describe('失败降级（不抛错）', () => {
  it('判定服务返回失败：空串 + degraded，并保留原因', async () => {
    const { runner, records } = harness({
      decide: async () => ({ ok: false, reason: 'timeout', message: 'aborted' }),
    });
    await expect(runner.judge(input())).resolves.toBe('');
    expect(records[0]!.disposition).toBe('degraded');
    expect(records[0]!.reason).toBe('timeout');
  });

  it('判定调用直接抛错：仍降级（network）', async () => {
    const { runner, records } = harness({
      decide: async () => {
        throw new Error('boom');
      },
    });
    await expect(runner.judge(input())).resolves.toBe('');
    expect(records[0]!.disposition).toBe('degraded');
    expect(records[0]!.error).toContain('network');
  });

  it('留档写入抛错不影响返回值', async () => {
    const runner = new IntentFocusRunner({
      config: CONFIG,
      client: {
        decide: async () => ({ ok: true, scores: { order_query: 0.9 }, model: 'laya-multilingual' }),
      },
      store: {
        append: () => Promise.reject(new Error('disk')),
      },
      isEnabled: () => true,
    });
    await expect(runner.judge(input())).resolves.toBe(`${FOCUS_PROMPT_PREFIX}order_query`);
  });
});

describe('候选与输入边界', () => {
  it('超长输入截断并标注（取尾部）', async () => {
    const { runner, records } = harness();
    await runner.judge(input({ userInput: `${'字'.repeat(MAX_STATE_CHARS + 10)}末尾提问` }));
    expect(records[0]!.input_truncated).toBe(true);
    expect(records[0]!.input.length).toBeLessThanOrEqual(MAX_STATE_CHARS);
    expect(records[0]!.input.endsWith('末尾提问')).toBe(true);
  });

  it('候选超过总数上限时截断并标注', async () => {
    const { runner, records } = harness();
    const over = Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) => ({
      name: `tool_${i}`,
      description: 'x',
    }));
    await runner.judge(input({ tools: over }));
    expect(records[0]!.truncated).toBe(true);
    expect(records[0]!.candidates).toBe(MAX_CANDIDATES);
    expect(records[0]!.batches).toBe(Math.ceil(MAX_CANDIDATES / MAX_QUESTIONS_PER_BATCH));
  });

  it('同名工具只算一个候选（不重复发命题）', async () => {
    const { runner, records } = harness();
    await runner.judge(input({ tools: [...TOOLS, { name: 'order_query', description: '重复' }] }));
    expect(records[0]!.candidates).toBe(3);
  });

  it('空名工具被剔除（题量与候选数都不含它）', async () => {
    const { runner, records } = harness({
      decide: async () => ({
        ok: true,
        scores: { order_query: 0.9, capacity_query: 0.9 },
        model: 'laya-multilingual',
      }),
    });
    await runner.judge(
      input({ tools: [{ name: '', description: '脏数据' }, ...TOOLS.slice(0, 2)] }),
    );
    expect(records[0]!.candidates).toBe(2);
    expect(records[0]!.actions).toEqual(['order_query', 'capacity_query']);
  });
});

describe('日志与装配缺省（可观测性与优雅降级）', () => {
  it('未配置判定模型：warn 记 intent-focus.unconfigured（首轮可发现）', async () => {
    const logger = spyLogger();
    const { runner } = harness({ configured: false, logger });

    await runner.judge(input());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'intent-focus.unconfigured' }),
      expect.any(String),
    );
  });

  it('判定失败：warn 记 alert + detail（HTTP 失败带状态码）', async () => {
    const logger = spyLogger();
    const { runner, records } = harness({
      logger,
      decide: async () => ({ ok: false, reason: 'http', status: 503, message: '服务不可用' }),
    });

    await runner.judge(input());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'intent-focus.failed',
        alert: true,
        reason: 'http_503',
      }),
      expect.any(String),
    );
    // 留档里的 error 带批次与状态码，便于按上游故障归类
    expect(records[0]!.error).toBe('batch_0:http:503');
    expect(records[0]!.reason).toBe('http_503');
  });

  it('判定成功 / 空结果：info 记 ok 或 empty（含阈值与耗时）', async () => {
    const okLogger = spyLogger();
    const ok = harness({
      logger: okLogger,
      decide: async () => ({ ok: true, scores: { order_query: 0.9 }, model: 'laya-multilingual' }),
    });
    await ok.runner.judge(input());
    expect(okLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'intent-focus.ok', threshold: 0.5 }),
      expect.any(String),
    );

    const emptyLogger = spyLogger();
    const empty = harness({
      logger: emptyLogger,
      decide: async () => ({ ok: true, scores: { order_query: 0.1 }, model: 'laya-multilingual' }),
    });
    await empty.runner.judge(input());
    expect(emptyLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'intent-focus.empty' }),
      expect.any(String),
    );
  });

  it('留档写入失败：warn 记 alert，判定结果照常返回', async () => {
    const logger = spyLogger();
    const runner = new IntentFocusRunner({
      config: CONFIG,
      client: {
        decide: async () => ({ ok: true, scores: { order_query: 0.9 }, model: 'laya-multilingual' }),
      },
      store: { append: () => Promise.reject(new Error('disk full')) },
      isEnabled: () => true,
      logger,
    });

    await expect(runner.judge(input())).resolves.toBe(`${FOCUS_PROMPT_PREFIX}order_query`);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'intent-focus.record.failed', alert: true }),
      expect.any(String),
    );
  });

  it('未装配留档存储：照常判定，只是不落档（不抛错）', async () => {
    const { runner, records } = harness({ withStore: false });

    await expect(runner.judge(input())).resolves.toBe(`${FOCUS_PROMPT_PREFIX}order_query`);
    expect(records).toHaveLength(0);
  });

  it('未注入时钟：走默认 Date.now，逐轮耗时仍可计算', async () => {
    const { runner, records } = harness({ withoutNow: true });

    await runner.judge(input());

    expect(typeof records[0]!.round_ms).toBe('number');
    expect(records[0]!.round_ms).toBeGreaterThanOrEqual(0);
  });
});

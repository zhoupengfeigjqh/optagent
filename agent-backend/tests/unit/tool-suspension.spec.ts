import { describe, expect, it, vi } from 'vitest';

import {
  SUSPENDED_MESSAGE,
  createToolSuspension,
  interceptSuspended,
  suspendTools,
} from '../../src/domain/tool-suspension.js';

describe('createToolSuspension', () => {
  it('新建即未挂起，无兜底出口', () => {
    const state = createToolSuspension();
    expect(state).toEqual({
      suspended: false,
      code: '',
      attempts: 0,
      exhausted: false,
    });
    expect(state.onExhausted).toBeUndefined();
  });

  it('传入的兜底出口挂在状态上', () => {
    const onExhausted = vi.fn();
    expect(createToolSuspension(onExhausted).onExhausted).toBe(onExhausted);
  });
});

describe('suspendTools', () => {
  it('置挂起并记住触发码', () => {
    const state = createToolSuspension();
    suspendTools(state, 'ONTOLOGY_SCOPE_DENIED');
    expect(state).toMatchObject({ suspended: true, code: 'ONTOLOGY_SCOPE_DENIED' });
  });

  it('幂等：已挂起时不覆盖首个触发码', () => {
    const state = createToolSuspension();
    suspendTools(state, 'ONTOLOGY_SCOPE_DENIED');
    suspendTools(state, 'ONTOLOGY_RULE_DENIED');
    expect(state.code).toBe('ONTOLOGY_SCOPE_DENIED');
  });

  it('挂起本身不计入 attempts（首次拒绝不算"又被调用一次"）', () => {
    const state = createToolSuspension();
    suspendTools(state, 'ONTOLOGY_RULE_DENIED');
    expect(state.attempts).toBe(0);
  });
});

describe('interceptSuspended', () => {
  it('未挂起：返回 false 且不累加 attempts', () => {
    const state = createToolSuspension();
    expect(interceptSuspended(state)).toBe(false);
    expect(state.attempts).toBe(0);
  });

  it('挂起后：返回 true 并累加 attempts', () => {
    const state = createToolSuspension();
    suspendTools(state, 'ONTOLOGY_RULE_DENIED');

    expect(interceptSuspended(state)).toBe(true);
    expect(state.attempts).toBe(1);
    expect(state.exhausted).toBe(false);
  });

  it('第 2 次拦截触发兜底，且只触发一次', () => {
    const onExhausted = vi.fn();
    const state = createToolSuspension(onExhausted);
    suspendTools(state, 'ONTOLOGY_RULE_DENIED');

    interceptSuspended(state);
    expect(onExhausted).not.toHaveBeenCalled();

    interceptSuspended(state);
    interceptSuspended(state);
    interceptSuspended(state);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ attempts: 4, exhausted: true });
  });

  it('兜底出口抛错不影响拦截结果', () => {
    const state = createToolSuspension(() => {
      throw new Error('stop is broken');
    });
    suspendTools(state, 'ONTOLOGY_RULE_DENIED');

    interceptSuspended(state);
    expect(() => interceptSuspended(state)).not.toThrow();
    expect(state.exhausted).toBe(true);
  });
});

describe('SUSPENDED_MESSAGE', () => {
  it('是面向模型的短文案（非空且不声称本轮已失败）', () => {
    expect(SUSPENDED_MESSAGE).toContain('本轮已停止执行工具');
    expect(SUSPENDED_MESSAGE).not.toContain('失败');
  });
});

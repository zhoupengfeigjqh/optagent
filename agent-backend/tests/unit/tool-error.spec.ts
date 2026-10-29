/**
 * 单元测试：工具失败标记通道（`domain/tool-error.ts`）。
 *
 * 守住的语义（2026-10-29 产品口径）：
 * - 标记只放 `details.toolError`，不抛异常（pi 的 catch 会覆盖 result）
 * - `readToolError` 对任何脏数据都返回 undefined（不抛）
 * - `markToolError` 是 `afterToolCall` 的实现体，**MUST 不抛**——
 *   它抛错时 pi 会把正常结果覆盖成 error（`finalizeExecutedToolCall` 的 catch）
 */
import { describe, expect, it } from 'vitest';

import {
  markToolError,
  readToolError,
  toolErrorResult,
  TOOL_ERROR_DETAILS_KEY,
} from '../../src/domain/tool-error.js';

describe('toolErrorResult', () => {
  it('正文与 details.message 同源，code 原样落位', () => {
    const result = toolErrorResult('工具执行失败：磁盘满了', 'TOOL_EXECUTION_FAILED');

    expect(result.content).toEqual([{ type: 'text', text: '工具执行失败：磁盘满了' }]);
    expect(readToolError(result.details)).toEqual({
      code: 'TOOL_EXECUTION_FAILED',
      message: '工具执行失败：磁盘满了',
    });
  });

  it('不设 isError 字段：pi 只认 afterToolCall 的 patch，工具返回体里的 isError 会被忽略', () => {
    const result = toolErrorResult('x', 'C');

    expect('isError' in result).toBe(false);
  });
});

describe('readToolError：脏数据一律 undefined（不抛）', () => {
  const cases: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['字符串', 'toolError'],
    ['数组', []],
    ['空对象', {}],
    ['标记不是对象', { [TOOL_ERROR_DETAILS_KEY]: 'oops' }],
    ['标记缺 code', { [TOOL_ERROR_DETAILS_KEY]: { message: 'x' } }],
    ['标记 code 为空串', { [TOOL_ERROR_DETAILS_KEY]: { code: '', message: 'x' } }],
    ['标记 code 非字符串', { [TOOL_ERROR_DETAILS_KEY]: { code: 500, message: 'x' } }],
    ['标记缺 message', { [TOOL_ERROR_DETAILS_KEY]: { code: 'C' } }],
    ['取值器抛错', {
      get [TOOL_ERROR_DETAILS_KEY]() {
        throw new Error('boom');
      },
    }],
  ];

  for (const [name, details] of cases) {
    it(name, () => {
      expect(() => readToolError(details)).not.toThrow();
      expect(readToolError(details)).toBeUndefined();
    });
  }
});

describe('markToolError（afterToolCall 的实现体）', () => {
  it('有标记 → { isError: true }', () => {
    expect(markToolError(toolErrorResult('x', 'C'))).toEqual({ isError: true });
  });

  it('无标记 → undefined（放行原结果，不能误标红）', () => {
    expect(markToolError({ content: [{ type: 'text', text: 'ok' }], details: {} })).toBeUndefined();
  });

  it('result 是脏数据也返回 undefined：hook 抛错会让正常结果被覆盖成 error', () => {
    expect(markToolError(undefined)).toBeUndefined();
    expect(markToolError(null)).toBeUndefined();
    expect(markToolError('nope')).toBeUndefined();
    expect(
      markToolError({
        get details() {
          throw new Error('boom');
        },
      }),
    ).toBeUndefined();
  });
});

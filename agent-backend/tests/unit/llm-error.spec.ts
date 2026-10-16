/**
 * 单元测试：LLM 失败分类（`src/domain/llm-error.ts`，契约 `runtime-api-delta.md` §19.2/§19.3）
 *
 * 这一层是**唯一**的判据实现（直聊与工具循环两条路径都用它），所以逐类钉死：
 * 每个状态码 → 错误码、诊断字段的解析与省略、以及"用今天真实发生过的报文"回归。
 */
import { describe, expect, it } from 'vitest';
import {
  ALERT_LLM_ERROR_CODES,
  classifyLlmFailure,
  isAlertLlmFailure,
  statusOfError,
  toHistoryErrorInfo,
} from '../../src/domain/llm-error.js';

/** 今天真实踩到的报文（DeepSeek 2026-10-15，request_id 写在 message 文本内部） */
const REAL_503 =
  '503: {"message":"Service is too busy. We advise users to temporarily switch to alternative LLM API service providers. (request_id: 7eac5255-1f3b-4c2a-9d77-0a1b2c3d4e5f)","type":"service_unavailable_error","code":"service_unavailable_error"}';

describe('classifyLlmFailure：状态码 → 错误码', () => {
  it.each([
    ['401: {"error":{"message":"Authentication Fails"}}', 'LLM_UNAUTHORIZED', 401],
    ['403: {"message":"Forbidden"}', 'LLM_UNAUTHORIZED', 403],
    ['402: {"error":{"message":"Insufficient Balance"}}', 'LLM_INSUFFICIENT_BALANCE', 402],
    ['429: {"error":{"message":"Rate limit reached"}}', 'LLM_RATE_LIMITED', 429],
    ['408: {"message":"Request Timeout"}', 'LLM_UNAVAILABLE', 408],
    ['500: {"message":"Internal Server Error"}', 'LLM_UNAVAILABLE', 500],
    ['502: {"message":"Bad Gateway"}', 'LLM_UNAVAILABLE', 502],
    ['503: {"message":"Service is too busy"}', 'LLM_UNAVAILABLE', 503],
  ])('%s → %s（upstream_status=%d）', (message, code, status) => {
    const failure = classifyLlmFailure({ message });
    expect(failure.code).toBe(code);
    expect(failure.upstream_status).toBe(status);
    expect(failure.message).toBe(message);
  });

  it('400 + 上下文长度特征 → LLM_CONTEXT_TOO_LONG', () => {
    const failure = classifyLlmFailure({
      message: '400: {"error":{"message":"This model\'s maximum context length is 65536 tokens"}}',
    });
    expect(failure.code).toBe('LLM_CONTEXT_TOO_LONG');
    expect(failure.upstream_status).toBe(400);
  });

  it('400 但报文与上下文无关 → 兜底 LLM_ERROR（不误报为上下文超长）', () => {
    const failure = classifyLlmFailure({
      message: '400: {"error":{"message":"invalid temperature"}}',
    });
    expect(failure.code).toBe('LLM_ERROR');
    expect(failure.upstream_status).toBe(400);
  });

  it.each([
    ['Connection error.', '网络层错误无状态码'],
    ['', '空文案'],
    ['deepseek: 调用失败', '无状态码的前缀形态'],
  ])('%s → 兜底 LLM_ERROR 且不臆造诊断字段（%s）', (message) => {
    const failure = classifyLlmFailure({ message });
    expect(failure.code).toBe('LLM_ERROR');
    expect(failure.upstream_status).toBeUndefined();
    expect(failure.upstream_type).toBeUndefined();
    expect(failure.request_id).toBeUndefined();
  });

  it('非法状态码（超出 100~599）不当作状态码', () => {
    expect(classifyLlmFailure({ message: '999: {"message":"x"}' }).upstream_status).toBeUndefined();
    expect(classifyLlmFailure({ message: '099: {"message":"x"}' }).upstream_status).toBeUndefined();
  });

  it('显式 status 优先于文案里的状态码（抛出的 Error 更可信）', () => {
    const failure = classifyLlmFailure({ message: '500: {"message":"boom"}', status: 401 });
    expect(failure.code).toBe('LLM_UNAUTHORIZED');
    expect(failure.upstream_status).toBe(401);
  });

  it('支持带 provider 前缀的形态：`deepseek (503): {…}`', () => {
    const failure = classifyLlmFailure({
      message: 'deepseek (503): {"message":"Service is too busy"}',
    });
    expect(failure.code).toBe('LLM_UNAVAILABLE');
    expect(failure.upstream_status).toBe(503);
  });

  it.each([
    ['503 status code (no body)', 'LLM_UNAVAILABLE', 503],
    ['429 Too Many Requests', 'LLM_RATE_LIMITED', 429],
    ['401 status code (no body)', 'LLM_UNAUTHORIZED', 401],
  ])('识别 openai SDK 自己的措辞：`%s` → %s', (message, code, status) => {
    // 实测：桩 fetch 返回非 2xx 时，pi 会把 SDK 的这句原文当 errorMessage 透出；
    // 不识别就会把 503 退化成兜底的 LLM_ERROR（等于用户侧仍看不到原因）
    const failure = classifyLlmFailure({ message });
    expect(failure.code).toBe(code);
    expect(failure.upstream_status).toBe(status);
  });

  it('文本里没有 JSON 体（HTML 错误页）也能分类，只是没有 upstream_type', () => {
    const failure = classifyLlmFailure({
      message: '503: <html><body>Service Unavailable</body></html>',
    });
    expect(failure.code).toBe('LLM_UNAVAILABLE');
    expect(failure.upstream_status).toBe(503);
    expect(failure.upstream_type).toBeUndefined();
    expect(failure.request_id).toBeUndefined();
  });

  it('中断由调用点显式传入，不靠文案猜（会覆盖状态码判定）', () => {
    const failure = classifyLlmFailure({ message: '500: {"message":"boom"}', aborted: true });
    expect(failure.code).toBe('ABORTED');
    expect(failure.upstream_status).toBeUndefined();
  });

  it('中断且 pi 未给文案时用兜底文案', () => {
    expect(classifyLlmFailure({ aborted: true }).message).toBe('已中断');
  });
});

describe('classifyLlmFailure：诊断字段解析', () => {
  it('真样本（DeepSeek 503）：状态码 / 类型 / request_id 全部解析出来', () => {
    const failure = classifyLlmFailure({ message: REAL_503 });
    expect(failure.code).toBe('LLM_UNAVAILABLE');
    expect(failure.upstream_status).toBe(503);
    expect(failure.upstream_type).toBe('service_unavailable_error');
    // request_id 被写在错误体的 message 文本内部，只读 JSON 字段会漏掉它
    expect(failure.request_id).toBe('7eac5255-1f3b-4c2a-9d77-0a1b2c3d4e5f');
  });

  it('错误体是嵌套 `{"error":{…}}` 时取 type', () => {
    const failure = classifyLlmFailure({
      message: '401: {"error":{"message":"Authentication Fails","type":"authentication_error"}}',
    });
    expect(failure.upstream_type).toBe('authentication_error');
  });

  it('兼容 `requestId` 驼峰字段', () => {
    const failure = classifyLlmFailure({ message: '503: {"requestId":"abc-1234567890"}' });
    expect(failure.request_id).toBe('abc-1234567890');
  });

  it('type 为空串视为没有（不写空字段）', () => {
    const failure = classifyLlmFailure({ message: '503: {"type":"","request_id":""}' });
    expect(failure.upstream_type).toBeUndefined();
    expect(failure.request_id).toBeUndefined();
  });

  it('JSON 体后面还有尾随文本（如网关的附加说明）：裁到最后一个 `}` 仍能解析', () => {
    const failure = classifyLlmFailure({
      message: '503: {"type":"service_unavailable_error"} [upstream gateway timeout hint]',
    });
    expect(failure.code).toBe('LLM_UNAVAILABLE');
    expect(failure.upstream_type).toBe('service_unavailable_error');
  });

  it('JSON 体被截断（缺右括号）：不抛错，只有状态码可用', () => {
    const failure = classifyLlmFailure({ message: '503: {"type":"service_unavailable_error"' });
    expect(failure.code).toBe('LLM_UNAVAILABLE');
    expect(failure.upstream_status).toBe(503);
    expect(failure.upstream_type).toBeUndefined();
  });
});

describe('statusOfError', () => {
  it.each([
    [{ status: 503 }, 503],
    [{ statusCode: 401 }, 401],
    [{ status: '503' }, undefined],
    [new Error('Connection error.'), undefined],
    [null, undefined],
    ['503', undefined],
  ])('%o → %s', (input, expected) => {
    expect(statusOfError(input)).toBe(expected);
  });

  it('status 非法时回落到 statusCode', () => {
    expect(statusOfError({ status: 99, statusCode: 429 })).toBe(429);
  });
});

describe('toHistoryErrorInfo：字段归一（有才写）', () => {
  it('有诊断字段则逐个写入', () => {
    const info = toHistoryErrorInfo({
      code: 'LLM_UNAVAILABLE',
      message: '503: …',
      upstream_status: 503,
      upstream_type: 'service_unavailable_error',
      request_id: 'rid-1',
    });
    expect(info).toEqual({
      code: 'LLM_UNAVAILABLE',
      message: '503: …',
      upstream_status: 503,
      upstream_type: 'service_unavailable_error',
      request_id: 'rid-1',
    });
  });

  it('没有诊断字段时**不出现键**（不是写 null / undefined）', () => {
    const info = toHistoryErrorInfo({ code: 'LLM_ERROR', message: 'boom' });
    expect(Object.keys(info).sort()).toEqual(['code', 'message']);
    expect('upstream_status' in info).toBe(false);
    expect('upstream_type' in info).toBe(false);
    expect('request_id' in info).toBe(false);
  });

  it('旁字段（如 LlmEvent 的 usage）不会被带进落盘行', () => {
    const info = toHistoryErrorInfo({
      code: 'LLM_ERROR',
      message: 'boom',
      ...({ usage: { inputTokens: 1, outputTokens: 2 }, type: 'error' } as object),
    });
    expect(Object.keys(info).sort()).toEqual(['code', 'message']);
  });
});

describe('告警判据', () => {
  it('只有"需要人工介入"的两类需要告警', () => {
    expect([...ALERT_LLM_ERROR_CODES]).toEqual(['LLM_INSUFFICIENT_BALANCE', 'LLM_UNAUTHORIZED']);
    expect(isAlertLlmFailure('LLM_INSUFFICIENT_BALANCE')).toBe(true);
    expect(isAlertLlmFailure('LLM_UNAUTHORIZED')).toBe(true);
    expect(isAlertLlmFailure('LLM_UNAVAILABLE')).toBe(false);
    expect(isAlertLlmFailure('LLM_ERROR')).toBe(false);
    expect(isAlertLlmFailure('ABORTED')).toBe(false);
  });
});

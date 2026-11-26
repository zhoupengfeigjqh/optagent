export interface SystemOneQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface LayaClientOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 单次判定超时（毫秒）；到时即中止，不重试 */
  timeoutMs: number;
}

export type LayaFailureReason = 'timeout' | 'http' | 'invalid_response' | 'network';

export type LayaDecideResult =
  | { ok: true; scores: Record<string, number>; model: string }
  | { ok: false; reason: LayaFailureReason; status?: number; message: string };

export interface LayaClientDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class LayaClient {
  private readonly baseUrl: string;
  private readonly opts: LayaClientOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: LayaClientOptions, deps: LayaClientDeps = {}) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
  }

  /**
   * 提交一次判定。返回值一律是"结果对象"，**不抛错**——
   * 上层据此决定是否降级，避免把网络异常漏成 500。
   *
   * `timeoutMs` 可选覆盖：分批时上层按"总预算 ÷ 批数"分配，避免 3 批各 10s
   * 把整轮拖到 30s。
   */
  async decide(
    state: string,
    questions: Record<string, SystemOneQuestion>,
    timeoutMs?: number,
  ): Promise<LayaDecideResult> {
    const url = `${this.baseUrl}/v1/systemone`;
    const body = JSON.stringify({
      state,
      model: this.opts.model,
      questions,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs ?? this.opts.timeoutMs),
      });
    } catch (err) {
      return {
        ok: false,
        reason: isTimeout(err) ? 'timeout' : 'network',
        message: (err as Error)?.message ?? String(err),
      };
    }

    if (!response.ok) {
      const detail = await response
        .text()
        .then((t) => t.replace(/\s+/g, ' ').slice(0, 200))
        .catch(() => '');
      return {
        ok: false,
        reason: 'http',
        status: response.status,
        message: detail
          ? `判定服务返回 ${response.status}：${detail}`
          : `判定服务返回 ${response.status}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, reason: 'invalid_response', message: '响应不是合法 JSON' };
    }

    return parseAnswers(payload);
  }
}

function parseAnswers(payload: unknown): LayaDecideResult {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: 'invalid_response', message: '响应不是对象' };
  }
  const answers = (payload as { answers?: unknown }).answers;
  if (typeof answers !== 'object' || answers === null) {
    return { ok: false, reason: 'invalid_response', message: '响应缺少 answers' };
  }
  const model =
    typeof (payload as { model?: unknown }).model === 'string'
      ? (payload as { model: string }).model
      : '';

  const scores: Record<string, number> = {};
  for (const [qid, value] of Object.entries(answers as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const noul = (value as { noul?: unknown }).noul;
    if (typeof noul === 'number' && Number.isFinite(noul)) scores[qid] = noul;
  }

  if (Object.keys(scores).length === 0) {
    return { ok: false, reason: 'invalid_response', message: '响应不含任何可用的 noul 分数' };
  }
  return { ok: true, scores, model };
}

function isTimeout(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}

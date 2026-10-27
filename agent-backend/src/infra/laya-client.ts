/**
 * Laya 决策模型（System One 线协议）适配器 —— 意图聚焦（013）的唯一网络出口。
 *
 * 为什么不用既有 LLM 通道（research.md D1/D3）：
 * - Laya 是**结构化决策模型**，官方只提供 `/v1/systemone`（及 `/v1/models`），没有对话补全端点；
 * - 既有 `PiAiLlmProvider` 绑定 `deepseekProvider()` 的模型目录，构造时命中不到 Laya 即抛错；
 * - 本能力 MUST NOT 经 MCP、MUST NOT 注册为工具（规格 FR-054）。
 *
 * 约束：只用平台原生 `fetch`（零新增依赖）；超时即失败、**不重试**（规格 FR-009/D4）。
 */
/**
 * System One 命题：`noul`（是非题），一个工具一条。
 *
 * 为什么用 `noul` 而不是 `choice`（2026-10-26 定标）：
 * - `choice` 是**单选**，概率归一到 1：24 个候选时 top1 只剩 3%~8%，任何阈值都无法
 *   同时"收下切题工具"和"拒绝无关工具"；且最多只能选出 1 个，无法表达"这一轮要用
 *   两个工具"；
 * - `noul` 每题一条真值命题，题与题之间**互不竞争**：32 个工具可以同时命中多个，
 *   且某题的分数**与同批有多少题无关**（实测 13 个候选与 32 个候选下同题分数逐位相同）；
 * - 代价是需要阈值：`noul` 分数不是归一化概率，"语义邻近"的工具也会得高分，
 *   阈值与候选集强相关（8 个工具时 0.5 很干净，32 个同域工具时无法切分）。
 *
 * `criteria`（真/假判据文案）**建议给**：实测加判据能把相关项最低值从 0.329 抬到
 * 0.708、间隔从 0.301 扩到 0.471；但措辞必须朴素，写"明确要求"之类反而会恶化。
 */
export interface SystemOneQuestion {
  type: 'noul';
  /** 命题正文（问句形式；实测越长越糟，控制在 25 字以内） */
  instructions: string;
  /** 真/假判据文案（`{type:'noul'}` 的可选字段） */
  criteria?: { true: string; false: string };
}

export interface LayaClientOptions {
  /** 形如 `http://laya:8000`（容器内）或 `http://127.0.0.1:8103`（本地直跑） */
  baseUrl: string;
  /** 请求体里的模型名，缺省 `laya-multilingual` */
  model: string;
  /** 容器 `DECIS_API_KEY` 同值 */
  apiKey: string;
  /** 单次判定超时（毫秒）；到时即中止，不重试 */
  timeoutMs: number;
}

/** 失败原因：留档与日志用，不向用户暴露 */
export type LayaFailureReason = 'timeout' | 'http' | 'invalid_response' | 'network';

export type LayaDecideResult =
  | { ok: true; scores: Record<string, number>; model: string }
  | { ok: false; reason: LayaFailureReason; status?: number; message: string };

export interface LayaClientDeps {
  /** 测试注入；缺省用全局 fetch */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** 响应里只依赖 `answers[tN].noul`（见 contracts §3.3） */
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
      // 带上响应体摘要：422 这类"请求被 schema 拒绝"的故障，只看状态码无法定位
      // （实测遇过一次：候选工具名里带非法字符，正文里其实写明了哪个字段不行）
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

/**
 * 从响应体取 **qid → noul 分数**；整表缺失视为结构性失败。
 *
 * `noul` 的回传形如 `answers['erp__query_bom'] = { type:'noul', noul:0.624 }`，
 * 键就是请求里 `questions` 的键（本项目用工具名），因此无需任何下标对齐。
 *
 * 单题缺 `noul` / 非数字：**跳过该题**而不是整批失败——32 条里坏一条不该让整轮丢失。
 * 只有一条都取不到时才判结构性失败。
 */
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

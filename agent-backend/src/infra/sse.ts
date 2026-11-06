/**
 * SSE 连接的生命周期（首帧 + 心跳 + 释放）。
 *
 * 为什么需要（2026-11-06）：
 * - `POST /api/threads/:id/messages` 此前只在**第一个业务事件**时才写第一个字节。本轮在写出前
 *   还要等 MCP 就绪、意图聚焦判定（预算 10s）与模型首 token，这段静默对中间设备而言就是"空闲"，
 *   代理 / 负载均衡按空闲时长掐连接（常见 60s，网关更短），用户看到网络失败而后端已跑完并落盘。
 * - 首帧与心跳都是**注释行**（`: ` 开头）。SSE 规范要求客户端忽略注释，前端解析器已如此
 *   （`frontend/src/utils/sse-parser.ts` 的 `parseBlock` 跳过 `:` 行），因此前端零改动、
 *   事件集合与载荷零变化。
 *
 * 形态与既有 `produced` / `scheduled-task` / `mcp-status` 三处 SSE 一致：建连即写一帧、
 * 定时心跳、连接关闭时清定时器。差异只在"首帧是注释"——聊天流没有可立即推送的快照。
 */

/**
 * 心跳间隔。
 *
 * 取 15s：须显著小于常见空闲超时（Nginx `proxy_read_timeout` 60s、云 LB 15~60s），
 * 才能在"判定 + 首 token 较慢"时仍然保住连接。注释帧零负载，频率提高没有成本。
 */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * 结构性依赖：只要求"能写 / 能结束 / 是否已结束"。
 *
 * 刻意不要求 `flushHeaders`——`light-my-request` 的假 Response（`app.inject` 用）没有该方法，
 * 而写首帧本身就会把响应头一并冲出去，故不需要它。
 */
export interface SseRawSink {
  write(chunk: string): boolean;
  end(...args: []): unknown;
  readonly writableEnded?: boolean;
}

export interface SseConnection {
  /** 写一个业务事件（`event: <type>` + `data: <json>`） */
  event(type: string, data: unknown): void;
  /** 释放定时器（连接已断 / 已由别处接管），**不**结束响应 */
  dispose(): void;
  /** 释放定时器并结束响应（本轮终结事件之后调用，幂等） */
  finish(): void;
}

/**
 * 建立一条 SSE 连接：先写首帧注释，再起心跳。
 *
 * 幂等性与安全性：
 * - `finish` / `dispose` 可重复调用，第二次起为 no-op；
 * - 释放之后 `event` 不再写（避免 `write after end`）；
 * - 心跳在 `writableEnded` 后自动跳过。
 */
export function openSseConnection(
  raw: SseRawSink,
  options: { heartbeatMs?: number } = {},
): SseConnection {
  // 首帧：让响应头与首个字节立刻送达，把"建连耗时"与"首个 token 耗时"解耦
  raw.write(': connected\n\n');

  let closed = false;
  let ended = false;
  const timer = setInterval(() => {
    if (closed || raw.writableEnded === true) return;
    raw.write(': ping\n\n');
  }, options.heartbeatMs ?? SSE_HEARTBEAT_MS);
  // 不拖住进程退出（测试收尾 / 优雅关闭）；浏览器侧无此方法，故可选调用
  timer.unref?.();

  const dispose = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
  };

  return {
    event(type: string, data: unknown): void {
      if (closed) return;
      raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    dispose,
    finish(): void {
      if (ended) return;
      ended = true;
      dispose();
      raw.end();
    },
  };
}

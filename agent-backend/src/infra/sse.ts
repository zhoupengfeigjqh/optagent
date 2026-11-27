
/**
 * 心跳间隔。
 *
 * 取 15s：须显著小于常见空闲超时（Nginx `proxy_read_timeout` 60s、云 LB 15~60s），
 * 才能在"判定 + 首 token 较慢"时仍然保住连接。注释帧零负载，频率提高没有成本。
 */
export const SSE_HEARTBEAT_MS = 15_000;

export interface SseRawSink {
  write(chunk: string): boolean;
  end(...args: []): unknown;
  readonly writableEnded?: boolean;
  once?(event: 'close' | 'error', listener: () => void): unknown;
}

export function onSseDisconnect(raw: SseRawSink, cleanup: () => void): void {
  let fired = false;
  const once = (): void => {
    if (fired) return;
    fired = true;
    cleanup();
  };
  raw.once?.('close', once);
  raw.once?.('error', once);
}

export interface SseConnection {
  event(type: string, data: unknown): void;
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
  raw.write(': connected\n\n');

  let closed = false;
  let ended = false;
  const timer = setInterval(() => {
    if (closed || raw.writableEnded === true) return;
    raw.write(': ping\n\n');
  }, options.heartbeatMs ?? SSE_HEARTBEAT_MS);
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

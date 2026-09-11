/**
 * 可编程假 LlmProvider：供集成测试复现断连/stop 时序，不烧真 API。
 *
 * 用法：预设事件脚本（含 waitFor 信号点），推送 N 段后停住等信号再推；
 * signal abort 时按 LlmProvider 契约产出 error(ABORTED)。
 */
import type { LlmChatRequest, LlmProvider } from '../../src/infra/llm/llm-provider';
import type { LlmEvent } from '../../src/types';

/** 脚本步：直接事件，或等待外部信号（resume()）后继续 */
export type FakeStep = LlmEvent | { type: 'wait'; id: string };

export class FakeLlmProvider implements LlmProvider {
  private readonly waits = new Map<string, () => void>();
  /** 已收到的请求（断言用） */
  readonly requests: LlmChatRequest[] = [];

  constructor(private readonly script: FakeStep[]) {}

  /** 触发脚本中的等待点继续 */
  resume(id: string): void {
    this.waits.get(id)?.();
    this.waits.delete(id);
  }

  /** 等待某个 wait 点到达（测试用：确认推到一半停住了） */
  reached(id: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (this.waits.has(id)) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });
  }

  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    this.requests.push(req);
    const aborted: LlmEvent = {
      type: 'error',
      code: 'ABORTED',
      message: '已中断',
      usage: { inputTokens: 3, outputTokens: 2 },
    };
    for (const step of this.script) {
      if (req.signal.aborted) {
        yield aborted;
        return;
      }
      if (step.type === 'wait') {
        const id = (step as { id: string }).id;
        await new Promise<void>((resolve) => {
          this.waits.set(id, resolve);
          req.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        if (req.signal.aborted) {
          yield aborted;
          return;
        }
        continue;
      }
      yield step;
    }
  }
}

/** 常用脚本构造：thinking + content + done */
export function simpleScript(content: string, thinking?: string): FakeStep[] {
  const steps: FakeStep[] = [];
  if (thinking) steps.push({ type: 'thinking_delta', delta: thinking });
  steps.push({ type: 'content_delta', delta: content });
  steps.push({ type: 'done', usage: { inputTokens: 10, outputTokens: 5 } });
  return steps;
}

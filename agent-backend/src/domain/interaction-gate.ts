
function genInteractionId(now: number): string {
  return `i_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface InteractionRequestInput {
  callId: string;
  toolName: string;
  toolLabel?: string;
  toolDescription?: string;
  schema: Record<string, unknown>;
  proposedArgs: Record<string, unknown>;
  rulesField?: string;
  /** 挂起超时（秒）；缺省 300 */
  timeoutSeconds?: number;
}

export interface InteractionRequestPayload {
  interaction_id: string;
  call_id: string;
  tool_name: string;
  /**
   * 工具的人读名称（2026-10-27）：弹窗"工具："一行与窗口标题都用它。
   * **恒为字符串**（无中文名时等于 `tool_name`），前端仍保留 `|| tool_name` 兼容旧快照。
   */
  tool_label: string;
  tool_description: string;
  title: string;
  schema: Record<string, unknown>;
  proposed_args: Record<string, unknown>;
  required: string[];
  timeout_seconds: number;
  rules_field?: string;
}

export interface InteractionSnapshot extends InteractionRequestPayload {
  remaining_seconds: number;
}

/**
 * 挂起解除时的结局。
 *
 * `reject.reason`（2026-10-29）：区分"用户主动拒绝"与"本轮被中断/收尾"。
 * 两者的工具结果都要标红，但**文案必须不同**——中断不是用户的决定，
 * 写"用户拒绝了本次调用"是错误归因（宪章原则九：不假装正常）。
 */
export type InteractionOutcome =
  | { kind: 'submit'; args: Record<string, unknown> }
  | { kind: 'reject'; reason: 'user' | 'aborted' }
  | { kind: 'expired' };

export interface InteractionSink {
  request(input: InteractionRequestInput): Promise<InteractionOutcome>;
}

export type SettleResult =
  | { result: 'settled'; outcome: InteractionOutcome }
  | { result: 'already-resolved'; outcome: InteractionOutcome }
  | { result: 'expired' }
  | { result: 'not-found' };

export interface InteractionGateDeps {
  /** 单 run 同时挂起的上限（默认 3），超出 FIFO 排队 */
  maxPending?: number;
  now?: () => number;
  onCreated?: (payload: InteractionRequestPayload) => void;
  onLog?: (msg: string) => void;
}

interface PendingEntry {
  state: 'waiting' | 'resolved' | 'expired';
  payload: InteractionRequestPayload;
  resolve: (outcome: InteractionOutcome) => void;
  outcome?: InteractionOutcome;
  timer?: ReturnType<typeof setTimeout>;
  createdAt: number;
}

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_MAX_PENDING = 3;

export class InteractionGate {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly waiters: Array<() => void> = [];
  private readonly maxPending: number;
  private readonly now: () => number;
  private disposed = false;

  constructor(private readonly deps: InteractionGateDeps = {}) {
    this.maxPending = deps.maxPending ?? DEFAULT_MAX_PENDING;
    this.now = deps.now ?? Date.now;
  }

  async request(input: InteractionRequestInput): Promise<InteractionOutcome> {
    if (this.disposed) return { kind: 'reject', reason: 'aborted' };
    if (this.waitingSize() >= this.maxPending) {
      await this.acquireSlot();
      if (this.disposed) return { kind: 'reject', reason: 'aborted' };
    }

    const createdAt = this.now();
    const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    const toolLabel =
      typeof input.toolLabel === 'string' && input.toolLabel.trim() !== ''
        ? input.toolLabel.trim()
        : input.toolName;
    const payload: InteractionRequestPayload = {
      interaction_id: genInteractionId(createdAt),
      call_id: input.callId,
      tool_name: input.toolName,
      tool_label: toolLabel,
      tool_description: typeof input.toolDescription === 'string' ? input.toolDescription : '',
      title: `确认调用参数：${toolLabel}`,
      schema: input.schema,
      proposed_args: input.proposedArgs,
      required: extractRequired(input.schema),
      timeout_seconds: timeoutSeconds,
      ...(input.rulesField ? { rules_field: input.rulesField } : {}),
    };

    let resolveFn!: (outcome: InteractionOutcome) => void;
    const promise = new Promise<InteractionOutcome>((resolve) => {
      resolveFn = resolve;
    });
    const entry: PendingEntry = {
      state: 'waiting',
      payload,
      resolve: resolveFn,
      createdAt,
    };
    entry.timer = setTimeout(() => this.expire(payload.interaction_id), timeoutSeconds * 1000);
    this.pending.set(payload.interaction_id, entry);

    this.deps.onCreated?.(payload);
    this.deps.onLog?.(
      `interaction 挂起：${payload.tool_name}（${payload.interaction_id}，超时 ${timeoutSeconds}s）`,
    );
    return promise;
  }

  /**
   * 用户提交（submit，带 args）或拒绝（reject）。
   * 幂等：重复 settle 返回首次结果；expired/not-found 返回对应状态不生效。
   */
  settle(
    interactionId: string,
    action: 'submit' | 'reject',
    args?: Record<string, unknown>,
  ): SettleResult {
    const entry = this.pending.get(interactionId);
    if (!entry) return { result: 'not-found' };
    if (entry.state === 'expired') return { result: 'expired' };
    if (entry.state === 'resolved') {
      return { result: 'already-resolved', outcome: entry.outcome! };
    }
    const outcome: InteractionOutcome =
      action === 'submit'
        ? { kind: 'submit', args: args ?? {} }
        : { kind: 'reject', reason: 'user' };
    this.resolveEntry(entry, outcome);
    this.deps.onLog?.(
      `interaction ${outcome.kind === 'submit' ? '已提交' : '被拒绝'}：${entry.payload.tool_name}（${interactionId}）`,
    );
    return { result: 'settled', outcome };
  }

  drain(): void {
    for (const entry of this.pending.values()) {
      if (entry.state === 'waiting') {
        this.resolveEntry(entry, { kind: 'reject', reason: 'aborted' });
        this.deps.onLog?.(
          `interaction 因中断收尾：${entry.payload.tool_name}（${entry.payload.interaction_id}）`,
        );
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.drain();
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.pending.clear();
    this.flushWaiters();
  }

  snapshot(): InteractionSnapshot | null {
    for (const entry of this.pending.values()) {
      if (entry.state !== 'waiting') continue;
      const elapsed = Math.floor((this.now() - entry.createdAt) / 1000);
      return {
        ...entry.payload,
        remaining_seconds: Math.max(0, entry.payload.timeout_seconds - elapsed),
      };
    }
    return null;
  }

  waitingCount(): number {
    let n = 0;
    for (const entry of this.pending.values()) {
      if (entry.state === 'waiting') n++;
    }
    return n;
  }

  pendingOf(
    interactionId: string,
  ): { state: 'waiting' | 'resolved' | 'expired'; payload: InteractionRequestPayload } | null {
    const entry = this.pending.get(interactionId);
    if (!entry) return null;
    return { state: entry.state, payload: entry.payload };
  }

  private expire(interactionId: string): void {
    const entry = this.pending.get(interactionId);
    if (!entry || entry.state !== 'waiting') return;
    entry.state = 'expired';
    entry.outcome = { kind: 'expired' };
    entry.resolve({ kind: 'expired' });
    this.releaseSlot();
    this.deps.onLog?.(`interaction 超时过期：${entry.payload.tool_name}（${interactionId}）`);
  }

  private resolveEntry(entry: PendingEntry, outcome: InteractionOutcome): void {
    entry.state = 'resolved';
    entry.outcome = outcome;
    if (entry.timer) clearTimeout(entry.timer);
    this.releaseSlot();
    entry.resolve(outcome);
  }

  /** 并发上限：超出则 FIFO 排队，等前一挂起点落定（settle/expire/drain 都释放槽位）。
   *  槽位按**等待中**的数量计——已落定/过期的条目为幂等读留档，不占槽位。 */
  private async acquireSlot(): Promise<void> {
    while (this.waitingSize() >= this.maxPending) {
      this.deps.onLog?.('interaction 达并发上限，排队等待');
      await new Promise<void>((release) => {
        this.waiters.push(release);
      });
    }
  }

  private waitingSize(): number {
    let n = 0;
    for (const entry of this.pending.values()) {
      if (entry.state === 'waiting') n++;
    }
    return n;
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    next?.();
  }

  private flushWaiters(): void {
    while (this.waiters.length > 0) {
      this.waiters.shift()!();
    }
  }
}

function extractRequired(schema: Record<string, unknown>): string[] {
  const required = schema.required;
  return Array.isArray(required) ? required.filter((r): r is string => typeof r === 'string') : [];
}

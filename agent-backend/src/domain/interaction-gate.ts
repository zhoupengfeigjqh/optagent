/**
 * 交互门（HITL，Human-in-the-loop）：工具调用执行前的人工确认挂起/恢复。
 *
 * 职责（纯领域逻辑，不依赖 Fastify/pi）：
 * - `request()`：发出 interaction_request 事件并**挂起**当前工具调用，
 *   直到用户 submit（返回确认参数）/ reject / 超时 / run 被中断
 * - `settle()`：用户提交/拒绝（幂等：重复 settle 返回首次结果）
 * - 并发上限（默认 3）：超出排 FIFO 队，前一 interaction 落定才放行下一个
 * - `drain()`：run 被 stop 时全部挂起点按 reject 收尾，杜绝泄漏
 * - `dispose()`：run 结束时清理全部状态（含 expired 留档）
 *
 * 与 run-manager 的关系：每个 RunImpl 持有一个 gate；
 * run-manager 负责把 SSE 事件广播给订阅者，gate 只管挂起语义本身。
 */

/** interaction_id 生成：i_{base36时间}_{4位随机}（与 genMessageId 同风格） */
function genInteractionId(now: number): string {
  return `i_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 发给工具包装器的挂起请求输入 */
export interface InteractionRequestInput {
  /** LLM 的 tool_call_id（展示与配对用） */
  callId: string;
  /** AgentTool 全名（server__tool 形式） */
  toolName: string;
  /** 工具级描述（schema 的 description；弹窗头部一句话说明用） */
  toolDescription?: string;
  /** 工具入参 JSON Schema（经 exposeSchema 处理后的可见形态） */
  schema: Record<string, unknown>;
  /** 模型提议的参数值（预填，用户可改） */
  proposedArgs: Record<string, unknown>;
  /** 挂起超时（秒）；缺省 300 */
  timeoutSeconds?: number;
}

/** SSE interaction_request 事件的 data（HTTP 契约投影） */
export interface InteractionRequestPayload {
  interaction_id: string;
  call_id: string;
  tool_name: string;
  /** 工具级描述（可空串：老调用方/无描述工具不阻断主流程） */
  tool_description: string;
  title: string;
  schema: Record<string, unknown>;
  proposed_args: Record<string, unknown>;
  required: string[];
  timeout_seconds: number;
}

/** 断连恢复用的快照：payload + 剩余等待秒数 */
export interface InteractionSnapshot extends InteractionRequestPayload {
  remaining_seconds: number;
}

/** 挂起解除时的结局 */
export type InteractionOutcome =
  | { kind: 'submit'; args: Record<string, unknown> }
  | { kind: 'reject' }
  | { kind: 'expired' };

/** 工具包装器经 AgentRunRequest 拿到的交互口（run-manager 每 run 装配一个） */
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
  /** 注入时钟（测试用） */
  now?: () => number;
  /** 挂起点建立时回调（run-manager 用来广播 SSE 事件） */
  onCreated?: (payload: InteractionRequestPayload) => void;
  /** 生命周期日志（created/submitted/rejected/expired/queued） */
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

  /**
   * 挂起：发出事件 → 等待用户输入。
   * resolve 值：submit=确认参数；reject/expired/run 中断 = 对应 outcome。
   * gate 已 dispose 时立即返回 reject（防御：run 收尾后不应再有新挂起）。
   *
   * 有槽位时**同步**创建挂起点（不经 await）：调用方在首个 await 之前
   * 即可见 snapshot/pendingOf/收到 SSE 事件——否则"request 返回后立刻查询"
   * 会拿到 null（微任务让出导致的时序坑，测试首轮即暴露）。
   */
  async request(input: InteractionRequestInput): Promise<InteractionOutcome> {
    if (this.disposed) return { kind: 'reject' };
    if (this.waitingSize() >= this.maxPending) {
      await this.acquireSlot();
      if (this.disposed) return { kind: 'reject' };
    }

    const createdAt = this.now();
    const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    const payload: InteractionRequestPayload = {
      interaction_id: genInteractionId(createdAt),
      call_id: input.callId,
      tool_name: input.toolName,
      tool_description: typeof input.toolDescription === 'string' ? input.toolDescription : '',
      title: `确认调用参数：${input.toolName}`,
      schema: input.schema,
      proposed_args: input.proposedArgs,
      required: extractRequired(input.schema),
      timeout_seconds: timeoutSeconds,
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
      action === 'submit' ? { kind: 'submit', args: args ?? {} } : { kind: 'reject' };
    this.resolveEntry(entry, outcome);
    this.deps.onLog?.(
      `interaction ${outcome.kind === 'submit' ? '已提交' : '被拒绝'}：${entry.payload.tool_name}（${interactionId}）`,
    );
    return { result: 'settled', outcome };
  }

  /** run 被 stop / 中断：全部挂起点按 reject 收尾（等待中的排队请求也随即放行并返回 reject） */
  drain(): void {
    for (const entry of this.pending.values()) {
      if (entry.state === 'waiting') {
        this.resolveEntry(entry, { kind: 'reject' });
        this.deps.onLog?.(`interaction 因中断收尾：${entry.payload.tool_name}（${entry.payload.interaction_id}）`);
      }
    }
  }

  /** run 结束：清理全部状态（含 expired 留档），此后 request 立即 reject */
  dispose(): void {
    this.disposed = true;
    this.drain();
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.pending.clear();
    this.flushWaiters();
  }

  /** 当前等待中的 interaction 快照（断连恢复用；无则 null） */
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

  /** 等待中的数量（监控/测试用） */
  waitingCount(): number {
    let n = 0;
    for (const entry of this.pending.values()) {
      if (entry.state === 'waiting') n++;
    }
    return n;
  }

  /** 查询单个 interaction 的状态与负载（提交前取 schema 终验用） */
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

/** 从 schema 提取 required 列表（前端标星用；形状非法时退化为空） */
function extractRequired(schema: Record<string, unknown>): string[] {
  const required = schema.required;
  return Array.isArray(required) ? required.filter((r): r is string => typeof r === 'string') : [];
}

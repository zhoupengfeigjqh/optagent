/**
 * 定时任务路由（015，契约 `contracts/scheduled-tasks-api.md`）：
 * - `GET    /api/scheduled-tasks`               任务列表（`created_at` 倒序 + 派生字段）
 * - `POST   /api/scheduled-tasks`               创建（不自动启用）
 * - `PATCH  /api/scheduled-tasks/:id`           编辑（2026-10-30 增补：停用中才可改）
 * - `PATCH  /api/scheduled-tasks/:id/enabled`   启用 / 停用
 * - `DELETE /api/scheduled-tasks/:id`           删除（启用中拒绝）
 * - `GET    /api/scheduled-tasks/runs`          运行记录（倒序 + 筛选 + 封顶）
 * - `GET    /api/scheduled-tasks/events`        变更信号 SSE（负载为空）
 *
 * 三条职责边界（宪章原则二/七）：
 * 1. **作用域**一律取"当前用户 + 当前选中数字人"（`resolveAgentScope`）：任务归属由
 *    目录位置承载，跨数字人访问天然落到 `404 SCHEDULED_TASK_NOT_FOUND`，不泄露存在性；
 * 2. **派生字段由 `domain/scheduled-task-schedule.ts` 现算**（`status` / `terminated` /
 *    `can_start`），路由只做响应映射——前端因此不必再推导一遍（两处口径必然漂移）；
 * 3. **运行记录的"会话是否还在"**由 `ThreadStore.exists` 判定（域层），路由不碰文件系统。
 *
 * 字段级校验用 `details: ['字段名: 说明']`（首个不符即拒绝，与 Fastify schema 的
 * first-error 口径一致）：`ApiError.details` 沿用既有 `string[]`，不为此新增第二种错误体。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { getCurrentUser } from '../domain/current-user.js';
import {
  advanceToFuture,
  canStart,
  deriveStatus,
  firstRunAt,
  isTerminated,
} from '../domain/scheduled-task-schedule.js';
import type { ScheduleRun } from '../domain/scheduled-task-run-store.js';
import {
  ScheduledTaskExhaustedError,
  TASK_NAME_MAX,
  TASK_PROMPT_MAX,
  type CreateScheduledTaskInput,
  type ScheduledTask,
  type UpdateScheduledTaskInput,
} from '../domain/scheduled-task-store.js';
import { ApiError } from '../server.js';

/** 运行记录默认条数（契约 §5） */
const RUN_LIMIT_DEFAULT = 50;

const createBodySchema = {
  type: 'object',
  required: ['name', 'prompt', 'start_at', 'interval_seconds', 'max_runs', 'deadline_at'],
  additionalProperties: false,
  properties: {
    // 上限只做"明显超标"的第一道拦截，真正的字数口径在 `validateCreate`（按 Unicode 码点）
    name: { type: 'string', minLength: 1 },
    prompt: { type: 'string', minLength: 1 },
    thinking: { type: 'boolean' },
    start_at: { type: 'string', minLength: 1 },
    interval_seconds: { type: 'integer', minimum: 1 },
    max_runs: { type: 'integer', minimum: 1 },
    deadline_at: { type: 'string', minLength: 1 },
    // 015 增补：创建后不可修改（`FR-060`），故只出现在创建体里
    new_thread_per_run: { type: 'boolean' },
  },
} as const;

/**
 * 编辑请求体（2026-10-30 增补）：与创建同 7 项、**整份替换**（不是字段级 PATCH）。
 *
 * 刻意不含 `new_thread_per_run`：会话模式创建后不可改（`FR-060`），
 * 出现该字段按"未声明字段"直接 400，而不是静默忽略。
 */
const updateBodySchema = {
  type: 'object',
  required: ['name', 'prompt', 'start_at', 'interval_seconds', 'max_runs', 'deadline_at'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    prompt: { type: 'string', minLength: 1 },
    thinking: { type: 'boolean' },
    start_at: { type: 'string', minLength: 1 },
    interval_seconds: { type: 'integer', minimum: 1 },
    max_runs: { type: 'integer', minimum: 1 },
    deadline_at: { type: 'string', minLength: 1 },
  },
} as const;

const enabledBodySchema = {
  type: 'object',
  required: ['enabled'],
  additionalProperties: false,
  properties: { enabled: { type: 'boolean' } },
} as const;

const runsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', minLength: 1 },
    limit: { type: 'string', pattern: '^[0-9]+$' },
  },
} as const;

/** 允许出现的字段（与 schema 的 properties 同源，避免两处清单漂移） */
const CREATE_FIELDS = new Set(Object.keys(createBodySchema.properties));
const UPDATE_FIELDS = new Set(Object.keys(updateBodySchema.properties));
const ENABLED_FIELDS = new Set(Object.keys(enabledBodySchema.properties));

/**
 * 拒绝未声明字段（`preValidation`）。
 *
 * 为什么不能只靠 `additionalProperties: false`：Fastify 默认 ajv 配置是
 * `removeAdditional: true`——多余字段会被**静默删掉**而不是报错。对"创建任务"这种
 * 一次性配置来说，静默丢字段只表现为"我明明传了却没生效"，没有任何报错可循
 * （与 `routes/chat.ts` 的 `skip_intent_focus` 同一类问题）。
 *
 * 作用域仅限本文件的两个端点，不动全局 ajv 选项。
 */
function assertKnownFields(allowed: ReadonlySet<string>, body: unknown): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
  const unknown = Object.keys(body as Record<string, unknown>).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    invalid(unknown[0]!, `不支持的请求字段: ${unknown.join(', ')}`);
  }
}

/** 创建与编辑共有的 7 项可编辑字段 */
interface EditableBody {
  name: string;
  prompt: string;
  thinking?: boolean;
  start_at: string;
  interval_seconds: number;
  max_runs: number;
  deadline_at: string;
}

interface CreateBody extends EditableBody {
  new_thread_per_run?: boolean;
}

type UpdateBody = EditableBody;

/** 字段级拒绝：消息给人读，`details` 带字段名供前端定位 */
function invalid(field: string, message: string): never {
  throw new ApiError(400, 'VALIDATION_FAILED', message, [`${field}: ${message}`]);
}

function parseInstant(field: string, raw: string, label: string): number {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) invalid(field, `${label}格式不是合法的日期时间`);
  return ms;
}

/**
 * 可编辑字段的语义校验（创建与编辑共用，`SC-006` 的 7 项非法输入）。
 *
 * 与 JSON Schema 的分工：schema 管类型与形状（多字段 → 400），这里管**语义**
 * （trim 后长度、时间先后、未来时刻），并给出可直接展示的中文说明。
 *
 * `options.requireFutureStart` 的差别只有一处：编辑允许保留**已过去**的开始时刻——
 * 它表示"改完配置后这份计划从哪一刻算起"，启用时由 `PATCH enabled` 推进到未来
 * （不补跑，`FR-045` 同口径）。否则"只改个名字"也会被开始时间已过挡住。
 */
function validateEditable(
  body: EditableBody,
  nowMs: number,
  options: { requireFutureStart: boolean },
): UpdateScheduledTaskInput {
  const name = body.name.trim();
  if (name === '') invalid('name', '任务名称不能为空');
  if ([...name].length > TASK_NAME_MAX) {
    invalid('name', `任务名称不能超过 ${TASK_NAME_MAX} 个字符`);
  }
  const prompt = body.prompt.trim();
  if (prompt === '') invalid('prompt', '任务提示词不能为空');
  if ([...prompt].length > TASK_PROMPT_MAX) {
    invalid('prompt', `任务提示词不能超过 ${TASK_PROMPT_MAX} 个字符`);
  }
  const startMs = parseInstant('start_at', body.start_at, '执行开始时间');
  if (options.requireFutureStart && startMs <= nowMs) {
    invalid('start_at', '执行开始时间必须晚于当前时刻');
  }
  const deadlineMs = parseInstant('deadline_at', body.deadline_at, '有效截止时间');
  if (deadlineMs <= startMs) invalid('deadline_at', '有效截止时间必须晚于执行开始时间');
  if (!Number.isInteger(body.interval_seconds) || body.interval_seconds < 1) {
    invalid('interval_seconds', '执行间隔秒数必须是 ≥1 的整数');
  }
  if (!Number.isInteger(body.max_runs) || body.max_runs < 1) {
    invalid('max_runs', '执行次数必须是 ≥1 的整数');
  }
  return {
    name,
    prompt,
    thinking: body.thinking ?? false,
    startAt: new Date(startMs).toISOString(),
    intervalSeconds: body.interval_seconds,
    maxRuns: body.max_runs,
    deadlineAt: new Date(deadlineMs).toISOString(),
  };
}

/** 创建入参：7 项可编辑字段 + 会话模式缺省（`FR-059`/`FR-064`） */
function validateCreate(body: CreateBody, nowMs: number): CreateScheduledTaskInput {
  return {
    ...validateEditable(body, nowMs, { requireFutureStart: true }),
    // 缺省 = 每次新建会话（升级前创建的任务同样按此处理，`FR-064`）
    newThreadPerRun: body.new_thread_per_run ?? true,
  };
}

/** 编辑入参：7 项可编辑字段，整份替换（`FR-066`） */
function validateUpdate(body: UpdateBody, nowMs: number): UpdateScheduledTaskInput {
  return validateEditable(body, nowMs, { requireFutureStart: false });
}

/** 任务 → HTTP 契约（`reused_thread_id` 是服务端内部字段，不下发） */
function taskJson(task: ScheduledTask, nowMs: number) {
  return {
    task_id: task.taskId,
    name: task.name,
    prompt: task.prompt,
    thinking: task.thinking,
    start_at: task.startAt,
    interval_seconds: task.intervalSeconds,
    max_runs: task.maxRuns,
    deadline_at: task.deadlineAt,
    new_thread_per_run: task.newThreadPerRun !== false,
    enabled: task.enabled,
    executed_count: task.executedCount,
    status: deriveStatus(task, nowMs),
    terminated: isTerminated(task, nowMs),
    can_start: canStart(task, nowMs),
    disabled_reason: task.disabledReason,
    next_run_at: task.nextRunAt,
    last_run_at: task.lastRunAt,
    agent_name: task.agentName,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

/** 运行记录 → HTTP 契约（`thread_deleted` 由调用方按会话存在性回填） */
function runJson(run: ScheduleRun, threadDeleted: boolean) {
  return {
    run_id: run.runId,
    task_id: run.taskId,
    task_name: run.taskName,
    triggered_at: run.triggeredAt,
    finished_at: run.finishedAt,
    result: run.result,
    reason: run.reason,
    reason_text: run.reasonText,
    thread_id: run.threadId,
    thread_title: run.threadTitle,
    rebuilt: run.rebuilt === true,
    thread_deleted: threadDeleted,
  };
}

/** 列表读取的统一入口：损坏必须暴露（500 + 日志），MUST NOT 返回空数组冒充"还没有任务" */
function listTasks(ctx: AppContext, userId: string, agentName: string, route: string) {
  try {
    return ctx.scheduled.store.list(userId, agentName);
  } catch (err) {
    ctx.loggers.logger.error(
      { err, event: 'scheduled_task.list.failed', user_id: userId, agent_name: agentName, route },
      '定时任务数据损坏，无法读取列表',
    );
    throw err;
  }
}

export function registerScheduledTaskRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/scheduled-tasks', async () => {
    const userId = getCurrentUser().userId;
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人后再管理定时任务',
      route: 'GET /api/scheduled-tasks',
    });
    const nowMs = Date.now();
    const tasks = listTasks(ctx, userId, agentName, 'GET /api/scheduled-tasks');
    // 新建的排在最前（与左栏会话列表同口径：最近创建的更可能是刚配好的那个）
    const sorted = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { tasks: sorted.map((task) => taskJson(task, nowMs)) };
  });

  app.post(
    '/api/scheduled-tasks',
    {
      schema: { body: createBodySchema },
      preValidation: async (req) => assertKnownFields(CREATE_FIELDS, req.body),
    },
    async (req, reply) => {
      const userId = getCurrentUser().userId;
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人后再创建定时任务',
        route: 'POST /api/scheduled-tasks',
      });
      const input = validateCreate(req.body as CreateBody, Date.now());
      // 名称冲突由 store 判定（同域唯一），抛 `SCHEDULED_TASK_NAME_CONFLICT` → 409
      const task = ctx.scheduled.store.create(userId, agentName, input);
      ctx.scheduled.events.emitChanged(userId);
      ctx.loggers.logger.info(
        {
          event: 'scheduled_task.created',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
          interval_seconds: task.intervalSeconds,
          max_runs: task.maxRuns,
          new_thread_per_run: task.newThreadPerRun,
        },
        `定时任务已创建：${task.name}（未启用）`,
      );
      return reply.status(201).send({ task: taskJson(task, Date.now()) });
    },
  );

  /**
   * 编辑（2026-10-30 增补，`FR-065`~`FR-069`）：整份替换 7 项可编辑字段。
   *
   * 拒绝条件全部落在 store（唯一判据来源）：不存在 → 404、启用中 → 409、
   * 同域重名 → 409。会话模式不在请求体里（`FR-060`）。
   */
  app.patch(
    '/api/scheduled-tasks/:id',
    {
      schema: { body: updateBodySchema },
      preValidation: async (req) => assertKnownFields(UPDATE_FIELDS, req.body),
    },
    async (req) => {
      const userId = getCurrentUser().userId;
      const { id: taskId } = req.params as { id: string };
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人后再编辑定时任务',
        route: 'PATCH /api/scheduled-tasks/:id',
      });
      const input = validateUpdate(req.body as UpdateBody, Date.now());
      const task = ctx.scheduled.store.update(userId, agentName, taskId, input);
      ctx.scheduled.events.emitChanged(userId);
      ctx.loggers.logger.info(
        {
          event: 'scheduled_task.updated',
          user_id: userId,
          agent_name: agentName,
          task_id: taskId,
          interval_seconds: task.intervalSeconds,
          max_runs: task.maxRuns,
          start_at: task.startAt,
        },
        `定时任务已编辑：${task.name}`,
      );
      return { task: taskJson(task, Date.now()) };
    },
  );

  app.patch(
    '/api/scheduled-tasks/:id/enabled',
    {
      schema: { body: enabledBodySchema },
      preValidation: async (req) => assertKnownFields(ENABLED_FIELDS, req.body),
    },
    async (req) => {
      const userId = getCurrentUser().userId;
      const { id: taskId } = req.params as { id: string };
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人后再管理定时任务',
        route: 'PATCH /api/scheduled-tasks/:id/enabled',
      });
      const { enabled } = req.body as { enabled: boolean };
      const task = ctx.scheduled.store.get(userId, agentName, taskId); // 不存在 → 404
      const nowMs = Date.now();

      let updated: ScheduledTask;
      if (enabled) {
        // 次数用尽 / 已过截止：拒绝启动（不产生"打开了但不执行"的假状态，FR-016）
        if (isTerminated(task, nowMs)) throw new ScheduledTaskExhaustedError(task.name);
        const base = task.nextRunAt === null ? firstRunAt(task.startAt) : Date.parse(task.nextRunAt);
        const from = Number.isFinite(base) ? base : nowMs;
        // 落在过去的计划时刻推进到未来，不补跑（FR-045 同口径）
        const nextMs = advanceToFuture(from, task.intervalSeconds, nowMs);
        updated = ctx.scheduled.store.setEnabled(
          userId,
          agentName,
          taskId,
          true,
          new Date(nextMs).toISOString(),
        );
      } else {
        // 停用不中断已开始的那一轮（FR-015），只阻止后续触发
        updated = ctx.scheduled.store.setEnabled(userId, agentName, taskId, false);
      }
      ctx.scheduled.events.emitChanged(userId);
      ctx.loggers.logger.info(
        {
          event: 'scheduled_task.enabled.changed',
          user_id: userId,
          agent_name: agentName,
          task_id: taskId,
          enabled,
          next_run_at: updated.nextRunAt,
        },
        enabled ? `定时任务已启用：${task.name}` : `定时任务已停用：${task.name}`,
      );
      return { task: taskJson(updated, Date.now()) };
    },
  );

  app.delete('/api/scheduled-tasks/:id', async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { id: taskId } = req.params as { id: string };
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人后再管理定时任务',
      route: 'DELETE /api/scheduled-tasks/:id',
    });
    // 启用中直接 409（`FR-018`）；停用则原子移除（一次临时文件 + rename）
    ctx.scheduled.store.remove(userId, agentName, taskId);
    ctx.scheduled.events.emitChanged(userId);
    ctx.loggers.logger.info(
      { event: 'scheduled_task.deleted', user_id: userId, agent_name: agentName, task_id: taskId },
      '定时任务已删除（会话与历史保留）',
    );
    return reply.status(204).send();
  });

  app.get('/api/scheduled-tasks/runs', { schema: { querystring: runsQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人后再查看运行记录',
      route: 'GET /api/scheduled-tasks/runs',
    });
    const query = req.query as { task_id?: string; limit?: string };
    const requested = query.limit === undefined ? RUN_LIMIT_DEFAULT : Number(query.limit);
    const limit = Number.isFinite(requested) ? Math.floor(requested) : RUN_LIMIT_DEFAULT;

    // 仍存在的任务 = 记录可见范围（`FR-022`：任务删除后其记录不再出现）
    const tasks = listTasks(ctx, userId, agentName, 'GET /api/scheduled-tasks/runs');
    const { runs, total } = ctx.scheduled.runs.read(userId, agentName, {
      ...(query.task_id === undefined ? {} : { taskId: query.task_id }),
      onlyTaskIds: tasks.map((task) => task.taskId),
      limit,
    });

    // 会话存在性：按**去重后**的 thread_id 判定，不逐条查（避免 N+1）
    const deleted = new Map<string, boolean>();
    const isDeleted = (threadId: string): boolean => {
      let value = deleted.get(threadId);
      if (value === undefined) {
        value = !ctx.threadStore.exists(userId, agentName, threadId);
        deleted.set(threadId, value);
      }
      return value;
    };
    return {
      runs: runs.map((run) =>
        runJson(run, run.threadId === null ? false : isDeleted(run.threadId)),
      ),
      total,
    };
  });

  app.get('/api/scheduled-tasks/events', (req, reply) => {
    const userId = getCurrentUser().userId;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    // 建连即推一次：客户端不必判断"是不是还没变化"
    const push = (): void => {
      reply.raw.write('event: scheduled-task\ndata: \n\n');
    };
    push();
    // 总线已按 userId 分桶：订阅本用户即可，不必再过滤
    const unsubscribe = ctx.scheduled.events.onChanged(userId, push);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}

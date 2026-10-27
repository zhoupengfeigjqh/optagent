/**
 * 单轮执行（从 `run-manager.ts` 拆出，2026-10-25 / 013）。
 *
 * 拆分理由（宪章原则二）：`run-manager.ts` 因历次特性累积到 539 行（越过 500 硬门禁），
 * 而本特性必然触及它。这里承接的是**"一轮怎么跑完"**（组装 prompt、消费事件流、收尾），
 * `run-manager.ts` 只留**生命周期编排**（配额、活跃表、startRun/stop）。
 *
 * **纯搬运 + 013 新增判定口**：事件顺序、落盘顺序、日志字段与拆分前逐字一致。
 */
import type { HistoryMessage, RunRuntime } from '../types.js';
import { formatCurrentTime, toSeconds } from './message-format.js';
import { buildPromptMessages } from './prompt-builder.js';
import type { FinalizeTurn, RunFinalizer } from './run-finalize.js';
import type { RunImpl } from './run-impl.js';
import type { RunManagerDeps, StartRunOptions } from './run-manager.js';

/** `consumeTurn` 需要的编排侧能力（由 `RunManager` 提供，避免反向依赖整个 manager） */
export interface ConsumeContext {
  deps: RunManagerDeps;
  now: () => number;
  finalizer: RunFinalizer;
  /** run 结束时把 threadId 从活跃表移除（`RunManager.active` 的唯一出口） */
  onSettled: (threadId: string) => void;
}

/** 读素材并拼装本轮 prompt（拼装规则与理由见 `prompt-builder.ts`） */
async function buildPrompt(
  deps: RunManagerDeps,
  opts: StartRunOptions,
  userMessage: HistoryMessage,
): Promise<{ messages: HistoryMessage[]; systemExtra?: string }> {
  const { userId, threadId } = opts;
  // 009：本轮数据的归属数字人＝执行本轮的实例（会话归属不可变更，故恒等于会话归属）
  const { agentName } = opts.agent.key;
  return buildPromptMessages({
    threadId,
    summaryData: deps.summary?.read(userId, agentName, threadId) ?? {
      summary: '',
      coveredCount: 0,
    },
    allMessages: deps.history.readAll(userId, agentName, threadId),
    userMessage,
    records: deps.toolEvents?.readAll(userId, agentName, threadId) ?? [],
    producedText: (await deps.produced?.(userId, agentName, threadId)) ?? '',
    // R18：当前时间（每轮现算；纯函数层不读时钟，故在此注入）
    nowText: formatCurrentTime(new Date()),
    // 004：问题实例的隐藏工具引导（请求级，不落盘）
    ...(opts.guidance ? { guidance: opts.guidance } : {}),
  });
}

/** 跑完一轮：消费事件流 → 广播增量 → 收尾落盘。 */
export async function consumeTurn(
  ctx: ConsumeContext,
  run: RunImpl,
  opts: StartRunOptions,
): Promise<void> {
  const { userId, threadId, agent, thinking } = opts;
  const userMessage: HistoryMessage = { role: 'user', content: opts.userMessage };
  if (opts.attachments && opts.attachments.length > 0) userMessage.attachments = opts.attachments;
  /**
   * 007：本轮运行期事实（工具清单由 `agent-factory` 在装配工具后**回填**）。
   *
   * 为什么用一个可变对象传下去：装配发生在 `agent.run` 内部（跑起来之后），
   * 而收尾在流结束时——两者之间的传递只有这一个引用。**必须整体传对象**，
   * 装配方是"整体替换数组"（`runtime.availableTools = [...]`），提前解构出数组会读到空。
   */
  const runtime: RunRuntime = { availableTools: [] };
  // 007 修订：SOUL 开关判定（逐次现读）——开关开启时条数上限同时驱动
  // 提示词装配（尾部块指令）与轮末收尾（卡片定稿），两处同源
  const naConfig = ctx.deps.nextActionsConfig?.(userId, agent.key.agentName) ?? null;
  // 供收尾（run-finalize）装配素材：运行期事实 + 卡片条数上限
  const turn: FinalizeTurn = {
    userId,
    threadId,
    runtime,
    ...(naConfig ? { nextActionsMax: naConfig.max } : {}),
  };
  /**
   * 013：意图聚焦判定口。
   *
   * 只把"判定"委托给域层服务，候选工具由装配方回填的 `tools` 给出（唯一权威来源）。
   * 任何异常都在此收敛为空串——判定失败绝不改变本轮响应（FR-009/FR-052）。
   */
  const intentFocus = ctx.deps.intentFocus;
  /**
   * 013 加固：`guidance`（问题实例卡片 / 下一步动作卡片自带的工具引导）非空白时，
   * 本轮**必然**跳过聚焦——两套工具建议不该共存（聚焦提示在 systemExtra 里位置更靠后、
   * 权重更大，会把卡片指定的工具挤掉，症状是"点了卡片却用了别的工具"，且无任何报错）。
   *
   * 归一放在域层而不是路由：任何调用方（直接 `startRun` 的内部调用、测试、将来新增的入口）
   * 都受同一约束，不依赖"前端记得带 skip_intent_focus"。
   */
  const skipFocus = opts.skipIntentFocus === true || (opts.guidance ?? '').trim() !== '';
  const focusJudge = intentFocus
    ? async (tools: ReadonlyArray<{ name: string; description: string }>): Promise<string> => {
        try {
          return await intentFocus.judge({
            userId,
            agentName: agent.key.agentName,
            threadId,
            messageId: run.assistantMessageId,
            userInput: opts.userMessage,
            skip: skipFocus,
            tools,
          });
        } catch (err) {
          ctx.deps.logger?.warn(
            {
              event: 'intent-focus.failed',
              alert: true,
              reason: 'judge_threw',
              thread_id: threadId,
              agent_name: agent.key.agentName,
            },
            `意图聚焦判定异常，本轮按不聚焦处理：${(err as Error).message}`,
          );
          return '';
        }
      }
    : undefined;
  /**
   * 本轮结局：供收尾日志使用（任务 2026-09-16）。
   *
   * 为什么要有这一条：关闭逐请求访问日志后，agent 侧只剩"崩溃"能查到，
   * **正常/失败的一轮在日志里没有任何痕迹**——"回答很慢""这轮失败了"
   * 只能靠复现。`run.end` 每轮一行（含 ok / duration_ms / error_code），
   * 既是排障入口，也是"业务是否正常"的最直接信号。
   */
  let outcome: { ok: boolean; error_code?: string } = { ok: false, error_code: 'INTERNAL_ERROR' };
  try {
    /**
     * 组装本轮提示词（读摘要 / 历史 / 工具记录 / 产出清单）。
     *
     * **必须在 try 内**（2026-10-27 修）：它与"跑模型"共用同一套收尾——失败时同样要
     * 走到 finally 的 `onSettled` 与 `gate.dispose`。放在 try 之外时，读取异常会整段跳过
     * 收尾：活跃表永久占位（该会话此后每次发送恒 409 `THREAD_RUN_ACTIVE`）、SSE 不终结、
     * HITL 定时器泄漏。
     *
     * 失败语义是"本轮未开始"，**不是**实例崩溃：故不触发 `onCrash`（销毁实例会连带重建
     * 全部 MCP 连接，与"读历史失败"毫无关系），改用独立错误码让前端给出可读提示。
     */
    let prompt: { messages: HistoryMessage[]; systemExtra?: string };
    try {
      prompt = await buildPrompt(ctx.deps, opts, userMessage);
    } catch (err) {
      run.state = 'error';
      outcome = { ok: false, error_code: 'PROMPT_BUILD_FAILED' };
      ctx.deps.logger?.error(
        {
          err,
          alert: true,
          event: 'run.prompt.failed',
          scope: 'run',
          user_id: userId,
          thread_id: threadId,
          agent_name: agent.key.agentName,
        },
        '组装本轮上下文失败，本轮未开始（实例保留）',
      );
      run.emit({
        type: 'error',
        data: {
          error: { code: 'PROMPT_BUILD_FAILED', message: '读取会话上下文失败，请重试' },
          duration_seconds: toSeconds(ctx.now() - run.startedAt),
          agent_name: run.agentName,
        },
      });
      return;
    }
    for await (const ev of agent.run({
      threadId,
      messages: prompt.messages,
      ...(prompt.systemExtra ? { systemExtra: prompt.systemExtra } : {}),
      thinking,
      ...(opts.model ? { model: opts.model } : {}),
      signal: run.controller.signal,
      interactionSink: run.gate,
      runtime,
      ...(naConfig ? { nextActionsMax: naConfig.max } : {}),
      ...(focusJudge ? { focusJudge } : {}),
    })) {
      switch (ev.type) {
        case 'thinking_delta':
          run.emit({ type: 'thinking', data: { delta: ev.delta } });
          break;
        case 'content_delta': {
          // 007 修订（Tail Protocol）：增量先过尾部块捕获状态机——
          // 命中 `<next_actions>` 后的内容只进缓冲不下发，正文部分照常累积与广播
          const visible = run.tailCapture.push(ev.delta);
          if (visible !== '') {
            run.buffer += visible;
            run.emit({ type: 'content', data: { delta: visible } });
          }
          break;
        }
        case 'tool_call_start': {
          const startedAtMs = ctx.now();
          const startedAt = new Date(startedAtMs).toISOString();
          run.toolCalls.set(ev.callId, {
            name: ev.name,
            startedAt,
            startedAtMs,
            ...(ev.label !== undefined ? { label: ev.label } : {}),
          });
          // 007：另记一份"本轮调用过哪些工具"（去重）——`toolCalls` 在 end 即删、轮末为空，
          // 轮末生成「下一步动作提示」需要它（见 types.RunRuntime 与 next-actions.ts）
          run.calledTools.add(ev.name);
          // 落 tool-events.jsonl（写盘失败只告警，不影响对话，见 appendStart 内部兜底）
          ctx.deps.toolEvents?.appendStart(userId, agent.key.agentName, threadId, {
            callId: ev.callId,
            messageId: run.assistantMessageId,
            name: ev.name,
            ...(ev.label !== undefined ? { label: ev.label } : {}),
            startedAt,
            ...(ev.argsDigest ? { argsDigest: ev.argsDigest } : {}),
          });
          run.emit({
            type: 'tool_call',
            data: {
              call_id: ev.callId,
              name: ev.name,
              ...(ev.label !== undefined ? { label: ev.label } : {}),
              status: 'running',
            },
          });
          break;
        }
        case 'tool_call_end': {
          const meta = run.toolCalls.get(ev.callId);
          run.toolCalls.delete(ev.callId);
          const endedAtMs = ctx.now();
          // fire-and-forget：落盘不阻塞 SSE，失败也不影响本轮回答（原则九）
          void ctx.deps.toolEvents?.appendEnd(userId, agent.key.agentName, threadId, {
            callId: ev.callId,
            messageId: run.assistantMessageId,
            name: meta?.name ?? ev.name,
            ...(meta?.label !== undefined ? { label: meta.label } : {}),
            startedAt: meta?.startedAt ?? new Date(endedAtMs).toISOString(),
            status: ev.status,
            durationMs: meta ? Math.max(0, endedAtMs - meta.startedAtMs) : 0,
            resultText: ev.resultText ?? '',
          });
          run.emit({ type: 'tool_call_end', data: { call_id: ev.callId, status: ev.status } });
          break;
        }
        case 'done': {
          // 007 修订（Tail Protocol）：流已终结，冲刷暂扣的"疑似开标签前缀"——
          // 确认为普通正文，先于 done 事件补发（保持"用户所见 = 落盘正文"逐字一致）
          const held = run.tailCapture.flush();
          if (held !== '') {
            run.buffer += held;
            run.emit({ type: 'content', data: { delta: held } });
          }
          // 归档尾部块原文，供 run-finalize 定稿卡片（损坏丢弃时为空串 = 本轮无卡片）
          run.nextActionsTail = run.tailCapture.captured;
          if (run.tailCapture.overflowed) {
            ctx.deps.logger?.warn(
              {
                event: 'next-actions.tail.overflow',
                thread_id: threadId,
                agent_name: agent.key.agentName,
              },
              '下一步动作提示尾部块超过大小上限，本轮按无卡片处理',
            );
          }
          // 落盘失败时 finalizer 已广播 HISTORY_WRITE_FAILED：本轮按失败记账，
          // 不能记成成功（否则 run.end 日志与用户所见相反）
          outcome = (await ctx.finalizer.done(run, turn, userMessage, ev.usage))
            ? { ok: true }
            : { ok: false, error_code: 'HISTORY_WRITE_FAILED' };
          return;
        }
        case 'error':
          if (ev.code === 'ABORTED') {
            ctx.finalizer.aborted(run, turn, ev.usage);
            outcome = { ok: false, error_code: 'ABORTED' };
            return;
          }
          await ctx.finalizer.error(run, turn, userMessage, ev);
          outcome = { ok: false, error_code: ev.code };
          return;
      }
    }
    /**
     * 流无终结事件而结束（2026-10-27 统一）：走过去与 `error` **同一条收尾路径**。
     *
     * 修复前这里只手写一个 SSE 事件、不落盘：用户当场看到"失败"，刷新后那条提问
     * 凭空消失（历史里根本没有）——同一件事三套行为的其中一套。
     */
    outcome = { ok: false, error_code: 'LLM_ERROR' };
    await ctx.finalizer.error(run, turn, userMessage, {
      code: 'LLM_ERROR',
      message: 'LLM 流异常结束',
    });
  } catch (err) {
    // 未知异常：疑似实例崩溃 → 销毁实例（FR-030），下条消息自动重建
    // 若走到这里时终态已发过（订阅者回调抛错等），不再二次广播/二次落盘
    const alreadySettled = run.state !== 'running';
    run.state = 'error';
    outcome = { ok: false, error_code: 'INTERNAL_ERROR' };
    ctx.deps.logger?.error(
      {
        err,
        alert: true,
        event: 'agent.crashed',
        user_id: userId,
        thread_id: threadId,
        agent_name: agent.key.agentName,
      },
      'Agent 实例崩溃，已销毁',
    );
    ctx.deps.onCrash?.(agent.key, err);
    // 崩溃同样落盘（2026-10-27）：用户消息与本轮失败留痕，避免"刷新后消息凭空出现"
    if (!alreadySettled) {
      await ctx.finalizer.error(run, turn, userMessage, {
        code: 'INTERNAL_ERROR',
        message: '内部错误，请重试',
      });
    }
  } finally {
    ctx.onSettled(threadId);
    // HITL：run 结束清理全部挂起状态（含 expired 留档与排队等待者）
    run.gate.dispose();
    const durationMs = ctx.now() - run.startedAt;
    ctx.deps.logger?.[outcome.ok ? 'info' : 'warn'](
      {
        event: 'run.end',
        scope: 'run',
        ok: outcome.ok,
        duration_ms: durationMs,
        ...(outcome.error_code ? { error_code: outcome.error_code } : {}),
        user_id: userId,
        thread_id: threadId,
        agent_name: run.agentName,
      },
      `对话轮次结束：${outcome.ok ? '成功' : `失败（${outcome.error_code ?? '未知'}）`}，耗时 ${durationMs}ms`,
    );
  }
}

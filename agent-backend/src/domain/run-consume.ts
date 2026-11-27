import type { HistoryMessage, RunRuntime } from '../types.js';
import { formatCurrentTime, toSeconds } from './message-format.js';
import { normalizeToolTips, renderToolTipsInstruction } from './next-actions.js';
import type { FocusToolTip } from './intent-focus/types.js';
import { buildPromptMessages } from './prompt-builder.js';
import type { FinalizeTurn, RunFinalizer } from './run-finalize.js';
import type { RunImpl } from './run-impl.js';
import type { RunManagerDeps, StartRunOptions } from './run-manager.js';

/** `consumeTurn` 需要的编排侧能力（由 `RunManager` 提供，避免反向依赖整个 manager） */
export interface ConsumeContext {
  deps: RunManagerDeps;
  now: () => number;
  finalizer: RunFinalizer;
  onSettled: (threadId: string) => void;
}

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
    nowText: formatCurrentTime(new Date()),
    ...(opts.guidance ? { guidance: opts.guidance } : {}),
  });
}

export async function consumeTurn(
  ctx: ConsumeContext,
  run: RunImpl,
  opts: StartRunOptions,
): Promise<void> {
  const { userId, threadId, agent, thinking } = opts;
  const userMessage: HistoryMessage = { role: 'user', content: opts.userMessage };
  if (opts.attachments && opts.attachments.length > 0) userMessage.attachments = opts.attachments;
  if (opts.skill) userMessage.skill = opts.skill;
  const storedUserMessage: HistoryMessage =
    opts.displayContent === undefined
      ? userMessage
      : { ...userMessage, content: opts.displayContent };
  const runtime: RunRuntime = { availableTools: [] };
  // 007 修订：SOUL 开关判定（逐次现读）——开关开启时条数上限同时驱动
  const naConfig = ctx.deps.nextActionsConfig?.(userId, agent.key.agentName) ?? null;
  // 供收尾（run-finalize）装配素材：运行期事实 + 卡片条数上限
  const turn: FinalizeTurn = {
    userId,
    threadId,
    runtime,
    ...(naConfig ? { nextActionsMax: naConfig.max } : {}),
  };
  const intentFocus = ctx.deps.intentFocus;
  const skipFocus =
    opts.skipIntentFocus === true ||
    (opts.guidance ?? '').trim() !== '' ||
    (opts.skill ?? '') !== '';
  let outcome: { ok: boolean; error_code?: string } = { ok: false, error_code: 'INTERNAL_ERROR' };
  try {
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
    let systemExtra = prompt.systemExtra;
    let focusToolTips: readonly FocusToolTip[] = [];
    let focusPrompt: string | undefined;
    /** 028：规划门禁分数；`null` = 没判（门禁关闭/未开规划/判定失败）→ fail-open 走规划 */
    let focusPlanScore: number | null = null;
    if (intentFocus) {
      try {
        const focus = await intentFocus.judge({
          userId,
          agentName: agent.key.agentName,
          threadId,
          messageId: run.assistantMessageId,
          userInput: opts.userMessage,
          skip: skipFocus,
          // 用户点"停止"时改写调用随之取消（不得在后台继续烧 token）。
          ...(opts.model ? { model: opts.model } : {}),
          signal: run.controller.signal,
        });
        focusToolTips = focus.toolTips;
        focusPlanScore = focus.planScore ?? null;
        if (focus.prompt !== '') {
          focusPrompt = focus.prompt;
          systemExtra = systemExtra ? `${systemExtra}\n\n${focus.prompt}` : focus.prompt;
        }
      } catch (err) {
        ctx.deps.logger?.warn(
          {
            event: 'intent-focus.degraded',
            alert: true,
            stage: 'judge',
            reason: 'judge_threw',
            thread_id: threadId,
            agent_name: agent.key.agentName,
          },
          `意图聚焦判定异常，本轮按不聚焦处理：${(err as Error).message}`,
        );
      }
    }
    // 先过公共读取器再渲染，避免客户端把 systemExtra 撑大或塞进非对象条目。
    const toolTipsText = renderToolTipsInstruction(normalizeToolTips(opts.toolTips));
    if (toolTipsText !== '') {
      systemExtra = systemExtra ? `${systemExtra}\n\n${toolTipsText}` : toolTipsText;
    }
    turn.focusToolTips = focusToolTips;

    for await (const ev of agent.run({
      threadId,
      messages: prompt.messages,
      ...(systemExtra ? { systemExtra } : {}),
      ...(opts.skill ? { skill: opts.skill } : {}),
      thinking,
      ...(opts.model ? { model: opts.model } : {}),
      signal: run.controller.signal,
      interactionSink: run.gate,
      // 020 / 021 共用的兜底中止：纯中断，不写业务原因（走 ABORTED 收尾）。
      interruptRun: () => run.stop(),
      runtime,
      ...(naConfig ? { nextActionsMax: naConfig.max } : {}),
      ...(focusToolTips.length > 0 ? { focusToolTips } : {}),
      ...(focusPrompt !== undefined ? { focusPrompt } : {}),
      ...(focusPlanScore !== null ? { planScore: focusPlanScore } : {}),
    })) {
      switch (ev.type) {
        case 'thinking_delta':
          run.emit({ type: 'thinking', data: { delta: ev.delta } });
          break;
        case 'content_delta': {
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
        /**
         * 028 FR-034：计划进度**只转发、不留痕**——不写历史、不落盘、不进尾部块，
         * 刷新页面不恢复（这也是它敢放在 `tool_call` 旁边直接 emit 的原因）。
         */
        case 'plan_progress':
          run.emit({
            type: 'plan_progress',
            data: { seq_id: ev.seqId, label: ev.label, phase: ev.phase },
          });
          break;
        case 'done': {
          const held = run.tailCapture.flush();
          if (held !== '') {
            run.buffer += held;
            run.emit({ type: 'content', data: { delta: held } });
          }
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
          // 不能记成成功（否则 run.end 日志与用户所见相反）
          outcome = (await ctx.finalizer.done(run, turn, storedUserMessage, ev.usage))
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
          await ctx.finalizer.error(run, turn, storedUserMessage, ev);
          outcome = { ok: false, error_code: ev.code };
          return;
      }
    }
    outcome = { ok: false, error_code: 'LLM_ERROR' };
    await ctx.finalizer.error(run, turn, storedUserMessage, {
      code: 'LLM_ERROR',
      message: 'LLM 流异常结束',
    });
  } catch (err) {
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
      await ctx.finalizer.error(run, turn, storedUserMessage, {
        code: 'INTERNAL_ERROR',
        message: '内部错误，请重试',
      });
    }
  } finally {
    ctx.onSettled(threadId);
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

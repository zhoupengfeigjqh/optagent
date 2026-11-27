import path from 'node:path';
import type { Logger } from 'pino';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { loadAgentConfig } from '../domain/agent-instance.js';
import { createScopeGuard, type ScopeGuardPort } from '../domain/scope-guard/index.js';
import type { PooledInstance } from '../domain/agent-pool.js';
import type { LlmRetryOptions } from '../config.js';
import { computeConfigFingerprint } from '../domain/config-fingerprint.js';
import { FileAccess } from '../domain/file-access.js';
import { planCapabilityBlocks, planGateBlocks } from '../domain/intent-focus/plan-gate.js';
import type { PlanLimits, PlanProgress } from '../domain/plan/types.js';
import { isIntentFocusEnabled, isTaskPlanningEnabled } from '../domain/soul.js';
import { createOntologyFactsLoader } from '../domain/plan/ontology-facts.js';
import { PlanStore } from '../domain/plan/store.js';
import { buildTailInstruction, effectiveNextActionsMax } from '../domain/next-actions.js';
import { composeSystemPrompt } from '../domain/skill-prompt.js';
import { matchKeys } from '../domain/ontology-doc.js';
import {
  createFunctionRecord,
  createRuleGate,
  type RuleGatePort,
} from '../domain/rule-gate/index.js';
import type { AgentRunRequest } from '../domain/run-manager.js';
import { createToolSuspension, suspendTools } from '../domain/tool-suspension.js';
import { PRODUCED_DIR, listAvailableDirs, userAgentsDir } from '../domain/dirs.js';
import type {
  AgentConfigBundle,
  LlmEvent,
  McpCallEvent,
  McpConfirmation,
  McpConnectionStatus,
  McpServerConfig,
  ModelSelection,
  PoolKey,
} from '../types.js';
import { runAgentLoopEvents, type RunAgentLoopHooks } from './agent-loop.js';
import { createPlanLlm } from './plan-llm.js';
import { createPlanOrchestrator } from './plan-orchestrator.js';
import { buildBuiltinTools } from './builtin-tools.js';
import { agentScopedPath, mintPutUrl, mintSignedUrl } from './file-sign.js';
import { scopeToolsByAllowlist } from './mcp-tool-scope.js';
import { wrapToolWithInteraction } from './tool-intercept.js';
import { ruleGateTools } from './tool-rule-gate.js';
import { guardTools } from './tool-scope-guard.js';
import type { LlmProvider } from './llm/llm-provider.js';
import { PiAiLlmProvider } from './llm/pi-ai-provider.js';
import type { AsyncToolContext } from './mcp/async-result-url.js';
import { McpManager } from './mcp/mcp-manager.js';
import { mcpToolsAsAgentTools } from './mcp/mcp-tool-adapter.js';

export interface ChatAgent extends PooledInstance {
  readonly config: AgentConfigBundle;
  readonly configFingerprint: string;
  unavailableMcp(): string[];
  mcpStatusOf(server: string): McpConnectionStatus;
  probeMcp(): Promise<string[]>;
  mcpReady(timeoutMs: number): Promise<boolean>;
  run(req: AgentRunRequest): AsyncIterable<LlmEvent>;
}

export interface AgentFactoryDeps {
  root: string;
  llm: () => LlmProvider;
  providerFor?: (entry: ModelSelection) => LlmProvider;
  logger: Logger;
  mcpTimeoutMs: number;
  /** 单服务建连超时（毫秒）；缺省取 `mcpTimeoutMs`（测试路径） */
  mcpConnectTimeoutMs?: number;
  /**
   * 2026-10-15：请求级模型覆盖的临时 provider 的有界重试口径。
   * 缺省 = 不重试（测试默认；生产由 `server.ts` 注入 `config.llmRetry`）。
   */
  llmRetry?: LlmRetryOptions;
  /** read_file 截断上限（KB） */
  truncateKb?: number;
  /**
   * 028：规划门禁阈值（来自 `intent_focus.plan_threshold`）。
   *
   * 缺省 = 门禁关闭（开启规划即发起规划调用）；分数低于该值时本轮跳过规划。
   */
  planThreshold?: number;
  /** 028：规划上限（`config.yaml` 的 `plan` 块）；缺省走 `DEFAULT_PLAN_LIMITS` */
  planLimits?: PlanLimits;
  /**
   * `write_file` 落盘字节上限（2026-11-16）：生产由 `server.ts` 注入
   * `PREVIEW_MAX_MB`——与预览上限同源，避免写出"能下载、点开即 413"的文件。
   */
  writeMaxBytes?: number;
  publicBaseUrl: string;
  fileSignSecret: string;
  onMcpStatus?: (key: PoolKey) => void;
  onMcpCall?: (event: McpCallEvent) => void;
  planStore?: PlanStore;
}

const NO_LLM_RETRY: LlmRetryOptions = { maxRetries: 0, maxRetryDelayMs: 0 };

export class AgentInstanceFactory {
  private readonly planStore: PlanStore;

  constructor(private readonly deps: AgentFactoryDeps) {
    this.planStore =
      deps.planStore ??
      new PlanStore(deps.root, {
        warn: (msg) => deps.logger.warn({ alert: true, event: 'plan.record.failed' }, msg),
      });
  }

  /** 创建实例：配置加载失败抛 AgentConfigError；MCP 异步并发建连，不等待 */
  async create(key: PoolKey): Promise<ChatAgent> {
    const { root, logger, mcpTimeoutMs, mcpConnectTimeoutMs } = this.deps;
    const agentDir = path.join(userAgentsDir(root, key.userId), key.agentName);
    const config = loadAgentConfig(agentDir, {
      logger: {
        warn: (msg: string) => logger.warn({ alert: true, agent_name: key.agentName }, msg),
      },
    });

    const mcp = new McpManager({
      timeoutMs: mcpTimeoutMs,
      ...(mcpConnectTimeoutMs !== undefined ? { connectTimeoutMs: mcpConnectTimeoutMs } : {}),
      logger: {
        warn: (msg: string) => logger.warn({ alert: true, agent_name: key.agentName }, msg),
      },
      ...(this.deps.onMcpStatus ? { onStatusChange: () => this.deps.onMcpStatus!(key) } : {}),
    });
    // 异步并发建连：不 await，不阻断实例就绪（保首字延迟 SC-001）；
    void mcp.connectAndTrack(config.mcpServers);

    const scopeGuard = createScopeGuard({
      agentDir,
      username: key.userId,
      warn: (warnings) =>
        logger.warn(
          {
            alert: true,
            user_id: key.userId,
            agent_name: key.agentName,
            event: 'scope_guard.catalog.degraded',
            warnings: warnings.slice(0, 20),
          },
          '本体行为权限闸门：授权配置加载告警',
        ),
    });

    const ruleGate = createRuleGate({
      agentDir,
      warn: (warnings) =>
        logger.warn(
          {
            alert: true,
            user_id: key.userId,
            agent_name: key.agentName,
            event: 'rule_gate.catalog.degraded',
            warnings: warnings.slice(0, 20),
          },
          '本体行为规则闸门：规则配置加载告警',
        ),
    });

    const instance: ChatAgent = {
      key,
      config,
      // 固化创建时的指纹：部署（目录级原子改名）会改变 mtime，从而改变指纹
      configFingerprint: computeConfigFingerprint(agentDir),
      activeThreads: 0,
      lastActiveAt: Date.now(),
      unavailableMcp: () => mcp.unavailable(),
      mcpStatusOf: (server) => mcp.statusOf(server),
      probeMcp: () => mcp.probe(),
      mcpReady: (timeoutMs) => mcp.waitSettled(timeoutMs),
      dispose: () => mcp.closeAll(),
      run: (req) => this.runWith(instance, mcp, req, scopeGuard, ruleGate),
    };
    return instance;
  }

  private async *runWith(
    inst: ChatAgent,
    mcp: McpManager,
    req: AgentRunRequest,
    scopeGuard: ScopeGuardPort,
    ruleGate: RuleGatePort,
  ): AsyncIterable<LlmEvent> {
    // 每次运行的日志绑定用户/数字人/线程（任务 2026-09-15：日志必须可归属到用户）
    const logger = this.deps.logger.child({
      user_id: inst.key.userId,
      agent_name: inst.key.agentName,
      thread_id: req.threadId,
    });
    const tools: AgentTool[] = [];
    const builtinNames = new Set<string>();
    const ruleGateEnabled = isIntentFocusEnabled(
      this.deps.root,
      inst.key.userId,
      inst.key.agentName,
      {
        warn: (msg: string) => logger.warn({ alert: true, agent_name: inst.key.agentName }, msg),
      },
    );

    if (inst.config.enabledTools.length > 0) {
      const fa = new FileAccess({
        optAgentRoot: this.deps.root,
        userId: inst.key.userId,
        agentName: inst.key.agentName,
        logger,
        truncateKb: this.deps.truncateKb,
      });
      const availableDirs = listAvailableDirs(this.deps.root, inst.key.userId, inst.key.agentName);
      const builtinTools = buildBuiltinTools({
        fileAccess: fa,
        threadId: req.threadId,
        enabled: inst.config.enabledTools,
        availableDirs,
        skillsDir: path.join(
          userAgentsDir(this.deps.root, inst.key.userId),
          inst.key.agentName,
          'skills',
        ),
        // 2026-11-16：写入上限与预览上限同源（encode 后按字节判定）
        ...(this.deps.writeMaxBytes === undefined
          ? {}
          : { maxWriteBytes: this.deps.writeMaxBytes }),
        logger,
      });
      for (const builtinTool of builtinTools) builtinNames.add(builtinTool.name);
      tools.push(...builtinTools);
    }
    for (const server of inst.config.mcpServers) {
      if (!mcp.isAvailable(server.name)) continue;
      try {
        const toolInfos = await mcp.listTools(server.name);
        const visibleToolInfos = scopeToolsByAllowlist(toolInfos, server.allowedTools);
        const fileCtx = server.fileArgs
          ? {
              fileAccess: new FileAccess({
                optAgentRoot: this.deps.root,
                userId: inst.key.userId,
                agentName: inst.key.agentName,
                logger,
              }),
              userId: inst.key.userId,
              mintUrl: (userId: string, relPath: string) =>
                mintSignedUrl(
                  this.deps.publicBaseUrl,
                  this.deps.fileSignSecret,
                  userId,
                  agentScopedPath(inst.key.agentName, relPath),
                ),
            }
          : undefined;
        const agentTools = mcpToolsAsAgentTools(
          mcp,
          server.name,
          visibleToolInfos,
          { uid: inst.key.userId, sid: req.threadId },
          server.fileArgs,
          fileCtx,
          this.deps.onMcpCall,
          logger,
          asyncToolContext(server, inst.key.userId, inst.key.agentName, req.threadId, this.deps),
          server.toolLabels,
        );
        if (req.interactionSink && needsConfirmation(server.confirmation)) {
          for (const t of agentTools) {
            const rawName = t.name.startsWith(`${server.name}__`)
              ? t.name.slice(server.name.length + 2)
              : t.name;
            tools.push(
              toolNeedsConfirmation(server.confirmation, rawName)
                ?
                  wrapToolWithInteraction(t, req.interactionSink, server.rulesFields?.[rawName])
                : t,
            );
          }
        } else {
          tools.push(...agentTools);
        }
      } catch (err) {
        logger.warn(
          { err, alert: true, agent_name: inst.key.agentName, event: 'mcp.listTools.failed' },
          `MCP server ${server.name} 工具表获取失败，按不可用降级`,
        );
      }
    }

    // 兜底出口接到 `interruptRun`（与用户点"停止"同路径，不留错误码）：软收尾只给
    const suspension = createToolSuspension(() => req.interruptRun?.());

    let ruled = tools;
    let isStaleProbe: ((toolName: string) => boolean) | undefined;
    if (ruleGateEnabled) {
      /**
       * 021：轮内函数执行记录——**每轮新建**，轮结束即丢（`FR-001`）。
       * MUST NOT 提到实例级：上一轮的函数结果不能算作本轮已执行（`SC-003`）。
       */
      const record = createFunctionRecord({
        warn: (info) =>
          logger.warn(
            {
              event: 'rule_gate.record.dropped',
              ts: new Date().toISOString(),
              tool_name: info.toolName,
              reason: info.reason,
              ...(info.bytes !== undefined ? { bytes: info.bytes } : {}),
              ...(info.count !== undefined ? { count: info.count } : {}),
            },
            '规则闸门：函数记录条目被丢弃',
          ),
      });
      isStaleProbe = (toolName) => record.hasEver(toolName) && !record.has(toolName);
      ruled = ruleGateTools(tools, {
        gate: ruleGate,
        record,
        builtinNames,
        availableNames: collectAvailableNames(tools),
        suspension,
        logger,
        userId: inst.key.userId,
        agentName: inst.key.agentName,
        threadId: req.threadId,
      });
    }

    const guarded = guardTools(
      ruled,
      scopeGuard,
      {
        logger,
        userId: inst.key.userId,
        agentName: inst.key.agentName,
        threadId: req.threadId,
      },
      suspension,
    );

    // 放在工具装配**之后、降级判定之前**：直聊分支（tools 为空）同样回填空数组，
    if (req.runtime) {
      req.runtime.availableTools = guarded.map((t) => ({
        name: t.name,
        description: t.description ?? '',
      }));
    }

    // 请求级模型覆盖（FR-023）：指定模型时按该 entry 构造临时 provider，
    const llm = req.model
      ? this.deps.providerFor
        ? this.deps.providerFor(req.model)
        : new PiAiLlmProvider(req.model, this.deps.llmRetry ?? NO_LLM_RETRY)
      : this.deps.llm();
    const extra = req.systemExtra;
    const basePrompt = composeSystemPrompt({
      soulBody: inst.config.soulBody,
      skills: inst.config.skills,
      ...(req.skill ? { explicitSkill: req.skill } : {}),
    });
    let systemPrompt = extra ? `${basePrompt}\n\n${extra}` : basePrompt;
    const focusToolTips = req.focusToolTips ?? [];
    const tailMax = effectiveNextActionsMax(req.nextActionsMax, focusToolTips);
    if (tailMax !== undefined) {
      systemPrompt = `${systemPrompt}\n\n${buildTailInstruction(focusToolTips, tailMax)}`;
    }
    // 028：规划开关本轮只读一次——直聊早退分支也要说清"为什么没规划"，
    // 且避免同一轮两次读 SOUL 造成开关口径分裂。
    const planWarn = {
      warn: (msg: string): void => {
        logger.warn({ alert: true, agent_name: inst.key.agentName }, msg);
      },
    };
    const planEnabled = isTaskPlanningEnabled(
      this.deps.root,
      inst.key.userId,
      inst.key.agentName,
      planWarn,
    );
    if (guarded.length === 0 || !(llm instanceof PiAiLlmProvider)) {
      // 早退也要留痕：否则"开了规划却没反应"只能靠"日志里没有 plan.started"来推断
      if (planEnabled) {
        logger.info(
          {
            event: 'plan.skipped',
            reason: guarded.length === 0 ? 'no_tools' : 'no_loop_provider',
          },
          '本轮无可用工具循环，跳过规划阶段',
        );
      }
      if (guarded.length > 0) {
        logger.warn(
          { agent_name: inst.key.agentName, event: 'tools.noLoopProvider' },
          '非 pi provider，工具不可用，降级直聊',
        );
      }
      yield* llm.streamChat({
        systemPrompt,
        messages: req.messages,
        tools: [],
        thinking: req.thinking,
        signal: req.signal,
      });
      return;
    }

    let loopTools = guarded;
    let loopMessages = req.messages;
    let planHooks: RunAgentLoopHooks | undefined;
    /**
     * 028 FR-034：计划进度通道。
     *
     * `begin()` 在 loop 启动前就会产出首步 `running`，此时事件队列还不存在，
     * 故先排队；loop 就绪后由 `onPlanProgress` 把后续进度直接投递到队列。
     */
    const queuedProgress: PlanProgress[] = [];
    let progressSink: ((event: PlanProgress) => void) | null = null;
    const onPlanProgress = (event: PlanProgress): void => {
      if (progressSink !== null) progressSink(event);
      else queuedProgress.push(event);
    };
    if (!planEnabled) {
      logger.info(
        { event: 'plan.skipped', reason: ruleGateEnabled ? 'switch_off' : 'focus_disabled' },
        '任务规划未开启，跳过规划阶段',
      );
    } else if ((req.focusPrompt ?? '').trim() === '') {
      logger.info({ event: 'plan.skipped', reason: 'empty_focus' }, '本轮无意图聚焦结果，跳过规划');
    } else if (planCapabilityBlocks(req.planEligible)) {
      // 028（2026-11-27）：规划必须从聚焦行为/函数起算；只命中技能、没有命中任何本体行为
      // 或函数时，规划没有可展开的 coreAction，直接跳过（门禁判定已在聚焦阶段一并省掉）。
      logger.info(
        { event: 'plan.skipped', reason: 'no_focus_capability' },
        '本轮未聚焦到本体行为/函数，跳过规划阶段',
      );
    } else if (planGateBlocks(req.planScore, this.deps.planThreshold)) {
      // 028：门禁拦截（分数缺席 = 没判/判失败 → fail-open，继续走规划）
      logger.info(
        {
          event: 'plan.skipped',
          reason: 'below_threshold',
          plan_score: req.planScore,
          threshold: this.deps.planThreshold,
        },
        '规划门禁判定为单步任务，跳过规划阶段',
      );
    } else {
      try {
        const agentDir = path.join(
          userAgentsDir(this.deps.root, inst.key.userId),
          inst.key.agentName,
        );
        const loader = createOntologyFactsLoader(agentDir);
        const lastUser = [...req.messages].reverse().find((message) => message.role === 'user');
        const userInput = lastUser?.content ?? '';
        const orchestrator = createPlanOrchestrator({
          goal: Array.from(userInput).slice(0, 40).join(''),
          userInput,
          focusPrompt: req.focusPrompt ?? '',
          history: req.messages,
          tools: guarded,
          ontology: loader.getIndex(),
          facts: loader.get(),
          behaviorOf: (name) => ruleGate.lookupBehavior(name),
          ...(isStaleProbe !== undefined ? { isStale: isStaleProbe } : {}),
          plan: createPlanLlm(llm),
          signal: req.signal,
          logger: {
            info: (fields, message) => logger.info(fields, message),
            warn: (fields, message) => logger.warn(fields, message),
          },
          suspend: (code) => suspendTools(suspension, code),
          record: (record) => {
            void this.planStore.append(inst.key.userId, inst.key.agentName, req.threadId, record);
          },
          onProgress: onPlanProgress,
          ...(this.deps.planLimits !== undefined ? { limits: this.deps.planLimits } : {}),
        });
        if (await orchestrator.begin()) {
          loopTools = orchestrator.initialTools();
          loopMessages = orchestrator.initialMessages(req.messages);
          planHooks = orchestrator.hooks;
        }
      } catch (err) {
        logger.warn(
          { event: 'plan.abandoned', reason: 'init_failed', err },
          '规划装配失败，本轮回退既有流程',
        );
      }
    }

    const { model, streamFn } = llm.loopOptions();
    yield* runAgentLoopEvents({
      model,
      streamFn,
      systemPrompt,
      messages: loopMessages,
      tools: loopTools,
      labelTools: guarded,
      thinking: req.thinking,
      signal: req.signal,
      ...(planHooks !== undefined ? { hooks: planHooks } : {}),
      // 028 FR-034：先补发 begin 期间的进度，再把实时回调接到事件队列
      planProgress: queuedProgress,
      onPlanProgress: (emit) => {
        progressSink = emit;
      },
    });
  }
}

function asyncToolContext(
  server: McpServerConfig,
  userId: string,
  agentName: string,
  threadId: string,
  deps: AgentFactoryDeps,
): AsyncToolContext {
  return {
    // 回写目录带数字人段（009）：产出落进**发起该轮的数字人**的临时空间/后台产出
    mintResultUrl: (toolName: string, toolCallId: string) =>
      mintPutUrl(
        deps.publicBaseUrl,
        deps.fileSignSecret,
        userId,
        agentScopedPath(agentName, PRODUCED_DIR),
        {
          sid: threadId,
          callId: toolCallId,
          tool: `${server.name}__${toolName}`,
        },
      ),
  };
}

function collectAvailableNames(tools: readonly AgentTool[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const tool of tools) {
    for (const key of matchKeys(tool.name)) names.add(key);
  }
  return names;
}

function needsConfirmation(policy: McpConfirmation | undefined): boolean {
  if (policy === undefined || policy === 'never') return false;
  if (policy === 'always') return true;
  return policy.tools.length > 0;
}

function toolNeedsConfirmation(policy: McpConfirmation | undefined, rawToolName: string): boolean {
  if (policy === 'always') return true;
  if (typeof policy === 'object' && Array.isArray(policy.tools)) {
    return policy.tools.includes(rawToolName);
  }
  return false;
}

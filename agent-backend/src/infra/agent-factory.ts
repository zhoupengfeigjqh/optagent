/**
 * Agent 实例装配工厂（infra 层）：domain 的 loadAgentConfig 配置包 +
 * McpManager（异步并发建连不阻断就绪）+ LlmProvider，产出池化的 ChatAgent。
 *
 * run() 路径选择：
 * - 无可用工具（本期内置工具 Phase 5 才落地）→ LlmProvider.streamChat 直聊
 * - 有 MCP 工具 → pi 低层 runAgentLoop（仅当 LlmProvider 为 PiAiLlmProvider）
 */
import path from 'node:path';
import type { Logger } from 'pino';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { loadAgentConfig } from '../domain/agent-instance.js';
import { createScopeGuard, type ScopeGuardPort } from '../domain/scope-guard/index.js';
import type { PooledInstance } from '../domain/agent-pool.js';
import type { LlmRetryOptions } from '../config.js';
import { computeConfigFingerprint } from '../domain/config-fingerprint.js';
import { FileAccess } from '../domain/file-access.js';
import { buildTailInstruction, effectiveNextActionsMax } from '../domain/next-actions.js';
import { composeSystemPrompt } from '../domain/skill-prompt.js';
import { matchKeys } from '../domain/ontology-doc.js';
import {
  createFunctionRecord,
  createRuleGate,
  type RuleGatePort,
} from '../domain/rule-gate/index.js';
import type { AgentRunRequest } from '../domain/run-manager.js';
import { createToolSuspension } from '../domain/tool-suspension.js';
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
import { runAgentLoopEvents } from './agent-loop.js';
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
  /**
   * 实例创建时**固化的配置指纹**（R7 / `FR-034`）。
   * `server.ts` 的 `getOrCreateAgent` 在池命中后用它与磁盘比对，不一致即换代。
   */
  readonly configFingerprint: string;
  unavailableMcp(): string[];
  /** 单服务连接状态（FR-019）：建连结果未产生前为 `unknown`，不误报为 `failed` */
  mcpStatusOf(server: string): McpConnectionStatus;
  /**
   * 主动健康探测（2026-09-23）：由 `server.ts` 的调度器定期调用，补齐
   * "服务被停掉但无流量、`onClose` 不触发"导致的假绿；返回本次翻转为 failed 的服务名。
   */
  probeMcp(): Promise<string[]>;
  /**
   * 有界等待本实例的 MCP 建连**全部落定**（2026-10-18）。
   *
   * 为什么需要：建连是 fire-and-forget，而一轮对话的工具装配按 `isAvailable` 过滤，
   * 首轮若在飞行中就开跑，该轮会**静默缺少 MCP 工具**（状态却随后变绿，用户以为已就绪）。
   * 已落定（常态）→ 立即返回 `true`，不影响首字延迟。
   *
   * @returns `true` = 已有连接结果（connected/failed）；`false` = 本次等待超时（降级继续）。
   */
  mcpReady(timeoutMs: number): Promise<boolean>;
  run(req: AgentRunRequest): AsyncIterable<LlmEvent>;
}

export interface AgentFactoryDeps {
  /** .opt-agent 根目录 */
  root: string;
  /** LlmProvider 惰性获取（默认模型全局单例；测试注入 fake） */
  llm: () => LlmProvider;
  /** 请求级模型覆盖的 provider 构造（缺省 new PiAiLlmProvider；测试注入 fake 时统一返回 fake） */
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
  /** 签名直链对外基址（file_args 转换用） */
  publicBaseUrl: string;
  /** 签名直链 HMAC 密钥（file_args 转换用） */
  fileSignSecret: string;
  /** 实例内 MCP 单 server 建连落定时回调（server.ts 接线到事件总线 → SSE 推送） */
  onMcpStatus?: (key: PoolKey) => void;
  /** MCP 工具调用计数回调（R4 / FR-049）；由 server.ts 接线到 UsageDb */
  onMcpCall?: (event: McpCallEvent) => void;
}

/** 未注入重试口径时的缺省（= 不重试，与 pi-ai 的 `maxRetries` 默认一致；测试路径即此） */
const NO_LLM_RETRY: LlmRetryOptions = { maxRetries: 0, maxRetryDelayMs: 0 };

export class AgentInstanceFactory {
  constructor(private readonly deps: AgentFactoryDeps) {}

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
    // 但把落定 Promise 留下，发消息前可 `mcpReady()` 有界等待（见 ChatAgent.mcpReady）
    void mcp.connectAndTrack(config.mcpServers);

    // 020：本体行为权限闸门。与实例同生命周期（部署换代即重建），
    // 目录签名变化时内部自行重载；加载告警走 alert 通道，不阻断实例创建。
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

    // 021：本体行为规则闸门。与实例同生命周期（部署换代即重建），目录签名变化时内部自行重载；
    // 加载告警走 alert 通道，不阻断实例创建（与 020 同一口径）。
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
    /** 平台内置工具名：规则闸门据此跳过判定与记录（内置与函数同名时仍按内置优先） */
    const builtinNames = new Set<string>();
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

    // 内置工具（Phase 5）：按 TOOL.json 启用项装配，全部经 FileAccess 代理；
    // 每次 run 重建以绑定当前 threadId（write_file 前缀）
    if (inst.config.enabledTools.length > 0) {
      const fa = new FileAccess({
        optAgentRoot: this.deps.root,
        userId: inst.key.userId,
        agentName: inst.key.agentName,
        logger,
        truncateKb: this.deps.truncateKb,
      });
      // list_dir/read_file 的目录清单按**该数字人**的 scenario 动态生成；
      // 未配置场景时退化为三空间根
      const availableDirs = listAvailableDirs(this.deps.root, inst.key.userId, inst.key.agentName);
      const builtinTools = buildBuiltinTools({
        fileAccess: fa,
        threadId: req.threadId,
        enabled: inst.config.enabledTools,
        availableDirs,
        // 技能目录（数字人级）：`read_skill` 的沙箱根，与用户三空间分开、不经 FileAccess
        skillsDir: path.join(
          userAgentsDir(this.deps.root, inst.key.userId),
          inst.key.agentName,
          'skills',
        ),
        logger,
      });
      for (const builtinTool of builtinTools) builtinNames.add(builtinTool.name);
      tools.push(...builtinTools);
    }
    // MCP 工具：已建连的 server 收集工具表
    for (const server of inst.config.mcpServers) {
      if (!mcp.isAvailable(server.name)) continue;
      try {
        const toolInfos = await mcp.listTools(server.name);
        // 工具白名单（2026-10-03）：只把白名单里的工具挂给数字人——**模型看不到其余工具**
        // （清单外的工具不进工具表，模型无从发起调用；比"调用时拒绝"更彻底）。
        // 缺省 / 空数组 = 不限制（语义与判据见 `mcp-tool-scope.ts`）。
        const visibleToolInfos = scopeToolsByAllowlist(toolInfos, server.allowedTools);
        // file_args 声明：绑定当前（用户，数字人）的 FileAccess + 签名直链铸造（远程服务回源下载）。
        // 签名内的路径带数字人段（`agentScopedPath`）⇒ 直链只能取回**本数字人**数据域的文件。
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
          // 强制穿透的运行上下文（2026-09-16）：uid=当前用户、sid=当前会话；
          // 工具 schema 里声明了才注入，没声明的不受影响
          { uid: inst.key.userId, sid: req.threadId },
          server.fileArgs,
          fileCtx,
          this.deps.onMcpCall,
          logger,
          asyncToolContext(server, inst.key.userId, inst.key.agentName, req.threadId, this.deps),
          // 工具显示名（2026-10-27）：平台配置优先，进意图聚焦命题；缺省回退英文拼接
          server.toolLabels,
        );
        // HITL：该服务声明了 confirmation 策略且本 run 带交互口时，
        // 命中策略的工具包交互门（execute 前挂起等用户确认参数）；
        // 无 sink（理论防御：run-manager 恒传入）或未声明策略 → 原样直跑
        if (req.interactionSink && needsConfirmation(server.confirmation)) {
          for (const t of agentTools) {
            const rawName = t.name.startsWith(`${server.name}__`)
              ? t.name.slice(server.name.length + 2)
              : t.name;
            tools.push(
              toolNeedsConfirmation(server.confirmation, rawName)
                ? // 规则字段声明按**当前工具名**查服务级映射：不在确认范围内的工具
                  // 根本不会被包装，映射对其天然不生效
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

    // 020 / 021 共用**同一份**本轮挂起状态（2026-11-09）：任一方拒绝后，本轮其余工具
    // 一律不执行。状态每轮新建一次、随工具数组丢弃（不落实例、不跨轮）。
    // 兜底出口接到 `interruptRun`（与用户点"停止"同路径，不留错误码）：软收尾只给
    // 一次机会，模型第二次仍要调工具即纯中止本轮。
    const suspension = createToolSuspension(() => req.interruptRun?.());

    // 021：规则闸门在 020 **内侧**（先判权限、再判规则）。被权限拒绝的调用不会进入这里，
    // 因此既不会被判定，也不会进入函数记录（`FR-009` / `FR-003`）。
    // `availableNames` 由**本轮最终工具数组**生成（含内置），用 `matchKeys` 同时登记
    // "完整名"与"去服务前缀名"——规则的 `related_functions` 写的是裸名，只有裸名可命中（`FR-043`）。
    const ruled = ruleGateTools(tools, {
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

    // 020：统一在装配**末端**套一层权限闸门（内置工具与 MCP 工具一视同仁）。
    // 套在 HITL 包装之外 ⇒ 判定先于人工确认，被拒不弹确认框（FR-002）；
    // 装配顺序固定为 `guardTools(ruleGateTools(tools))`：020 在外、021 在内。
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

    // 007：把"本轮模型真正能用的工具"回填给域层（轮末生成「下一步动作提示」要据此裁剪引用）。
    // 放在工具装配**之后、降级判定之前**：直聊分支（tools 为空）同样回填空数组，
    // 语义即"本轮模型没有任何工具"。包装不改名称与描述，回填内容与包装前一致。
    if (req.runtime) {
      req.runtime.availableTools = guarded.map((t) => ({
        name: t.name,
        description: t.description ?? '',
      }));
    }

    // 请求级模型覆盖（FR-023）：指定模型时按该 entry 构造临时 provider，
    // 不重建实例（实例共享 MCP/工具连接）；缺省用默认模型全局单例
    const llm = req.model
      ? this.deps.providerFor
        ? this.deps.providerFor(req.model)
        : new PiAiLlmProvider(req.model, this.deps.llmRetry ?? NO_LLM_RETRY)
      : this.deps.llm();
    // 016：聚焦提示由 `run-consume` 在 prompt 组装后直接追加进 `req.systemExtra`，
    // 装配期不再回调判定（本特性与工具清单无关，且入口卡片轮次不应扫目录）。
    const extra = req.systemExtra;
    // 2026-11-07：本轮用户显式选中的技能（`/技能名`）只插入该技能；缺省走默认全量索引。
    // 组装是纯函数（`skill-prompt.ts`），实例本身不重建、不指纹换代。
    const basePrompt = composeSystemPrompt({
      soulBody: inst.config.soulBody,
      skills: inst.config.skills,
      ...(req.skill ? { explicitSkill: req.skill } : {}),
    });
    // FR-017：滚动摘要等动态片段追加到实例固化 System Prompt 之后
    let systemPrompt = extra ? `${basePrompt}\n\n${extra}` : basePrompt;
    // 007 修订（Tail Protocol）：SOUL 开关开启时在 System Prompt **末尾**追加尾部块指令。
    // 候选目录取**本轮意图聚焦选出的本体能力**（`req.focusToolTips`）：卡片的 `tool_tips`
    // 只能从这份清单抄写，与"无 Laya 结果就不产卡片"的门控同源。
    // 放在最末尾让"输出格式要求"最贴近生成位置、最易被遵循。
    //
    // 开关关闭 / 本轮能力为空 → 不追加指令（`effectiveNextActionsMax` 返回 undefined），
    // 模型因此不感知该协议，本轮必然无卡片。
    const focusToolTips = req.focusToolTips ?? [];
    const tailMax = effectiveNextActionsMax(req.nextActionsMax, focusToolTips);
    if (tailMax !== undefined) {
      systemPrompt = `${systemPrompt}\n\n${buildTailInstruction(focusToolTips, tailMax)}`;
    }
    if (guarded.length === 0 || !(llm instanceof PiAiLlmProvider)) {
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

    const { model, streamFn } = llm.loopOptions();
    yield* runAgentLoopEvents({
      model,
      streamFn,
      systemPrompt,
      messages: req.messages,
      tools: guarded,
      thinking: req.thinking,
      signal: req.signal,
    });
  }
}

/**
 * 异步工具的注入依赖（R11）：**恒构造**——"是否注入"由每个工具自己的入参 schema
 * 判定（声明了 `resultUrl` 才注入，见 `mcp/async-result-url.ts`），平台侧不再有
 * `async_tools` 白名单。
 *
 * 回写地址**每次调用现铸**（而非装配期铸一次）：`exp` 从调用时刻起算更贴合"任务最长时长"，
 * 且能把 `call_id` 与工具全名作为**归属提示参数**写进 URL——服务只需原样回传，
 * 产出即可接回具体对话与那一次调用（契约 §10.3）。
 */
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

/**
 * 本轮挂载给模型的工具名集合（注册校验的唯一判据，`FR-043`）。
 *
 * 每个工具名经 `matchKeys` 展开为"完整名 + 去 `{服务}__` 前缀名"：
 * 规则的 `related_functions` 写裸名（`checkSupplierExistence`），
 * 而模型看到的工具名带服务前缀（`erp__checkSupplierExistence`）——
 * 两种键都登记，才既支持带前缀也支持不带前缀的服务。
 */
function collectAvailableNames(tools: readonly AgentTool[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const tool of tools) {
    for (const key of matchKeys(tool.name)) names.add(key);
  }
  return names;
}

/** 该服务是否需要任何交互确认（never/缺省 = 否） */
function needsConfirmation(policy: McpConfirmation | undefined): boolean {
  if (policy === undefined || policy === 'never') return false;
  if (policy === 'always') return true;
  return policy.tools.length > 0;
}

/** 单个工具（原始工具名，不含 server 前缀）是否命中确认策略 */
function toolNeedsConfirmation(policy: McpConfirmation | undefined, rawToolName: string): boolean {
  if (policy === 'always') return true;
  if (typeof policy === 'object' && Array.isArray(policy.tools)) {
    return policy.tools.includes(rawToolName);
  }
  return false;
}

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
import type { PooledInstance } from '../domain/agent-pool.js';
import { computeConfigFingerprint } from '../domain/config-fingerprint.js';
import { FileAccess } from '../domain/file-access.js';
import type { AgentRunRequest } from '../domain/run-manager.js';
import {
  SPACE_PREP,
  SPACE_SHARED,
  SPACE_TMP,
  ScenarioNotConfiguredError,
  loadScenario,
  userAgentsDir,
} from '../domain/dirs.js';
import type {
  AgentConfigBundle,
  LlmEvent,
  McpConfirmation,
  McpConnectionStatus,
  ModelSelection,
  PoolKey,
} from '../types.js';
import { runAgentLoopEvents } from './agent-loop.js';
import { buildBuiltinTools } from './builtin-tools.js';
import { mintSignedUrl } from './file-sign.js';
import { wrapToolWithInteraction } from './tool-intercept.js';
import type { LlmProvider } from './llm/llm-provider.js';
import { PiAiLlmProvider } from './llm/pi-ai-provider.js';
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
  /** read_file 截断上限（KB） */
  truncateKb?: number;
  /** 签名直链对外基址（file_args 转换用） */
  publicBaseUrl: string;
  /** 签名直链 HMAC 密钥（file_args 转换用） */
  fileSignSecret: string;
  /** 实例内 MCP 单 server 建连落定时回调（server.ts 接线到事件总线 → SSE 推送） */
  onMcpStatus?: (key: PoolKey) => void;
  /** MCP 工具调用计数回调（R4 / FR-049）；由 server.ts 接线到 UsageDb。第三参为调用发起用户 */
  onMcpCall?: (serviceName: string, ok: boolean, userId?: string) => void;
}

export class AgentInstanceFactory {
  constructor(private readonly deps: AgentFactoryDeps) {}

  /** 创建实例：配置加载失败抛 AgentConfigError；MCP 异步并发建连，不等待 */
  async create(key: PoolKey): Promise<ChatAgent> {
    const { root, logger, mcpTimeoutMs } = this.deps;
    const agentDir = path.join(userAgentsDir(root, key.userId), key.agentName);
    const config = loadAgentConfig(agentDir, {
      logger: {
        warn: (msg: string) => logger.warn({ alert: true, agent_name: key.agentName }, msg),
      },
    });

    const mcp = new McpManager({
      timeoutMs: mcpTimeoutMs,
      logger: {
        warn: (msg: string) => logger.warn({ alert: true, agent_name: key.agentName }, msg),
      },
      ...(this.deps.onMcpStatus ? { onStatusChange: () => this.deps.onMcpStatus!(key) } : {}),
    });
    // 异步并发建连：不 await，不阻断实例就绪（保首字延迟 SC-001）
    void mcp.connectAll(config.mcpServers);

    const instance: ChatAgent = {
      key,
      config,
      // 固化创建时的指纹：部署（目录级原子改名）会改变 mtime，从而改变指纹
      configFingerprint: computeConfigFingerprint(agentDir),
      activeThreads: 0,
      lastActiveAt: Date.now(),
      unavailableMcp: () => mcp.unavailable(),
      mcpStatusOf: (server) => mcp.statusOf(server),
      dispose: () => mcp.closeAll(),
      run: (req) => this.runWith(instance, mcp, req),
    };
    return instance;
  }

  private async *runWith(
    inst: ChatAgent,
    mcp: McpManager,
    req: AgentRunRequest,
  ): AsyncIterable<LlmEvent> {
    // 每次运行的日志绑定用户/数字人/线程（任务 2026-09-15：日志必须可归属到用户）
    const logger = this.deps.logger.child({
      user_id: inst.key.userId,
      agent_name: inst.key.agentName,
      thread_id: req.threadId,
    });
    const tools: AgentTool[] = [];

    // 内置工具（Phase 5）：按 TOOL.json 启用项装配，全部经 FileAccess 代理；
    // 每次 run 重建以绑定当前 threadId（write_file 前缀）
    if (inst.config.enabledTools.length > 0) {
      const fa = new FileAccess({
        optAgentRoot: this.deps.root,
        userId: inst.key.userId,
        logger,
        truncateKb: this.deps.truncateKb,
      });
      // list_dir/read_file 的目录清单按**该数字人**的 scenario 动态生成；
      // 未配置场景时退化为三空间根
      const availableDirs = listAvailableDirs(
        this.deps.root,
        inst.key.userId,
        inst.key.agentName,
      );
      tools.push(
        ...buildBuiltinTools({
          fileAccess: fa,
          threadId: req.threadId,
          enabled: inst.config.enabledTools,
          availableDirs,
          logger,
        }),
      );
    }
    // MCP 工具：已建连的 server 收集工具表
    for (const server of inst.config.mcpServers) {
      if (!mcp.isAvailable(server.name)) continue;
      try {
        const toolInfos = await mcp.listTools(server.name);
        // file_args 声明：绑定当前用户的 FileAccess + 签名直链铸造（远程服务回源下载）
        const fileCtx = server.fileArgs
          ? {
              fileAccess: new FileAccess({
                optAgentRoot: this.deps.root,
                userId: inst.key.userId,
                logger,
              }),
              userId: inst.key.userId,
              mintUrl: (userId: string, relPath: string) =>
                mintSignedUrl(this.deps.publicBaseUrl, this.deps.fileSignSecret, userId, relPath),
            }
          : undefined;
        const agentTools = mcpToolsAsAgentTools(
          mcp,
          server.name,
          toolInfos,
          // 强制穿透的运行上下文（2026-09-16）：uid=当前用户、sid=当前会话；
          // 工具 schema 里声明了才注入，没声明的不受影响
          { uid: inst.key.userId, sid: req.threadId },
          server.fileArgs,
          fileCtx,
          this.deps.onMcpCall,
          logger,
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
                ? wrapToolWithInteraction(t, req.interactionSink)
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

    // 请求级模型覆盖（FR-023）：指定模型时按该 entry 构造临时 provider，
    // 不重建实例（实例共享 MCP/工具连接）；缺省用默认模型全局单例
    const llm = req.model
      ? this.deps.providerFor
        ? this.deps.providerFor(req.model)
        : new PiAiLlmProvider(req.model)
      : this.deps.llm();
    // FR-017：滚动摘要等动态片段追加到实例固化 System Prompt 之后
    const systemPrompt = req.systemExtra
      ? `${inst.config.systemPrompt}\n\n${req.systemExtra}`
      : inst.config.systemPrompt;
    if (tools.length === 0 || !(llm instanceof PiAiLlmProvider)) {
      if (tools.length > 0) {
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
      tools,
      thinking: req.thinking,
      signal: req.signal,
    });
  }
}

/**
 * list_dir/read_file 可用的目录清单：数据准备子目录（**该数字人** scenario 定义）
 * + 共享空间 + 临时空间。
 *
 * 场景随数字人存放，故同一用户的不同数字人清单可以不同。
 */
function listAvailableDirs(root: string, userId: string, agentName: string): string[] {
  try {
    const scenario = loadScenario(root, userId, agentName);
    return [
      ...scenario.dataPrepDirs.map((d) => `${SPACE_PREP}/${d}`),
      SPACE_SHARED,
      SPACE_TMP,
    ];
  } catch (err) {
    if (err instanceof ScenarioNotConfiguredError) return [SPACE_SHARED, SPACE_TMP];
    throw err;
  }
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

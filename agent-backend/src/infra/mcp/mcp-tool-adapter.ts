import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Logger } from 'pino';
import type { FileAccess } from '../../domain/file-access.js';
import {
  FILE_ARG_PATH_HINT,
  parseFileArgMode,
  parseFileArgPath,
  type FileArgMode,
  type FileArgStep,
} from '../../domain/file-arg-path.js';
import type { McpCallEvent } from '../../types.js';
import { toolErrorResult } from '../../domain/tool-error.js';
import {
  ASYNC_RESULT_URL_PARAM,
  declaresResultUrl,
  injectResultUrl,
  type AsyncToolContext,
} from './async-result-url.js';
import type { McpManager, McpToolInfo } from './mcp-manager.js';
import { classifyMcpError, McpUnavailableError } from './mcp-manager.js';
import { mcpResultText } from './mcp-result-text.js';
import {
  exposeSchema,
  hideSchemaPaths,
  withServerTitleX,
  type InputSchemaLike,
} from './mcp-schema-view.js';

export interface FileArgContext {
  fileAccess: FileAccess;
  userId: string;
  mintUrl: (userId: string, relPath: string) => string;
}

/**
 * 强制穿透给工具的**运行时上下文**（2026-09-16）。
 *
 * `uid`（用户 id，如 `admin`）与 `sid`（当前会话 id = `thread_id`）由**运行环境**填，
 * MUST NOT 交给 LLM 填：模型既不知道真实值，填错还会造成**越权访问他人数据**。
 */
export interface RuntimeContext {
  uid: string;
  sid: string;
}

export const RUNTIME_CONTEXT_PARAMS = ['uid', 'sid'] as const;

export function mcpToolsAsAgentTools(
  manager: McpManager,
  serverName: string,
  tools: McpToolInfo[],
  runtime?: RuntimeContext,
  fileArgs?: Record<string, Record<string, FileArgMode>>,
  fileCtx?: FileArgContext,
  onCall?: (event: McpCallEvent) => void,
  logger?: Logger,
  asyncCtx?: AsyncToolContext,
  toolLabels?: Record<string, string>,
): AgentTool[] {
  return tools.map((t) => {
    const injected = declaredContextParams(t.inputSchema);
    const asyncInjected =
      asyncCtx && declaresResultUrl(t.inputSchema) ? [ASYNC_RESULT_URL_PARAM] : [];
    // 模型无从填写，也就不可能幻觉出伪造的 http 地址（2026-09-18）
    const decl = fileArgs?.[t.name];
    const derivedPaths = decl
      ? Object.entries(decl)
          .map(([path, mode]) => ({
            steps: parseFileArgPath(path),
            from: parseFileArgMode(mode)?.from,
          }))
          .filter(
            (e): e is { steps: FileArgStep[]; from: string } =>
              e.steps !== null && e.from !== undefined,
          )
          .map((e) => e.steps)
      : [];
    return {
      name: `${serverName}__${t.name}`,
      label: toolLabels?.[t.name]?.trim() || t.title?.trim() || `${serverName}: ${t.name}`,
      description: t.description ?? '',
      // MCP inputSchema 是 JSON Schema，与 typebox 结构兼容；直接透传。
      // 但**穿透参数与派生目标字段对 LLM 隐藏**：模型无从填写，也就不可能覆盖或幻觉出别的值
      parameters: exposeSchema(
        withServerTitleX(hideSchemaPaths(t.inputSchema, derivedPaths), t.title),
        [...injected, ...asyncInjected],
      ) as never,
      execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
        let finalParams: unknown;
        try {
          finalParams = injectRuntimeContext(
            rewriteFileArgs(serverName, t.name, params, fileArgs, fileCtx, logger),
            injected,
            runtime,
          );
          if (asyncInjected.length > 0 && asyncCtx) {
            finalParams = injectResultUrl(finalParams, asyncCtx.mintResultUrl(t.name, toolCallId));
          }
        } catch (err) {
          logger?.warn(
            { alert: true, event: 'mcp.fileargs.denied', service: serverName, tool: t.name },
            `MCP 文件参数校验失败，调用未发出：${err instanceof Error ? err.message : String(err)}`,
          );
          // 标记失败：调用**未发出**，用户必须看到这次没做成（此前是一张绿色卡片）
          return toolErrorResult(
            `文件参数校验失败：${err instanceof Error ? err.message : String(err)}`,
            'MCP_FILE_ARGS_DENIED',
          );
        }
        // 计时口径：`callTool` 内部最多尝试 2 次（30s 超时 + 重试 1 次），故从调用前
        const startedAt = Date.now();
        try {
          const result = await manager.callTool(serverName, t.name, finalParams);
          onCall?.({
            service: serverName,
            tool: t.name,
            ok: true,
            durationMs: Date.now() - startedAt,
            userId: runtime?.uid ?? null,
            threadId: runtime?.sid ?? null,
          });
          logger?.info(
            { event: 'mcp.tool.call', scope: 'run', service: serverName, tool: t.name, ok: true },
            `MCP 工具调用成功：${serverName}.${t.name}`,
          );
          // 信封——否则业务字段（如 viewUrl）被压进字符串，抽取与结构化展示都够不着（见 mcp-result-text.ts）
          const text = mcpResultText(result, { logger, service: serverName, tool: t.name });
          return { content: [{ type: 'text', text }], details: {} };
        } catch (err) {
          // 真的发起了调用但失败：计入失败次数（含"服务不可用"）
          onCall?.({
            service: serverName,
            tool: t.name,
            ok: false,
            durationMs: Date.now() - startedAt,
            errorKind: classifyMcpError(err),
            userId: runtime?.uid ?? null,
            threadId: runtime?.sid ?? null,
          });
          logger?.warn(
            { event: 'mcp.tool.call', scope: 'run', service: serverName, tool: t.name, ok: false },
            `MCP 工具调用失败：${serverName}.${t.name}`,
          );
          if (err instanceof McpUnavailableError) {
            return toolErrorResult(
              `外部服务 ${serverName} 当前不可用，请稍后尝试`,
              'MCP_UNAVAILABLE',
            );
          }
          return toolErrorResult(
            `外部服务 ${serverName} 调用失败：${err instanceof Error ? err.message : String(err)}`,
            'MCP_CALL_FAILED',
          );
        }
      },
    };
  });
}

function declaredContextParams(schema: unknown): Array<keyof RuntimeContext> {
  if (typeof schema !== 'object' || schema === null) return [];
  const properties = (schema as InputSchemaLike).properties;
  if (typeof properties !== 'object' || properties === null) return [];
  return RUNTIME_CONTEXT_PARAMS.filter((name) => name in (properties as Record<string, unknown>));
}

function injectRuntimeContext(
  params: unknown,
  injected: readonly (keyof RuntimeContext)[],
  runtime?: RuntimeContext,
): unknown {
  if (injected.length === 0 || !runtime) return params;
  const base =
    typeof params === 'object' && params !== null
      ? { ...(params as Record<string, unknown>) }
      : params === undefined
        ? {}
        : null;
  if (base === null) return params;
  for (const name of injected) base[name] = runtime[name];
  return base;
}

const MISSING = Symbol('fileArgMissing');

interface PathContext {
  serverName: string;
  toolName: string;
  path: string;
  fileCtx: FileArgContext;
  logger?: Logger;
}

function rewriteFileArgs(
  serverName: string,
  toolName: string,
  params: unknown,
  fileArgs?: Record<string, Record<string, FileArgMode>>,
  fileCtx?: FileArgContext,
  logger?: Logger,
): unknown {
  const decl = fileArgs?.[toolName];
  if (!decl || !fileCtx) return params;
  const entries = Object.entries(decl);
  if (entries.length === 0) return params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return params;

  const base: PathContext = {
    serverName,
    toolName,
    path: '',
    fileCtx,
    ...(logger ? { logger } : {}),
  };
  let out = params as Record<string, unknown>;
  for (const [path, modeRaw] of entries) {
    const ctx = { ...base, path };
    const mode = parseFileArgMode(modeRaw);
    if (!mode) {
      // 平台保存与 `MCP.json` 加载都已拦过非法模式，这里是最后一道兜底
      throw new Error(
        `file_args.${toolName} 的「${path}」转换模式不合法（须为 "url" 或 "url:from=<取值路径>"）`,
      );
    }
    if (mode.from !== undefined) {
      out = deriveFileArg(out, path, mode.from, ctx) as Record<string, unknown>;
      continue;
    }
    const steps = parseFileArgPath(path);
    if (!steps) {
      // 平台保存与 `MCP.json` 加载都已拦过非法路径，这里是最后一道兜底
      throw new Error(
        `file_args.${toolName} 的「${path}」不是合法取值路径（${FILE_ARG_PATH_HINT}）`,
      );
    }
    out = applyPath(out, steps, ctx, '') as Record<string, unknown>;
  }
  return out;
}

function deriveFileArg(
  params: Record<string, unknown>,
  targetPath: string,
  fromPath: string,
  ctx: PathContext,
): Record<string, unknown> {
  const targetSteps = parseFileArgPath(targetPath)!;
  const fromSteps = parseFileArgPath(fromPath)!;
  const shared = targetSteps.slice(0, -1);
  const targetKey = targetSteps.at(-1)!.key;
  const sourceKey = fromSteps.at(-1)!.key;

  const walk = (container: unknown, steps: FileArgStep[], prefix: string): unknown => {
    if (steps.length === 0) {
      if (typeof container !== 'object' || container === null || Array.isArray(container)) {
        throw new Error(
          `file_args 声明「${ctx.path}」：${prefix || '入参'} 应为对象（实际是 ${shapeOf(container)}）`,
        );
      }
      const obj = container as Record<string, unknown>;
      const value = obj[sourceKey];
      const loc = joinPath(prefix, sourceKey);
      if (value === undefined || value === null) {
        throw new Error(
          `file_args 声明「${ctx.path}」：${prefix || '入参'} 缺少派生来源字段「${sourceKey}」，无法铸造「${targetKey}」`,
        );
      }
      if (typeof value === 'string' && value.trim() === '') {
        throw new Error(`file_args 声明「${ctx.path}」：${loc} 为空串，无法铸造「${targetKey}」`);
      }
      const minted = convertLeaf(value, ctx, loc);
      ctx.logger?.info(
        {
          event: 'mcp.fileargs.derived',
          service: ctx.serverName,
          tool: ctx.toolName,
          path: ctx.path,
          from: fromPath,
        },
        `MCP 文件参数派生注入：${ctx.serverName}.${ctx.toolName} 的「${targetPath}」取自「${fromPath}」（${loc}）`,
      );
      return { ...obj, [targetKey]: minted };
    }

    const step = steps[0]!;
    const rest = steps.slice(1);
    const current = requireProperty(container, step.key, prefix, ctx);
    const loc = joinPath(prefix, step.key);
    if (step.array) {
      if (!Array.isArray(current)) {
        throw new Error(
          `file_args 声明「${ctx.path}」：${loc} 应为数组（实际是 ${shapeOf(current)}）`,
        );
      }
      const mapped = current.map((item, index) => {
        try {
          return walk(item, rest, `${loc}[]`);
        } catch (err) {
          throw new Error(
            `${err instanceof Error ? err.message : String(err)}（元素 ${loc}[${index}]）`,
            { cause: err },
          );
        }
      });
      return { ...(container as Record<string, unknown>), [step.key]: mapped };
    }
    const next = walk(current, rest, loc);
    return { ...(container as Record<string, unknown>), [step.key]: next };
  };

  return walk(params, shared, '') as Record<string, unknown>;
}

function requireProperty(
  container: unknown,
  key: string,
  prefix: string,
  ctx: PathContext,
): unknown {
  if (typeof container !== 'object' || container === null || Array.isArray(container)) {
    throw new Error(
      `file_args 声明「${ctx.path}」：${prefix || '入参'} 应为对象（实际是 ${shapeOf(container)}）`,
    );
  }
  const value = (container as Record<string, unknown>)[key];
  if (value === undefined || value === null) {
    throw new Error(
      `file_args 声明「${ctx.path}」：${prefix || '入参'} 缺少派生来源字段「${key}」，调用未发出`,
    );
  }
  return value;
}

function applyPath(
  container: unknown,
  steps: FileArgStep[],
  ctx: PathContext,
  prefix: string,
): unknown {
  if (steps.length === 0) return convertLeaf(container, ctx, prefix || '入参');

  const step = steps[0]!;
  const rest = steps.slice(1);
  const current = takeProperty(container, step.key, prefix, ctx);
  if (current === MISSING) return container;

  const loc = joinPath(prefix, step.key);
  const next = step.array
    ? mapElements(current, loc, rest, ctx)
    : applyPath(current, rest, ctx, loc);
  return { ...(container as Record<string, unknown>), [step.key]: next };
}

function takeProperty(container: unknown, key: string, prefix: string, ctx: PathContext): unknown {
  if (typeof container !== 'object' || container === null || Array.isArray(container)) {
    throw new Error(
      `file_args 声明「${ctx.path}」：${prefix || '入参'} 应为对象（实际是 ${shapeOf(container)}）`,
    );
  }
  const value = (container as Record<string, unknown>)[key];
  if (value === undefined || value === null) {
    warnUnmatched(ctx, joinPath(prefix, key), '本次入参里没有这个键');
    return MISSING;
  }
  return value;
}

/** 声明了 `[]` 的那一段：值必须是数组，路径其余部分应用到**每个元素** */
function mapElements(
  items: unknown,
  loc: string,
  rest: FileArgStep[],
  ctx: PathContext,
): unknown[] {
  if (!Array.isArray(items)) {
    throw new Error(`file_args 声明「${ctx.path}」：${loc} 应为数组（实际是 ${shapeOf(items)}）`);
  }
  return items.map((item, index) => {
    try {
      return applyPath(item, rest, ctx, `${loc}[]`);
    } catch (err) {
      // 补上元素下标：清单有几十条时，否则只能靠肉眼找是第几项
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}（元素 ${loc}[${index}]）`,
        { cause: err },
      );
    }
  });
}

function convertLeaf(value: unknown, ctx: PathContext, loc: string): unknown {
  if (typeof value !== 'string') {
    throw new Error(`file_args 声明「${ctx.path}」：${loc} 应为字符串（实际是 ${shapeOf(value)}）`);
  }
  if (value.trim() === '') {
    warnUnmatched(ctx, loc, '值为空串');
    return value;
  }
  if (/^https?:\/\//i.test(value)) return value; // 已是可下载直链：无需铸造，也不能进沙箱
  const { relPath } = ctx.fileCtx.fileAccess.resolveVerified(value);
  return ctx.fileCtx.mintUrl(ctx.fileCtx.userId, relPath);
}

function warnUnmatched(ctx: PathContext, loc: string, why: string): void {
  ctx.logger?.warn(
    {
      event: 'mcp.fileargs.unmatched',
      service: ctx.serverName,
      tool: ctx.toolName,
      path: ctx.path,
    },
    `MCP 文件参数未匹配：${ctx.serverName}.${ctx.toolName} 的 file_args 声明「${ctx.path}」在 ${loc} 取不到值（${why}），该参数原样透传——若它是必填参数，请核对声明与工具入参是否一致`,
  );
}

function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

function shapeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

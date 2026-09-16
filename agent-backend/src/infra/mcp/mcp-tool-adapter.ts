/**
 * MCP tool → pi-agent-core AgentTool 适配（T021）。
 *
 * - 工具名 `{server}__{tool}`，避免多 server 重名冲突
 * - 调用经 McpManager（30s 超时 + 重试 1 次）
 * - McpUnavailableError 不抛出：以自然语言降级提示作为工具结果返回，
 *   Agent 在 content 中说明"当前服务不可用，请稍后尝试"（FR-024，不走 SSE error）
 * - file_args 声明（可选）：LLM 传 user-data 相对路径，经 FileAccess 沙箱校验后
 *   **按声明的取值路径**（如 `image`，或对象数组里的 `items[].excelFileUrl`）
 *   原位替换为签名直链发给服务（远程/跨容器服务无磁盘访问权）
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Logger } from 'pino';
import type { FileAccess } from '../../domain/file-access.js';
import { FILE_ARG_PATH_HINT, parseFileArgPath, type FileArgStep } from '../../domain/file-arg-path.js';
import type { McpManager, McpToolInfo } from './mcp-manager.js';
import { McpUnavailableError } from './mcp-manager.js';

/** 文件参数转换依赖（按 server 声明启用；agent-factory 按当前用户注入） */
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

/**
 * 约定被穿透的参数名。
 *
 * 要不要注入**由工具自己的入参 schema 决定**：声明了 `uid`/`sid` 的工具才会收到，
 * 没声明的工具（如 OCR 的 `ocr_image`）参数**原样透传**，不受任何影响——
 * 这样"强制穿透"不会把多余字段塞给严格校验入参的第三方服务。
 * 若某个服务用了别的参数名（如 `user_id`/`session_id`），只需在此处扩展一行。
 */
export const RUNTIME_CONTEXT_PARAMS = ['uid', 'sid'] as const;

export function mcpToolsAsAgentTools(
  manager: McpManager,
  serverName: string,
  tools: McpToolInfo[],
  /** 本次运行的上下文（`uid`/`sid`）：与 file_args 一样**由运行环境提供，不经 LLM** */
  runtime?: RuntimeContext,
  fileArgs?: Record<string, Record<string, 'url'>>,
  fileCtx?: FileArgContext,
  /**
   * 调用计数回调（`FR-049`/`FR-050`）：成功/失败各记一次，由 server 接线到 UsageDb。
   * 第三个参数为调用发起用户（2026-09-16 十四次调整：支撑按用户明细），取自运行上下文 `uid`。
   */
  onCall?: (serviceName: string, ok: boolean, userId?: string) => void,
  /** 绑定了 user_id/agent_name/thread_id 的运行日志（任务 2026-09-15：MCP 调用可归属到用户） */
  logger?: Logger,
): AgentTool[] {
  return tools.map((t) => {
    // 工具声明了哪些穿透参数（按自己的入参 schema 判定）
    const injected = declaredContextParams(t.inputSchema);
    return {
      name: `${serverName}__${t.name}`,
      label: `${serverName}: ${t.name}`,
      description: t.description ?? '',
      // MCP inputSchema 是 JSON Schema，与 typebox 结构兼容；直接透传。
      // 但**穿透参数对 LLM 隐藏**：模型无从填写，也就不可能覆盖或幻觉出别的值
      parameters: exposeSchema(t.inputSchema, injected) as never,
      execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
        let finalParams: unknown;
        try {
          // 顺序：先按声明路径铸造文件参数（相对路径 → 签名直链），
          // 再注入运行环境的 uid/sid（覆盖 LLM 填的任何内容）
          finalParams = injectRuntimeContext(
            rewriteFileArgs(serverName, t.name, params, fileArgs, fileCtx, logger),
            injected,
            runtime,
          );
        } catch (err) {
          // 沙箱校验拒绝（路径越权/文件不存在）：作为工具结果返回，Agent 可自我纠正。
          // 这类失败发生在**调用外部服务之前**，不计入 MCP 调用次数。
          logger?.warn(
            { alert: true, event: 'mcp.fileargs.denied', service: serverName, tool: t.name },
            `MCP 文件参数校验失败，调用未发出：${err instanceof Error ? err.message : String(err)}`,
          );
          return {
            content: [
              {
                type: 'text',
                text: `文件参数校验失败：${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            details: {},
          };
        }
        try {
          const result = await manager.callTool(serverName, t.name, finalParams);
          onCall?.(serverName, true, runtime?.uid);
          logger?.info(
            { event: 'mcp.tool.call', scope: 'run', service: serverName, tool: t.name, ok: true },
            `MCP 工具调用成功：${serverName}.${t.name}`,
          );
          const text = typeof result === 'string' ? result : JSON.stringify(result);
          return { content: [{ type: 'text', text }], details: {} };
        } catch (err) {
          // 真的发起了调用但失败：计入失败次数（含"服务不可用"）
          onCall?.(serverName, false, runtime?.uid);
          logger?.warn(
            { event: 'mcp.tool.call', scope: 'run', service: serverName, tool: t.name, ok: false },
            `MCP 工具调用失败：${serverName}.${t.name}`,
          );
          if (err instanceof McpUnavailableError) {
            return {
              content: [{ type: 'text', text: `外部服务 ${serverName} 当前不可用，请稍后尝试` }],
              details: {},
            };
          }
          throw err;
        }
      },
    };
  });
}

/** JSON Schema 里我们关心的部分（只读） */
interface InputSchemaLike {
  properties?: Record<string, unknown>;
  required?: unknown;
  [key: string]: unknown;
}

/**
 * 该工具声明了哪些穿透参数（按 `properties` 判定，保持 `RUNTIME_CONTEXT_PARAMS` 的顺序）。
 *
 * **没声明就不注入**：这是"不影响不需要 uid/sid 的工具"的判据来源。
 */
function declaredContextParams(schema: unknown): Array<keyof RuntimeContext> {
  if (typeof schema !== 'object' || schema === null) return [];
  const properties = (schema as InputSchemaLike).properties;
  if (typeof properties !== 'object' || properties === null) return [];
  return RUNTIME_CONTEXT_PARAMS.filter((name) => name in (properties as Record<string, unknown>));
}

/**
 * 暴露给 LLM 的入参 schema：**删掉穿透参数**（含 `required` 里的同名项）。
 *
 * 删 `required` 里的一项是否会让模型少填必填参数？不会——这些值由运行环境补齐，
 * 且我们是在**发出调用之前**注入的，服务端看到的参数依旧完整。
 * 未声明穿透参数的工具**原样返回**（不碰第三方给的 schema 对象）。
 */
function exposeSchema(schema: unknown, injected: readonly string[]): unknown {
  if (injected.length === 0 || typeof schema !== 'object' || schema === null) {
    return schema ?? { type: 'object', properties: {} };
  }
  const source = schema as InputSchemaLike;
  const properties = { ...(source.properties ?? {}) };
  for (const name of injected) delete properties[name];
  const next: InputSchemaLike = { ...source, properties };
  if (Array.isArray(source.required)) {
    const required = source.required.filter(
      (item): item is string => typeof item === 'string' && !injected.includes(item),
    );
    if (required.length > 0) next.required = required;
    else delete next.required;
  }
  return next;
}

/**
 * 调用前**强制注入** `uid`/`sid`：值一律以运行环境为准，覆盖 LLM 填的任何内容。
 *
 * 参数不是对象时原样返回（防御：MCP 入参本就应当是对象，异常形状交给服务端校验）。
 */
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

/** 声明路径在本次入参里取不到值时的哨兵（与"取到的值是 undefined"区分开） */
const MISSING = Symbol('fileArgMissing');

/** 单条声明在改写过程中的上下文：错误信息与告警日志都要定位到「哪个服务的哪个工具」 */
interface PathContext {
  serverName: string;
  toolName: string;
  /** 声明的取值路径（如 `items[].excelFileUrl`） */
  path: string;
  fileCtx: FileArgContext;
  logger?: Logger;
}

/**
 * 命中 file_args 声明的**取值路径**：把路径末端的（可能位于数组元素里的）相对路径
 * **原位置换**为签名直链；沙箱拒绝时抛 `PermissionError`（由 `execute` 转成工具结果）。
 *
 * 三条判据（2026-09-16；起因见 `domain/file-arg-path.ts`——旧实现只认顶层字符串参数，
 * 对象数组里的字段"配了也静默不生效"）：
 *
 * 1. **取不到值**（路径上的键本次没提供、为 `null` 或是空串）→ 原样透传，
 *    并记 `mcp.fileargs.unmatched` 告警日志。可选参数是合法场景，声明写错也长这样，
 *    日志让后者可查——**静默**正是这次要消除的东西；
 * 2. **形状不符**（该是数组不是数组、该是对象不是对象、叶子不是字符串）→ **抛错**、
 *    调用不发出。这类不一致继续放行只会得到远端更难懂的报错，或"铸了个寂寞"；
 * 3. **值已是 `http(s)://` 直链** → 原样透传。对方要的就是"可下载地址"，这正是目标形态；
 *    且这类值**不能**进沙箱——它不是 user-data 相对路径，会被判"目录不在白名单"，
 *    从而**把整次调用误伤掉**（同一批里的合法文件也一起失败）。
 *
 * 未声明 `file_args` 的工具、入参不是对象的调用，一律原样透传（不碰第三方给的形状）。
 */
function rewriteFileArgs(
  serverName: string,
  toolName: string,
  params: unknown,
  fileArgs?: Record<string, Record<string, 'url'>>,
  fileCtx?: FileArgContext,
  logger?: Logger,
): unknown {
  const decl = fileArgs?.[toolName];
  if (!decl || !fileCtx) return params;
  const paths = Object.keys(decl);
  if (paths.length === 0) return params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return params;

  const base: PathContext = {
    serverName,
    toolName,
    path: '',
    fileCtx,
    ...(logger ? { logger } : {}),
  };
  let out = params as Record<string, unknown>;
  for (const path of paths) {
    const steps = parseFileArgPath(path);
    if (!steps) {
      // 平台保存与 `MCP.json` 加载都已拦过非法路径，这里是最后一道兜底
      throw new Error(
        `file_args.${toolName} 的「${path}」不是合法取值路径（${FILE_ARG_PATH_HINT}）`,
      );
    }
    out = applyPath(out, steps, { ...base, path }, '') as Record<string, unknown>;
  }
  return out;
}

/**
 * 按路径递归改写，返回**新的容器**（不改动入参对象，数组元素也逐个重建）。
 * `prefix` 是"已经走过的路径"，只用于错误信息与日志定位（写法与声明一致，如 `items[]`）。
 */
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

/** 取下一步的值；键不存在/为 null 时记日志并返回哨兵（调用方原样保留该分支） */
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
    throw new Error(
      `file_args 声明「${ctx.path}」：${loc} 应为数组（实际是 ${shapeOf(items)}）`,
    );
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

/** 路径末端：铸签名直链（相对路径）或原样透传（外部直链） */
function convertLeaf(value: unknown, ctx: PathContext, loc: string): unknown {
  if (typeof value !== 'string') {
    throw new Error(
      `file_args 声明「${ctx.path}」：${loc} 应为字符串（实际是 ${shapeOf(value)}）`,
    );
  }
  if (value.trim() === '') {
    warnUnmatched(ctx, loc, '值为空串');
    return value;
  }
  if (/^https?:\/\//i.test(value)) return value; // 已是可下载直链：无需铸造，也不能进沙箱
  const { relPath } = ctx.fileCtx.fileAccess.resolveVerified(value); // 越权/不存在抛 PermissionError
  return ctx.fileCtx.mintUrl(ctx.fileCtx.userId, relPath);
}

/**
 * 记"声明了但这次没值"的告警。
 * 刻意不是 `alert: true`：可选参数不填是**正常**的，只有"声明写错"才需要人来处理，
 * 而这种错会每次调用都出现，一眼可见（用 alert 反而会把这条噪声抬成告警）。
 */
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

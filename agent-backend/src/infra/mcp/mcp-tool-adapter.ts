/**
 * MCP tool → pi-agent-core AgentTool 适配（T021）。
 *
 * - 工具名 `{server}__{tool}`，避免多 server 重名冲突
 * - 调用经 McpManager（30s 超时 + 重试 1 次）
 * - McpUnavailableError 不抛出：以自然语言降级提示作为工具结果返回，
 *   Agent 在 content 中说明"当前服务不可用，请稍后尝试"（FR-024，不走 SSE error）
 * - file_args 声明（可选）：LLM 传 user-data 相对路径，经 FileAccess 沙箱校验后
 *   **按声明的取值路径**（如 `image`，或对象数组里的 `items[].excelFileUrl`）
 *   原位替换为签名直链发给服务（远程/跨容器服务无磁盘访问权）；
 *   `"url:from=<来源路径>"` 派生模式的目标字段对 LLM 隐藏，值由引擎从来源路径
 *   推导注入并覆盖模型填写（根治模型对 http 地址字段的幻觉）
 */
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
import {
  ASYNC_RESULT_URL_PARAM,
  declaresResultUrl,
  injectResultUrl,
  type AsyncToolContext,
} from './async-result-url.js';
import type { McpManager, McpToolInfo } from './mcp-manager.js';
import { classifyMcpError, McpUnavailableError } from './mcp-manager.js';
import { exposeSchema, hideSchemaPaths, type InputSchemaLike } from './mcp-schema-view.js';

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
  fileArgs?: Record<string, Record<string, FileArgMode>>,
  fileCtx?: FileArgContext,
  /**
   * 调用计数回调（`FR-049`/`FR-050`）：成功/失败各记一次，由 server 接线到 UsageDb。
   *
   * 2026-09-23：改为回传**事件对象**——除服务名/成败外还带上**工具名**（MCP 服务自己的
   * 工具名，如 `ocr` 下的 `ocr_image`，不含暴露给模型的 `{server}__` 前缀）、耗时与错误分类，
   * 以及运行上下文里的 `uid`（发起用户）与 `sid`（会话 = `thread_id`），供统计下钻与接回对话。
   */
  onCall?: (event: McpCallEvent) => void,
  /** 绑定了 user_id/agent_name/thread_id 的运行日志（任务 2026-09-15：MCP 调用可归属到用户） */
  logger?: Logger,
  /**
   * 异步工具注入依赖（R11）：仅当该服务声明了 `async_tools` 时传入；
   * 缺省 = 不注入 `result_url`（存量行为零变化，见 `async-result-url.ts` 不变式 1）
   */
  asyncCtx?: AsyncToolContext,
): AgentTool[] {
  return tools.map((t) => {
    // 工具声明了哪些穿透参数（按自己的入参 schema 判定）
    const injected = declaredContextParams(t.inputSchema);
    // 异步工具（R11）：命中声明才注入回写地址。schema 未声明 `result_url` 时**告警但不阻断**——
    // "配了但服务收不到回写地址"若静默，服务侧只会一直不产出，排查成本极高（不变式 6）。
    const asyncDeclared = asyncCtx?.tools.includes(t.name) ?? false;
    const asyncInjected =
      asyncDeclared && declaresResultUrl(t.inputSchema) ? [ASYNC_RESULT_URL_PARAM] : [];
    if (asyncDeclared && asyncInjected.length === 0) {
      logger?.warn(
        {
          alert: true,
          event: 'mcp.async.result_url.missing',
          service: serverName,
          tool: t.name,
        },
        `MCP 服务 ${serverName} 的工具 ${t.name} 已声明为异步，但其入参 schema 未声明 ` +
          `${ASYNC_RESULT_URL_PARAM}，回写地址无法送达（该工具不会产生后台产出）——请核对该工具的参数定义`,
      );
    }
    // 派生模式（"url:from="）的目标字段同样对 LLM 隐藏：值由运行环境注入，
    // 模型无从填写，也就不可能幻觉出伪造的 http 地址（2026-09-18）
    const decl = fileArgs?.[t.name];
    const derivedPaths = decl
      ? Object.entries(decl)
          .map(([path, mode]) => ({
            steps: parseFileArgPath(path),
            from: parseFileArgMode(mode)?.from,
          }))
          .filter((e): e is { steps: FileArgStep[]; from: string } => e.steps !== null && e.from !== undefined)
          .map((e) => e.steps)
      : [];
    return {
      name: `${serverName}__${t.name}`,
      label: `${serverName}: ${t.name}`,
      description: t.description ?? '',
      // MCP inputSchema 是 JSON Schema，与 typebox 结构兼容；直接透传。
      // 但**穿透参数与派生目标字段对 LLM 隐藏**：模型无从填写，也就不可能覆盖或幻觉出别的值
      parameters: exposeSchema(hideSchemaPaths(t.inputSchema, derivedPaths), [
        ...injected,
        ...asyncInjected,
      ]) as never,
      execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
        let finalParams: unknown;
        try {
          // 顺序：先按声明路径铸造文件参数（相对路径 → 签名直链），
          // 再注入运行环境的 uid/sid（覆盖 LLM 填的任何内容）
          finalParams = injectRuntimeContext(
            rewriteFileArgs(serverName, t.name, params, fileArgs, fileCtx, logger),
            injected,
            runtime,
          );
          // 异步工具的回写地址（R11）：在 HITL 挂起之后、发出调用之前的最后一跳注入，
          // 故它不会出现在 interaction_request 的 proposed_args 快照里（不变式 2）
          if (asyncInjected.length > 0 && asyncCtx) {
            finalParams = injectResultUrl(finalParams, asyncCtx.mintResultUrl(t.name, toolCallId));
          }
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
        // 计时口径：`callTool` 内部最多尝试 2 次（30s 超时 + 重试 1 次），故从调用前
        // 开始计，得到的是**含重试的用户感知耗时**，不是单次尝试耗时。
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
          const text = typeof result === 'string' ? result : JSON.stringify(result);
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
 * 4. **派生模式（`"url:from=<来源路径>"`）** → 目标字段的值**不取自模型的填写**：
 *    引擎从来源路径读取（同一形状、逐元素对应）、过沙箱、铸造后**无条件覆盖写入**
 *    目标字段（模型塞的伪造 http 地址一律作废）。来源缺失/为空 → **抛错**、调用不发出
 *    （与规则 1 不同：普通声明缺失可能是"可选参数没填"，派生来源是管道命脉，缺了
 *    就该让模型自我纠正），并记 `mcp.fileargs.derived` 日志保证注入可观测。
 *
 * 未声明 `file_args` 的工具、入参不是对象的调用，一律原样透传（不碰第三方给的形状）。
 */
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

/**
 * 派生模式（`"url:from="`）的执行体（2026-09-18）。
 *
 * 目标路径与来源路径**除最后一段外逐段一致**（配置加载已校验），因此前缀各层的
 * 容器是同一个：沿前缀下行读取来源，最后在同一容器上「读来源键 → 铸造 → 写目标键」。
 * 数组段按元素逐个对应（元素下标进错误信息）。全程重建容器、不改入参对象。
 */
function deriveFileArg(
  params: Record<string, unknown>,
  targetPath: string,
  fromPath: string,
  ctx: PathContext,
): Record<string, unknown> {
  const targetSteps = parseFileArgPath(targetPath)!; // 配置加载已校验
  const fromSteps = parseFileArgPath(fromPath)!;
  const shared = targetSteps.slice(0, -1); // 与 fromSteps 前缀相同（isCompatibleFromPath 保证）
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
        throw new Error(
          `file_args 声明「${ctx.path}」：${loc} 为空串，无法铸造「${targetKey}」`,
        );
      }
      // 沙箱校验 + 铸造（外部 http 直链照旧透传，见 convertLeaf）
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

/** 派生读取用的取属性：与 `takeProperty` 的区别是**缺失即抛错**（派生来源是管道命脉） */
function requireProperty(container: unknown, key: string, prefix: string, ctx: PathContext): unknown {
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

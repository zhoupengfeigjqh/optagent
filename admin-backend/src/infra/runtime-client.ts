import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';

export interface BuiltinToolProjection {
  name: string;
  label: string;
  /** 含 `{可用目录}` / `{示例路径}` / `{会话标识}` / `{临时空间}` 占位符的模板 */
  description_template: string;
  parameters: Record<string, unknown>;
  writable: boolean;
}

export interface McpCallStatItem {
  name: string;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
}

export interface McpCallGroupItem {
  service: string;
  tool_name: string | null;
  user_id: string | null;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
  windows?: Record<string, { ok: number; failed: number; total: number }>;
}

export interface McpCallStatsResult {
  stats_available: boolean;
  items: McpCallStatItem[];
  groups: McpCallGroupItem[];
}

export interface RuntimeClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: RuntimeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** 可枚举的内置工具目录（`FR-011`）；不可达 → `ADM_RUNTIME_UNREACHABLE` */
  async builtinTools(): Promise<BuiltinToolProjection[]> {
    const body = await this.getJson<{ items?: BuiltinToolProjection[] }>('/api/builtin-tools');
    const items = body?.items;
    if (!Array.isArray(items)) {
      throw new ApiError(
        ERROR_CODES.ADM_RUNTIME_UNREACHABLE,
        '运行环境返回的内置工具目录结构不合法（缺少 items 数组）',
      );
    }
    return items;
  }

  /**
   * MCP 调用统计（`FR-049`／`FR-050`）。
   * 不可达时**抛错**而不是返回空——上层必须把"读不到"呈现为"未知"，
   * MUST NOT 以 0 冒充（`FR-009`）。
   */
  async mcpCallStats(): Promise<McpCallStatsResult> {
    const body = await this.getJson<McpCallStatsResult>('/api/mcp-call-stats');
    if (
      !body ||
      typeof body.stats_available !== 'boolean' ||
      !Array.isArray(body.items) ||
      !Array.isArray(body.groups)
    ) {
      throw new ApiError(ERROR_CODES.ADM_RUNTIME_UNREACHABLE, '运行环境返回的调用统计结构不合法');
    }
    return body;
  }

  private async getJson<T>(apiPath: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${apiPath}`, { signal: controller.signal });
    } catch (err) {
      throw new ApiError(
        ERROR_CODES.ADM_RUNTIME_UNREACHABLE,
        `运行环境不可达（${this.baseUrl}${apiPath}，${(err as Error).message}）`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ApiError(
        ERROR_CODES.ADM_RUNTIME_UNREACHABLE,
        `运行环境端点 ${apiPath} 返回 HTTP ${response.status}`,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(ERROR_CODES.ADM_RUNTIME_UNREACHABLE, `运行环境端点 ${apiPath} 返回非 JSON 响应`);
    }
  }
}

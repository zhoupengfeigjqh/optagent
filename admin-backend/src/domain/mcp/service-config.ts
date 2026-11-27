import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { MCP_TRANSPORT_HINT, normalizeTransport, type McpTransport } from './transport.js';
import {
  MCP_SERVICE_NAME_HINT,
  MCP_URL_HINT,
  isValidMcpServiceName,
  normalizeAllowedTools,
  normalizeConfirmation,
  normalizeFileArgs,
  normalizeHeaders,
  normalizeRulesFields,
  normalizeToolLabels,
  normalizeUrl,
  sanitize,
} from './service-config-fields.js';
import type { PlatformStore } from '../../infra/platform-store.js';

const REL = 'mcp-services.json';

export type { McpTransport };

export { MCP_SERVICE_NAME_HINT, MCP_URL_HINT, isValidMcpServiceName };

export interface McpServiceConfig {
  name: string;
  description: string;
  transport: McpTransport;
  url: string | null;
  command: string | null;
  args: string[] | null;
  file_args: Record<string, Record<string, string>>;
  confirmation: McpConfirmation;
  rules_fields: Record<string, string>;
  allowed_tools: string[];
  tool_labels: Record<string, string>;
  headers: Record<string, string>;
  updated_at: string;
}

export type McpConfirmation = 'never' | 'always' | { tools: string[] };

interface Document {
  items: Record<string, McpServiceConfig>;
}

export interface McpConfigInput {
  name?: unknown;
  description?: unknown;
  transport?: unknown;
  url?: unknown;
  command?: unknown;
  args?: unknown;
  writable?: unknown;
  permission_scope?: unknown;
  file_args?: unknown;
  confirmation?: unknown;
  rules_fields?: unknown;
  allowed_tools?: unknown;
  tool_labels?: unknown;
  headers?: unknown;
}

interface McpFallbacks {
  headers: Record<string, string>;
  toolLabels: Record<string, string>;
}

export class McpServiceConfigService {
  constructor(private readonly store: PlatformStore) {}

  listAll(): McpServiceConfig[] {
    const doc = this.store.readJson<Document>(REL);
    const items = doc?.items;
    if (!items || typeof items !== 'object') return [];
    return Object.values(items)
      .map(sanitize)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  readOrNull(name: string): McpServiceConfig | null {
    const doc = this.store.readJson<Document>(REL);
    const raw = doc?.items?.[name] ?? null;
    return raw ? sanitize(raw) : null;
  }

  read(name: string): McpServiceConfig {
    const config = this.readOrNull(name);
    if (!config) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND, `MCP 服务 ${name} 尚未配置`);
    }
    return config;
  }

  exists(name: string): boolean {
    return this.readOrNull(name) !== null;
  }

  create(input: McpConfigInput, revision?: number): { config: McpServiceConfig; revision: number } {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!isValidMcpServiceName(name)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `MCP 服务名非法：${JSON.stringify(input.name)}（${MCP_SERVICE_NAME_HINT}）`,
      );
    }
    if (this.exists(name)) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_EXISTS, `MCP 服务名称已存在：${name}`);
    }
    const allowedTools = normalizeAllowedTools(input.allowed_tools, true);
    const nextRevision = this.write(
      name,
      input,
      allowedTools,
      { headers: {}, toolLabels: {} },
      revision,
    );
    return { config: this.read(name), revision: nextRevision };
  }

  /**
   * 新建前的**只校验不落盘**（给路由层用）：让"重名/字段非法"先于连接探测失败，
   * 避免为一个注定失败的新建去连一次 MCP 服务。
   */
  validateForCreate(input: McpConfigInput): void {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!isValidMcpServiceName(name)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `MCP 服务名非法：${JSON.stringify(input.name)}（${MCP_SERVICE_NAME_HINT}）`,
      );
    }
    if (this.exists(name)) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_EXISTS, `MCP 服务名称已存在：${name}`);
    }
    normalizeAllowedTools(input.allowed_tools, true);
    this.normalize(name, input, [], { headers: {}, toolLabels: {} });
  }

  remove(name: string, revision?: number): { name: string; revision: number } {
    if (!this.exists(name)) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND, `MCP 服务不存在：${name}`);
    }
    const removeItem = (): void => {
      const doc = this.store.readJson<Document>(REL) ?? { items: {} };
      delete doc.items[name];
      this.store.writeJson(REL, doc);
    };
    const nextRevision =
      revision === undefined
        ? (removeItem(), this.store.bumpRevision())
        : this.store.withRevision(revision, removeItem).revision;
    return { name, revision: nextRevision };
  }

  upsert(
    name: string,
    input: McpConfigInput,
    revision: number,
  ): { config: McpServiceConfig; revision: number } {
    const existing = this.readOrNull(name);
    if (!existing) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND, `MCP 服务不存在：${name}`);
    }
    // 白名单：缺省沿用存量（保存调用配置 MUST NOT 顺手清空它）；提供则全量替换，且非空
    const allowedTools =
      input.allowed_tools === undefined
        ? existing.allowed_tools
        : normalizeAllowedTools(input.allowed_tools, true);
    const nextRevision = this.write(
      name,
      input,
      allowedTools,
      { headers: existing.headers, toolLabels: existing.tool_labels },
      revision,
    );
    return { config: this.read(name), revision: nextRevision };
  }

  private write(
    name: string,
    input: McpConfigInput,
    allowedTools: string[],
    fallbacks: McpFallbacks,
    revision?: number,
  ): number {
    let validated!: McpServiceConfig;
    const commit = (): void => {
      validated = this.normalize(name, input, allowedTools, fallbacks);
      const doc = this.store.readJson<Document>(REL) ?? { items: {} };
      doc.items[name] = validated;
      this.store.writeJson(REL, doc);
    };
    if (revision === undefined) {
      commit();
      return this.store.bumpRevision();
    }
    return this.store.withRevision(revision, commit).revision;
  }

  private normalize(
    name: string,
    input: McpConfigInput,
    allowedTools: string[],
    fallbacks: McpFallbacks,
  ): McpServiceConfig {
    const description = typeof input.description === 'string' ? input.description : '';
    const transport = normalizeTransport(input.transport);
    if (transport === null) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `transport 须为 ${MCP_TRANSPORT_HINT}（当前：${JSON.stringify(input.transport)}）`,
      );
    }

    // 连接地址：http 必填；stdio 丢弃（与"http 丢弃 command/args"对称，避免隐性配置漂移）
    const url = normalizeUrl(input.url);
    if (transport === 'http' && url === null) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `transport=http 时 url 必填（${MCP_URL_HINT}）`);
    }

    const command =
      transport === 'stdio' && typeof input.command === 'string' && input.command.trim() !== ''
        ? input.command
        : null;
    const args = transport === 'stdio' && Array.isArray(input.args) ? input.args.map(String) : null;
    if (transport === 'stdio' && !command) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'transport=stdio 时 command 必填');
    }

    return {
      name,
      description,
      transport,
      url: transport === 'http' ? url : null,
      command,
      args,
      file_args: normalizeFileArgs(input.file_args),
      confirmation: normalizeConfirmation(input.confirmation),
      rules_fields: normalizeRulesFields(input.rules_fields),
      allowed_tools: allowedTools,
      tool_labels: normalizeToolLabels(input.tool_labels, fallbacks.toolLabels),
      // 避免留下一条永远不生效、却在界面上显示"已配置令牌"的隐性配置）
      headers: transport === 'http' ? normalizeHeaders(input.headers, fallbacks.headers) : {},
      updated_at: new Date().toISOString(),
    };
  }
}


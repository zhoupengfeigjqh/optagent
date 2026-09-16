/**
 * 容器编排声明读取（**只读**，`FR-043`）。
 *
 * `docker-compose.yml` 是"MCP 服务**应该**有什么"的**唯一来源**：
 * 平台 MUST NOT 要求二次登记，新增服务后 MUST 无需改代码即可识别。
 * 与之相对的"**实际**是什么"由 `docker-host.ts` 从 Docker Engine 读取——
 * 两者的差异正是 `FR-052` 要求检测的对象。
 *
 * 使用既有 `yaml` 依赖（`research.md` D2 已登记），不引入新解析器。
 */
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';

/** 编排中的一条服务声明（平台只关心呈现与差异比对所需字段） */
export interface ComposeServiceDeclaration {
  name: string;
  image: string | null;
  containerName: string | null;
  ports: string[];
  environment: Record<string, string>;
  /** 原始声明的浅拷贝，供 `FR-052` 呈现具体差异 */
  raw: Record<string, unknown>;
}

/**
 * **非 MCP 服务**清单：平台自身与界面的基础服务。
 *
 * 判定方式之所以是"排除法"而非"识别法"：编排文件对 MCP 服务没有统一标记，
 * 而平台自己的服务是**已知且封闭**的（网关 / 两个界面 / 对话后端 / 管理服务）。
 * 其余服务一律视为候选 MCP 服务，从而满足 `FR-043`「新增服务无需平台侧配置」。
 */
export const PLATFORM_SERVICE_NAMES: readonly string[] = [
  'gateway',
  'frontend',
  'backend',
  'admin-frontend',
  'admin-backend',
];

export class ComposeReader {
  constructor(private readonly filePath: string) {}

  getPath(): string {
    return this.filePath;
  }

  /** 文件是否可读（health 端点用，不抛错） */
  isReadable(): boolean {
    try {
      fs.accessSync(this.filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 全部服务声明。
   * 文件缺失/不可读/解析失败 → `ADM_COMPOSE_FILE_UNREADABLE`（`FR-009` 可读原因），
   * **不**静默返回空数组——静默会把"读不到"伪装成"一个 MCP 服务都没有"。
   */
  list(): ComposeServiceDeclaration[] {
    let text: string;
    try {
      text = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      throw new ApiError(
        ERROR_CODES.ADM_COMPOSE_FILE_UNREADABLE,
        `无法读取容器编排声明 ${this.filePath}：${(err as Error).message}`,
      );
    }

    let doc: unknown;
    try {
      doc = parseYaml(text);
    } catch (err) {
      throw new ApiError(
        ERROR_CODES.ADM_COMPOSE_FILE_UNREADABLE,
        `容器编排声明解析失败（${this.filePath}）：${(err as Error).message}`,
      );
    }

    const services = (doc as { services?: unknown } | null)?.services;
    if (typeof services !== 'object' || services === null || Array.isArray(services)) {
      throw new ApiError(
        ERROR_CODES.ADM_COMPOSE_FILE_UNREADABLE,
        `容器编排声明缺少 services 段：${this.filePath}`,
      );
    }

    const out: ComposeServiceDeclaration[] = [];
    for (const [name, value] of Object.entries(services as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const svc = value as Record<string, unknown>;
      out.push({
        name,
        image: typeof svc.image === 'string' ? svc.image : null,
        containerName: typeof svc.container_name === 'string' ? svc.container_name : null,
        ports: Array.isArray(svc.ports) ? svc.ports.map(String) : [],
        environment: normalizeEnvironment(svc.environment),
        raw: svc,
      });
    }
    return out;
  }

  /** MCP 服务声明（清单来源为编排文件，`FR-043`） */
  listMcpServices(): ComposeServiceDeclaration[] {
    const excluded = new Set(PLATFORM_SERVICE_NAMES);
    return this.list().filter((s) => !excluded.has(s.name));
  }

  /** 按服务名查找（不存在返回 `null`） */
  find(name: string): ComposeServiceDeclaration | null {
    return this.list().find((s) => s.name === name) ?? null;
  }

  /**
   * 传输方式推断：**编排里声明的服务一律按 `http` 处理**。
   *
   * 依据：编排文件里的服务运行在容器网络中，对它的调用必然是**跨进程的网络调用**
   * （平台既没有它的可执行文件，也无权在容器内驱动一个本地进程）；`stdio`
   * 只在"能在本地直接起一个命令"时才成立，因此只能由**调用配置显式声明**
   * （`FR-044` 把 `transport` 定为调用配置的必填字段）。
   *
   * 之所以不能用"是否声明 `ports`"来判断：本产品的真实形态里，MCP 服务
   * （如 OCR）**只在内网提供 streamable-http，不对外暴露端口**——
   * 用"无端口即 stdio"会把它标成 `stdio`，等于向管理员展示一个**错误**的传输方式。
   */
  static inferTransport(_decl: ComposeServiceDeclaration): 'http' | 'stdio' {
    return 'http';
  }

  /**
   * 容器名解析：`container_name` 优先，其次按 compose 默认命名规则
   * `{项目目录名}-{服务名}-1` 的近似——这里退化为服务名本身，
   * 因为 Docker 查询会先按容器名精确匹配，失败后再按 compose 标签匹配。
   */
  static containerNameOf(decl: ComposeServiceDeclaration): string {
    return decl.containerName ?? decl.name;
  }
}

/** 编排中的 environment 可能是 map 或 `KEY=VALUE` 列表，统一成 map */
function normalizeEnvironment(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const text = String(item);
      const idx = text.indexOf('=');
      if (idx < 0) out[text] = '';
      else out[text.slice(0, idx)] = text.slice(idx + 1);
    }
    return out;
  }
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      out[key] = value === null || value === undefined ? '' : String(value);
    }
  }
  return out;
}

/**
 * 宿主机 Docker 访问（`research.md` D3，**零新增依赖**）。
 *
 * 用 Node 内置 `node:http` + `{ socketPath }` 直连 Docker Engine API。
 *
 * **风险与收口**：挂载 `/var/run/docker.sock` 等价于授予宿主机 root 权限，
 * 因此本模块把可访问的操作**限定为白名单三类**：
 *   ① 容器列表与状态查询（`FR-043`）
 *   ② 容器日志读取（`FR-048`）
 *   ③ 对**编排白名单内**服务的 `start` / `stop`（`FR-046`）
 * 其余 API（构建、删除、exec、卷操作）**不提供任何调用入口**，
 * 也**不暴露**"任意 API 透传"端点——管理界面只能触发上述三类。
 */
import http from 'node:http';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';

/** 契约 §3.1 的四态 */
export type ContainerStatus = 'running' | 'stopped' | 'abnormal' | 'unknown';

export interface DockerLogLine {
  ts: string | null;
  line: string;
}

export interface DockerHostOptions {
  socketPath: string;
  timeoutMs?: number;
  /**
   * 服务名白名单判定（由编排声明提供）。
   * 未通过即拒绝启停 → `ADM_MCP_SERVICE_UNMANAGED`（`FR-043`）。
   */
  isManageable?: (serviceName: string) => boolean;
}

interface DockerContainer {
  Id: string;
  Names: string[];
  State: string;
  Labels: Record<string, string>;
  /** unix 秒；用于"多个容器共享同一服务标签"时取最新的（见 `pickContainer`） */
  Created?: number;
}

export class DockerHost {
  private readonly socketPath: string;
  private readonly timeoutMs: number;
  private readonly isManageable: (serviceName: string) => boolean;

  constructor(options: DockerHostOptions) {
    this.socketPath = options.socketPath;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.isManageable = options.isManageable ?? (() => false);
  }

  /** socket 可达性（health 端点据此上报 `docker.available`） */
  async available(): Promise<boolean> {
    try {
      const res = await this.raw('GET', '/_ping');
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /** 按服务名解析容器状态；查不到 → `unknown`（**不**报错，`FR-043`） */
  async statusOf(serviceName: string, containerName?: string): Promise<ContainerStatus> {
    const containers = await this.listContainers();
    const found = findByService(containers, serviceName, containerName);
    return found ? mapState(found.State) : 'unknown';
  }

  /** 批量取状态（列表端点用一次查询，避免 N+1） */
  async statusMap(): Promise<Map<string, ContainerStatus>> {
    const containers = await this.listContainers();
    // 同一服务标签可能有多个容器（含残留的死容器），逐组挑选最可信的那个
    const byService = new Map<string, DockerContainer[]>();
    for (const c of containers) {
      const service = c.Labels?.['com.docker.compose.service'];
      if (!service) continue;
      const group = byService.get(service) ?? [];
      group.push(c);
      byService.set(service, group);
    }
    const map = new Map<string, ContainerStatus>();
    for (const [service, group] of byService) {
      map.set(service, mapState(pickContainer(group).State));
    }
    return map;
  }

  /**
   * 读取日志片段（**有界返回**，`FR-048`）：按时间倒序，最多 `limit` 行。
   * Docker 的日志流是**多路复用帧**（8 字节头 + 负载），需先解复用再按行切分。
   */
  async logs(serviceName: string, limit: number, containerName?: string): Promise<DockerLogLine[]> {
    const container = await this.resolveContainer(serviceName, containerName);
    const tail = Math.max(1, Math.min(limit, 500));
    const res = await this.raw(
      'GET',
      `/containers/${container.Id}/logs`,
      { stdout: '1', stderr: '1', timestamps: '1', tail: String(tail) },
    );
    if (res.status !== 200) {
      throw new ApiError(
        ERROR_CODES.ADM_DOCKER_UNAVAILABLE,
        `读取容器日志失败（HTTP ${res.status}）：${res.body.slice(0, 200)}`,
      );
    }
    return toBoundedLogLines(Buffer.from(res.body, 'binary'), tail);
  }

  /** 启动服务容器（仅白名单内，`FR-046`） */
  async start(serviceName: string, containerName?: string): Promise<ContainerStatus> {
    return this.mutate('start', serviceName, containerName);
  }

  /** 关闭服务容器（仅白名单内，`FR-046`） */
  async stop(serviceName: string, containerName?: string): Promise<ContainerStatus> {
    return this.mutate('stop', serviceName, containerName);
  }

  private async mutate(
    action: 'start' | 'stop',
    serviceName: string,
    containerName?: string,
  ): Promise<ContainerStatus> {
    // 白名单收口：非编排声明的服务不允许启停（FR-043）
    if (!this.isManageable(serviceName)) {
      throw new ApiError(
        ERROR_CODES.ADM_MCP_SERVICE_UNMANAGED,
        `服务 ${serviceName} 不在容器编排声明内，不允许启停`,
      );
    }
    const container = await this.resolveContainer(serviceName, containerName);
    const res = await this.raw('POST', `/containers/${container.Id}/${action}`);
    // 304：容器已处于目标状态，按成功处理（幂等）
    if (res.status !== 204 && res.status !== 304) {
      throw new ApiError(
        ERROR_CODES.INTERNAL_ERROR,
        `${action === 'start' ? '启动' : '关闭'}服务 ${serviceName} 失败（HTTP ${res.status}）：${res.body.slice(0, 200)}`,
      );
    }
    return this.statusOf(serviceName, containerName);
  }

  private async resolveContainer(serviceName: string, containerName?: string): Promise<DockerContainer> {
    const containers = await this.listContainers();
    const found = findByService(containers, serviceName, containerName);
    if (!found) {
      throw new ApiError(
        ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND,
        `容器未找到：服务 ${serviceName}（容器名 ${containerName ?? serviceName}）`,
      );
    }
    return found;
  }

  private async listContainers(): Promise<DockerContainer[]> {
    const res = await this.raw('GET', '/containers/json', { all: '1' });
    if (res.status !== 200) {
      throw new ApiError(
        ERROR_CODES.ADM_DOCKER_UNAVAILABLE,
        `Docker 容器列表不可得（HTTP ${res.status}）`,
      );
    }
    try {
      const parsed = JSON.parse(res.body) as DockerContainer[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new ApiError(ERROR_CODES.ADM_DOCKER_UNAVAILABLE, 'Docker 容器列表响应不是合法 JSON');
    }
  }

  /**
   * 单次 Engine API 调用（socket 不可达 → `ADM_DOCKER_UNAVAILABLE`）。
   *
   * 路径**不带 API 版本前缀**：不写版本时 Docker 按守护进程支持的最高版本协商，
   * 而写死版本会在较新的守护进程上直接失败——
   * 实测 Docker Engine 29 会回 `client version 1.43 is too old. Minimum supported
   * API version is 1.44`（表现为 `health` 里 `docker.available=false`，
   * 而 socket 明明是通的，属最难排查的一类"看起来像权限问题"的故障）。
   */
  private raw(
    method: 'GET' | 'POST',
    apiPath: string,
    query?: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    const search = query ? `?${new URLSearchParams(query).toString()}` : '';
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
          path: `${apiPath}${search}`,
          method,
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('binary') }),
          );
        },
      );
      req.on('timeout', () => {
        req.destroy();
        reject(
          new ApiError(
            ERROR_CODES.ADM_DOCKER_UNAVAILABLE,
            `访问宿主机 Docker 超时（${this.timeoutMs}ms，socket ${this.socketPath}）`,
          ),
        );
      });
      req.on('error', (err: NodeJS.ErrnoException) => {
        reject(
          new ApiError(
            ERROR_CODES.ADM_DOCKER_UNAVAILABLE,
            `无法访问宿主机 Docker（socket ${this.socketPath}，${err.code ?? err.message}）`,
          ),
        );
      });
      req.end();
    });
  }
}

/** 按 compose 服务标签优先、容器名次之查找容器 */
function findByService(
  containers: DockerContainer[],
  serviceName: string,
  containerName?: string,
): DockerContainer | null {
  const wanted = new Set([`/${containerName ?? serviceName}`, `/${serviceName}`]);
  const byName = containers.filter((c) => (c.Names ?? []).some((n) => wanted.has(n)));
  if (byName.length > 0) return pickContainer(byName);
  const byLabel = containers.filter(
    (c) => c.Labels?.['com.docker.compose.service'] === serviceName,
  );
  return byLabel.length > 0 ? pickContainer(byLabel) : null;
}

/**
 * 多个容器匹配同一服务时的取舍（**实测缺陷**，见 `quickstart.md` §10.3）：
 * 宿主机上可能残留同服务标签的历史容器（如手工起过的 `optagent-ocr-dev`，
 * 状态 `exited`）。若"任取一个命中即返回"，状态会显示成已停止、启停操作会
 * 打到死容器上。取舍规则：**精确容器名 > 运行中 > 创建时间最新**。
 */
function pickContainer(candidates: DockerContainer[]): DockerContainer {
  // 调用方保证 candidates 非空；reduce 在空数组上会抛错，恰好也算一种防御
  return candidates.reduce((best, c) => (scoreOf(c) > scoreOf(best) ? c : best));
}

function scoreOf(c: DockerContainer): number {
  return (c.State === 'running' ? 1e12 : 0) + (c.Created ?? 0);
}

/** Docker State → 契约四态 */
function mapState(state: string): ContainerStatus {
  switch (state) {
    case 'running':
      return 'running';
    case 'exited':
    case 'created':
    case 'paused':
      return 'stopped';
    case 'restarting':
    case 'dead':
    case 'removing':
      return 'abnormal';
    default:
      return 'unknown';
  }
}

/**
 * 解复用 Docker 日志流。
 *
 * 非 TTY 容器的日志是 `[1B 流类型][3B 保留][4B BE 长度][负载]` 的帧序列；
 * TTY 容器则是裸文本。这里按帧头**校验后再解析**，校验不通过即按裸文本处理，
 * 避免把普通文本误当帧头切碎。
 */
export function demuxDockerLogStream(buf: Buffer): string {
  const parts: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const streamType = buf[offset]!;
    const isFrameHeader =
      (streamType === 0 || streamType === 1 || streamType === 2) &&
      buf[offset + 1] === 0 &&
      buf[offset + 2] === 0 &&
      buf[offset + 3] === 0;
    if (!isFrameHeader) break;
    const size = buf.readUInt32BE(offset + 4);
    if (size < 0 || offset + 8 + size > buf.length) break;
    parts.push(buf.subarray(offset + 8, offset + 8 + size).toString('utf8'));
    offset += 8 + size;
  }
  // 一帧都没解出来，或尾部还有残余：按裸文本处理
  if (parts.length === 0) return buf.toString('utf8');
  if (offset < buf.length) parts.push(buf.subarray(offset).toString('utf8'));
  return parts.join('');
}

/** 切出 Docker 的时间戳前缀（RFC3339Nano）与正文 */
export function parseTimestampedLine(line: string): DockerLogLine {
  const idx = line.indexOf(' ');
  if (idx > 0) {
    const ts = line.slice(0, idx);
    if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) return { ts, line: line.slice(idx + 1) };
  }
  return { ts: null, line };
}

/**
 * 解复用 + **有界截断** + 时间倒序（`FR-048`）。
 *
 * 抽成纯函数便于单测：日志"量大时页面仍快速返回"这条要求，
 * 靠的就是"只保留最后 N 行"这道服务端侧上限（`tail` 之外的第二道保险）。
 */
export function toBoundedLogLines(payload: Buffer, limit: number): DockerLogLine[] {
  const bounded = Math.max(1, Math.min(limit, 500));
  const text = demuxDockerLogStream(payload);
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const sliced = lines.slice(Math.max(0, lines.length - bounded));
  return sliced.map(parseTimestampedLine).reverse();
}

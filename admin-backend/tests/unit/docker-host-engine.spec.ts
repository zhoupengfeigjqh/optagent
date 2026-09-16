/**
 * 单元测试：Docker Engine API 访问路径（T102 的第二半）
 *
 * 用一个**本进程内的 HTTP 服务**监听 socket（Windows 命名管道 / POSIX unix socket）
 * 来扮演 Docker Engine，从而在**不依赖 Docker daemon** 的前提下覆盖
 * 列表、状态合成、日志读取、启停这几条真实 HTTP 路径。
 *
 * 这是"能不引依赖就测到真实路径"的做法：`DockerHost` 的 socket 传输逻辑
 * 与真实运行时完全一致，避免只测桩而漏掉协议层缺陷。
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { DockerHost } from '../../src/infra/docker-host.js';

/** Windows 用命名管道，其余平台用 unix socket（Node 两者都原生支持） */
function socketPath(): string {
  const tag = `optagent-test-${process.pid}-${Date.now()}`;
  if (process.platform === 'win32') return `\\\\.\\pipe\\${tag}`;
  return path.join(os.tmpdir(), `${tag}.sock`);
}

const sock = socketPath();

interface Recorded {
  url: string;
  method: string;
}

const recorded: Recorded[] = [];
let failNextLogs = false;
/** 模拟容器的真实状态：start/stop 会改变它，供"回读真实结果"的断言使用 */
let ocrState = 'running';
/** 容器列表端点的异常模式（覆盖非 200 与"合法 JSON 但不是数组"两条分支） */
let listFailure: 'none' | 'http-500' | 'not-an-array' = 'none';
/** 启停端点的异常模式（`304` 已在目标状态、非 204/304 的失败） */
let mutateFailure: 'none' | 'not-modified' | 'http-500' = 'none';

/** 极简 Docker Engine 模拟：只需覆盖被测代码实际调用的四个端点 */
const server = http.createServer((req, res) => {
  const url = req.url ?? '';
  recorded.push({ url, method: req.method ?? '' });

  // 被测代码使用**不带版本前缀**的路径（由守护进程协商版本），
  // 这里同时接受带版本的形式，以便将来换成显式版本时测试仍然有效。
  if (url.includes('/_ping')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK');
    return;
  }

  if (url.includes('/containers/json')) {
    if (listFailure === 'http-500') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"message":"list backend exploded"}');
      return;
    }
    if (listFailure === 'not-an-array') {
      // 合法 JSON 但不是容器数组（守护进程异常响应）：MUST 按空列表处理，MUST NOT 崩
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"message":"not an array"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify([
        {
          Id: 'abc123',
          Names: ['/optagent-ocr'],
          State: ocrState,
          Labels: { 'com.docker.compose.service': 'ocr' },
          Created: 1700000100,
        },
        {
          // 同服务标签的**历史残留容器**（如 dev 期手工起过的实例，已退出）：
          // 若实现"任取一个命中即返回"，状态会显示成已停止、操作会打到死容器
          Id: 'dead999',
          Names: ['/optagent-ocr-dev'],
          State: 'exited',
          Labels: { 'com.docker.compose.service': 'ocr' },
          Created: 1700000000,
        },
        {
          Id: 'def456',
          Names: ['/optagent-legacy'],
          State: 'restarting',
          Labels: { 'com.docker.compose.service': 'legacy' },
        },
        {
          // 手工 `docker run` 起的容器：**没有** compose 服务标签，也没有 Names / Created。
          // 三个字段缺失都必须被容忍（跳过 / 按空数组 / 按 0 计），否则整个列表端点会崩
          Id: 'manual01',
          State: 'exited',
        },
        {
          // 无 compose 标签，但容器名可匹配 → 覆盖"按容器名查找"这条优先路径
          Id: 'byname',
          Names: ['/byname-svc'],
          State: 'running',
          Created: 10,
        },
        {
          // 同组内**死容器排在前面**（Created 更大）、运行中的排在后面：
          // 取舍规则必须仍然选中运行中的那个
          Id: 'ordered-dead',
          Names: ['/optagent-ordered-a'],
          State: 'exited',
          Labels: { 'com.docker.compose.service': 'ordered' },
          Created: 1700009999,
        },
        {
          Id: 'ordered-live',
          Names: ['/optagent-ordered-b'],
          State: 'running',
          Labels: { 'com.docker.compose.service': 'ordered' },
          Created: 1700000001,
        },
        {
          // 运行中但**缺 Created**：参与比较时按 0 计，仍应凭"运行中"胜出
          Id: 'nocreated-live',
          Names: ['/optagent-nocreated-a'],
          State: 'running',
          Labels: { 'com.docker.compose.service': 'nocreated' },
        },
        {
          Id: 'nocreated-dead',
          Names: ['/optagent-nocreated-b'],
          State: 'exited',
          Labels: { 'com.docker.compose.service': 'nocreated' },
          Created: 999,
        },
        {
          // 守护进程给出未知状态：归为 unknown，MUST NOT 崩溃或漏项
          Id: 'hibernating01',
          Names: ['/optagent-hibernating'],
          State: 'hibernating',
          Labels: { 'com.docker.compose.service': 'hibernating' },
          Created: 5,
        },
      ]),
    );
    return;
  }

  if (url.includes('/containers/abc123/logs')) {
    if (failNextLogs) {
      res.writeHead(500);
      res.end('log backend exploded');
      return;
    }
    // Docker 多路复用帧：stdout(1) + stderr(2)
    const frame = (type: number, text: string): Buffer => {
      const payload = Buffer.from(text, 'utf8');
      const header = Buffer.alloc(8);
      header.writeUInt8(type, 0);
      header.writeUInt32BE(payload.length, 4);
      return Buffer.concat([header, payload]);
    };
    res.writeHead(200, { 'content-type': 'application/vnd.docker.raw-stream' });
    res.end(
      Buffer.concat([
        frame(1, '2026-09-15T06:00:01.000Z 第一行\n'),
        frame(2, '2026-09-15T06:00:02.000Z 第二行\n'),
        frame(1, '2026-09-15T06:00:03.000Z 第三行\n'),
      ]),
    );
    return;
  }

  if (url.includes('/containers/abc123/start')) {
    if (mutateFailure === 'http-500') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"message":"cannot start"}');
      return;
    }
    if (mutateFailure === 'not-modified') {
      // 304：容器已处于目标状态 → 按成功处理（幂等）
      res.writeHead(304);
      res.end();
      return;
    }
    ocrState = 'running';
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.includes('/containers/abc123/stop')) {
    if (mutateFailure === 'http-500') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"message":"cannot stop"}');
      return;
    }
    if (mutateFailure === 'not-modified') {
      res.writeHead(304);
      res.end();
      return;
    }
    ocrState = 'exited';
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{"message":"no such container"}');
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(sock, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('DockerHost —— 真实 Engine API 路径', () => {
  it('available()：`/_ping` 可达即为 true', async () => {
    expect(await new DockerHost({ socketPath: sock, timeoutMs: 2000 }).available()).toBe(true);
  });

  it('statusMap()：按 compose 服务标签合成状态（running / abnormal）', async () => {
    const map = await new DockerHost({ socketPath: sock }).statusMap();
    expect(map.get('ocr')).toBe('running');
    // restarting → abnormal（反复重启属异常态）
    expect(map.get('legacy')).toBe('abnormal');
  });

  it('statusOf()：未知服务返回 unknown 而非报错（FR-043）', async () => {
    const host = new DockerHost({ socketPath: sock });
    expect(await host.statusOf('not-deployed')).toBe('unknown');
  });

  it('logs()：解复用、按时间倒序、带上限', async () => {
    const host = new DockerHost({ socketPath: sock });
    const lines = await host.logs('ocr', 2);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.line)).toEqual(['第三行', '第二行']);
    expect(lines[0]?.ts).toBe('2026-09-15T06:00:03.000Z');
  });

  it('logs()：Engine 返回非 200 → ADM_DOCKER_UNAVAILABLE 并带响应片段', async () => {
    failNextLogs = true;
    let caught: unknown;
    try {
      await new DockerHost({ socketPath: sock }).logs('ocr', 10);
    } catch (err) {
      caught = err;
    } finally {
      failNextLogs = false;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_DOCKER_UNAVAILABLE);
    expect((caught as ApiError).message).toContain('500');
  });

  it('start/stop：白名单通过后发起 POST 并**回读真实状态**（FR-046，不把"已发出命令"当结果）', async () => {
    const host = new DockerHost({ socketPath: sock, isManageable: () => true });
    expect(await host.stop('ocr')).toBe('stopped');
    expect(await host.start('ocr')).toBe('running');
    expect(
      recorded.some((r) => r.url.includes('/containers/abc123/stop') && r.method === 'POST'),
    ).toBe(true);
    expect(
      recorded.some((r) => r.url.includes('/containers/abc123/start') && r.method === 'POST'),
    ).toBe(true);
  });

  it('操作白名单先于任何网络调用：非白名单服务不发出请求（FR-043）', async () => {
    const before = recorded.length;
    const host = new DockerHost({ socketPath: sock, isManageable: () => false });
    await expect(host.start('ocr')).rejects.toThrow(ApiError);
    expect(recorded.length).toBe(before);
  });

  it('同服务标签存在残留死容器：状态与启停都必须落在运行中的容器上（实测缺陷回归）', async () => {
    const host = new DockerHost({ socketPath: sock, isManageable: () => true });
    const map = await host.statusMap();
    expect(map.get('ocr')).toBe('running');
    expect(await host.statusOf('ocr')).toBe('running');
    expect(await host.stop('ocr')).toBe('stopped');
    expect(await host.start('ocr')).toBe('running');
    // 绝不能碰残留的死容器
    expect(recorded.some((r) => r.url.includes('/containers/dead999/'))).toBe(false);
    expect(recorded.some((r) => r.url.includes('/containers/abc123/stop'))).toBe(true);
    expect(recorded.some((r) => r.url.includes('/containers/abc123/start'))).toBe(true);
  });

  it('要启停的容器不存在 → ADM_MCP_SERVICE_NOT_FOUND', async () => {
    const host = new DockerHost({ socketPath: sock, isManageable: () => true });
    let caught: unknown;
    try {
      await host.start('ghost-service');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND);
  });

  it('容器列表响应不是合法 JSON → ADM_DOCKER_UNAVAILABLE', async () => {
    const bad = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not json at all');
    });
    const badSock = socketPath();
    await new Promise<void>((resolve) => bad.listen(badSock, resolve));
    try {
      let caught: unknown;
      try {
        await new DockerHost({ socketPath: badSock }).statusMap();
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_DOCKER_UNAVAILABLE);
    } finally {
      await new Promise<void>((resolve) => bad.close(() => resolve()));
    }
  });
});

describe('DockerHost —— 容器列表的边界与取舍', () => {
  it('无 compose 标签的容器（手工 docker run）被跳过，不产生空 key 条目', async () => {
    const map = await new DockerHost({ socketPath: sock }).statusMap();
    expect([...map.keys()].sort()).toEqual([
      'hibernating',
      'legacy',
      'nocreated',
      'ocr',
      'ordered',
    ]);
  });

  it('守护进程给出未知状态 → unknown（既不崩也不漏项）', async () => {
    const map = await new DockerHost({ socketPath: sock }).statusMap();
    expect(map.get('hibernating')).toBe('unknown');
  });

  it('同组内死容器排在运行容器之前 → 仍选中运行中的那个', async () => {
    const map = await new DockerHost({ socketPath: sock }).statusMap();
    expect(map.get('ordered')).toBe('running');
  });

  it('容器缺 Created 字段 → 按 0 参与取舍，运行中的仍然胜出', async () => {
    const map = await new DockerHost({ socketPath: sock }).statusMap();
    expect(map.get('nocreated')).toBe('running');
  });

  it('无 compose 标签、但容器名可匹配 → 按名字定位（statusOf）', async () => {
    const host = new DockerHost({ socketPath: sock });
    expect(await host.statusOf('byname-svc')).toBe('running');
  });

  it('容器列表返回非 200 → ADM_DOCKER_UNAVAILABLE 并带状态码', async () => {
    listFailure = 'http-500';
    try {
      let caught: unknown;
      try {
        await new DockerHost({ socketPath: sock }).statusMap();
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_DOCKER_UNAVAILABLE);
      expect((caught as ApiError).message).toContain('500');
    } finally {
      listFailure = 'none';
    }
  });

  it('容器列表是合法 JSON 但不是数组 → 按空列表处理（不崩）', async () => {
    listFailure = 'not-an-array';
    try {
      const host = new DockerHost({ socketPath: sock });
      expect((await host.statusMap()).size).toBe(0);
      expect(await host.statusOf('ocr')).toBe('unknown');
    } finally {
      listFailure = 'none';
    }
  });

  it('启停返回非 204/304 → INTERNAL_ERROR（不把"已发出命令"当成功；启动与关闭都要报）', async () => {
    mutateFailure = 'http-500';
    try {
      const host = new DockerHost({ socketPath: sock, isManageable: () => true });
      const cases: Array<[() => Promise<unknown>, string]> = [
        [() => host.start('ocr'), '启动服务 ocr 失败'],
        [() => host.stop('ocr'), '关闭服务 ocr 失败'],
      ];
      for (const [call, expected] of cases) {
        let caught: unknown;
        try {
          await call();
        } catch (err) {
          caught = err;
        }
        expect((caught as ApiError).code).toBe(ERROR_CODES.INTERNAL_ERROR);
        expect((caught as ApiError).message).toContain(expected);
      }
    } finally {
      mutateFailure = 'none';
    }
  });

  it('启停返回 304（容器已在目标状态）→ 按成功处理（幂等）', async () => {
    mutateFailure = 'not-modified';
    ocrState = 'running';
    try {
      const host = new DockerHost({ socketPath: sock, isManageable: () => true });
      expect(await host.start('ocr')).toBe('running');
    } finally {
      mutateFailure = 'none';
    }
  });

  it('Docker 不响应（超时）→ ADM_DOCKER_UNAVAILABLE，并给出超时值与 socket', async () => {
    // 收到请求但永不响应：socket 空闲到超时
    const silent = http.createServer(() => {});
    const silentSock = socketPath();
    await new Promise<void>((resolve) => silent.listen(silentSock, resolve));
    try {
      let caught: unknown;
      try {
        await new DockerHost({ socketPath: silentSock, timeoutMs: 80 }).statusMap();
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_DOCKER_UNAVAILABLE);
      expect((caught as ApiError).message).toContain('超时');
      expect((caught as ApiError).message).toContain('80ms');
    } finally {
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});

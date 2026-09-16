/**
 * 单元测试：宿主机 Docker 访问（T102）
 *
 * 覆盖 socket 不可达（`ADM_DOCKER_UNAVAILABLE`）、**启停白名单**（`FR-043`）
 * 与**日志有界截断**（`FR-048`）。日志解复用是纯函数，直接单测而非起真容器。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  DockerHost,
  demuxDockerLogStream,
  parseTimestampedLine,
  toBoundedLogLines,
} from '../../src/infra/docker-host.js';

/** 构造 Docker 多路复用日志帧：`[1B 流类型][3B 保留][4B BE 长度][负载]` */
function frame(streamType: number, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

const unreachable = () => new DockerHost({ socketPath: '/definitely/not/a/docker.sock', timeoutMs: 200 });

describe('DockerHost —— socket 不可达', () => {
  it('available() 返回 false（health 端点据此上报 docker.available）', async () => {
    expect(await unreachable().available()).toBe(false);
  });

  it('查询容器列表 → ADM_DOCKER_UNAVAILABLE 且给出 socket 路径', async () => {
    let caught: unknown;
    try {
      await unreachable().statusMap();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_DOCKER_UNAVAILABLE);
    expect((caught as ApiError).message).toContain('/definitely/not/a/docker.sock');
  });

  it('读日志同样以 ADM_DOCKER_UNAVAILABLE 报错（不静默返回空数组）', async () => {
    let caught: unknown;
    try {
      await unreachable().logs('ocr', 10);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_DOCKER_UNAVAILABLE);
  });
});

describe('DockerHost —— 启停白名单（FR-043）', () => {
  it('非白名单服务拒绝启停 → ADM_MCP_SERVICE_UNMANAGED', async () => {
    const host = new DockerHost({ socketPath: '/x', isManageable: () => false });
    for (const action of ['start', 'stop'] as const) {
      let caught: unknown;
      try {
        await (action === 'start' ? host.start('ocr') : host.stop('ocr'));
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_MCP_SERVICE_UNMANAGED);
    }
  });

  it('默认白名单为空：未显式声明可管理时一律拒绝', async () => {
    const host = new DockerHost({ socketPath: '/x' });
    let caught: unknown;
    try {
      await host.start('ocr');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_MCP_SERVICE_UNMANAGED);
  });

  it('白名单内的服务才会真正发起调用（socket 不通 → ADM_DOCKER_UNAVAILABLE）', async () => {
    const host = new DockerHost({ socketPath: '/definitely/not/a/docker.sock', isManageable: () => true });
    let caught: unknown;
    try {
      await host.start('ocr');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_DOCKER_UNAVAILABLE);
  });
});

describe('日志解复用与有界截断（FR-048）', () => {
  it('demuxDockerLogStream 正确还原多帧负载', () => {
    const buffer = Buffer.concat([frame(1, 'stdout-1\n'), frame(2, 'stderr-2\n')]);
    expect(demuxDockerLogStream(buffer)).toBe('stdout-1\nstderr-2\n');
  });

  it('非帧结构（TTY 容器的裸文本）按原样返回，不被误切碎', () => {
    const raw = Buffer.from('2026-09-15T06:00:00.000000000Z hello\n', 'utf8');
    expect(demuxDockerLogStream(raw)).toBe(raw.toString('utf8'));
  });

  it('帧长度越界时退化为裸文本（不抛错、不越界读）', () => {
    const header = Buffer.alloc(8);
    header.writeUInt8(1, 0);
    header.writeUInt32BE(9999, 4);
    expect(() => demuxDockerLogStream(Buffer.concat([header, Buffer.from('xx')]))).not.toThrow();
  });

  it('只保留最后 limit 行，并按时间倒序返回', () => {
    const lines = Array.from(
      { length: 10 },
      (_, i) => `2026-09-15T06:00:${String(i).padStart(2, '0')}.000000000Z line-${i}`,
    ).join('\n');
    const result = toBoundedLogLines(Buffer.from(`${lines}\n`, 'utf8'), 3);

    expect(result).toHaveLength(3);
    expect(result.map((l) => l.line)).toEqual(['line-9', 'line-8', 'line-7']);
    expect(result[0]?.ts).toBe('2026-09-15T06:00:09.000000000Z');
  });

  it('limit 被硬上限截断（上限 500），防止超大响应拖慢页面', () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line-${i}`).join('\n');
    expect(toBoundedLogLines(Buffer.from(lines, 'utf8'), 9999)).toHaveLength(500);
  });

  it('limit 小于 1 时至少返回 1 行（不返回空）', () => {
    expect(toBoundedLogLines(Buffer.from('a\nb\n', 'utf8'), 0)).toHaveLength(1);
  });

  it('无时间戳前缀的行 ts 为 null 且正文完整保留', () => {
    expect(parseTimestampedLine('纯文本日志')).toEqual({ ts: null, line: '纯文本日志' });
    expect(parseTimestampedLine('2026-09-15T06:00:00Z x')).toEqual({
      ts: '2026-09-15T06:00:00Z',
      line: 'x',
    });
  });

  it('有空格但前缀不是时间戳 → 不误判为时间戳（整行保留）', () => {
    expect(parseTimestampedLine('ERROR something failed')).toEqual({
      ts: null,
      line: 'ERROR something failed',
    });
  });

  it('有效帧之后还有残余字节 → 残余按文本追加（不丢尾部日志）', () => {
    const buffer = Buffer.concat([frame(1, '完整帧\n'), Buffer.from('残余文本', 'utf8')]);
    expect(demuxDockerLogStream(buffer)).toBe('完整帧\n残余文本');
  });

  it('空负载返回空数组', () => {
    expect(toBoundedLogLines(Buffer.alloc(0), 10)).toEqual([]);
  });
});

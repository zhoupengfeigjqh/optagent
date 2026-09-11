/**
 * files 路由集成测试（T035）+ 权限违规对话体验（T041）：
 * - 上传：时间戳命名、格式拒绝（400）、超限（413）、dir=tmp（403）、路径穿越（400）
 * - 列表：业务目录与 tmp
 * - 下载：正常下载、路径穿越 400、不存在 404
 * - T041：工具越权（写业务目录）→ 返回自然语言降级文本而不抛出（对话不中断），
 *   日志出现 file.write.denied
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { FileAccess } from '../../src/domain/file-access';
import { buildBuiltinTools } from '../../src/infra/builtin-tools';
import { buildServer } from '../../src/server';
import { FakeLlmProvider, simpleScript } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

/** 手工拼 multipart/form-data（dir 字段在文件前） */
function multipart(filename: string, content: string | Buffer, dir: string | null) {
  const boundary = '----vitestboundary';
  const chunks: Buffer[] = [];
  if (dir !== null) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${dir}\r\n`,
        'utf8',
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      'utf8',
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  );
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('files 路由（US3）', () => {
  let root: string;
  let app: AppInstance;
  const dataDir = () => path.join(root, '.opt-agent', 'users', 'admin', 'user-data');

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-files-'));
    writeFileSync(path.join(root, 'config.yaml'), 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: {
        DEEPSEEK_API_KEY: 'sk-x',
        OPT_AGENT_ROOT: path.join(root, '.opt-agent'),
        UPLOAD_MAX_MB: '1', // 1MB 便于构造 413
      },
      configPath: path.join(root, 'config.yaml'),
    });
    app = await buildServer({ config, llmProvider: new FakeLlmProvider(simpleScript('ok')) });
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('上传：201，落盘名追加 _YYYYMMDD_HHMMSS 时间戳', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      ...multipart('计划.csv', '产品,数量\nA,10', '生产计划'),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { dir: string; filename: string; size: number };
    expect(body.dir).toBe('生产计划');
    expect(body.filename).toMatch(/^计划_\d{8}_\d{6}\.csv$/);
    expect(body.size).toBe(Buffer.byteLength('产品,数量\nA,10', 'utf8'));
    expect(readFileSync(path.join(dataDir(), '生产计划', body.filename), 'utf8')).toContain('A,10');
  });

  it('越界与非法：tmp 放开上传（002 FR-025）→ 201；穿越 dir → 400；.exe → 400；缺字段 → 400', async () => {
    const toTmp = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      ...multipart('a.csv', 'x', 'tmp'),
    });
    expect(toTmp.statusCode).toBe(201);
    expect(toTmp.json().dir).toBe('tmp');
    // 非法目录仍拒绝
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      ...multipart('a.csv', 'x', 'secret'),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('UPLOAD_DIR_FORBIDDEN');

    const traversal = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      ...multipart('a.csv', 'x', '../etc'),
    });
    expect(traversal.statusCode).toBe(400);

    const badExt = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      ...multipart('a.exe', 'MZ', 'shared'),
    });
    expect(badExt.statusCode).toBe(400);
    expect(badExt.json().error.code).toBe('VALIDATION_FAILED');

    const noDir = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      ...multipart('a.csv', 'x', null),
    });
    expect(noDir.statusCode).toBe(400);
    // 拒绝后不留暂存残留
    expect(
      readdirSync(path.join(dataDir(), 'tmp')).filter((f) => f.startsWith('.upload-')),
    ).toEqual([]);
  });

  it('超限 → 413 FILE_TOO_LARGE', async () => {
    const big = Buffer.alloc(1024 * 1024 + 1, 65); // 1MB + 1B
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      ...multipart('big.csv', big, 'shared'),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('FILE_TOO_LARGE');
    expect(readdirSync(path.join(dataDir(), 'shared'))).toEqual([]);
  });

  it('列表与下载：含 tmp；下载内容一致；穿越 400；不存在 404', async () => {
    // 上传一个文件
    const up = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      ...multipart('r.txt', '规则内容', '使用规则'),
    });
    const { filename } = up.json() as { filename: string };
    // tmp 放一个模拟 Agent 产出
    writeFileSync(path.join(dataDir(), 'tmp', 't-1_产出.csv'), 'a,b');

    const list1 = (
      await app.inject({
        method: 'GET',
        url: `/api/files/list?dir=${encodeURIComponent('使用规则')}`,
      })
    ).json() as Array<{ filename: string }>;
    expect(list1.map((f) => f.filename)).toContain(filename);
    const listTmp = (
      await app.inject({ method: 'GET', url: '/api/files/list?dir=tmp' })
    ).json() as Array<{ filename: string }>;
    expect(listTmp.map((f) => f.filename)).toContain('t-1_产出.csv');
    const badList = await app.inject({ method: 'GET', url: '/api/files/list?dir=../' });
    expect(badList.statusCode).toBe(400);

    const dl = await app.inject({
      method: 'GET',
      url: `/api/files/download?dir=${encodeURIComponent('使用规则')}&filename=${encodeURIComponent(filename)}`,
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe('规则内容');

    const dlTmp = await app.inject({
      method: 'GET',
      url: `/api/files/download?dir=tmp&filename=${encodeURIComponent('t-1_产出.csv')}`,
    });
    expect(dlTmp.statusCode).toBe(200);
    expect(dlTmp.body).toBe('a,b');

    const trav = await app.inject({
      method: 'GET',
      url: '/api/files/download?dir=tmp&filename=..%2F..%2Fusage.db',
    });
    expect(trav.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'GET',
      url: '/api/files/download?dir=tmp&filename=nope.txt',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('T041：工具写业务目录 → 自然语言降级文本（不抛出），日志 file.write.denied', async () => {
    const logs: string[] = [];
    const logger = pino({ level: 'warn' }, {
      write: (chunk: string) => {
        logs.push(chunk);
      },
    } as pino.DestinationStream);
    const fa = new FileAccess({
      optAgentRoot: path.join(root, '.opt-agent'),
      userId: 'admin',
      logger,
    });
    const tools = buildBuiltinTools({
      fileAccess: fa,
      threadId: 't-1',
      enabled: ['write_file', 'read_file'],
      logger,
    });
    const writeFile = tools.find((t) => t.name === 'write_file')!;

    // 结果不是 throw，而是交给模型的降级文本 → runAgentLoop 继续，对话不中断
    const result = await writeFile.execute('call-1', {
      filename: '../生产计划/t-1_结果.csv',
      content: 'x',
    } as never);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('没有权限');
    expect(text).toContain('tmp/');
    expect(logs.join('')).toContain('file.write.denied');
    expect(logs.join('')).toContain('"alert":true');
    // 业务目录未被写入
    expect(readdirSync(path.join(dataDir(), '生产计划'))).toEqual([]);

    // read 越权同样降级为文本
    const readFile = tools.find((t) => t.name === 'read_file')!;
    const r2 = await readFile.execute('call-2', { path: '../../etc/passwd' } as never);
    expect((r2.content[0] as { text: string }).text).toContain('没有权限');
  });

  it('T041：正常写 tmp 产出 → 落盘且可下载', async () => {
    const logger = pino({ enabled: false });
    const fa = new FileAccess({
      optAgentRoot: path.join(root, '.opt-agent'),
      userId: 'admin',
      logger,
    });
    const tools = buildBuiltinTools({
      fileAccess: fa,
      threadId: 't-1',
      enabled: ['write_file'],
      logger,
    });
    const writeFile = tools.find((t) => t.name === 'write_file')!;
    const result = await writeFile.execute('c', {
      filename: 't-1_结果.csv',
      content: 'a,b',
    } as never);
    expect((result.content[0] as { text: string }).text).toContain('tmp/t-1_结果.csv');
    expect(existsSync(path.join(dataDir(), 'tmp', 't-1_结果.csv'))).toBe(true);
    const dl = await app.inject({
      method: 'GET',
      url: `/api/files/download?dir=tmp&filename=${encodeURIComponent('t-1_结果.csv')}`,
    });
    expect(dl.body).toBe('a,b');
  });
});

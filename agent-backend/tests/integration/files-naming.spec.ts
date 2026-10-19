/**
 * 上传落盘命名集成测试（012）：**不重名用原名**，重名 `原名(n).ext`（半角括号），并发零覆盖。
 *
 * 运行方式（本地执行；容器只负责部署，见宪章原则三 / 原则八）：
 *   npm run test:all           # 全部测试
 *   npm run test:integration   # 仅集成测试
 *
 * 为什么单独一个文件：`files-scenario.spec.ts` 已远超 500 行（存量），
 * 新增 8 条命名用例不再往里堆（宪章原则二）。这里自带一份最小 fixture（一个数字人 + 场景）。
 *
 * 覆盖（对应 012 FR-020~FR-028 / SC-003 / SC-004）：
 * - 原名落盘（不再追加时间戳）、`(1)`·`(2)`、稀疏取最小、多点文件名；
 * - `Promise.all` 并发同名零覆盖、同名 20 连传零覆盖；
 * - 冲突域只在目标目录（跨空间互不影响）、历史时间戳文件并存不改名。
 *
 * 说明：`tests/` 不在 tsconfig 的 include 内（不参与构建），此处用无扩展名导入，
 * 由 Vitest 解析到 `src/*`。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-naming-'));
const userId = 'admin';
const AGENT = 'alpha';
/** 数据准备（带二级目录，用于跨目录同名）+ 三个空间 */
const SCENARIO = { scenario: '命名', data_prep_dirs: ['生产计划'] };

let app: FastifyInstance;

beforeAll(async () => {
  const dir = path.join(root, 'users', userId, 'agents', AGENT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${AGENT}。\n`, 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(SCENARIO), 'utf8');

  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });

  const selected = await app.inject({ method: 'POST', url: `/api/agents/${AGENT}/select` });
  expect(selected.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

/** 手工 multipart（`dir` 字段在前，命中早验路径）；与 `files-scenario.spec.ts` 同款 */
function multipart(dir: string, filename: string, content: string, contentType: string) {
  const boundary = '----vitest-naming-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${dir}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

function uploadTo(dir: string, filename: string, content: string) {
  const { body, headers } = multipart(dir, filename, content, 'text/plain');
  return app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers });
}

/** 目录绝对路径（与后端 `userDataDir(...)/<空间>` 同构） */
function absDir(space: string): string {
  return path.join(root, 'users', userId, 'user-data', AGENT, space);
}

async function uploadExpect201(dir: string, filename: string, content: string): Promise<string> {
  const res = await uploadTo(dir, filename, content);
  expect(res.statusCode).toBe(201);
  return (res.json() as { filename: string }).filename;
}

describe('落盘命名：原名 / 原名(n).ext（012 FR-020 / FR-021 / FR-027）', () => {
  it('不重名 ⇒ 原名（不含时间戳）', async () => {
    expect(await uploadExpect201('临时空间', 'n12-plain.txt', 'a')).toBe('n12-plain.txt');
  });

  it('重名 ⇒ (1)、(2)，半角括号紧贴主名、扩展名在末尾', async () => {
    expect(await uploadExpect201('临时空间', 'n12-seq.txt', 'v1')).toBe('n12-seq.txt');
    expect(await uploadExpect201('临时空间', 'n12-seq.txt', 'v2')).toBe('n12-seq(1).txt');
    expect(await uploadExpect201('临时空间', 'n12-seq.txt', 'v3')).toBe('n12-seq(2).txt');
  });

  it('删除 (1) 后 ⇒ 取最小可用编号（不跳号到 (3)）', async () => {
    await uploadExpect201('临时空间', 'n12-gap.txt', 'v1');
    await uploadExpect201('临时空间', 'n12-gap.txt', 'v2');
    await uploadExpect201('临时空间', 'n12-gap.txt', 'v3');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/files?dir=${encodeURIComponent('临时空间')}&filename=${encodeURIComponent('n12-gap(1).txt')}`,
    });
    expect(del.statusCode).toBe(200);

    expect(await uploadExpect201('临时空间', 'n12-gap.txt', 'v4')).toBe('n12-gap(1).txt');
  });

  it('多点文件名：编号只插在最后一个扩展名前', async () => {
    expect(await uploadExpect201('临时空间', 'n12-b.report.csv', 'x')).toBe('n12-b.report.csv');
    expect(await uploadExpect201('临时空间', 'n12-b.report.csv', 'y')).toBe('n12-b.report(1).csv');
  });

  it('历史时间戳文件并存：既有文件不改名，新上传用原名（FR-026）', async () => {
    const abs = absDir('临时空间');
    mkdirSync(abs, { recursive: true });
    writeFileSync(path.join(abs, 'n12-hist_20260101_000000.txt'), 'old', 'utf8');

    expect(await uploadExpect201('临时空间', 'n12-hist.txt', 'new')).toBe('n12-hist.txt');
    expect(existsSync(path.join(abs, 'n12-hist_20260101_000000.txt'))).toBe(true);
  });
});

describe('并发与冲突域（012 FR-022 / FR-023 / FR-025 / SC-004）', () => {
  it('并发 3 个同名 ⇒ 三个不同落盘名，内容互不相同（零覆盖）', async () => {
    const results = await Promise.all([
      uploadTo('临时空间', 'n12-race.txt', 'A'),
      uploadTo('临时空间', 'n12-race.txt', 'B'),
      uploadTo('临时空间', 'n12-race.txt', 'C'),
    ]);

    expect(results.map((res) => res.statusCode)).toEqual([201, 201, 201]);
    const names = results.map((res) => (res.json() as { filename: string }).filename);
    expect(new Set(names).size).toBe(3);

    const contents = names
      .map((name) => readFileSync(path.join(absDir('临时空间'), name), 'utf8'))
      .sort();
    expect(contents).toEqual(['A', 'B', 'C']);
  });

  it('同名 20 连传 ⇒ 20 个文件、编号连续无跳号、内容互不相同', async () => {
    const names: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      names.push(await uploadExpect201('临时空间', 'n12-twenty.txt', `c${index}`));
    }

    expect(new Set(names).size).toBe(20);
    expect(names[0]).toBe('n12-twenty.txt');
    expect(names[19]).toBe('n12-twenty(19).txt');
    const files = readdirSync(absDir('临时空间')).filter((name) => name.startsWith('n12-twenty'));
    expect(files).toHaveLength(20);
  });

  it('跨目录同名互不影响（冲突域只在目标目录）', async () => {
    expect(await uploadExpect201('临时空间', 'n12-cross.txt', 'tmp')).toBe('n12-cross.txt');
    // 同一数字人的另一个空间：同名照用原名
    expect(await uploadExpect201('共享空间', 'n12-cross.txt', 'shared')).toBe('n12-cross.txt');
  });
});

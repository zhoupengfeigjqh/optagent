/**
 * 单元测试：后台产出（R11，契约 §10.3 / §10.4 / §10.5）
 *
 * 守住四条：
 * 1. **命名口径** —— 落盘名 `{prefix}_{服务提供的文件名}`、sidecar `{主干}.meta.json`、
 *    `job_id` 取自服务提供的文件名主干；非法 `sid` 回退 `uid`（不让它把路径带歪）；
 * 2. **目录即索引** —— 列表由扫描目录现算；sidecar 损坏即跳过（**不产生悬空引用**）；
 * 3. **无产出即零成本** —— 提示词段为空串，不占一个字符（不变式 5）；
 * 4. **有界返回** —— 列表与提示词段都有条数上限。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRODUCED_DIR } from '../../src/domain/dirs.js';
import { FileAccess, PermissionError } from '../../src/domain/file-access.js';
import {
  PRODUCED_PROMPT_MAX,
  formatProducedList,
  jobIdOf,
  listProduced,
  markProducedRead,
  metaFilename,
  producedFilename,
  producedPrefix,
  writeProduced,
} from '../../src/domain/produced.js';

let root: string;
let access: FileAccess;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'produced-'));
  fs.mkdirSync(path.join(root, 'users', 'admin', 'user-data'), { recursive: true });
  access = new FileAccess({ optAgentRoot: root, userId: 'admin' });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 产出目录的绝对路径（断言正文真的落到磁盘时用） */
function producedAbs(name: string): string {
  return path.join(root, 'users', 'admin', 'user-data', PRODUCED_DIR, name);
}

describe('FileAccess.writeProduced —— 受控子目录写入（§10.6 不变式 4）', () => {
  it('只允许写入产出目录：其它目录一律拒绝（回写签名被伪造也写不到别处）', async () => {
    for (const dir of ['共享空间', '临时空间', '数据准备/生产计划', '']) {
      await expect(access.writeProduced(dir, 'x.json', Buffer.from('x'))).rejects.toThrow(
        PermissionError,
      );
    }
  });

  it('文件名非法（含分隔符 / `..` / 空）一律拒绝', async () => {
    for (const bad of ['a/b.json', 'a\\b.json', '../x.json', 'x/../y.json', '']) {
      await expect(access.writeProduced(PRODUCED_DIR, bad, Buffer.from('x'))).rejects.toThrow(
        PermissionError,
      );
    }
  });

  it('合法写入：目录按需创建，返回相对路径', async () => {
    const relPath = await access.writeProduced(PRODUCED_DIR, 'p_j1.json', Buffer.from('ok'));
    expect(relPath).toBe(`${PRODUCED_DIR}/p_j1.json`);
    expect(fs.readFileSync(producedAbs('p_j1.json'), 'utf8')).toBe('ok');
  });
});

describe('命名口径（契约 §10.3）', () => {
  it('job_id 取自服务提供文件名的主干', () => {
    expect(jobIdOf('j_123.json')).toBe('j_123');
    expect(jobIdOf('result')).toBe('result');
  });

  it('落盘名 = {prefix}_{服务提供的文件名}', () => {
    expect(producedFilename('th_x', 'j_1.json')).toBe('th_x_j_1.json');
  });

  it('sidecar 名 = 主干 + .meta.json', () => {
    expect(metaFilename('th_x_j_1.json')).toBe('th_x_j_1.meta.json');
  });

  it('前缀 = sid ?? uid；非法 sid 一律回退 uid', () => {
    expect(producedPrefix('th_9f8e', 'admin')).toBe('th_9f8e');
    for (const bad of [undefined, '', '   ', 'a/b', 'a\\b', '..', 'a'.repeat(65)]) {
      expect(producedPrefix(bad, 'admin')).toBe('admin');
    }
  });
});

describe('落盘与列表', () => {
  it('写正文 + sidecar：正文不带元数据，元数据都在 sidecar 里', async () => {
    const saved = await writeProduced({
      access,
      sid: 'th_9f8e',
      callId: 'call_c1',
      tool: 'ocr__submit_ocr',
      filename: 'j_123.json',
      content: Buffer.from('{"rows":12}', 'utf8'),
      userId: 'admin',
      summary: '识别到 12 页',
      now: new Date('2026-09-25T02:00:00.000Z'),
    });

    expect(saved.filename).toBe('th_9f8e_j_123.json');
    expect(saved.relPath).toBe(`${PRODUCED_DIR}/th_9f8e_j_123.json`);
    expect(fs.readFileSync(producedAbs(saved.filename), 'utf8')).toBe('{"rows":12}');
    expect(fs.existsSync(producedAbs(metaFilename(saved.filename)))).toBe(true);

    const items = await listProduced(access);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      job_id: 'j_123',
      uid: 'admin',
      sid: 'th_9f8e',
      call_id: 'call_c1',
      tool: 'ocr__submit_ocr',
      status: 'done',
      summary: '识别到 12 页',
      size: 11,
      filename: 'th_9f8e_j_123.json',
      relPath: `${PRODUCED_DIR}/th_9f8e_j_123.json`,
    });
  });

  it('sid 缺失：前缀回退 uid，sidecar 不写 sid 键', async () => {
    await writeProduced({
      access,
      filename: 'j_1.json',
      content: Buffer.from('x'),
      userId: 'admin',
    });

    const items = await listProduced(access);
    expect(items[0]?.filename).toBe('admin_j_1.json');
    expect(items[0]?.sid).toBeUndefined();
  });

  it('目录不存在 → 空列表（"没有产出"与"目录还没建"同义）', async () => {
    expect(await listProduced(access)).toEqual([]);
  });

  it('sidecar 损坏 → 跳过该条（不产生"列表里有、点开是空的"悬空引用）', async () => {
    await writeProduced({
      access,
      filename: 'j_1.json',
      content: Buffer.from('x'),
      userId: 'admin',
    });
    fs.writeFileSync(producedAbs(metaFilename('admin_j_1.json')), 'not json', 'utf8');

    expect(await listProduced(access)).toEqual([]);
  });

  it('按完成时间倒序 + 有界返回', async () => {
    const times = ['2026-09-25T01:00:00.000Z', '2026-09-25T03:00:00.000Z', '2026-09-25T02:00:00.000Z'];
    for (const [i, at] of times.entries()) {
      await writeProduced({
        access,
        filename: `j_${i}.json`,
        content: Buffer.from('x'),
        userId: 'admin',
        now: new Date(at),
      });
    }

    const items = await listProduced(access, 2);
    expect(items.map((i) => i.job_id)).toEqual(['j_1', 'j_2']);
  });
});

describe('提示词段（契约 §10.5 ③）', () => {
  it('无产出时为空串（不占一个字符，不变式 5）', () => {
    expect(formatProducedList([])).toBe('');
  });

  it('按"工具 · 相对时间 · 已完成 · 体积 · 路径"成行', async () => {
    await writeProduced({
      access,
      sid: 'th_9f8e',
      tool: 'ocr__submit_ocr',
      filename: 'j_123.json',
      content: Buffer.alloc(128 * 1024, 1),
      userId: 'admin',
      now: new Date('2026-09-25T02:00:00.000Z'),
    });

    const items = await listProduced(access);
    const text = formatProducedList(items, Date.parse('2026-09-25T02:02:00.000Z'));

    expect(text).toContain('【后台计算结果】');
    expect(text).toContain(
      '- ocr__submit_ocr · 2 分钟前 · 已完成 · 128.0 KB · 临时空间/后台产出/th_9f8e_j_123.json',
    );
  });

  it('条数上限：最多列 PRODUCED_PROMPT_MAX 行 + 一行标题', () => {
    const many = Array.from({ length: PRODUCED_PROMPT_MAX + 5 }, (_, i) => ({
      job_id: `j${i}`,
      uid: 'admin',
      tool: 't',
      created_at: '2026-09-25T00:00:00.000Z',
      finished_at: '2026-09-25T00:00:00.000Z',
      status: 'done' as const,
      size: 1,
      filename: `f${i}`,
      relPath: `临时空间/后台产出/f${i}`,
    }));

    expect(formatProducedList(many).split('\n')).toHaveLength(PRODUCED_PROMPT_MAX + 1);
  });

  it('tool 缺失时用 job_id 兜底（不留空白项）', () => {
    const item = {
      job_id: 'j_7',
      uid: 'admin',
      tool: '',
      created_at: '2026-09-25T00:00:00.000Z',
      finished_at: '2026-09-25T00:00:00.000Z',
      status: 'done' as const,
      size: 1,
      filename: 'f',
      relPath: '临时空间/后台产出/f',
    };
    expect(formatProducedList([item])).toContain('- j_7 ·');
  });
});

describe('标记已读（契约 §10.5 ⑤）', () => {
  /** 写一条产出；`at` 决定完成时刻（倒序与边界用例需要可控时序） */
  function seed(jobId: string, at = '2026-09-25T02:00:00.000Z'): ReturnType<typeof writeProduced> {
    return writeProduced({
      access,
      filename: `${jobId}.json`,
      content: Buffer.from('x'),
      userId: 'admin',
      now: new Date(at),
    });
  }

  it('标记后写入 read_at，并返回**实际写入条数**', async () => {
    await seed('j_1');

    const marked = await markProducedRead(access, ['j_1'], new Date('2026-09-25T03:00:00.000Z'));

    expect(marked).toBe(1);
    expect((await listProduced(access))[0]?.read_at).toBe('2026-09-25T03:00:00.000Z');
  });

  it('幂等：重复标记**不改动**原 read_at，返回 0', async () => {
    await seed('j_1');
    await markProducedRead(access, ['j_1'], new Date('2026-09-25T03:00:00.000Z'));

    const marked = await markProducedRead(access, ['j_1'], new Date('2026-09-25T04:00:00.000Z'));

    expect(marked).toBe(0);
    // 时间**不刷新**：重复点击不该把"什么时候读的"越推越近
    expect((await listProduced(access))[0]?.read_at).toBe('2026-09-25T03:00:00.000Z');
  });

  it('不存在的 job_id 一律忽略；空数组直接返回 0', async () => {
    expect(await markProducedRead(access, ['ghost'])).toBe(0);
    expect(await markProducedRead(access, [])).toBe(0);
  });

  it('能命中**列表之外**的条目（列表有界 50 条，但已读必须标得到任意一条）', async () => {
    for (let i = 0; i < 55; i += 1) {
      await seed(`j_${i}`, `2026-09-25T02:${String(i).padStart(2, '0')}:00.000Z`);
    }

    // 列表按完成时间倒序 + 有界：最旧的 j_0 不在列表里
    const listed = await listProduced(access);
    expect(listed).toHaveLength(50);
    expect(listed.some((item) => item.job_id === 'j_0')).toBe(false);

    expect(await markProducedRead(access, ['j_0'])).toBe(1);
  });

  it('只改 sidecar，**不动正文**（正文是服务的计算结果，元数据操作不该碰它）', async () => {
    const saved = await seed('j_1');
    const bodyPath = path.join(root, 'users', 'admin', 'user-data', saved.relPath);

    await markProducedRead(access, ['j_1']);

    expect(fs.readFileSync(bodyPath, 'utf8')).toBe('x');
  });

  it('一次标记多条：返回写入的成功条数（已读的与不存在的都不计入）', async () => {
    await seed('j_1');
    await seed('j_2');
    await markProducedRead(access, ['j_1']);

    const marked = await markProducedRead(access, ['j_1', 'j_2', 'ghost']);

    expect(marked).toBe(1);
    expect((await listProduced(access)).every((item) => item.read_at !== undefined)).toBe(true);
  });
});

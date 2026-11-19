/**
 * read_file 的格式分派（2026-10-20 增 `.html`）。
 *
 * 守三件事：
 * 1. `.html` 走**文本直读**（与 `.txt`/`.md` 同一条路），不是 Excel/PDF 解析分支；
 * 2. 返回的是**原文**（标签与脚本原样保留）——模型要读源码，不是渲染后的文本；
 * 3. 不支持类型的提示里 MUST 出现 `.html`（说明与实现同源，不能只改实现）。
 */
import { describe, expect, it, vi } from 'vitest';

import type { FileAccess } from '../../src/domain/file-access';
import { readToolFile } from '../../src/domain/tools/read-file';

const HTML = '<!doctype html><html><body><h1>看板</h1><script>alert(1)</script></body></html>';

/** 最小 FileAccess 桩：只区分"文本直读"与"读原始字节"两条路径 */
function stubAccess(content: string): {
  fa: FileAccess;
  read: ReturnType<typeof vi.fn>;
  readBuffer: ReturnType<typeof vi.fn>;
} {
  const read = vi.fn().mockResolvedValue({
    content,
    truncated: false,
    totalSize: Buffer.byteLength(content, 'utf8'),
  });
  const readBuffer = vi.fn().mockResolvedValue(Buffer.from(content, 'utf8'));
  const fa = {
    truncateBytes: 32 * 1024,
    assertPathAllowed: () => {},
    read,
    readBuffer,
  } as unknown as FileAccess;
  return { fa, read, readBuffer };
}

describe('readToolFile —— `.html`（2026-10-20）', () => {
  it('走文本直读并原样返回（不解析 DOM、不执行脚本、不剥标签）', async () => {
    const { fa, read, readBuffer } = stubAccess(HTML);

    const result = await readToolFile(fa, '临时空间/看板.html');

    expect(read).toHaveBeenCalledWith('临时空间/看板.html', {
      offset: undefined,
      limit: undefined,
    });
    expect(readBuffer).not.toHaveBeenCalled();
    expect(result.text).toBe(HTML);
    expect(result.truncated).toBe(false);
    expect(result.totalSize).toBe(Buffer.byteLength(HTML, 'utf8'));
  });

  it('扩展名大小写不敏感（`.HTML` 同样按文本读）', async () => {
    const { fa, readBuffer } = stubAccess(HTML);

    const result = await readToolFile(fa, '临时空间/REPORT.HTML');

    expect(result.text).toBe(HTML);
    expect(readBuffer).not.toHaveBeenCalled();
  });

  it('不支持类型的提示含 `.html`（说明与实现同源）', async () => {
    const { fa } = stubAccess('MZ\u0000\u0000二进制');

    const result = await readToolFile(fa, '临时空间/程序.exe');

    expect(result.text).toContain('不支持的文件格式');
    expect(result.text).toContain('.html');
  });
});

/**
 * 未知扩展名的文本嗅探兜底（2026-11-16）：与 `write_file` 的"未登记扩展名回落文本"对齐——
 * 模型写得进去的必须读得回来，判据是**内容**（有无 NUL）而不是扩展名名分。
 */
describe('readToolFile —— 未知扩展名按内容嗅探', () => {
  it('无 NUL → 按 utf8 文本读，走 readBuffer 而非 read', async () => {
    const { fa, read, readBuffer } = stubAccess('a: 1\nb: 2\n');

    const result = await readToolFile(fa, '临时空间/th_1.yaml');

    expect(readBuffer).toHaveBeenCalledWith('临时空间/th_1.yaml');
    expect(read).not.toHaveBeenCalled();
    expect(result.text).toBe('a: 1\nb: 2\n');
    expect(result.totalSize).toBe(Buffer.byteLength('a: 1\nb: 2\n', 'utf8'));
  });

  it('含 NUL → 判定为二进制并拒绝（不看扩展名名分）', async () => {
    const { fa } = stubAccess(`PK\u0000\u0003\u0004`);

    const result = await readToolFile(fa, '临时空间/归档.bin');

    expect(result.text).toContain('不支持的文件格式 ".bin"');
  });

  it('NUL 出现在远端（第 100 字节之后）同样拒绝——判据是全缓冲', async () => {
    const { fa } = stubAccess(`${'x'.repeat(100)}\u0000`);

    const result = await readToolFile(fa, '临时空间/th_1.未知');

    expect(result.text).toContain('不支持的文件格式 ".未知"');
  });

  it('偏移与截断沿用同一口径', async () => {
    const { fa } = stubAccess('0123456789');

    const result = await readToolFile(fa, '临时空间/th_1.dat', { offset: 2, limit: 3 });

    expect(result.text).toContain('234');
    expect(result.truncated).toBe(true);
    expect(result.totalSize).toBe(10);
  });
});

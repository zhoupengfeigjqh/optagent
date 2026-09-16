/**
 * 测试用最小 ZIP 构造器（零依赖）。
 *
 * 之所以自建：SKILL 安装的安全校验（`FR-038`、`FR-039`）必须用**恶意夹具**验证，
 * 而"绝对路径 / `..` 穿越 / 符号链接 / 超大 / 深层嵌套"这些边界**无法用正常
 * 打包工具产出**（正规工具会拒绝生成，或行为不可控）。
 *
 * 只实现 **STORE（不压缩）** 方式：结构最简单、可预测，足以覆盖校验路径。
 * 条目名统一按 UTF-8 编码并置位 general purpose bit 11。
 */
import { deflateRawSync } from 'node:zlib';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntrySpec {
  /** 条目名（可含 `../`、绝对路径等恶意形态，用于夹具） */
  name: string
  content?: string | Buffer
  /** 符号链接目标（写入 externalFileAttributes 的 Unix 模式位） */
  symlinkTo?: string
  /** 直接指定 externalFileAttributes（覆盖默认） */
  externalAttributes?: number
}

export interface ZipFixtureOptions {
  /** 是否用 deflate 压缩（默认 STORE） */
  compress?: boolean
}

/** 常规文件的外部属性（Unix 模式 100644） */
export const MODE_FILE = 0o100644
/** 符号链接的外部属性（Unix 模式 120777） */
export const MODE_SYMLINK = 0o120777

/**
 * 用 `{ 路径: 内容 }` 构造一个 ZIP（便捷形式）。
 *
 * @example zipFixture({ 'SKILL.md': '---\nname: x\ndescription: y\n---\n' })
 */
export function zipFixture(files: Record<string, string>, options: ZipFixtureOptions = {}): Buffer {
  return buildZip(
    Object.entries(files).map(([name, content]) => ({ name, content })),
    options,
  );
}

/** 构造 ZIP（完整形态，支持符号链接与自定义外部属性） */
export function buildZip(entries: ZipEntrySpec[], options: ZipFixtureOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = entry.symlinkTo !== undefined ? Buffer.from(entry.symlinkTo, 'utf8') : toBuffer(entry.content);
    const method = options.compress ? 8 : 0;
    const payload = options.compress ? deflateRawSync(raw) : raw;

    const crc = crc32(raw);
    const externalAttributes =
      entry.externalAttributes ??
      ((entry.symlinkTo !== undefined ? MODE_SYMLINK : MODE_FILE) << 16);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 名称
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(0x031e, 4); // version made by: unix(3) + 30
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(externalAttributes >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

function toBuffer(content: string | Buffer | undefined): Buffer {
  if (content === undefined) return Buffer.alloc(0);
  return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
}

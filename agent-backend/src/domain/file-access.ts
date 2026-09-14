/**
 * FileAccess 文件访问代理层（FR-022 核心安全策略）。
 *
 * 所有 Agent 侧文件读写必须经此层：
 * - 路径规范化：拒绝绝对路径与 `..` 穿越；已存在路径做 realpath 校验防符号链接穿越
 * - 目录白名单：三空间（数据准备/共享空间/临时空间）；数据准备的二级目录须真实存在
 * - 权限矩阵：数据准备/共享空间只读；临时空间可写但强制 `{thread_id}_` 前缀
 * - 违规抛 PermissionError 并记日志（对话不中断由上层保证）
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { SPACE_PREP, SPACE_TMP, SPACES, userDataDir } from './dirs.js';
import { removeFileSafeAsync } from './fs-safe.js';

export class PermissionError extends Error {
  readonly code = 'PERMISSION_DENIED';
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export interface FileEntry {
  name: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: string;
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  /** 跳过的二进制文件数（.xlsx/.pdf 等不在文本检索范围） */
  skippedBinary: number;
}

const READABLE_DIRS: readonly string[] = SPACES;
const TEXT_EXTENSIONS = new Set(['.csv', '.txt', '.json', '.md', '.log']);

export interface FileAccessOptions {
  optAgentRoot: string;
  userId: string;
  logger?: Logger;
  /** read 截断上限（KB），默认 32 */
  truncateKb?: number | undefined;
}

export class FileAccess {
  private readonly dataRoot: string;
  private readonly logger?: Logger;
  /** 读截断上限（字节），工具层做 xlsx/pdf 解析后文本截断时使用 */
  get truncateBytes(): number {
    return this.truncateBytesInternal;
  }

  private readonly truncateBytesInternal: number;
  constructor(opts: FileAccessOptions) {
    this.dataRoot = userDataDir(opts.optAgentRoot, opts.userId);
    if (opts.logger) this.logger = opts.logger;
    this.truncateBytesInternal = (opts.truncateKb ?? 32) * 1024;
  }

  /** 公开的路径白名单校验（工具层在任何格式分派前先过权限关） */
  assertPathAllowed(relPath: string): void {
    this.resolveSafe(relPath);
  }

  /**
   * 校验 + 定位（MCP 文件参数转签名 URL 用）：
   * 返回 posix 分隔的规范化相对路径与绝对路径；文件必须真实存在且为普通文件。
   */
  resolveVerified(relPath: string): { relPath: string; abs: string } {
    const abs = this.resolveSafe(relPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new PermissionError(`文件不存在或不可读: ${relPath}`);
    }
    if (!stat.isFile()) {
      throw new PermissionError(`仅支持文件: ${relPath}`);
    }
    const rel = path.relative(this.dataRoot, abs).split(path.sep).join('/');
    return { relPath: rel, abs };
  }

  /** 路径规范化 + 白名单校验，返回绝对路径；越权抛 PermissionError */
  private resolveSafe(relPath: string): string {
    if (!relPath || path.isAbsolute(relPath) || /^[a-zA-Z]:[\\/]/.test(relPath)) {
      throw this.deny(`拒绝绝对路径: ${relPath}`);
    }
    const resolved = path.resolve(this.dataRoot, relPath);
    const rel = path.relative(this.dataRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw this.deny(`路径穿越被拒绝: ${relPath}`);
    }
    const top = rel.split(path.sep)[0] ?? '';
    if (!(READABLE_DIRS as readonly string[]).includes(top)) {
      throw this.deny(`目录不在白名单: ${top}`);
    }
    // 数据准备的二级目录必须是磁盘上真实存在的目录（scenario 定义的清单会惰性创建）
    if (top === SPACE_PREP) {
      const sub = rel.split(path.sep)[1];
      if (!sub) {
        throw this.deny(`数据准备需指定二级目录: ${relPath}`);
      }
      const subAbs = path.join(this.dataRoot, SPACE_PREP, sub);
      if (!fs.existsSync(subAbs) || !fs.statSync(subAbs).isDirectory()) {
        throw this.deny(`数据准备子目录不存在: ${SPACE_PREP}/${sub}`);
      }
    }
    // 符号链接穿越校验：已存在路径必须 realpath 后仍在 dataRoot 内
    if (fs.existsSync(resolved)) {
      const real = fs.realpathSync(resolved);
      const realRel = path.relative(fs.realpathSync(this.dataRoot), real);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw this.deny(`符号链接穿越被拒绝: ${relPath}`);
      }
    } else {
      // 新文件：校验父目录 realpath
      const parent = path.dirname(resolved);
      if (fs.existsSync(parent)) {
        const realParentRel = path.relative(
          fs.realpathSync(this.dataRoot),
          fs.realpathSync(parent),
        );
        if (realParentRel.startsWith('..') || path.isAbsolute(realParentRel)) {
          throw this.deny(`符号链接穿越被拒绝: ${relPath}`);
        }
      }
    }
    return resolved;
  }

  private deny(message: string): PermissionError {
    this.logger?.warn({ alert: true, event: 'file.access.denied' }, message);
    return new PermissionError(message);
  }

  /** 读文本文件（utf8），超 truncateBytes 截断；tmp 文件刷新访问时间（7 天清理依据） */
  async read(
    relPath: string,
    opts?: { offset?: number | undefined; limit?: number | undefined },
  ): Promise<{ content: string; truncated: boolean; totalSize: number }> {
    const abs = this.resolveSafe(relPath);
    let buf: Buffer;
    try {
      buf = await fs.promises.readFile(abs);
    } catch {
      throw new PermissionError(`文件不存在或不可读: ${relPath}`);
    }
    const totalSize = buf.length;
    const offset = opts?.offset ?? 0;
    const limit = Math.min(opts?.limit ?? this.truncateBytes, this.truncateBytes);
    const slice = buf.subarray(offset, offset + limit);
    if (relPath.split(path.sep)[0] === SPACE_TMP || relPath.startsWith(`${SPACE_TMP}/`)) {
      const now = new Date();
      await fs.promises.utimes(abs, now, now).catch(() => {});
    }
    return {
      content: slice.toString('utf8'),
      truncated: offset + slice.length < totalSize,
      totalSize,
    };
  }

  /** 读原始字节（供 read_file 工具做 xlsx/pdf 格式分派）；tmp 文件同样刷新访问时间 */
  async readBuffer(relPath: string): Promise<Buffer> {
    const abs = this.resolveSafe(relPath);
    let buf: Buffer;
    try {
      buf = await fs.promises.readFile(abs);
    } catch {
      throw new PermissionError(`文件不存在或不可读: ${relPath}`);
    }
    if (relPath.split(path.sep)[0] === SPACE_TMP || relPath.startsWith(`${SPACE_TMP}/`)) {
      const now = new Date();
      await fs.promises.utimes(abs, now, now).catch(() => {});
    }
    return buf;
  }

  /** 写文件：仅允许 tmp/ 且文件名强制 `{threadId}_` 前缀；返回 user-data 相对路径 */
  async write(threadId: string, filename: string, content: string): Promise<string> {
    const base = path.basename(filename);
    if (base !== filename || base.includes('..')) {
      throw this.deny(`写入仅允许 临时空间/ 下的扁平文件名: ${filename}`);
    }
    if (!base.startsWith(`${threadId}_`)) {
      throw this.deny(`临时空间写入文件名必须以 "${threadId}_" 前缀开头: ${base}`);
    }
    const relPath = `${SPACE_TMP}/${base}`;
    const abs = this.resolveSafe(relPath);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, content, 'utf8');
    return relPath;
  }

  /**
   * 删除文件（**用户侧文件空间管理**专用，非 Agent 工具）。
   *
   * 仅允许白名单目录下的普通文件；目录本身不可删（抛 PermissionError）。
   * 路径安全由 `resolveSafe` 统一兜住（穿越 / 符号链接 / 白名单）。
   */
  async remove(relPath: string): Promise<void> {
    const abs = this.resolveSafe(relPath);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(abs);
    } catch {
      throw new PermissionError(`文件不存在或不可读: ${relPath}`);
    }
    if (stat.isDirectory()) {
      throw this.deny(`删除仅支持文件: ${relPath}`);
    }
    await removeFileSafeAsync(abs); // 不用 fs.promises.rm：Windows 非 ASCII 路径静默失效（见 fs-safe）
  }

  /** 列目录（仅白名单顶层目录） */
  async list(dir: string): Promise<FileEntry[]> {
    const abs = this.resolveSafe(dir);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(abs, { withFileTypes: true });
    } catch {
      throw new PermissionError(`目录不存在或不可读: ${dir}`);
    }
    const result: FileEntry[] = [];
    for (const e of entries) {
      const stat = await fs.promises.stat(path.join(abs, e.name)).catch(() => null);
      if (!stat) continue;
      result.push({
        name: e.name,
        size: stat.size,
        isDirectory: e.isDirectory(),
        modifiedAt: stat.mtime.toISOString(),
      });
    }
    return result;
  }

  /** 文本检索：仅文本格式，跳过 .xlsx/.pdf 等二进制并计数 */
  async grep(pattern: string, dir?: string): Promise<GrepResult> {
    const dirs = dir ? [dir] : await this.expandSpaces();
    const matches: GrepMatch[] = [];
    let skippedBinary = 0;
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      throw new PermissionError(`非法检索表达式: ${pattern}`);
    }
    for (const d of dirs) {
      let files: string[];
      try {
        files = await fs.promises.readdir(this.resolveSafe(d));
      } catch {
        continue; // 目录不存在不视为错误
      }
      for (const name of files) {
        const rel = `${d}/${name}`;
        const ext = path.extname(name).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) {
          if (ext) skippedBinary += 1;
          continue;
        }
        const { content } = await this.read(rel, { limit: this.truncateBytes }).catch(() => ({
          content: '',
          truncated: false,
          totalSize: 0,
        }));
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (re.test(line)) matches.push({ file: rel, line: i + 1, text: line.trim() });
        }
      }
    }
    return { matches, skippedBinary };
  }

  /** 展开三空间为可检索目录清单：数据准备下钻到现存子目录，其余空间即自身 */
  private async expandSpaces(): Promise<string[]> {
    const dirs: string[] = [];
    for (const space of READABLE_DIRS) {
      if (space !== SPACE_PREP) {
        dirs.push(space);
        continue;
      }
      const prepAbs = path.join(this.dataRoot, SPACE_PREP);
      const subs = await fs.promises
        .readdir(prepAbs, { withFileTypes: true })
        .catch(() => [] as fs.Dirent[]);
      for (const sub of subs) {
        if (sub.isDirectory()) dirs.push(`${SPACE_PREP}/${sub.name}`);
      }
    }
    return dirs;
  }
}

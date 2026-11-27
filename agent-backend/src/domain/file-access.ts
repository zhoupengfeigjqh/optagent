import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { PRODUCED_DIR, SPACE_PREP, SPACE_TMP, SPACES, userDataDir } from './dirs.js';
import { removeFileSafeAsync } from './fs-safe.js';
import { loadScenario } from './scenario.js';
import { judgeSpacePath } from './space-path.js';
import type { SpaceCapability, SpacePathDeny, SpacePathRules } from './space-path.js';

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
  skippedBinary: number;
}

const READABLE_DIRS: readonly string[] = SPACES;
const TEXT_EXTENSIONS = new Set(['.csv', '.txt', '.json', '.md', '.log', '.html']);

export interface FileAccessOptions {
  optAgentRoot: string;
  userId: string;
  agentName: string;
  logger?: Logger;
  /**
   * read 截断上限（KB）。**运行期默认是 128**（`READ_TRUNCATE_KB`，经 `server.ts` 注入），
   * `read_file` 与 `read_skill` 共用这一份口径。下面构造函数里的 `?? 32` 只是"未注入"时的兜底
   * （测试等直调场景），不是生产默认值。
   */
  truncateKb?: number | undefined;
}

export class FileAccess {
  private readonly dataRoot: string;
  private readonly optAgentRoot: string;
  private readonly userId: string;
  private readonly agentName: string;
  private readonly rules: SpacePathRules;
  private prepDirsCache?: readonly string[];
  private readonly logger?: Logger;
  /** 读截断上限（字节），工具层做 xlsx/pdf 解析后文本截断时使用 */
  get truncateBytes(): number {
    return this.truncateBytesInternal;
  }

  private readonly truncateBytesInternal: number;
  constructor(opts: FileAccessOptions) {
    this.dataRoot = userDataDir(opts.optAgentRoot, opts.userId, opts.agentName);
    this.optAgentRoot = opts.optAgentRoot;
    this.userId = opts.userId;
    this.agentName = opts.agentName;
    this.rules = { dataPrepDirs: () => this.dataPrepDirs() };
    if (opts.logger) this.logger = opts.logger;
    // 32 是"未注入"兜底：生产恒由 `server.ts` 注入 `READ_TRUNCATE_KB`（缺省 128）
    this.truncateBytesInternal = (opts.truncateKb ?? 32) * 1024;
  }

  private dataPrepDirs(): readonly string[] {
    if (this.prepDirsCache) return this.prepDirsCache;
    try {
      this.prepDirsCache = loadScenario(
        this.optAgentRoot,
        this.userId,
        this.agentName,
      ).dataPrepDirs;
    } catch {
      this.prepDirsCache = [];
    }
    return this.prepDirsCache;
  }

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

  private resolveSafe(relPath: string, capability: SpaceCapability = 'model-read'): string {
    const verdict = judgeSpacePath(relPath, capability, this.rules);
    if (!verdict.ok) throw this.deny(this.explain(verdict, capability));
    const resolved = path.resolve(this.dataRoot, verdict.relPath);
    const rel = path.relative(this.dataRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw this.deny(`路径穿越被拒绝: ${relPath}`);
    }
    // 数据准备的二级目录必须是磁盘上真实存在的目录（scenario 定义的清单会惰性创建）
    if (verdict.space === SPACE_PREP && verdict.sub) {
      const subAbs = path.join(this.dataRoot, SPACE_PREP, verdict.sub);
      if (!fs.existsSync(subAbs) || !fs.statSync(subAbs).isDirectory()) {
        throw this.deny(`数据准备子目录不存在: ${SPACE_PREP}/${verdict.sub}`);
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

  /**
   * 判据 → 给模型**可自我纠正**的中文文案。
   *
   * 文案属消费者（HTTP 要 400/403，模型要引导语），但合法性只由 `judgeSpacePath` 决定：
   * 这里 MUST NOT 再加任何"某种情况下放行"的分支。
   */
  private explain(v: SpacePathDeny, capability: SpaceCapability): string {
    switch (v.kind) {
      case 'bad-input':
        if (
          /^[a-zA-Z]:/.test(v.relPath) ||
          v.relPath.startsWith('/') ||
          v.relPath.startsWith('\\')
        ) {
          return `拒绝绝对路径: ${v.relPath}`;
        }
        return v.relPath === '' ? '非法路径: 空' : `路径穿越被拒绝: ${v.relPath}`;
      case 'space-forbidden':
        return capability === 'model-write'
          ? `写入仅允许 临时空间: ${v.relPath}`
          : `目录不在白名单: ${v.space ?? v.relPath}`;
      case 'missing-sub':
        return `数据准备需指定二级目录: ${v.relPath}`;
      case 'too-deep':
        return `数据准备不支持更深层级: ${v.relPath}`;
      case 'not-in-scenario':
        this.warnOrphanedPrepDir(v);
        return `数据准备子目录不在场景清单: ${v.space}/${v.sub}`;
      case 'not-flat':
        return `${v.space} 不支持子目录: ${v.relPath}`;
    }
    return `路径被拒绝: ${v.relPath}`;
  }

  private warnOrphanedPrepDir(v: SpacePathDeny): void {
    if (!v.sub) return;
    if (!fs.existsSync(path.join(this.dataRoot, SPACE_PREP, v.sub))) return;
    this.logger?.warn(
      {
        alert: true,
        event: 'prepdir.orphaned.denied',
        user_id: this.userId,
        agent_name: this.agentName,
        sub: v.sub,
      },
      `数据准备/${v.sub} 已不在场景清单内，但磁盘上仍有内容（部署不清理文件空间）`,
    );
  }

  private deny(message: string): PermissionError {
    this.logger?.warn({ alert: true, event: 'file.access.denied' }, message);
    return new PermissionError(message);
  }

  async read(
    relPath: string,
    opts?: { offset?: number | undefined; limit?: number | undefined; touch?: boolean },
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
    const inTmp = relPath.split(path.sep)[0] === SPACE_TMP || relPath.startsWith(`${SPACE_TMP}/`);
    if (opts?.touch !== false && inTmp) {
      const now = new Date();
      await fs.promises.utimes(abs, now, now).catch(() => {});
    }
    return {
      content: slice.toString('utf8'),
      truncated: offset + slice.length < totalSize,
      totalSize,
    };
  }

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

  async write(threadId: string, filename: string, content: string): Promise<string> {
    return this.writeBytes(threadId, filename, Buffer.from(content, 'utf8'));
  }

  /**
   * 写原始字节（2026-11-16）：与 `write` 共用同一套路径判据，只是不做 utf8 编码。
   *
   * 供 `write_file` 的二进制模式（后续 `.xlsx` / `.pdf`）使用；本层**不含任何格式知识**——
   * 扩展名路由在 `domain/tools/write-modes.ts`，权限层只管"能不能写、写到哪里"。
   */
  async writeBytes(threadId: string, filename: string, data: Buffer): Promise<string> {
    const base = path.basename(filename);
    if (base !== filename || base.includes('..')) {
      throw this.deny(`写入仅允许 临时空间/ 下的扁平文件名: ${filename}`);
    }
    // Windows 冒号 = NTFS 备用数据流（ADS，2026-10-21）：`a.txt:evil` 落的是 `a.txt` 的流，
    // Windows 文件名本来就禁止 `:`，拒绝它不损失任何合法用法（模型可写，故必须拦）。
    if (base.includes(':')) {
      throw this.deny(`写入仅允许扁平文件名（不得含 ":"）: ${filename}`);
    }
    if (!base.startsWith(`${threadId}_`)) {
      throw this.deny(`临时空间写入文件名必须以 "${threadId}_" 前缀开头: ${base}`);
    }
    const relPath = `${SPACE_TMP}/${base}`;
    const abs = this.resolveSafe(relPath, 'model-write');
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, data);
    return relPath;
  }

  async writeProduced(dir: string, filename: string, content: Buffer): Promise<string> {
    if (dir !== PRODUCED_DIR) {
      throw this.deny(`后台产出只允许写入 ${PRODUCED_DIR}，拒绝: ${dir}`);
    }
    const base = path.basename(filename);
    if (base !== filename || base === '' || base.includes('..')) {
      throw this.deny(`后台产出文件名非法: ${filename}`);
    }
    const relPath = `${PRODUCED_DIR}/${base}`;
    const abs = this.resolveSafe(relPath);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, content);
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

  /**
   * 列目录。
   *
   * 扁平空间（临时空间）**不可下钻**：`临时空间/别处` 本身就是子目录，
   * 一律不可列。这条判据必须在 stat 之后才成立（词法分不清"一层文件"与"同名目录"），
   * 故落在本实现而非 `space-path.ts`；例外子树 `临时空间/后台产出` 不受限。
   */
  async list(dir: string): Promise<FileEntry[]> {
    const abs = this.resolveSafe(dir);
    const baseRel = path.relative(this.dataRoot, abs).split(path.sep).join('/');
    const top = baseRel.split('/')[0] ?? '';
    const inProduced = baseRel === PRODUCED_DIR || baseRel.startsWith(`${PRODUCED_DIR}/`);
    const flatSpace = top === SPACE_TMP;
    if (flatSpace && !inProduced && baseRel !== top) {
      throw this.deny(`${top} 不支持子目录: ${dir}`);
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(abs, { withFileTypes: true });
    } catch {
      throw new PermissionError(`目录不存在或不可读: ${dir}`);
    }
    const result: FileEntry[] = [];
    for (const e of entries) {
      // 扁平空间根目录只列文件：目录条目在扁平模型里不可达（前端同样 filter 掉），
      if (flatSpace && baseRel === top && e.isDirectory()) continue;
      // 与前端口径一致：不可达的子目录**不返回**，避免"看得见点不开"
      if (e.isDirectory() && !judgeSpacePath(`${baseRel}/${e.name}`, 'model-read', this.rules).ok) {
        continue;
      }
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
        continue;
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
        if (!sub.isDirectory()) continue;
        const rel = `${SPACE_PREP}/${sub.name}`;
        // 否则"read_file 被拒、grep 却把内容漏给模型"，收紧会被一键绕过
        if (!judgeSpacePath(rel, 'model-read', this.rules).ok) continue;
        dirs.push(rel);
      }
    }
    return dirs;
  }
}

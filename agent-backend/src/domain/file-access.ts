/**
 * FileAccess 文件访问代理层（FR-022 核心安全策略）。
 *
 * 所有 Agent 侧文件读写必须经此层：
 * - 路径合法性：**唯一判据在 `domain/space-path.ts`**（与 HTTP 文件接口共用同一张表，
 *   2026-11-02 收敛）——三空间白名单、扁平空间限深、数据准备二级目录须在场景清单内
 * - 物理兜底：拒绝绝对路径与 `..` 穿越；已存在路径做 realpath 校验防符号链接穿越；
 *   数据准备二级目录须真实存在（清单目录由 `loadScenario` 惰性创建）
 * - 权限矩阵：数据准备/共享空间只读；临时空间可写但强制 `{thread_id}_` 前缀
 * - 违规抛 PermissionError 并记日志（对话不中断由上层保证）
 *
 * **009 归属**：`dataRoot` 是**数字人数据域**（`user-data/{数字人}`），`agentName` 为必填入参；
 * 因此相对路径（`数据准备/生产计划`、`临时空间`…）语义不变，但**解析结果随数字人而异**——
 * 跨数字人访问在路径层即不可达（白名单外 → PermissionError）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { PRODUCED_DIR, SPACE_PREP, SPACE_SHARED, SPACE_TMP, SPACES, userDataDir } from './dirs.js';
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
  /** 跳过的二进制文件数（.xlsx/.pdf 等不在文本检索范围） */
  skippedBinary: number;
}

const READABLE_DIRS: readonly string[] = SPACES;
/** grep 可扫描的文本类型（2026-10-20 增 `.html`：与 `read_file` 的可读集合对齐） */
const TEXT_EXTENSIONS = new Set(['.csv', '.txt', '.json', '.md', '.log', '.html']);

export interface FileAccessOptions {
  optAgentRoot: string;
  userId: string;
  /** 数据域所属数字人（009 必填）：决定 `dataRoot = user-data/{数字人}` */
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
  /** 路径判据的入参（唯一判据在 `domain/space-path.ts`；这里只提供场景清单） */
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

  /**
   * 该数字人的数据准备二级目录清单（2026-11-02：**可见性的唯一权威**）。
   *
   * 此前只验"磁盘上目录是否存在"，于是场景清单收缩后（部署不清理文件空间），
   * 已下线的目录与文件仍在磁盘上，模型照样能读——清单形同虚设。
   *
   * `loadScenario` 自带 mtime 缓存并会惰性创建清单目录；本实例再 memo 一次，
   * 避免 `grep` 逐文件调用时反复 stat。未配置场景 → 空清单（数据准备整体不可达，
   * 与 `listAvailableDirs` 的退化口径一致）。
   */
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

  /** 公开的路径白名单校验（工具层在任何格式分派前先过权限关；默认按模型只读口径） */
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

  /**
   * 路径规范化 + 合法性校验，返回绝对路径；越权抛 PermissionError。
   *
   * 合法性判据的**唯一来源**是 `domain/space-path.ts`（与 HTTP 文件接口共用同一张表）；
   * 本方法只补三件物理层面的事：落点归一、数据准备二级目录真实存在、realpath 防符号链接。
   */
  private resolveSafe(relPath: string, capability: SpaceCapability = 'model-read'): string {
    const verdict = judgeSpacePath(relPath, capability, this.rules);
    if (!verdict.ok) throw this.deny(this.explain(verdict, capability));
    const resolved = path.resolve(this.dataRoot, verdict.relPath);
    // 纵深防御：判据已收敛路径，这里仍确认落点没被 path.resolve 带到域外
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

  /**
   * 场景清单外的数据准备目录若**磁盘上仍存在**，说明清单被收缩过而文件空间不清理
   * （部署只覆盖数字人配置，不动 `user-data/`）。
   *
   * 这条日志让运维能主动决定"迁走还是留着"，而不是让数据静默变成
   * "前端看不到、agent 也读不到、却还占着盘"的中间态。
   */
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

  /**
   * 读文本文件（utf8），超 truncateBytes 截断；tmp 文件刷新访问时间（30 天清理依据）。
   *
   * `touch: false` 用于**清单类扫描**（后台产出的 sidecar）：那种读是"为了列表"而非
   * "为了内容"，若也续命，则每轮对话注入产出清单都会刷新 atime，产出**永远不会过期**
   * （契约 §10.4 的 30 天口径随之失效）。
   */
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

  /** 写文件：仅允许 tmp/ 且文件名强制 `{threadId}_` 前缀；返回**数字人数据域**相对路径 */
  async write(threadId: string, filename: string, content: string): Promise<string> {
    const base = path.basename(filename);
    if (base !== filename || base.includes('..')) {
      throw this.deny(`写入仅允许 临时空间/ 下的扁平文件名: ${filename}`);
    }
    // Windows 冒号 = NTFS 备用数据流（ADS，2026-10-21）：`a.txt:evil` 落的是 `a.txt` 的流，
    // 目录没变，但 `list_dir` 看不到、`read_file` 却能读——等于绕过"文件可见性"这层约束。
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
    await fs.promises.writeFile(abs, content, 'utf8');
    return relPath;
  }

  /**
   * **后台产出写入**（R11，契约 §10.3 / §10.6 不变式 4）：MCP 服务回写结果的唯一落点。
   *
   * 与 `write`（Agent 的 `write_file`）**分属两条权限**，互不放开：
   * - `write`：临时空间**顶层**、强制 `{threadId}_` 前缀（模型可写）
   * - 本方法：**只允许** `临时空间/后台产出/`，文件名由调用方按 `{prefix}_{jobId}.{ext}` 拼好
   *
   * 路径安全仍由 `resolveSafe` 统一兜住（顶层白名单 / `..` / 符号链接 / realpath），
   * 因此即便回写签名被伪造，也写不到 `后台产出/` 以外的任何位置。
   *
   * **未加"冒号（NTFS ADS）"判据，是有意的**（2026-10-21）：本方法的文件名来自**服务**
   * （非模型），落点又被 `dir !== PRODUCED_DIR` 锁死，威胁模型与 `write` 不同；
   * 且服务可能用含 `:` 的时间戳命名，加判据会让既有回写 400（破坏现有集成）。
   * 想收紧应当在与服务方的约定层（`§10.3` 的 `{jobId}.{ext}`）解决，而不是在这里拦。
   */
  async writeProduced(dir: string, filename: string, content: Buffer): Promise<string> {
    if (dir !== PRODUCED_DIR) {
      throw this.deny(`后台产出只允许写入 ${PRODUCED_DIR}，拒绝: ${dir}`);
    }
    const base = path.basename(filename);
    if (base !== filename || base === '' || base.includes('..')) {
      throw this.deny(`后台产出文件名非法: ${filename}`);
    }
    const relPath = `${PRODUCED_DIR}/${base}`;
    // 落点已由上面的 `dir !== PRODUCED_DIR` 锁死；判据走 model-read（该子树是登记例外）
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
   * 扁平空间（共享/临时）**不可下钻**：`共享空间/2026`、`临时空间/别处` 本身就是子目录，
   * 一律不可列。这条判据必须在 stat 之后才成立（词法分不清"一层文件"与"同名目录"），
   * 故落在本实现而非 `space-path.ts`；例外子树 `临时空间/后台产出` 不受限。
   */
  async list(dir: string): Promise<FileEntry[]> {
    const abs = this.resolveSafe(dir);
    const baseRel = path.relative(this.dataRoot, abs).split(path.sep).join('/');
    const top = baseRel.split('/')[0] ?? '';
    const inProduced = baseRel === PRODUCED_DIR || baseRel.startsWith(`${PRODUCED_DIR}/`);
    const flatSpace = top === SPACE_SHARED || top === SPACE_TMP;
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
      // 留着会让模型"看得见点不开"
      if (flatSpace && baseRel === top && e.isDirectory()) continue;
      // 与前端口径一致：不可达的子目录**不返回**，避免"看得见点不开"
      // （模型会去 list 一遍再被拒，用户看到的是一张注定失败的卡片）
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
        if (!sub.isDirectory()) continue;
        const rel = `${SPACE_PREP}/${sub.name}`;
        // 与 read_file 同一判据：场景清单外的残留目录不纳入检索范围，
        // 否则"read_file 被拒、grep 却把内容漏给模型"，收紧会被一键绕过
        if (!judgeSpacePath(rel, 'model-read', this.rules).ok) continue;
        dirs.push(rel);
      }
    }
    return dirs;
  }
}

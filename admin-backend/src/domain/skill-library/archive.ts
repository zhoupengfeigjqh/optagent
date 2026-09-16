/**
 * SKILL ZIP 归档的安全解析（`FR-038`、`FR-039`，`research.md` D7）。
 *
 * 用 `yauzl` 的 `lazyEntries` 逐条读取**条目元数据**，**先校验、后解压**：
 * 全部条目通过校验之前，不会把任何不可信内容读进内存，更不会写入目标目录
 * （`FR-039` 明确要求"校验 MUST 在写入目标目录之前完成"）。
 *
 * 拒绝项（`data-model.md` §4 校验项 5~7）：
 * - 绝对路径、`..` 穿越、反斜杠路径、控制字符、盘符
 * - 符号链接（`externalFileAttributes` 高 16 位的文件类型位为 `0o120000`）
 * - 重复条目名
 * - 总解压大小 / 单文件大小 / 文件数 / 嵌套层级超限
 */
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

export interface ArchiveLimits {
  /** 解压后总字节上限 */
  maxTotalBytes: number;
  /** 单文件字节上限 */
  maxFileBytes: number;
  /** 文件条目数上限 */
  maxFiles: number;
  /** 目录嵌套层级上限 */
  maxDepth: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxTotalBytes: 32 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxFiles: 500,
  maxDepth: 6,
};

export interface ArchiveEntryInfo {
  path: string;
  size: number;
}

export interface SkillArchive {
  /** 被剥离的单层顶层目录名（无则为空串） */
  prefix: string;
  /** 归一化后的文件清单（相对路径 + 字节数），供界面展示 */
  entries: ArchiveEntryInfo[];
  /** 归一化后的相对路径 → 内容 */
  files: Map<string, Buffer>;
  /** `SKILL.md` 全文 */
  skillMd: string;
}

function invalid(message: string): ApiError {
  return new ApiError(ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID, message);
}

function unsafe(message: string): ApiError {
  return new ApiError(ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE, message);
}

/**
 * 校验单个条目名，返回不安全的原因（安全则返回 `null`）。
 * 纯函数，便于单测（原则三：安全校验 MUST 有单元测试）。
 */
export function unsafeEntryReason(fileName: string): string | null {
  if (typeof fileName !== 'string' || fileName === '') return '条目名为空';
  if (fileName.length > 255) return `条目名过长（${fileName.length} 字符）`;
  if (/^[a-zA-Z]:/.test(fileName)) return `含盘符的绝对路径（${fileName}）`;
  if (fileName.startsWith('/') || fileName.startsWith('\\')) return `绝对路径（${fileName}）`;
  // 反斜杠在 Windows 打包工具里是**路径分隔符**（ZIP 规范推荐 `/`），
  // 不是危险字符：先归一再按同一套规则校验，否则"Windows 上正常打包"的技能装不上。
  const normalized = normalizeEntryName(fileName);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return `含控制字符（${fileName}）`;
  const segments = normalized.split('/');
  if (segments.some((s) => s === '..')) return `路径穿越（${fileName}）`;
  return null;
}

/** 目录项判定：反斜杠结尾同样视为目录 */
export function isDirectoryEntry(fileName: string): boolean {
  return fileName.endsWith('/') || fileName.endsWith('\\');
}

/** 嵌套层级：按归一化后的 `/` 计段数 */
export function entryDepth(fileName: string): number {
  const trimmed = normalizeEntryName(fileName).replace(/\/+$/, '');
  if (trimmed === '') return 0;
  return trimmed.split('/').length;
}

/**
 * 条目名归一：反斜杠 → 斜杠，并合并多余斜杠。
 *
 * 归一后的名字才用于去重、层级计算、顶层目录剥离与落盘路径，
 * 保证 Windows 打包与 Unix 打包的最终结果一致。
 */
export function normalizeEntryName(fileName: string): string {
  return fileName.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

/** 是否为符号链接条目（ZIP 用 Unix 文件模式的高 16 位表达文件类型） */
export function isSymlinkEntry(externalFileAttributes: number): boolean {
  const mode = (externalFileAttributes >>> 16) & 0o170000;
  return mode === 0o120000;
}

/**
 * 剥离**单层顶层目录**：标准 SKILL 包允许把内容放在一个顶层目录里
 * （`data-model.md` §4 校验项 2 的"根级或单层目录下的 SKILL.md"）。
 *
 * 只有当全部条目共享**同一个**首段时才剥离，避免误吞真实目录结构。
 */
export function stripCommonPrefix(paths: string[]): { prefix: string; relative: string[] } {
  if (paths.length === 0) return { prefix: '', relative: [] };
  const firstSegments = paths.map((p) => p.split('/')[0] ?? '');
  const candidate = firstSegments[0]!;
  if (candidate === '') return { prefix: '', relative: paths };
  const allShare =
    firstSegments.every((s) => s === candidate) && paths.every((p) => p.includes('/'));
  if (!allShare) return { prefix: '', relative: paths };
  return {
    prefix: candidate,
    relative: paths.map((p) => p.split('/').slice(1).join('/')),
  };
}

interface RawEntry {
  /** 压缩包里的原始条目名（读取内容时用于匹配 yauzl 条目） */
  fileName: string;
  /** 归一化后的名字（反斜杠→斜杠）：去重、层级、落盘路径均以此为准 */
  name: string;
  size: number;
}

/**
 * 打开压缩包。
 *
 * **必须拿到原始条目名，不能让 yauzl 静默清洗**：yauzl 默认会**清洗**条目名
 * （把 `../x` 变成 `x`、去掉开头的 `/`）。那样一来 `FR-039` 要求的
 * "拒绝越界路径"就永远不会触发——不安全条目会被悄悄改写后照常解压。
 *
 * 但 yauzl 的 `strictFileNames` 同时会**拒绝反斜杠**（Windows 打包工具的
 * 路径分隔符），导致"Windows 上正常打包的技能"根本装不上。因此这里关闭
 * yauzl 的内置校验，由 `unsafeEntryReason` **统一承担**全部安全判定：
 * 绝对路径 / 盘符 / `..` 穿越 / 控制字符仍然全部拒绝，反斜杠则按分隔符归一。
 */
function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: false }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(invalid(`压缩包无法打开：${err ? err.message : '未知原因'}`));
        return;
      }
      resolve(zipfile);
    });
  });
}

/** 惰性遍历全部条目（不读取内容，只读元数据） */
function walkEntries(
  zip: yauzl.ZipFile,
  onEntry: (entry: yauzl.Entry) => Promise<void> | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      try {
        zip.close();
      } catch {
        /* 关闭失败不影响报错语义 */
      }
      reject(err);
    };
    zip.on('error', fail);
    zip.on('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zip.on('entry', (entry: yauzl.Entry) => {
      Promise.resolve()
        .then(() => onEntry(entry))
        .then(
          () => {
            if (!settled) zip.readEntry();
          },
          (err: unknown) => fail(err),
        );
    });
    zip.readEntry();
  });
}

function readEntryBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream: Readable) => {
      if (err) {
        reject(invalid(`条目 ${entry.fileName} 读取失败：${err.message}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', (readErr: Error) =>
        reject(invalid(`条目 ${entry.fileName} 解压失败：${readErr.message}`)),
      );
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

/** 第一遍：只校验元数据（**不读内容**） */
async function collectValidatedEntries(
  buffer: Buffer,
  limits: ArchiveLimits,
): Promise<RawEntry[]> {
  const zip = await openZip(buffer);
  const raws: RawEntry[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let fileCount = 0;

  try {
    await walkEntries(zip, (entry) => {
      const fileName = entry.fileName;
      const reason = unsafeEntryReason(fileName);
      if (reason) throw unsafe(`压缩包含不安全条目：${reason}`);
      if (isSymlinkEntry(entry.externalFileAttributes)) {
        throw unsafe(`压缩包含符号链接条目：${fileName}`);
      }
      if (isDirectoryEntry(fileName)) return;

      // 去重 / 层级 / 落盘路径一律用**归一化名字**：Windows 与 Unix 打包结果一致
      const name = normalizeEntryName(fileName);
      if (seen.has(name)) throw unsafe(`压缩包含重复条目名：${name}`);
      seen.add(name);

      const depth = entryDepth(fileName);
      if (depth > limits.maxDepth) {
        throw unsafe(`条目嵌套层级超限（${name} 为 ${depth} 层，上限 ${limits.maxDepth}）`);
      }
      if (entry.uncompressedSize > limits.maxFileBytes) {
        throw unsafe(
          `单文件超出上限（${name} 为 ${entry.uncompressedSize} 字节，上限 ${limits.maxFileBytes}）`,
        );
      }
      totalBytes += entry.uncompressedSize;
      if (totalBytes > limits.maxTotalBytes) {
        throw unsafe(`解压后总大小超出上限（上限 ${limits.maxTotalBytes} 字节）`);
      }
      fileCount += 1;
      if (fileCount > limits.maxFiles) {
        throw unsafe(`文件数超出上限（上限 ${limits.maxFiles} 个）`);
      }
      raws.push({ fileName, name, size: entry.uncompressedSize });
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // `yauzl` 自身对不安全条目名也会报错（文案见其 `validateFileName`）。
    // 这类报错**正好等价于**我们要求的安全校验失败，因此归到 UNSAFE，
    // 而不是笼统地当作"格式不合法"——`FR-039` 要求提示**安全原因**。
    const message = (err as Error).message;
    if (/invalid characters in fileName|absolute path|invalid relative path/.test(message)) {
      throw unsafe(`压缩包含不安全条目：${message}`);
    }
    throw invalid(`压缩包解析失败：${message}`);
  }

  if (raws.length === 0) throw invalid('压缩包内没有任何文件');
  return raws;
}

/** 第二遍：校验已全部通过，此时才读取内容 */
async function readAllContents(
  buffer: Buffer,
  wanted: Set<string>,
): Promise<Map<string, Buffer>> {
  const zip = await openZip(buffer);
  const files = new Map<string, Buffer>();
  await walkEntries(zip, async (entry) => {
    if (isDirectoryEntry(entry.fileName)) return;
    if (!wanted.has(entry.fileName)) return;
    files.set(entry.fileName, await readEntryBuffer(zip, entry));
  });
  return files;
}

/**
 * 安全解析 SKILL 压缩包：**先校验后解压**，返回归一化后的文件集合与 `SKILL.md` 全文。
 *
 * 注意：本函数只做"能不能装"的判定，**不写入任何目录**——入驻由
 * `install.ts` 在全部校验通过后以原子操作完成（`FR-039`、`FR-041`）。
 */
export async function extractSkillArchive(
  buffer: Buffer,
  limits: Partial<ArchiveLimits> = {},
): Promise<SkillArchive> {
  const effective: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...limits };
  const raws = await collectValidatedEntries(buffer, effective);

  // 顶层目录剥离按**归一化名字**计算：Windows 打包的 `skill\SKILL.md` 同样生效
  const { prefix, relative } = stripCommonPrefix(raws.map((r) => r.name));
  const relativeOf = new Map<string, string>();
  raws.forEach((raw, index) => relativeOf.set(raw.name, relative[index]!));

  const normalizedNames = relative.filter((p) => p !== '');
  if (normalizedNames.some((p) => p === '')) throw invalid('压缩包含空的相对路径');
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    throw unsafe('剥离顶层目录后出现重复条目名');
  }

  const skillMdName = normalizedNames.find((p) => p === 'SKILL.md');
  if (!skillMdName) {
    throw invalid('压缩包内缺少 SKILL.md（需位于根级或单层目录下）');
  }

  // 读取内容仍以原始条目名匹配 yauzl 条目，落盘键用归一化后的相对路径
  const contents = await readAllContents(buffer, new Set(raws.map((r) => r.fileName)));
  const files = new Map<string, Buffer>();
  raws.forEach((raw) => {
    const rel = relativeOf.get(raw.name)!;
    const content = contents.get(raw.fileName);
    if (content && rel) files.set(rel, content);
  });

  return {
    prefix,
    entries: raws.map((raw) => ({ path: relativeOf.get(raw.name)!, size: raw.size })),
    files,
    skillMd: files.get('SKILL.md')!.toString('utf8'),
  };
}

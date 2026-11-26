import { PRODUCED_DIR } from './dirs.js';
import type { FileAccess, FileEntry } from './file-access.js';
import { formatBytes } from './tool-result.js';

export const META_SUFFIX = '.meta.json';
export const PRODUCED_LIST_MAX = 50;
export const PRODUCED_PROMPT_MAX = 10;

export interface ProducedMeta {
  job_id: string;
  uid: string;
  sid?: string;
  call_id?: string;
  tool: string;
  created_at: string;
  finished_at: string;
  status: 'done';
  summary?: string;
  size: number;
  filename: string;
  read_at?: string;
}

export interface ProducedItem extends ProducedMeta {
  relPath: string;
  agent_name?: string;
}

function stripExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.'));
  return ext.length > 1 && ext.length < name.length ? name.slice(0, -ext.length) : name;
}

export function jobIdOf(rawFilename: string): string {
  return stripExt(rawFilename);
}

export function producedFilename(prefix: string, rawFilename: string): string {
  return `${prefix}_${rawFilename}`;
}

export function isSafeProducedName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  if (name.includes('..')) return false;
  // eslint-disable-next-line no-control-regex -- 控制字符正是要拦的
  if (/[\u0000-\u001f]/u.test(name)) return false;
  return !/[\\/:*?"<>|]/u.test(name);
}

export function metaFilename(resultFilename: string): string {
  return `${stripExt(resultFilename)}${META_SUFFIX}`;
}

/**
 * 文件名前缀（契约 §10.3）：`sid ?? uid`。
 *
 * `sid` 来自 URL 的归属提示参数，**不参与验签**——但不能让它把路径带歪：
 * 含分隔符/`..`/空白/超长时一律回退 `uid`（它已被 `FileAccess` 的文件名校验再拦一道）。
 */
export function producedPrefix(sid: string | undefined, userId: string): string {
  if (!sid) return userId;
  const trimmed = sid.trim();
  if (trimmed === '' || !/^[^/\\]{1,64}$/.test(trimmed) || trimmed.includes('..')) return userId;
  return trimmed;
}

export interface WriteProducedInput {
  access: FileAccess;
  sid?: string | undefined;
  callId?: string | undefined;
  tool?: string | undefined;
  /** 服务提供的文件名（`{jobId}.{ext}`）；调用方已做安全检查 */
  filename: string;
  content: Buffer;
  userId: string;
  summary?: string | undefined;
  createdAt?: Date | undefined;
  now?: Date;
}

export async function writeProduced(
  input: WriteProducedInput,
): Promise<{ filename: string; relPath: string; size: number }> {
  const at = input.now ?? new Date();
  const prefix = producedPrefix(input.sid, input.userId);
  if (!isSafeProducedName(input.filename)) {
    throw new Error(`服务提供的产出文件名非法: ${input.filename}`);
  }
  const filename = producedFilename(prefix, input.filename);
  // 正文 MUST NOT 长得像 sidecar（2026-10-27）：`scanProduced` 按后缀识别元数据，
  if (filename.toLowerCase().endsWith(META_SUFFIX)) {
    throw new Error(`产出文件名不得以 ${META_SUFFIX} 结尾: ${input.filename}`);
  }
  const relPath = await input.access.writeProduced(PRODUCED_DIR, filename, input.content);

  const meta: ProducedMeta = {
    job_id: jobIdOf(input.filename),
    uid: input.userId,
    ...(input.sid ? { sid: input.sid } : {}),
    ...(input.callId ? { call_id: input.callId } : {}),
    tool: input.tool ?? '',
    // 提交时刻来自回写地址的 `t`；缺失/不可信时退化为回写时刻（两者相等 = 改造前行为）
    created_at: (input.createdAt ?? at).toISOString(),
    finished_at: at.toISOString(),
    status: 'done',
    ...(input.summary ? { summary: input.summary } : {}),
    size: input.content.length,
    filename,
  };
  await input.access.writeProduced(
    PRODUCED_DIR,
    metaFilename(filename),
    Buffer.from(JSON.stringify(meta), 'utf8'),
  );
  return { filename, relPath, size: input.content.length };
}

interface ScannedProduced {
  meta: ProducedMeta;
  relPath: string;
}

async function scanProduced(access: FileAccess): Promise<ScannedProduced[]> {
  let entries: FileEntry[];
  try {
    entries = await access.list(PRODUCED_DIR);
  } catch {
    return [];
  }
  const items: ScannedProduced[] = [];
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith(META_SUFFIX)) continue;
    const meta = await readMeta(access, `${PRODUCED_DIR}/${entry.name}`);
    if (!meta) continue;
    items.push({ meta, relPath: `${PRODUCED_DIR}/${meta.filename}` });
  }
  items.sort((a, b) => b.meta.finished_at.localeCompare(a.meta.finished_at));
  return items;
}

export async function listProduced(
  access: FileAccess,
  limit: number = PRODUCED_LIST_MAX,
): Promise<ProducedItem[]> {
  const scanned = await scanProduced(access);
  return scanned
    .slice(0, Math.max(0, Math.min(limit, PRODUCED_LIST_MAX)))
    .map(({ meta, relPath }) => ({ ...meta, relPath }));
}

/**
 * 按 `job_id` 取单条产出（**无界**，不受列表上限影响）；不存在返回 `null`。
 *
 * 供"点开看正文"（契约 §10.5 ⑦）使用：界面看的可能是**列表之外**的更旧条目
 * （列表有界 50 条），所以不能先 `listProduced` 再找。
 */
export async function findProduced(
  access: FileAccess,
  jobId: string,
): Promise<ProducedItem | null> {
  for (const { meta, relPath } of await scanProduced(access)) {
    if (meta.job_id === jobId) return { ...meta, relPath };
  }
  return null;
}

export async function markProducedRead(
  access: FileAccess,
  jobIds: readonly string[],
  now: Date = new Date(),
): Promise<number> {
  if (jobIds.length === 0) return 0;
  const wanted = new Set(jobIds);
  const at = now.toISOString();
  let marked = 0;
  for (const { meta } of await scanProduced(access)) {
    if (!wanted.has(meta.job_id) || meta.read_at) continue;
    await access.writeProduced(
      PRODUCED_DIR,
      metaFilename(meta.filename),
      Buffer.from(JSON.stringify({ ...meta, read_at: at }), 'utf8'),
    );
    marked += 1;
  }
  return marked;
}

async function readMeta(access: FileAccess, relPath: string): Promise<ProducedMeta | null> {
  try {
    const { content, truncated } = await access.read(relPath, { limit: 16 * 1024, touch: false });
    if (truncated) return null;
    const raw = JSON.parse(content) as Partial<ProducedMeta>;
    if (typeof raw.job_id !== 'string' || typeof raw.filename !== 'string') return null;
    // 不是单段文件名就整条跳过——宁可这条产出不可见，也不让"读产出"变成"读任意文件"。
    if (!isSafeProducedName(raw.filename)) return null;
    return {
      job_id: raw.job_id,
      uid: typeof raw.uid === 'string' ? raw.uid : '',
      ...(typeof raw.sid === 'string' ? { sid: raw.sid } : {}),
      ...(typeof raw.call_id === 'string' ? { call_id: raw.call_id } : {}),
      tool: typeof raw.tool === 'string' ? raw.tool : '',
      created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
      finished_at: typeof raw.finished_at === 'string' ? raw.finished_at : '',
      status: 'done',
      ...(typeof raw.summary === 'string' ? { summary: raw.summary } : {}),
      size: typeof raw.size === 'number' ? raw.size : 0,
      filename: raw.filename,
      ...(typeof raw.read_at === 'string' ? { read_at: raw.read_at } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * 提示词段（契约 §10.5 ③）：`systemExtra` 里的产出清单（与工具结果回灌无关，
 * 后者 2026-11-07 起只进 messages）。
 *
 * **无产出时返回空串**（不占一个字符，不变式 5）；正文 MUST NOT 被注入——
 * 结果可能数 MB，模型需要内容时自己按路径 `read_file`。
 */
export function formatProducedList(
  items: readonly ProducedItem[],
  now: number = Date.now(),
): string {
  if (items.length === 0) return '';
  const lines = items.slice(0, PRODUCED_PROMPT_MAX).map((item) => {
    const parts = [
      `- ${item.tool !== '' ? item.tool : item.job_id}`,
      relativeTime(item.finished_at, now),
      '已完成',
      formatBytes(item.size),
      item.relPath,
    ];
    return parts.join(' · ');
  });
  return ['【后台计算结果】（需要内容时用 read_file 按路径读取）', ...lines].join('\n');
}

function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '时间未知';
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

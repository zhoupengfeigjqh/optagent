/**
 * 后台产出（R11，契约 §10.4 / §10.5）：MCP 异步工具回写结果的落盘与消费投影。
 *
 * 存储形态：**正文与 sidecar 元数据同目录、同生命周期**（刻意不用单一 `index.jsonl`）——
 * 被清理时一起消失，不会出现"列表里有、点开是空的"悬空引用。
 *
 * **目录即索引**：列表与提示词段都由**扫描目录**现算，不落第二份可漂移的数据（原则五）。
 *
 * 全部 IO 经 `FileAccess`（顶层白名单 + 符号链接校验 + 受控子目录写入），
 * 本模块不直接碰文件系统。
 */
import { PRODUCED_DIR } from './dirs.js';
import type { FileAccess, FileEntry } from './file-access.js';
import { formatBytes } from './tool-result.js';

/** sidecar 后缀，同时是"这条产出存在"的判据（正文文件本身不参与列表） */
export const META_SUFFIX = '.meta.json';
/** 产出列表一次最多返回几条（有界返回） */
export const PRODUCED_LIST_MAX = 50;
/** 提示词段最多列几条（与「可用的工具结果原文」同一量级） */
export const PRODUCED_PROMPT_MAX = 10;

/**
 * sidecar 元数据（契约 §10.4）。
 *
 * `created_at` 口径：契约定义为"提交时刻"，但服务回写时**不强制回传**它；
 * 缺失时退化为回写时刻（与 `finished_at` 相等），仅影响列表展示的精度。
 */
export interface ProducedMeta {
  /** 服务侧任务号（= 服务提供的文件名主干，见 `jobIdOf`） */
  job_id: string;
  uid: string;
  /** 发起该任务的会话（= thread_id）；决定落盘文件名前缀，缺失时为 `uid` */
  sid?: string;
  /** 关联那次"已受理"的工具调用（前端挂载点） */
  call_id?: string;
  /** 运行环境侧工具全名（含 `{server}__` 前缀） */
  tool: string;
  created_at: string;
  finished_at: string;
  status: 'done';
  /** 一行摘要（可缺省；由服务决定是否提供） */
  summary?: string;
  size: number;
  /** **落盘名**（含 `{prefix}_`），列表与提示词段都用它 */
  filename: string;
  /**
   * 已读时刻（契约 §10.5 ⑤）：**缺省 = 未读**。
   *
   * 写在 sidecar 内 ⇒ 与产出**同生命周期**：产出被 7 天清理时它一起消失，
   * 未读数因此自然归零，不会出现"角标 > 0 而列表为空"的悬空状态（§10.6 不变式 7）。
   */
  read_at?: string;
}

/**
 * 列表项 = 元数据 + 可直接 `read_file` 的路径 + **查询期联结出的展示字段**。
 *
 * `agent_name` 刻意**不落 sidecar**：它是"发起会话**最近一轮**使用的数字人"，
 * 会随会话跨数字人而变，只由查询方按 `sid` 反查 `ThreadStore`（见 `routes/produced.ts`）。
 * 落盘就会成为与 thread meta 并存的第二份真相（原则五）。
 */
export interface ProducedItem extends ProducedMeta {
  /** 相对 user-data 的路径（模型据此 read_file） */
  relPath: string;
  /** 发起会话最近一轮使用的数字人（由 `sid` 反查）；`sid` 缺失或会话已删除时缺省 */
  agent_name?: string;
}

/** 去掉扩展名（`j_123.json` → `j_123`；无扩展名则原样返回） */
function stripExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.'));
  return ext.length > 1 && ext.length < name.length ? name.slice(0, -ext.length) : name;
}

/** `job_id` 取自**服务提供的** `filename` 主干（契约 §10.3） */
export function jobIdOf(rawFilename: string): string {
  return stripExt(rawFilename);
}

/** 落盘名：`{prefix}_{服务提供的文件名}`（契约 §10.3） */
export function producedFilename(prefix: string, rawFilename: string): string {
  return `${prefix}_${rawFilename}`;
}

/** 结果文件对应的 sidecar 名：`{prefix}_j_1.json` → `{prefix}_j_1.meta.json` */
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
  /** 归属提示（来自 URL，非签名） */
  sid?: string | undefined;
  callId?: string | undefined;
  tool?: string | undefined;
  /** 服务提供的文件名（`{jobId}.{ext}`）；调用方已做安全检查 */
  filename: string;
  content: Buffer;
  /** 归属用户（sidecar 记录；前缀回退值） */
  userId: string;
  summary?: string | undefined;
  now?: Date;
}

/** 落盘正文 + sidecar；返回落盘名、相对路径与体积 */
export async function writeProduced(
  input: WriteProducedInput,
): Promise<{ filename: string; relPath: string; size: number }> {
  const at = input.now ?? new Date();
  const prefix = producedPrefix(input.sid, input.userId);
  const filename = producedFilename(prefix, input.filename);
  const relPath = await input.access.writeProduced(PRODUCED_DIR, filename, input.content);

  const meta: ProducedMeta = {
    job_id: jobIdOf(input.filename),
    uid: input.userId,
    ...(input.sid ? { sid: input.sid } : {}),
    ...(input.callId ? { call_id: input.callId } : {}),
    tool: input.tool ?? '',
    created_at: at.toISOString(),
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

/** 扫描结果（内部形状）：元数据**原样保留**，另附仅供列表使用的路径 */
interface ScannedProduced {
  meta: ProducedMeta;
  relPath: string;
}

/**
 * 扫描产出目录并按完成时间倒序返回**全部**条目（不做有界截断）。
 *
 * 与 `listProduced` 分开的原因：**"标记已读"必须能命中列表之外的条目**——
 * 列表是有界返回（`PRODUCED_LIST_MAX`），但用户完全可能点开第 51 条。
 * 扫描本身无界（规模 = 7 天内的产出数，量级极小）。
 *
 * - 目录不存在 → 空数组（"没有产出"与"目录还没建"同义）
 * - sidecar 损坏/正文已被清理 → **跳过该条**（不产生悬空引用）
 * - sidecar 读取用 `touch: false`：清单扫描不该给产出续命（否则永不清理，见 `file-access`）
 */
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

/** 产出列表（**有界返回**，契约 §10.5 ②）：扫描 + 按 `limit` 截断 */
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

/**
 * 批量标记已读（契约 §10.5 ⑤）：把 `read_at` 写回 sidecar。
 *
 * - **幂等**：已标记过的条目**不改动**原有 `read_at`（重复点击不刷新时间）；
 * - **不存在的 `job_id` 忽略**：产出可能已被 7 天清理——那不是调用方的错误；
 * - 返回**实际写入的条数**（供界面如实反馈，也便于测试断言）；
 * - 直接改 `scanProduced` 拿到的元数据并整体回写：不重建字段，避免"列表项 → sidecar"
 *   的字段搬运漂移（漏一个字段就等于抹掉一条元数据）。
 */
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
    if (truncated) return null; // 元数据不该大到被截断；宁可跳过也不返回半截信息
    const raw = JSON.parse(content) as Partial<ProducedMeta>;
    if (typeof raw.job_id !== 'string' || typeof raw.filename !== 'string') return null;
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
 * 提示词段（契约 §10.5 ③）：与「可用的工具结果原文」并列、措辞一致。
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

/** 相对时间（列表与提示词段共用口径）；无法解析时给可读占位，不留空白 */
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

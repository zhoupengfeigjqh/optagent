/**
 * 一次性回填：为 2026-10-12 **之前**落盘的"信封格式"工具记录补出 `view_links`。
 *
 * 背景：那之前适配器把整个 MCP `CallToolResult` 序列化成一个 text 块，服务返回的业务正文
 * 成了"字符串里的 JSON"，`extractViewLinks`（只递归对象/数组）抽不到 `viewUrl`，回答尾部
 * 因此没有入口行。上游修好后**新记录**不再有信封（见
 * `src/infra/mcp/mcp-result-text.ts` 头注释），但旧记录的 `view_links` 是**落盘时**算的，
 * 不会自己长出来——本脚本补这一步，且只跑一次。
 *
 * 口径与安全（宪章原则五 / 八 / 九）：
 * - **默认干跑**（只打印将要改动的内容），必须显式 `--apply` 才写盘 = 二次确认；
 * - 写盘走"临时文件 + 原子改名"，任何一步失败都保持原文件**不变**，不出现部分提交；
 * - **幂等**：已有 `view_links` 的行不动；重复执行结果一致；
 * - 只可能改 `view_links` 一个字段：其余字段与其余行**逐字节保持原样**（未改动的行原样拼回）；
 * - 抽取判据全部**复用运行时实现**（`unwrapMcpEnvelopeText` + `extractViewLinks`），
 *   脚本不复制任何规则，因而不产生第二套口径；
 * - 失败以**非零退出码**结束（根目录不存在 / 读盘失败）。
 *
 * 用法（在 `agent-backend/` 目录下执行）：
 * ```
 * npx tsx scripts/backfill-view-links.ts                     # 干跑，只报告
 * npx tsx scripts/backfill-view-links.ts --apply             # 写盘
 * npx tsx scripts/backfill-view-links.ts --root /path/.opt-agent --apply
 * ```
 * 根目录口径与 `src/config.ts` 一致：`--root` > `OPT_AGENT_ROOT` 环境变量 > 默认 `.opt-agent`。
 */
import fs from 'node:fs';
import path from 'node:path';

import { SPACE_TMP, THREADS_DIR, threadDir, userDataDir } from '../src/domain/dirs.js';
import { artifactFileName } from '../src/domain/tool-result.js';
import { extractViewLinks } from '../src/domain/view-links.js';
import { unwrapMcpEnvelopeText } from '../src/infra/mcp/mcp-result-text.js';

/** 干跑时最多预览几条改动（人工核对用，不改动行为） */
const PREVIEW_MAX = 10;

interface Stats {
  files: number;
  lines: number;
  updated: number;
  alreadyHasLinks: number;
  noTextAvailable: number;
  brokenLines: number;
}

/** 命令行取值：`--root <path>` */
function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** 解析运行数据根目录（与 `src/config.ts` 同口径） */
function resolveRoot(): string {
  return path.resolve(
    process.cwd(),
    argValue('--root') ?? process.env['OPT_AGENT_ROOT'] ?? '.opt-agent',
  );
}

/** 列出全部 `threads/{threadId}/tool-events.jsonl`（目录不存在 → 空数组） */
function threadFiles(root: string): string[] {
  const usersDir = path.join(root, 'users');
  const files: string[] = [];
  for (const userId of readDirs(usersDir)) {
    const threadsDir = path.join(userDataDir(root, userId), THREADS_DIR);
    for (const threadId of readDirs(threadsDir)) {
      const file = path.join(threadDir(root, userId, threadId), 'tool-events.jsonl');
      if (fs.existsSync(file)) files.push(file);
    }
  }
  return files;
}

/** 目录下的子目录名（不存在 / 不可读 → 空数组：一处读不到不该让整次回填失败） */
function readDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * 该行**当时落盘的正文文本**：优先内联；正文被外置时按 `{threadId, callId}` 重算路径读取
 * （路径不信任行内数据，与运行时同一口径）。取不到 → `undefined`（该行不动）。
 */
function storedText(file: string, record: Record<string, unknown>): string | undefined {
  const inline = record['inline_content'];
  if (typeof inline === 'string') return inline;

  const callId = record['call_id'];
  if (typeof callId !== 'string' || record['artifact_size'] === undefined) return undefined;

  const threadId = path.basename(path.dirname(file));
  const userData = path.dirname(path.dirname(path.dirname(file)));
  const artifact = path.join(userData, SPACE_TMP, artifactFileName(threadId, callId));
  try {
    return fs.readFileSync(artifact, 'utf8');
  } catch {
    return undefined;
  }
}

/** 回填单个文件；返回是否有改动（干跑时只统计与预览，不写盘） */
function backfillFile(file: string, apply: boolean, stats: Stats, preview: string[]): boolean {
  const raw = fs.readFileSync(file, 'utf8');
  if (raw === '') return false;

  let changed = false;
  // `split/join` 保证"未改动的行逐字节原样"，且天然保留结尾换行
  const outLines = raw.split('\n').map((line) => {
    if (line.trim() === '') return line;

    stats.lines += 1;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      stats.brokenLines += 1; // 坏行原样留下（与运行时"坏行不阻断"同口径）
      return line;
    }

    if (Array.isArray(record['view_links'])) {
      stats.alreadyHasLinks += 1;
      return line;
    }

    const text = storedText(file, record);
    if (text === undefined) {
      stats.noTextAvailable += 1;
      return line;
    }

    const links = extractViewLinks(unwrapMcpEnvelopeText(text) ?? text);
    if (links === undefined) return line;

    record['view_links'] = links;
    changed = true;
    stats.updated += 1;
    if (preview.length < PREVIEW_MAX) {
      preview.push(
        `${path.basename(path.dirname(file))}/${String(record['call_id'])} → ${JSON.stringify(links)}`,
      );
    }
    return JSON.stringify(record);
  });

  if (!changed || !apply) return changed;

  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, outLines.join('\n'), 'utf8');
  fs.renameSync(tmp, file); // 原子替换：失败时原文件不变
  return true;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const root = resolveRoot();
  if (!fs.existsSync(path.join(root, 'users'))) {
    console.error(`找不到运行数据根目录下的 users/：${root}（可用 --root 指定）`);
    process.exitCode = 1;
    return;
  }

  const stats: Stats = {
    files: 0,
    lines: 0,
    updated: 0,
    alreadyHasLinks: 0,
    noTextAvailable: 0,
    brokenLines: 0,
  };
  const preview: string[] = [];

  for (const file of threadFiles(root)) {
    stats.files += 1;
    backfillFile(file, apply, stats, preview);
  }

  console.log(`根目录：${root}`);
  console.log(`扫描：${stats.files} 个 tool-events.jsonl / ${stats.lines} 行记录`);
  console.log(
    `结果：待回填（命中）${stats.updated} 行；已有 view_links ${stats.alreadyHasLinks} 行；` +
      `取不到正文 ${stats.noTextAvailable} 行；坏行 ${stats.brokenLines} 行`,
  );
  if (preview.length > 0)
    console.log(`示例（最多 ${PREVIEW_MAX} 条）：\n  ${preview.join('\n  ')}`);

  if (!apply) {
    console.log('干跑模式：**未写盘**。确认无误后加 `--apply` 执行。');
    return;
  }
  console.log('已写盘（临时文件 + 原子改名）。');
}

main();

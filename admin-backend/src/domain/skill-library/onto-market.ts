import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './archive.js';
import type { SkillInstallResult, SkillLibraryService } from './install.js';
import { parseSkillMetadata } from './metadata.js';

const MARKET_SKILLS_DIR = 'skills';
const MARKET_ENTRY_FILE = 'SKILL.md';

export type OntoMarketSkillStatus = 'new' | 'unchanged' | 'changed' | 'conflict' | 'invalid';

export interface OntoMarketItem {
  scenario: string;
  ontology: string;
  skill_dir: string;
  name: string | null;
  display_name: string | null;
  description: string | null;
  /** 解析失败原因；非 null 时不可导入 */
  invalid_reason: string | null;
  files: Array<{ path: string; size: number }>;
  hash: string;
  status: OntoMarketSkillStatus;
}

export interface OntoMarketListing {
  configured: boolean;
  /** 无法列出时的可读原因（未配置 / 目录不存在 / 不可读）；正常为 null */
  reason: string | null;
  items: OntoMarketItem[];
}

export interface OntoMarketRef {
  scenario: string;
  ontology: string;
  skill: string;
}

function invalid(message: string): ApiError {
  return new ApiError(ERROR_CODES.VALIDATION_FAILED, message);
}

/** 单段路径安全（场景/本体/skill 目录名）：不含分隔符、`..`、控制字符，长度有界 */
function assertSafeSegment(kind: string, value: string): void {
  if (
    value === '' ||
    value.length > 128 ||
    value === '.' ||
    value === '..' ||
    /[/\\]/.test(value) ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw invalid(`${kind} 不合法：${JSON.stringify(value)}`);
  }
}

interface CollectedFile {
  relPath: string;
  content: Buffer;
}

/**
 * 收集技能目录下的全部普通文件（递归）。
 *
 * - 跳过点开头条目与 `__pycache__`（市场侧的构建产物不属于技能内容）；
 * - 符号链接等非常规条目一律不收（与库内 `readFile` 的口径一致）；
 * - 文件数 / 单文件 / 总大小沿用 ZIP 安装的上限（`DEFAULT_ARCHIVE_LIMITS`）。
 */
function collectSkillFiles(
  skillDir: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): CollectedFile[] {
  const out: CollectedFile[] = [];
  let totalBytes = 0;
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > limits.maxDepth) {
      throw invalid(`技能目录嵌套超过上限（${limits.maxDepth} 层）：${prefix}`);
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '__pycache__') continue;
      const abs = path.join(dir, entry.name);
      const rel = prefix !== '' ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = fs.readFileSync(abs);
      if (out.length >= limits.maxFiles) {
        throw invalid(`技能文件数超过上限（${limits.maxFiles}）`);
      }
      if (content.length > limits.maxFileBytes) {
        throw invalid(`单文件超过上限（${limits.maxFileBytes} 字节）：${rel}`);
      }
      totalBytes += content.length;
      if (totalBytes > limits.maxTotalBytes) {
        throw invalid(`技能总大小超过上限（${limits.maxTotalBytes} 字节）`);
      }
      out.push({ relPath: rel, content });
    }
  };
  walk(skillDir, '', 1);
  return out;
}

export function packageHash(files: CollectedFile[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    hash.update(file.relPath);
    hash.update('\0');
    hash.update(file.content);
  }
  return hash.digest('hex');
}

function toEntries(files: CollectedFile[]): Array<{ path: string; size: number }> {
  return files
    .map((file) => ({ path: file.relPath, size: file.content.length }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function scanMarketSkills(root: string): OntoMarketItem[] {
  const items: OntoMarketItem[] = [];
  for (const scenarioEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!scenarioEntry.isDirectory() || scenarioEntry.name.startsWith('.')) continue;
    const scenarioDir = path.join(root, scenarioEntry.name);
    for (const ontologyEntry of fs.readdirSync(scenarioDir, { withFileTypes: true })) {
      if (!ontologyEntry.isDirectory()) continue;
      if (ontologyEntry.name.startsWith('.') || ontologyEntry.name === '__pycache__') continue;
      const skillsDir = path.join(scenarioDir, ontologyEntry.name, MARKET_SKILLS_DIR);
      if (!fs.existsSync(skillsDir)) continue;
      for (const skillEntry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!skillEntry.isDirectory() || skillEntry.name.startsWith('.')) continue;
        const base = {
          scenario: scenarioEntry.name,
          ontology: ontologyEntry.name,
          skill_dir: skillEntry.name,
        };
        try {
          const collected = collectSkillFiles(path.join(skillsDir, skillEntry.name));
          const skillMd = collected.find((file) => file.relPath === MARKET_ENTRY_FILE);
          if (!skillMd) {
            throw invalid('技能目录缺少 SKILL.md');
          }
          const meta = parseSkillMetadata(skillMd.content.toString('utf8'));
          items.push({
            ...base,
            name: meta.name,
            display_name: meta.display_name,
            description: meta.description,
            invalid_reason: null,
            files: toEntries(collected),
            hash: packageHash(collected),
            status: 'new',
          });
        } catch (err) {
          // 单个技能格式无效只影响它自己（标记不可导入），MUST NOT 拖垮整个列表
          items.push({
            ...base,
            name: null,
            display_name: null,
            description: null,
            invalid_reason: err instanceof Error ? err.message : String(err),
            files: [],
            hash: '',
            status: 'invalid',
          });
        }
      }
    }
  }
  return items;
}

export function listOntoMarket(root: string | null, skills: SkillLibraryService): OntoMarketListing {
  if (root === null || root === '') {
    return {
      configured: false,
      reason: '未配置 ONTO_MARKET_DIR（本体市场目录），无法列出可导入的技能',
      items: [],
    };
  }
  if (!fs.existsSync(root)) {
    return { configured: true, reason: `本体市场目录不存在：${root}`, items: [] };
  }
  let items: OntoMarketItem[];
  try {
    items = scanMarketSkills(root);
  } catch (err) {
    return {
      configured: true,
      reason: `本体市场目录不可读：${err instanceof Error ? err.message : String(err)}`,
      items: [],
    };
  }
  const library = new Map(skills.listAll().map((record) => [record.name, record]));
  return {
    configured: true,
    reason: null,
    items: items.map((item) => {
      if (item.status === 'invalid' || item.name === null) return item;
      const record = library.get(item.name);
      if (!record) return { ...item, status: 'new' };
      if (record.origin?.kind !== 'onto_market') return { ...item, status: 'conflict' };
      return { ...item, status: record.origin.hash === item.hash ? 'unchanged' : 'changed' };
    }),
  };
}

export function readMarketSkillPackage(
  root: string,
  ref: OntoMarketRef,
): {
  name: string;
  files: Map<string, Buffer>;
  entries: Array<{ path: string; size: number }>;
  hash: string;
} {
  assertSafeSegment('场景名', ref.scenario);
  assertSafeSegment('本体名', ref.ontology);
  assertSafeSegment('技能目录名', ref.skill);
  const skillDir = path.join(root, ref.scenario, ref.ontology, MARKET_SKILLS_DIR, ref.skill);
  const resolvedRoot = path.resolve(root);
  if (!path.resolve(skillDir).startsWith(resolvedRoot + path.sep)) {
    throw invalid(`路径越界（本体市场目录之外）：${ref.scenario}/${ref.ontology}/${ref.skill}`);
  }
  if (!fs.existsSync(path.join(skillDir, MARKET_ENTRY_FILE))) {
    throw invalid(`技能目录缺少 SKILL.md：${ref.scenario}/${ref.ontology}/skills/${ref.skill}`);
  }
  const collected = collectSkillFiles(skillDir);
  const files = new Map(collected.map((file) => [file.relPath, file.content]));
  const skillMd = files.get(MARKET_ENTRY_FILE)!;
  const meta = parseSkillMetadata(skillMd.toString('utf8'));
  return {
    name: meta.name,
    files,
    entries: toEntries(collected),
    hash: packageHash(collected),
  };
}

/**
 * 从本体市场导入一个技能：读包 → `installFromDirectory`（重名拒绝、原子入驻）。
 *
 * `source` 记录溯源路径（界面"来源"列可见）；`origin.hash` 供后续变化检查。
 */
export function installOntoMarketSkill(
  root: string | null,
  skills: SkillLibraryService,
  ref: OntoMarketRef,
): SkillInstallResult {
  if (root === null || root === '') {
    throw invalid('未配置 ONTO_MARKET_DIR（本体市场目录），无法导入');
  }
  const pkg = readMarketSkillPackage(root, ref);
  return skills.installFromDirectory(pkg.files, {
    source: `onto_market:${ref.scenario}/${ref.ontology}`,
    origin: { kind: 'onto_market', scenario: ref.scenario, ontology: ref.ontology, hash: pkg.hash },
  });
}

export interface OntoMarketUpdateResult extends SkillInstallResult {
  locally_modified: boolean;
}

export function updateOntoMarketSkill(
  root: string | null,
  skills: SkillLibraryService,
  ref: OntoMarketRef,
  options: { confirmModified: boolean },
): OntoMarketUpdateResult {
  if (root === null || root === '') {
    throw invalid('未配置 ONTO_MARKET_DIR（本体市场目录），无法更新');
  }
  const pkg = readMarketSkillPackage(root, ref);

  const record = skills.listAll().find((item) => item.name === pkg.name);
  if (!record) {
    throw invalid(`共享技能库中不存在同名 SKILL：${pkg.name}（更新只针对已导入的技能，请先导入）`);
  }
  if (record.origin?.kind !== 'onto_market') {
    throw new ApiError(
      ERROR_CODES.ADM_SKILL_NAME_TAKEN,
      `库内同名 SKILL 并非来自本体市场：${pkg.name}（市场更新只覆盖市场导入的技能）`,
    );
  }
  if (record.origin.scenario !== ref.scenario || record.origin.ontology !== ref.ontology) {
    throw invalid(
      `库内同名 SKILL 来自市场的其他位置（${record.origin.scenario}/${record.origin.ontology}），` +
        `不接受从 ${ref.scenario}/${ref.ontology} 覆盖更新`,
    );
  }

  const libraryHash = packageHash(
    skills.readFiles(pkg.name).map((file) => ({ relPath: file.path, content: file.content })),
  );
  const locallyModified = libraryHash !== record.origin.hash;
  if (locallyModified && !options.confirmModified) {
    throw new ApiError(
      ERROR_CODES.ADM_SKILL_MODIFIED,
      `库内 SKILL ${pkg.name} 在导入后被人工修改过（内容指纹不符）；` +
        '更新将丢弃这些修改，请显式确认后再重试',
    );
  }

  const result = skills.updateFromDirectory(pkg.files, {
    source: `onto_market:${ref.scenario}/${ref.ontology}`,
    origin: { kind: 'onto_market', scenario: ref.scenario, ontology: ref.ontology, hash: pkg.hash },
  });
  return { ...result, locally_modified: locallyModified };
}

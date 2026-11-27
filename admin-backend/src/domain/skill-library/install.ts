import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { PlatformStore } from '../../infra/platform-store.js';
import { removeTree } from '../../infra/fs-remove.js';
import { extractSkillArchive, type ArchiveLimits, type SkillArchive } from './archive.js';
import { withDisplayNames } from './display-name.js';
import {
  SKILLS_DIR,
  contentHash,
  readSkillFile,
  writeSkillFile,
  type SkillFileContent,
} from './file-access.js';
import { isSafeSkillName, parseSkillMetadata } from './metadata.js';
import { assertSkillEditable, isReadOnlyOrigin, type SkillOrigin } from './origin.js';

const INDEX_REL = `${SKILLS_DIR}/index.json`;

export interface SkillFileWriteResult {
  name: string;
  path: string;
  size: number;
  hash: string;
  updated_at: string;
  revision: number;
}

export interface SkillFileInfo {
  path: string;
  size: number;
}

export interface SkillRecord {
  name: string;
  display_name: string;
  description: string;
  files: SkillFileInfo[];
  source: string;
  origin?: SkillOrigin;
  installed_at: string;
  updated_at: string;
}

export interface SkillDetail extends SkillRecord {
  content: string;
  content_hash: string;
  revision: number;
}

export interface SkillInstallResult {
  name: string;
  display_name: string;
  description: string;
  files: SkillFileInfo[];
  installed_at: string;
  overwritten: boolean;
}

interface SkillIndexDocument {
  items: SkillRecord[];
}

export interface InstallOptions {
  overwrite: boolean;
  source: string;
  limits?: Partial<ArchiveLimits>;
}

export interface SkillLibraryOptions {
  logger?: Logger;
}

export class SkillLibraryService {
  private readonly logger: Logger | undefined;

  constructor(
    private readonly store: PlatformStore,
    options: SkillLibraryOptions = {},
  ) {
    this.logger = options.logger;
  }

  listAll(): SkillRecord[] {
    const doc = this.store.readJson<SkillIndexDocument>(INDEX_REL);
    const items = Array.isArray(doc?.items) ? doc.items : [];
    // 以磁盘实际存在的目录为准，剔除索引里已无实体的残留项（防止"幽灵卡片"）
    const live = items.filter((item) => this.store.exists(this.dirRel(item.name)));
    const { items: named, backfilled } = withDisplayNames(this.store, live);
    const sorted = named.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    if (backfilled) this.writeIndex(sorted);
    return sorted;
  }

  names(): Set<string> {
    return new Set(this.listAll().map((item) => item.name));
  }

  list(page: number): Paged<SkillRecord> {
    return paginate(this.listAll(), page);
  }

  exists(name: string): boolean {
    return this.store.exists(this.dirRel(name));
  }

  read(name: string): SkillDetail {
    const record = this.listAll().find((item) => item.name === name);
    if (!record) throw new ApiError(ERROR_CODES.ADM_SKILL_NOT_FOUND, `SKILL 不存在：${name}`);
    // 直接读字节再解码：`content_hash` 必须与磁盘内容严格对应，否则详情页改正文会被误判为并发冲突
    let raw: Buffer;
    try {
      raw = fs.readFileSync(this.store.abs(`${this.dirRel(name)}/SKILL.md`));
    } catch {
      throw new ApiError(ERROR_CODES.ADM_SKILL_NOT_FOUND, `SKILL ${name} 的 SKILL.md 缺失`);
    }
    return {
      ...record,
      content: raw.toString('utf8'),
      content_hash: contentHash(raw),
      revision: this.store.revision(),
    };
  }

  /**
   * 该 SKILL 的全部文件（相对 `skills/{name}/` 的 posix 路径 → 内容）。
   *
   * 部署物化用：`FR-026` 要求把 SKILL 从库中**物化一份副本**到数字人目录，
   * 且"下次部署按库中版本覆盖"（`SC-009`）——因此必须物化**整包**，
   * 而不只是 `SKILL.md`，否则附件类技能会残缺。
   */
  readFiles(name: string): Array<{ path: string; content: Buffer }> {
    const dir = this.store.abs(this.dirRel(name));
    if (!fs.existsSync(dir)) {
      throw new ApiError(ERROR_CODES.ADM_SKILL_NOT_FOUND, `SKILL 不存在：${name}`);
    }
    const out: Array<{ path: string; content: Buffer }> = [];
    const walk = (current: string, prefix: string): void => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const abs = path.join(current, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(abs, rel);
        else out.push({ path: rel, content: fs.readFileSync(abs) });
      }
    };
    walk(dir, '');
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** 读取技能内**单个文件**（含附件）：见 `file-access.ts` 的安全与体积口径 */
  readFile(name: string, relPath: unknown): SkillFileContent {
    const content = readSkillFile(this.fileDeps(), this.dirRel(name), name, relPath);
    return isReadOnlyOrigin(this.listAll().find((item) => item.name === name)?.origin)
      ? { ...content, editable: false }
      : content;
  }

  writeFile(name: string, relPath: unknown, content: unknown, baseHash: unknown): SkillFileWriteResult {
    assertSkillEditable(name, this.listAll().find((item) => item.name === name)?.origin);

    const outcome = writeSkillFile(this.fileDeps(), this.dirRel(name), name, relPath, content, baseHash);

    const updatedAt = new Date().toISOString();
    const record = this.listAll().find((item) => item.name === name);
    if (record) {
      const files = record.files.map((entry) =>
        entry.path === outcome.path ? { path: entry.path, size: outcome.size } : entry,
      );
      this.writeIndex([
        ...this.listAll().filter((item) => item.name !== name),
        {
          ...record,
          files,
          display_name: outcome.display_name ?? record.display_name,
          description: outcome.description ?? record.description,
          updated_at: updatedAt,
        },
      ]);
    }
    const revision = this.store.bumpRevision();

    this.logger?.info(
      {
        event: 'skill.file.save',
        skill: name,
        path: outcome.path,
        size: outcome.size,
      },
      'SKILL 文件已在线编辑保存',
    );

    return {
      name,
      path: outcome.path,
      size: outcome.size,
      hash: outcome.hash,
      updated_at: updatedAt,
      revision,
    };
  }

  /**
   * 上传 ZIP 安装到共享技能库（`FR-037`~`FR-041`）。
   *
   * **MUST NOT 直接写入某个数字人的技能目录**——安装目标只有共享技能库。
   */
  async install(buffer: Buffer, options: InstallOptions): Promise<SkillInstallResult> {
    const archive = await extractSkillArchive(buffer, options.limits ?? {});
    const metadata = parseSkillMetadata(archive.skillMd);
    if (!isSafeSkillName(metadata.name)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `SKILL 名称不可作为目录名：${metadata.name}`);
    }

    const existing = this.listAll().find((item) => item.name === metadata.name);
    if (existing && !options.overwrite) {
      throw new ApiError(
        ERROR_CODES.ADM_SKILL_NAME_TAKEN,
        `共享技能库中已存在同名 SKILL：${metadata.name}；请显式选择「覆盖」或「取消」`,
      );
    }

    const now = new Date().toISOString();
    const record: SkillRecord = {
      name: metadata.name,
      display_name: metadata.display_name,
      description: metadata.description,
      files: archive.entries,
      source: options.source,
      installed_at: existing?.installed_at ?? now,
      updated_at: now,
    };

    this.commitAtomic(metadata.name, archive);

    const others = this.listAll().filter((item) => item.name !== metadata.name);
    this.writeIndex([...others, record]);
    this.store.bumpRevision();

    return {
      name: record.name,
      display_name: record.display_name,
      description: record.description,
      files: record.files,
      installed_at: record.installed_at,
      overwritten: existing !== undefined,
    };
  }

  installFromDirectory(
    files: Map<string, Buffer>,
    options: { source: string; origin: SkillOrigin },
  ): SkillInstallResult {
    const skillMd = files.get('SKILL.md');
    if (skillMd === undefined) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '技能目录缺少 SKILL.md');
    }
    const metadata = parseSkillMetadata(skillMd.toString('utf8'));
    const existing = this.listAll().find((item) => item.name === metadata.name);
    if (existing) {
      throw new ApiError(
        ERROR_CODES.ADM_SKILL_NAME_TAKEN,
        `共享技能库中已存在同名 SKILL：${metadata.name}；目录导入不提供覆盖，` +
          '如需更新请先删除库内同名技能再重新导入',
      );
    }

    const now = new Date().toISOString();
    const entries = [...files.entries()]
      .map(([relPath, content]) => ({ path: relPath, size: content.length }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const record: SkillRecord = {
      name: metadata.name,
      display_name: metadata.display_name,
      description: metadata.description,
      files: entries,
      source: options.source,
      origin: options.origin,
      installed_at: now,
      updated_at: now,
    };

    this.commitAtomic(metadata.name, {
      prefix: '',
      entries,
      files,
      skillMd: skillMd.toString('utf8'),
    });
    this.writeIndex([...this.listAll().filter((item) => item.name !== metadata.name), record]);
    this.store.bumpRevision();
    this.logger?.info(
      { event: 'skill.installed', skill: metadata.name, source: options.source },
      'SKILL 已从目录安装',
    );

    return {
      name: record.name,
      display_name: record.display_name,
      description: record.description,
      files: entries,
      installed_at: record.installed_at,
      overwritten: false,
    };
  }

  updateFromDirectory(
    files: Map<string, Buffer>,
    options: { source: string; origin: SkillOrigin },
  ): SkillInstallResult {
    const skillMd = files.get('SKILL.md');
    if (skillMd === undefined) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '技能目录缺少 SKILL.md');
    }
    const metadata = parseSkillMetadata(skillMd.toString('utf8'));
    const existing = this.listAll().find((item) => item.name === metadata.name);
    if (!existing) {
      throw new ApiError(
        ERROR_CODES.ADM_SKILL_NOT_FOUND,
        `共享技能库中不存在同名 SKILL：${metadata.name}（更新只针对已导入的技能，请先导入）`,
      );
    }

    const now = new Date().toISOString();
    const entries = [...files.entries()]
      .map(([relPath, content]) => ({ path: relPath, size: content.length }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const record: SkillRecord = {
      name: metadata.name,
      display_name: metadata.display_name,
      description: metadata.description,
      files: entries,
      source: options.source,
      origin: options.origin,
      installed_at: existing.installed_at,
      updated_at: now,
    };

    this.commitAtomic(metadata.name, {
      prefix: '',
      entries,
      files,
      skillMd: skillMd.toString('utf8'),
    });
    this.writeIndex([...this.listAll().filter((item) => item.name !== metadata.name), record]);
    this.store.bumpRevision();
    this.logger?.info(
      { event: 'skill.updated', skill: metadata.name, source: options.source },
      'SKILL 已从目录更新（整包替换）',
    );

    return {
      name: record.name,
      display_name: record.display_name,
      description: record.description,
      files: entries,
      installed_at: record.installed_at,
      overwritten: true,
    };
  }

  remove(name: string): void {
    this.read(name);
    this.store.remove(this.dirRel(name));
    this.writeIndex(this.listAll().filter((item) => item.name !== name));
    this.store.bumpRevision();
  }

  private fileDeps(): { store: PlatformStore } {
    return { store: this.store };
  }

  private dirRel(name: string): string {
    return `${SKILLS_DIR}/${name}`;
  }

  private writeIndex(items: SkillRecord[]): void {
    this.store.writeJson(INDEX_REL, { items } satisfies SkillIndexDocument);
  }

  /**
   * 目录级原子入驻（`FR-040`/`FR-041`）。
   *
   * 临时目录建在**目标目录的同级**（`skills/.tmp-*`），保证 `rename` 不跨设备
   * （与 `research.md` D8 同一约束）；失败时清理临时目录与备份目录，不留残留。
   */
  private commitAtomic(name: string, archive: SkillArchive): void {
    const skillsRoot = this.store.abs(SKILLS_DIR);
    const target = path.join(skillsRoot, name);
    const stamp = `${process.pid}-${Date.now()}`;
    const tmpDir = path.join(skillsRoot, `.tmp-${stamp}`);
    const backupDir = path.join(skillsRoot, `.old-${stamp}`);

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      for (const [rel, content] of archive.files) {
        const dest = path.join(tmpDir, ...rel.split('/'));
        const resolved = path.resolve(dest);
        if (!resolved.startsWith(path.resolve(tmpDir) + path.sep)) {
          throw new ApiError(ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE, `条目越界：${rel}`);
        }
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content);
      }

      const existed = fs.existsSync(target);
      if (existed) fs.renameSync(target, backupDir);
      try {
        fs.renameSync(tmpDir, target);
      } catch (err) {
        if (existed) fs.renameSync(backupDir, target); // 回滚
        throw err;
      }
      if (existed) removeTree(backupDir);
    } catch (err) {
      removeTree(tmpDir);
      removeTree(backupDir);
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
        `SKILL 入驻失败（已回滚，无残留）：${(err as Error).message}`,
      );
    }
  }
}

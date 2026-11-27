import { createHash } from 'node:crypto';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { Logger } from 'pino';
import type { PlatformStore } from '../../infra/platform-store.js';
import { parseOntologyMetadata, type OntologyMetadata } from './metadata.js';

export const ONTO_MARKET_DIR = 'onto_market';
export const ONTOLOGY_FILE = 'ontology.yaml';
/** 行为安全管控文件名（市场与库内同名，**必需**：缺该文件的本体不可导入） */
export const SECURITIES_FILE = 'securities.yaml';
/** 单文件上限：沿用全项目单文件口径 16MB（实测 ontology.yaml 约 30KB、securities.yaml 约 1.5KB） */
export const MAX_ONTOLOGY_BYTES = 16 * 1024 * 1024;

const INDEX_REL = `${ONTO_MARKET_DIR}/index.json`;

export type OntologyIdentity = OntologyMetadata & {
  scenario_name: string;
  ontology_name: string;
};

export interface OntologyStoredRecord {
  metadata: OntologyIdentity;
  ontology_hash: string;
  securities_hash: string;
  installed_at: string;
  updated_at: string;
}

export type OntologyRecord = OntologyStoredRecord;

export interface OntologyDetail extends OntologyRecord {
  content: string;
  size: number;
  securities_content: string;
  securities_size: number;
  revision: number;
}

/** 入库输入：本体正文 + 安全管控文件（导入与更新共用；两个文件均为必需） */
export interface OntologyPackageInput {
  scenario: string;
  ontology_dir: string;
  content: string;
  /** `securities.yaml` 全文（市场侧缺该文件的本体不可导入） */
  securities: string;
}

export interface OntologyWriteResult {
  metadata: OntologyIdentity;
  installed_at: string;
  overwritten: boolean;
}

interface OntologyIndexDocument {
  items: OntologyStoredRecord[];
}

export interface OntologyStoreOptions {
  logger?: Logger;
}

export function contentHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 单段路径安全（场景名 / 本体目录名）：不含分隔符、`..`、控制字符，长度有界。
 *
 * 市场侧的目录名含中文与全角括号（如 `资源（人员和设备）`），这些**合法**——
 * 判据只看"能否安全地当作单个路径段"，不做字符白名单。
 */
export function assertSafeSegment(kind: string, value: string): void {
  if (
    value === '' ||
    value.length > 128 ||
    value === '.' ||
    value === '..' ||
    /[/\\]/.test(value) ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${kind}不合法：${JSON.stringify(value)}`);
  }
}

export class OntologyStore {
  private readonly logger: Logger | undefined;

  constructor(
    private readonly store: PlatformStore,
    options: OntologyStoreOptions = {},
  ) {
    this.logger = options.logger;
  }

  private dirRel(scenario: string, ontologyDir: string): string {
    return `${ONTO_MARKET_DIR}/${scenario}/${ontologyDir}`;
  }

  private storedItems(): OntologyStoredRecord[] {
    const doc = this.store.readJson<OntologyIndexDocument>(INDEX_REL);
    return Array.isArray(doc?.items) ? doc.items : [];
  }

  private static identityOf(
    stored: OntologyStoredRecord,
  ): Pick<OntologyIdentity, 'scenario_name' | 'ontology_name'> | null {
    const scenario = stored.metadata?.scenario_name;
    const ontology = stored.metadata?.ontology_name;
    if (typeof scenario !== 'string' || scenario === '' || typeof ontology !== 'string' || ontology === '') {
      return null;
    }
    return { scenario_name: scenario, ontology_name: ontology };
  }

  private toRecord(stored: OntologyStoredRecord): OntologyRecord | null {
    const identity = OntologyStore.identityOf(stored);
    if (!identity) {
      this.logger?.warn(
        { event: 'ontology.index.dirty', metadata: stored.metadata ?? null },
        '本体索引记录缺少 metadata.scenario_name / ontology_name，已忽略该条',
      );
      return null;
    }
    return { ...stored, metadata: { ...stored.metadata, ...identity } };
  }

  listAll(): OntologyRecord[] {
    const live = this.storedItems()
      .map((item) => this.toRecord(item))
      .filter((record): record is OntologyRecord => record !== null)
      .filter((record) =>
        this.store.exists(this.dirRel(record.metadata.scenario_name, record.metadata.ontology_name)),
      );
    return [...live].sort(
      (a, b) =>
        a.metadata.scenario_name.localeCompare(b.metadata.scenario_name, 'zh-Hans-CN') ||
        a.metadata.ontology_name.localeCompare(b.metadata.ontology_name, 'zh-Hans-CN'),
    );
  }

  list(page: number): Paged<OntologyRecord> {
    return paginate(this.listAll(), page);
  }

  find(scenario: string, ontologyDir: string): OntologyRecord | null {
    assertSafeSegment('场景名', scenario);
    assertSafeSegment('本体名', ontologyDir);
    return (
      this.listAll().find(
        (item) => item.metadata.scenario_name === scenario && item.metadata.ontology_name === ontologyDir,
      ) ?? null
    );
  }

  exists(scenario: string, ontologyDir: string): boolean {
    return this.find(scenario, ontologyDir) !== null;
  }

  read(scenario: string, ontologyDir: string): OntologyDetail {
    const record = this.find(scenario, ontologyDir);
    if (!record) {
      throw new ApiError(ERROR_CODES.ADM_ONTOLOGY_NOT_FOUND, `本体不存在：${scenario}/${ontologyDir}`);
    }
    const dirRel = this.dirRel(scenario, ontologyDir);
    const content = this.store.readText(`${dirRel}/${ONTOLOGY_FILE}`);
    if (content === null) {
      throw new ApiError(
        ERROR_CODES.ADM_ONTOLOGY_NOT_FOUND,
        `本体文件缺失：${scenario}/${ontologyDir}/${ONTOLOGY_FILE}`,
      );
    }
    // 安全管控同为必需文件：缺失说明库内快照不完整（旧口径导入 / 手删），按"文件缺失"报错，
    // 不降级成 `null`——否则界面与部署物化都会把一个残缺本体当成正常本体
    const securities = this.store.readText(`${dirRel}/${SECURITIES_FILE}`);
    if (securities === null) {
      throw new ApiError(
        ERROR_CODES.ADM_ONTOLOGY_NOT_FOUND,
        `本体文件缺失：${scenario}/${ontologyDir}/${SECURITIES_FILE}`,
      );
    }
    return {
      ...record,
      content,
      size: Buffer.byteLength(content, 'utf8'),
      securities_content: securities,
      securities_size: Buffer.byteLength(securities, 'utf8'),
      revision: this.store.revision(),
    };
  }

  /**
   * 首次导入（库内已存在 → `ADM_ONTOLOGY_EXISTS`，界面应改用"更新"）。
   *
   * 目标目录已存在但索引里没有记录（异常残留）时同样拒绝——避免覆盖来源不明的数据。
   */
  install(pkg: OntologyPackageInput): OntologyWriteResult {
    assertSafeSegment('场景名', pkg.scenario);
    assertSafeSegment('本体目录名', pkg.ontology_dir);
    if (
      this.exists(pkg.scenario, pkg.ontology_dir) ||
      this.store.exists(this.dirRel(pkg.scenario, pkg.ontology_dir))
    ) {
      throw new ApiError(
        ERROR_CODES.ADM_ONTOLOGY_EXISTS,
        `本体库中已存在同名本体：${pkg.scenario}/${pkg.ontology_dir}；如需更新请使用「更新」`,
      );
    }
    return this.write(pkg, { overwritten: false });
  }

  update(pkg: OntologyPackageInput): OntologyWriteResult {
    const existing = this.find(pkg.scenario, pkg.ontology_dir);
    if (!existing) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `本体库中不存在该本体：${pkg.scenario}/${pkg.ontology_dir}（请先导入）`,
      );
    }
    return this.write(pkg, { overwritten: true, installedAt: existing.installed_at });
  }

  remove(scenario: string, ontologyDir: string): void {
    this.read(scenario, ontologyDir);
    this.store.remove(this.dirRel(scenario, ontologyDir));
    this.writeIndex(
      this.storedItems().filter((item) => !OntologyStore.sameIdentity(item, scenario, ontologyDir)),
    );
    this.store.bumpRevision();
    this.logger?.info(
      { event: 'ontology.removed', scenario, ontology_dir: ontologyDir },
      '本体已从本体库删除',
    );
  }

  private static sameIdentity(stored: OntologyStoredRecord, scenario: string, ontologyDir: string): boolean {
    return stored.metadata?.scenario_name === scenario && stored.metadata?.ontology_name === ontologyDir;
  }

  private static assertMetadataMatchesPath(
    metadata: OntologyMetadata,
    scenario: string,
    ontologyDir: string,
  ): void {
    if (metadata.scenario_name !== scenario || metadata.ontology_name !== ontologyDir) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `ontology.yaml 的 metadata 与市场路径不一致：` +
          `metadata=${JSON.stringify(metadata.scenario_name)}/${JSON.stringify(metadata.ontology_name)}，` +
          `路径=${scenario}/${ontologyDir}（要求两者完全一致）`,
      );
    }
  }

  private write(
    pkg: OntologyPackageInput,
    options: { overwritten: boolean; installedAt?: string },
  ): OntologyWriteResult {
    const parsed = parseOntologyMetadata(pkg.content);
    OntologyStore.assertMetadataMatchesPath(parsed, pkg.scenario, pkg.ontology_dir);
    const metadata: OntologyIdentity = {
      ...parsed,
      scenario_name: pkg.scenario,
      ontology_name: pkg.ontology_dir,
    };
    const now = new Date().toISOString();
    const stored: OntologyStoredRecord = {
      metadata,
      ontology_hash: contentHash(pkg.content),
      securities_hash: contentHash(pkg.securities),
      installed_at: options.installedAt ?? now,
      updated_at: now,
    };

    const dirRel = this.dirRel(pkg.scenario, pkg.ontology_dir);
    this.store.writeText(`${dirRel}/${ONTOLOGY_FILE}`, pkg.content);
    this.store.writeText(`${dirRel}/${SECURITIES_FILE}`, pkg.securities);
    this.writeIndex([
      ...this.storedItems().filter(
        (item) => !OntologyStore.sameIdentity(item, pkg.scenario, pkg.ontology_dir),
      ),
      stored,
    ]);
    this.store.bumpRevision();
    this.logger?.info(
      {
        event: options.overwritten ? 'ontology.updated' : 'ontology.imported',
        scenario: pkg.scenario,
        ontology_dir: pkg.ontology_dir,
      },
      options.overwritten ? '本体已从本体市场更新' : '本体已从本体市场导入',
    );

    return {
      metadata,
      installed_at: stored.installed_at,
      overwritten: options.overwritten,
    };
  }

  private writeIndex(items: OntologyStoredRecord[]): void {
    this.store.writeJson(INDEX_REL, { items } satisfies OntologyIndexDocument);
  }
}

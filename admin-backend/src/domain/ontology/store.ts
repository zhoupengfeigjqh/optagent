/**
 * 本体库：本体文件的落盘、索引与只读读取（2026-10-03，`FR-058`~`FR-061`）。
 *
 * 与 `skill-library/install.ts` 的关系：**结构同形、口径更窄**。
 * - 同形：一个 `index.json` 索引 + 每条一个目录 + `PlatformStore` 原子写 + 全局 `revision`；
 * - 更窄：本体的**唯一写入口是"从本体市场导入/更新"**（`ontology.ts` 的 market 模块），
 *   平台**不提供任何编辑本体文件的端点**——管理员只能看，改不了（`FR-059`）。
 *
 * 落盘形态（与市场前两级结构一致，`data-model.md` §本体）：
 * ```text
 * .platform-data/onto_market/
 * ├── index.json                        ← 索引（元数据缓存 + 两个变化检测基准 hash）
 * └── {场景名}/{本体名}/
 *     ├── ontology.yaml                 ← 本体正文（必需）
 *     └── securities.yaml               ← 行为安全管控（可选，随本体一并同步）
 * ```
 *
 * **2026-10-03 扩展**：导入范围由「只 `ontology.yaml`」扩为「`ontology.yaml` +
 * `securities.yaml`」——本体侧的行为安全管控（`confirm` / `confirm_content` / `scope`）
 * 是运行面治理配置，平台要展示与比对就得先把文件同步过来。两个文件都按**只读快照**
 * 处理：平台不解析 `securities.yaml` 的语义（原样存取），也不提供任何编辑端点。
 *
 * 一致性与原子性：
 * - 单文件写入走 `store.writeText`（临时文件 → fsync → rename），**不会留半截文件**；
 * - 写入顺序：**先写 `ontology.yaml`，再写索引**——中途中断只会表现为"导入未生效"
 *   （索引里没有记录），不会出现"卡片在、文件缺"的幽灵条目；
 * - `listAll()` 以索引为准，并**按目录实际存在过滤**（与技能库同一口径，防止索引残留）。
 */
import { createHash } from 'node:crypto';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { Logger } from 'pino';
import type { PlatformStore } from '../../infra/platform-store.js';
import {
  ontologyDisplayName,
  parseOntologyMetadata,
  type OntologyMetadata,
} from './metadata.js';

/** 本体库在设计态根下的目录名（与市场根同名，便于对照） */
export const ONTO_MARKET_DIR = 'onto_market';
/** 本体正文文件名（市场与库内同名，**必需**） */
export const ONTOLOGY_FILE = 'ontology.yaml';
/** 行为安全管控文件名（市场与库内同名，**可选**：缺失即该本体未配置安全管控） */
export const SECURITIES_FILE = 'securities.yaml';
/** 单文件上限：沿用全项目单文件口径 16MB（实测 ontology.yaml 约 30KB、securities.yaml 约 1.5KB） */
export const MAX_ONTOLOGY_BYTES = 16 * 1024 * 1024;

const INDEX_REL = `${ONTO_MARKET_DIR}/index.json`;

export interface OntologyRecord {
  /** 市场一级目录名（场景名） */
  scenario: string;
  /** 市场二级目录名（本体目录名）；与本体的存储身份一一对应 */
  ontology_dir: string;
  /** 展示名：`metadata.ontology_name`，缺失时兜底为目录名 */
  name: string;
  metadata: OntologyMetadata;
  /** 来源标记，恒为 `onto_market:{场景}`（本体只能从市场来） */
  source: string;
  /** 导入时 `ontology.yaml` 的 sha256（变化检测基准之一） */
  hash: string;
  /** 导入时 `securities.yaml` 的 sha256；该本体没有该文件时为 `null`（变化检测基准之二） */
  securities_hash: string | null;
  installed_at: string;
  updated_at: string;
}

export interface OntologyDetail extends OntologyRecord {
  /** `ontology.yaml` 全文（只读展示用） */
  content: string;
  size: number;
  /** `securities.yaml` 全文（同一只读视图的第二个文件）；未同步时为 `null` */
  securities_content: string | null;
  /** `securities.yaml` 字节数；未同步时为 0 */
  securities_size: number;
  /** 是否已同步安全管控文件（与 `securities_content !== null` 同义；列表卡片徽标用它） */
  has_securities: boolean;
  revision: number;
}

/** 入库输入：本体正文 + 可选的安全管控文件（导入与更新共用） */
export interface OntologyPackageInput {
  scenario: string;
  ontology_dir: string;
  content: string;
  /** `securities.yaml` 全文；`null` = 市场侧没有该文件（同时清掉库内可能存在的旧副本） */
  securities: string | null;
}

export interface OntologyWriteResult {
  scenario: string;
  ontology_dir: string;
  name: string;
  metadata: OntologyMetadata;
  installed_at: string;
  /** 是否为**更新**（首次导入为 `false`） */
  overwritten: boolean;
}

interface OntologyIndexDocument {
  items: OntologyRecord[];
}

export interface OntologyStoreOptions {
  logger?: Logger;
}

/** 内容指纹（sha256 hex）—— 与索引里的 `hash` 同一算法 */
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
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${kind}不合法：${JSON.stringify(value)}`,
    );
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

  /** 本体目录相对路径 */
  private dirRel(scenario: string, ontologyDir: string): string {
    return `${ONTO_MARKET_DIR}/${scenario}/${ontologyDir}`;
  }

  /** 全部本体（索引为准 + 目录存在校验；排序稳定：场景 → 目录） */
  listAll(): OntologyRecord[] {
    const doc = this.store.readJson<OntologyIndexDocument>(INDEX_REL);
    const items = Array.isArray(doc?.items) ? doc.items : [];
    const live = items
      .filter((item) => this.store.exists(this.dirRel(item.scenario, item.ontology_dir)))
      // 存量记录（扩展前导入的）没有 `securities_hash` → 归一为 `null`：与市场比对时
      // "市场有 securities.yaml 而库内没有"即判 `changed`，一次更新即可补齐同步
      .map((item) => ({ ...item, securities_hash: item.securities_hash ?? null }));
    return [...live].sort(
      (a, b) =>
        a.scenario.localeCompare(b.scenario, 'zh-Hans-CN') ||
        a.ontology_dir.localeCompare(b.ontology_dir, 'zh-Hans-CN'),
    );
  }

  list(page: number): Paged<OntologyRecord> {
    return paginate(this.listAll(), page);
  }

  find(scenario: string, ontologyDir: string): OntologyRecord | null {
    assertSafeSegment('场景名', scenario);
    assertSafeSegment('本体目录名', ontologyDir);
    return (
      this.listAll().find(
        (item) => item.scenario === scenario && item.ontology_dir === ontologyDir,
      ) ?? null
    );
  }

  exists(scenario: string, ontologyDir: string): boolean {
    return this.find(scenario, ontologyDir) !== null;
  }

  /** 详情：记录 + `ontology.yaml` 全文（**只读**；不存在 → `ADM_ONTOLOGY_NOT_FOUND`） */
  read(scenario: string, ontologyDir: string): OntologyDetail {
    const record = this.find(scenario, ontologyDir);
    if (!record) {
      throw new ApiError(
        ERROR_CODES.ADM_ONTOLOGY_NOT_FOUND,
        `本体不存在：${scenario}/${ontologyDir}`,
      );
    }
    const dirRel = this.dirRel(scenario, ontologyDir);
    const content = this.store.readText(`${dirRel}/${ONTOLOGY_FILE}`);
    if (content === null) {
      throw new ApiError(
        ERROR_CODES.ADM_ONTOLOGY_NOT_FOUND,
        `本体文件缺失：${scenario}/${ontologyDir}/${ONTOLOGY_FILE}`,
      );
    }
    // 安全管控为可选文件：没有就是"该本体未配置"，不是错误（界面据此隐藏第二块只读区）
    const securities = this.store.readText(`${dirRel}/${SECURITIES_FILE}`);
    return {
      ...record,
      content,
      size: Buffer.byteLength(content, 'utf8'),
      securities_content: securities,
      securities_size: securities === null ? 0 : Buffer.byteLength(securities, 'utf8'),
      has_securities: securities !== null,
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
    if (this.exists(pkg.scenario, pkg.ontology_dir) || this.store.exists(this.dirRel(pkg.scenario, pkg.ontology_dir))) {
      throw new ApiError(
        ERROR_CODES.ADM_ONTOLOGY_EXISTS,
        `本体库中已存在同名本体：${pkg.scenario}/${pkg.ontology_dir}；如需更新请使用「更新」`,
      );
    }
    return this.write(pkg, { overwritten: false });
  }

  /** 更新（库内不存在 → `VALIDATION_FAILED`，界面应改用"导入"）；`installed_at` 保留首次导入时间 */
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

  /** 删除（`FR-061`）；不存在 → `ADM_ONTOLOGY_NOT_FOUND` */
  remove(scenario: string, ontologyDir: string): void {
    this.read(scenario, ontologyDir);
    this.store.remove(this.dirRel(scenario, ontologyDir));
    this.writeIndex(
      this.listAll().filter(
        (item) => !(item.scenario === scenario && item.ontology_dir === ontologyDir),
      ),
    );
    this.store.bumpRevision();
    this.logger?.info(
      { event: 'ontology.removed', scenario, ontology_dir: ontologyDir },
      '本体已从本体库删除',
    );
  }

  /** 落盘 + 索引（写入顺序：先文件后索引，见文件头注释） */
  private write(
    pkg: OntologyPackageInput,
    options: { overwritten: boolean; installedAt?: string },
  ): OntologyWriteResult {
    const metadata = parseOntologyMetadata(pkg.content);
    const now = new Date().toISOString();
    const record: OntologyRecord = {
      scenario: pkg.scenario,
      ontology_dir: pkg.ontology_dir,
      name: ontologyDisplayName(metadata, pkg.ontology_dir),
      metadata,
      source: `onto_market:${pkg.scenario}`,
      hash: contentHash(pkg.content),
      securities_hash: pkg.securities === null ? null : contentHash(pkg.securities),
      installed_at: options.installedAt ?? now,
      updated_at: now,
    };

    const dirRel = this.dirRel(pkg.scenario, pkg.ontology_dir);
    this.store.writeText(`${dirRel}/${ONTOLOGY_FILE}`, pkg.content);
    if (pkg.securities === null) {
      // 市场侧已没有该文件（或从来没有）：清掉库内旧副本，保证"库内 = 市场快照"
      // 这一不变式；没有旧副本时 remove 是幂等的
      this.store.remove(`${dirRel}/${SECURITIES_FILE}`);
    } else {
      this.store.writeText(`${dirRel}/${SECURITIES_FILE}`, pkg.securities);
    }
    this.writeIndex([
      ...this.listAll().filter(
        (item) => !(item.scenario === pkg.scenario && item.ontology_dir === pkg.ontology_dir),
      ),
      record,
    ]);
    this.store.bumpRevision();
    this.logger?.info(
      {
        event: options.overwritten ? 'ontology.updated' : 'ontology.imported',
        scenario: pkg.scenario,
        ontology_dir: pkg.ontology_dir,
        has_securities: record.securities_hash !== null,
      },
      options.overwritten ? '本体已从本体市场更新' : '本体已从本体市场导入',
    );

    return {
      scenario: record.scenario,
      ontology_dir: record.ontology_dir,
      name: record.name,
      metadata: record.metadata,
      installed_at: record.installed_at,
      overwritten: options.overwritten,
    };
  }

  private writeIndex(items: OntologyRecord[]): void {
    this.store.writeJson(INDEX_REL, { items } satisfies OntologyIndexDocument);
  }
}

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
 * ├── index.json                        ← 索引（metadata + `ontology_hash` / `securities_hash` + 时间）
 * └── {场景名}/{本体名}/
 *     ├── ontology.yaml                 ← 本体正文（必需）
 *     └── securities.yaml               ← 行为安全管控（必需，随本体一并同步）
 * ```
 *
 * **2026-10-03 扩展**：导入范围由「只 `ontology.yaml`」扩为「`ontology.yaml` +
 * `securities.yaml`」——本体侧的行为安全管控（`confirm` / `confirm_content` / `scope`）
 * 是运行面治理配置，平台要展示与比对就得先把文件同步过来。两个文件都按**只读快照**
 * 处理：平台不解析 `securities.yaml` 的语义（原样存取），也不提供任何编辑端点。
 *
 * **2026-10-17（索引去冗余 + 安全管控转必填）**：
 * 1. `index.json` 的条目不再**保存** `scenario` / `ontology_dir` / `name` / `source`——
 *    它们分别是由 `metadata.scenario_name`、`metadata.ontology_name`、
 *    `metadata.ontology_name`、`` `onto_market:${metadata.scenario_name}` `` 派生的值，
 *    落盘即冗余。**但对外响应保持不变**：`toRecord()` 在视图层派生这四个字段
 *    （`contracts/admin-api.md` §10 的响应形状未变，前端无需改动）；
 * 2. 该派生成立的前提是「metadata 与市场目录名完全一致」这条不变式，
 *    由 `write()` 入库时**强校验**，不一致即拒绝导入（否则会拼出指向不存在目录的路径）；
 * 3. `securities.yaml` 由"可选"转为**必填**：市场侧缺该文件的本体不可导入，
 *    库内缺该文件即视为快照不完整（`read()` 报 `ADM_ONTOLOGY_NOT_FOUND`）。
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
import { parseOntologyMetadata, type OntologyMetadata } from './metadata.js';

/** 本体库在设计态根下的目录名（与市场根同名，便于对照） */
export const ONTO_MARKET_DIR = 'onto_market';
/** 本体正文文件名（市场与库内同名，**必需**） */
export const ONTOLOGY_FILE = 'ontology.yaml';
/** 行为安全管控文件名（市场与库内同名，**必需**：缺该文件的本体不可导入） */
export const SECURITIES_FILE = 'securities.yaml';
/** 单文件上限：沿用全项目单文件口径 16MB（实测 ontology.yaml 约 30KB、securities.yaml 约 1.5KB） */
export const MAX_ONTOLOGY_BYTES = 16 * 1024 * 1024;

const INDEX_REL = `${ONTO_MARKET_DIR}/index.json`;

/**
 * 本体身份（2026-10-17）：场景名 + 本体名，**落盘只存在于 `metadata` 里**。
 *
 * 索引不保存 `scenario` / `ontology_dir` / `name` / `source`——它们是同一份数据的副本，
 * 且 `source` 恒为 `onto_market:{场景名}`。身份的唯一来源是
 * `metadata.scenario_name` / `metadata.ontology_name`，入库时由 `write()` 强校验与市场
 * 目录名一致；对外仍在**视图层派生**下发，响应形状对调用方不变（`admin-api.md` §10）。
 *
 * 两个名字在本类型里被收窄为 `string`：`listAll()` 会剔除缺项记录（脏数据），
 * 因此下游（路由、前端）拿到的一定是可寻址的本体，无需逐个判空。
 */
export type OntologyIdentity = OntologyMetadata & {
  scenario_name: string;
  ontology_name: string;
};

/**
 * **落盘形态**（`index.json` 的 `items[]`，2026-10-17 去冗余）。
 *
 * 只有 5 个键：`metadata` 承载身份与展示信息，另两个是变化检测基准 + 时间戳。
 */
export interface OntologyStoredRecord {
  metadata: OntologyIdentity;
  /** 导入时 `ontology.yaml` 的 sha256（变化检测基准之一） */
  ontology_hash: string;
  /** 导入时 `securities.yaml` 的 sha256（变化检测基准之二；必填文件故恒有值） */
  securities_hash: string;
  installed_at: string;
  updated_at: string;
}

/**
 * **对外形态**（API 响应 / 内存查询）= 落盘记录本身（2026-10-17 二次收敛）。
 *
 * 曾短暂在视图层派生 `scenario` / `ontology_dir` / `name` / `source` 四个副本字段，
 * 但它们**只服务于卡片文案与 URL**，而卡片与 URL 都已改用 `metadata` 的两个名字——
 * 副本没有第二个消费者，纯属"同一概念两套叫法"。现一律从 `metadata` 读：
 * `metadata.scenario_name` / `metadata.ontology_name`。
 */
export type OntologyRecord = OntologyStoredRecord;

export interface OntologyDetail extends OntologyRecord {
  /** `ontology.yaml` 全文（只读展示用） */
  content: string;
  size: number;
  /** `securities.yaml` 全文（必填文件，与 `ontology.yaml` 一并同步） */
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

/** 导入/更新结果（`admin-api.md` §10.5 / §10.6）：身份只在 `metadata` 里 */
export interface OntologyWriteResult {
  metadata: OntologyIdentity;
  installed_at: string;
  /** 是否为**更新**（首次导入为 `false`） */
  overwritten: boolean;
}

interface OntologyIndexDocument {
  items: OntologyStoredRecord[];
}

export interface OntologyStoreOptions {
  logger?: Logger;
}

/** 内容指纹（sha256 hex）—— 与索引里的 `ontology_hash` / `securities_hash` 同一算法 */
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

  /** 本体目录相对路径 */
  private dirRel(scenario: string, ontologyDir: string): string {
    return `${ONTO_MARKET_DIR}/${scenario}/${ontologyDir}`;
  }

  /** 索引里的落盘记录（不做任何归一：新结构就是唯一结构） */
  private storedItems(): OntologyStoredRecord[] {
    const doc = this.store.readJson<OntologyIndexDocument>(INDEX_REL);
    return Array.isArray(doc?.items) ? doc.items : [];
  }

  /** 从 `metadata` 取身份（**唯一来源**）；缺项或空串 → `null` */
  private static identityOf(
    stored: OntologyStoredRecord,
  ): Pick<OntologyIdentity, 'scenario_name' | 'ontology_name'> | null {
    const scenario = stored.metadata?.scenario_name;
    const ontology = stored.metadata?.ontology_name;
    if (
      typeof scenario !== 'string' ||
      scenario === '' ||
      typeof ontology !== 'string' ||
      ontology === ''
    ) {
      return null;
    }
    return { scenario_name: scenario, ontology_name: ontology };
  }

  /**
   * 落盘记录 → 视图：只补全/校验 `metadata` 的两个名字，不派生任何副本字段。
   *
   * 缺 `scenario_name` / `ontology_name` 的记录是脏数据：记 warn 后丢弃。
   * 空串同样丢弃——空串会拼出 `onto_market//` 这类目录，`exists()` 恰好为 false
   * 时表现为"卡片无声消失"，正是这条防护要避免的形态。
   */
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

  /** 全部本体（索引为准 + 目录存在校验；排序稳定：场景 → 本体） */
  listAll(): OntologyRecord[] {
    const live = this.storedItems()
      .map((item) => this.toRecord(item))
      .filter((record): record is OntologyRecord => record !== null)
      // 目录存在校验：索引残留（卡片在、文件缺）不参与列表
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
        (item) =>
          item.metadata.scenario_name === scenario && item.metadata.ontology_name === ontologyDir,
      ) ?? null
    );
  }

  exists(scenario: string, ontologyDir: string): boolean {
    return this.find(scenario, ontologyDir) !== null;
  }

  /** 详情：记录 + 两个文件的全文（**只读**；不存在 → `ADM_ONTOLOGY_NOT_FOUND`） */
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
      this.storedItems().filter((item) => !OntologyStore.sameIdentity(item, scenario, ontologyDir)),
    );
    this.store.bumpRevision();
    this.logger?.info(
      { event: 'ontology.removed', scenario, ontology_dir: ontologyDir },
      '本体已从本体库删除',
    );
  }

  /** 落盘记录的持久身份（落盘无独立身份字段，只能从 metadata 读） */
  private static sameIdentity(
    stored: OntologyStoredRecord,
    scenario: string,
    ontologyDir: string,
  ): boolean {
    return stored.metadata?.scenario_name === scenario && stored.metadata?.ontology_name === ontologyDir;
  }

  /**
   * 入库强校验：`metadata` 的场景名 / 本体名必须与市场路径**完全一致**。
   *
   * 索引不再单独保存这两个名字（见 `OntologyStoredRecord`），身份**只**来自 `metadata`；
   * 一旦允许二者不同，就会拼出指向不存在目录的路径——`read()` 报"文件缺失"、
   * `listAll()` 把记录当索引残留过滤掉（表现为本体无声消失）。
   * 故把"不一致"提前成导入期可读拒绝。
   */
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

  /** 落盘 + 索引（写入顺序：先文件后索引，见文件头注释） */
  private write(
    pkg: OntologyPackageInput,
    options: { overwritten: boolean; installedAt?: string },
  ): OntologyWriteResult {
    const parsed = parseOntologyMetadata(pkg.content);
    OntologyStore.assertMetadataMatchesPath(parsed, pkg.scenario, pkg.ontology_dir);
    // 强校验通过后收窄：两个名字就是市场路径的两段，必非空
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

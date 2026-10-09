/**
 * 本体市场（optonto `.data/onto_market`）的**只读**扫描与导入/更新（2026-10-03，`FR-060`）。
 *
 * 市场目录形态（实测）：
 * ```text
 * {root}/{场景名}/{本体名}/ontology.yaml      ← 导入（必需）
 *                          ├── securities.yaml  ← 导入（可选：行为安全管控）
 *                          ├── data_engines.yaml / meta.json
 *                          ├── functions/、ontology_versions/、skills/
 * ```
 *
 * 产品决策（2026-10-03）：导入 **`ontology.yaml` + `securities.yaml`** 两个文件——
 * 前者回答"本体是什么"（卡片 metadata 只存在于此），后者承载**行为安全管控**
 * （`confirm` 需人工确认 / `confirm_content` 弹窗文案 / `scope` 权限范围），
 * 平台的 HITL 配置要与之对齐就得先把它同步进库。其余一律不搬：
 * `functions/`（算法脚本）、`ontology_versions/`（历史版本）、`skills/`（已由共享技能库
 * 独立管理）、`data_engines.yaml` / `meta.json`。
 *
 * 因此：
 * - 「市场是否变化」= **两个文件的 sha256 是否都与库内记录一致**：任一不同即 `changed`。
 *   按整包口径可覆盖两种情况——正文改了、安全管控改了（或从无到有）；
 * - 缺 `securities.yaml` **不是** `invalid`：本体可以不配安全管控（实测 4 个本体里
 *   只有 1 个有该文件），缺失只意味着"库内 `securities_hash = null`"；
 * - 单文件原子写（`store.writeText`）即可，无需目录级改名；
 * - 与技能库不同，这里**没有 `conflict` 状态**：本体没有 ZIP 上传等第二个来源，
 *   库内记录必然来自本市场；也没有"人工修改确认"——本体只读、无本地编辑通道。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import {
  ontologyDisplayName,
  parseOntologyMetadata,
  type OntologyMetadata,
} from './metadata.js';
import {
  MAX_ONTOLOGY_BYTES,
  ONTOLOGY_FILE,
  SECURITIES_FILE,
  assertSafeSegment,
  contentHash,
  type OntologyStore,
  type OntologyWriteResult,
} from './store.js';

export type OntologyMarketStatus = 'new' | 'unchanged' | 'changed' | 'invalid';

export interface OntologyMarketItem {
  scenario: string;
  ontology_dir: string;
  /** `metadata.ontology_name`；解析失败为 `null`（该条不可导入） */
  name: string | null;
  metadata: OntologyMetadata | null;
  /** `ontology.yaml` 字节数 */
  size: number;
  /** `ontology.yaml` 的 sha256（导入后记入库内记录的 `hash`） */
  hash: string;
  /** 市场侧是否有 `securities.yaml`（缺省 = 该本体未配置行为安全管控） */
  has_securities: boolean;
  /** `securities.yaml` 字节数；无该文件为 0 */
  securities_size: number;
  /** `securities.yaml` 的 sha256；无该文件为 `null`（导入后记入库内记录的 `securities_hash`） */
  securities_hash: string | null;
  status: OntologyMarketStatus;
  invalid_reason: string | null;
}

export interface OntologyMarketListing {
  /** 是否配置了 `ONTO_MARKET_DIR` */
  configured: boolean;
  /** 无法列出时的可读原因（未配置 / 目录不存在 / 不可读）；正常为 `null` */
  reason: string | null;
  items: OntologyMarketItem[];
}

export interface OntologyMarketRef {
  scenario: string;
  ontology_dir: string;
}

/** 市场侧单个本体包（导入/更新共用） */
export interface MarketOntologyPackage {
  scenario: string;
  ontology_dir: string;
  name: string;
  metadata: OntologyMetadata;
  content: string;
  size: number;
  hash: string;
  /** `securities.yaml` 全文；市场侧没有该文件为 `null` */
  securities: string | null;
  securitiesHash: string | null;
}

function invalid(message: string): ApiError {
  return new ApiError(ERROR_CODES.VALIDATION_FAILED, message);
}

/** 一个文件的大小与内容（超限即抛可读错） */
function readFileChecked(file: string): { content: string; size: number } {
  const stat = fs.statSync(file);
  if (stat.size > MAX_ONTOLOGY_BYTES) {
    throw invalid(
      `${path.basename(file)} 超过单文件上限（${MAX_ONTOLOGY_BYTES} 字节，实际 ${stat.size}）`,
    );
  }
  return { content: fs.readFileSync(file, 'utf8'), size: stat.size };
}

/** 读取**可选**文件（不存在 → `null`；存在但超限 → 抛可读错） */
function readOptionalFile(file: string): { content: string; size: number } | null {
  return fs.existsSync(file) ? readFileChecked(file) : null;
}

/** 扫描市场：只处理**存在 `ontology.yaml` 的二级目录**；单条格式问题不拖垮整个列表 */
function scanMarketOntologies(root: string): OntologyMarketItem[] {
  const items: OntologyMarketItem[] = [];
  for (const scenarioEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!scenarioEntry.isDirectory() || scenarioEntry.name.startsWith('.')) continue;
    const scenarioDir = path.join(root, scenarioEntry.name);
    for (const ontologyEntry of fs.readdirSync(scenarioDir, { withFileTypes: true })) {
      if (!ontologyEntry.isDirectory()) continue;
      if (ontologyEntry.name.startsWith('.') || ontologyEntry.name === '__pycache__') continue;
      const base = { scenario: scenarioEntry.name, ontology_dir: ontologyEntry.name };
      const dir = path.join(scenarioDir, ontologyEntry.name);
      try {
        const file = path.join(dir, ONTOLOGY_FILE);
        if (!fs.existsSync(file)) {
          throw invalid(`本体目录缺少 ${ONTOLOGY_FILE}`);
        }
        const { content, size } = readFileChecked(file);
        const metadata = parseOntologyMetadata(content);
        // 安全管控可选：缺失即 `has_securities: false`（不是错误，不影响可导入性）
        const securities = readOptionalFile(path.join(dir, SECURITIES_FILE));
        items.push({
          ...base,
          name: ontologyDisplayName(metadata, ontologyEntry.name),
          metadata,
          size,
          hash: contentHash(content),
          has_securities: securities !== null,
          securities_size: securities?.size ?? 0,
          securities_hash: securities === null ? null : contentHash(securities.content),
          status: 'new',
          invalid_reason: null,
        });
      } catch (err) {
        // 单条无效只影响它自己（标 invalid 并给出原因），其余照常可导入（FR-009）
        items.push({
          ...base,
          name: null,
          metadata: null,
          size: 0,
          hash: '',
          has_securities: false,
          securities_size: 0,
          securities_hash: null,
          status: 'invalid',
          invalid_reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return items;
}

/**
 * 列出市场上可导入的本体，并按库内现状标注差异状态：
 * - `new`：库内没有（场景 + 目录名）这条记录，可导入；
 * - `unchanged`：已导入且**两个基准文件**都无变化（不可重复导入）；
 * - `changed`：已导入但任一个基准文件已变化（`ontology.yaml` 或 `securities.yaml`，
 *   含"市场新增了安全管控文件而库内还没有"）→ 可经"更新"整包替换；
 * - `invalid`：市场侧 `ontology.yaml` 缺失/超限/YAML 无效（原因见 `invalid_reason`）。
 */
export function listOntoMarketOntologies(
  root: string | null,
  ontologies: OntologyStore,
): OntologyMarketListing {
  if (root === null || root === '') {
    return {
      configured: false,
      reason: '未配置 ONTO_MARKET_DIR（本体市场目录），无法列出可导入的本体',
      items: [],
    };
  }
  if (!fs.existsSync(root)) {
    return { configured: true, reason: `本体市场目录不存在：${root}`, items: [] };
  }
  let items: OntologyMarketItem[];
  try {
    items = scanMarketOntologies(root);
  } catch (err) {
    return {
      configured: true,
      reason: `本体市场目录不可读：${err instanceof Error ? err.message : String(err)}`,
      items: [],
    };
  }
  return {
    configured: true,
    reason: null,
    items: items.map((item) => {
      if (item.status === 'invalid') return item;
      const record = ontologies.find(item.scenario, item.ontology_dir);
      if (!record) return { ...item, status: 'new' as const };
      // 两个基准文件全部一致才算"无变化"：正文或安全管控任一改动（含新增/移除）都是 changed
      const sameSecurities =
        (record.securities_hash ?? null) === (item.securities_hash ?? null);
      const unchanged = record.hash === item.hash && sameSecurities;
      return { ...item, status: unchanged ? ('unchanged' as const) : ('changed' as const) };
    }),
  };
}

/** 读取市场侧一个本体（导入与更新共用的前置校验） */
export function readMarketOntology(
  root: string | null,
  ref: OntologyMarketRef,
): MarketOntologyPackage {
  if (root === null || root === '') {
    throw invalid('未配置 ONTO_MARKET_DIR（本体市场目录），无法读取本体');
  }
  assertSafeSegment('场景名', ref.scenario);
  assertSafeSegment('本体目录名', ref.ontology_dir);
  const dir = path.join(root, ref.scenario, ref.ontology_dir);
  const resolvedRoot = path.resolve(root);
  if (!path.resolve(dir, ONTOLOGY_FILE).startsWith(resolvedRoot + path.sep)) {
    throw invalid(`路径越界（本体市场目录之外）：${ref.scenario}/${ref.ontology_dir}`);
  }
  const file = path.join(dir, ONTOLOGY_FILE);
  if (!fs.existsSync(file)) {
    throw invalid(`本体市场里没有该本体：${ref.scenario}/${ref.ontology_dir}/${ONTOLOGY_FILE}`);
  }
  const { content, size } = readFileChecked(file);
  const metadata = parseOntologyMetadata(content);
  const securities = readOptionalFile(path.join(dir, SECURITIES_FILE));
  return {
    scenario: ref.scenario,
    ontology_dir: ref.ontology_dir,
    name: ontologyDisplayName(metadata, ref.ontology_dir),
    metadata,
    content,
    size,
    hash: contentHash(content),
    securities: securities?.content ?? null,
    securitiesHash: securities === null ? null : contentHash(securities.content),
  };
}

/** 从本体市场导入：库内已存在 → `ADM_ONTOLOGY_EXISTS`（界面应改用更新） */
export function importOntoMarketOntology(
  root: string | null,
  ontologies: OntologyStore,
  ref: OntologyMarketRef,
): OntologyWriteResult {
  const pkg = readMarketOntology(root, ref);
  return ontologies.install({
    scenario: pkg.scenario,
    ontology_dir: pkg.ontology_dir,
    content: pkg.content,
    securities: pkg.securities,
  });
}

/** 用市场现版本更新：库内不存在 → `VALIDATION_FAILED`（界面应改用导入） */
export function updateOntoMarketOntology(
  root: string | null,
  ontologies: OntologyStore,
  ref: OntologyMarketRef,
): OntologyWriteResult {
  const pkg = readMarketOntology(root, ref);
  return ontologies.update({
    scenario: pkg.scenario,
    ontology_dir: pkg.ontology_dir,
    content: pkg.content,
    securities: pkg.securities,
  });
}

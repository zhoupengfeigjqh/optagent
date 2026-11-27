import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { parseOntologyMetadata, type OntologyMetadata } from './metadata.js';
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
  /** 本体元信息；解析失败为 `null`（该条不可导入，展示时兜底用目录名） */
  metadata: OntologyMetadata | null;
  /** 展示名：取自 `metadata.ontology_name`，解析失败为 `null`（界面兜底用目录名） */
  name: string | null;
  size: number;
  ontology_hash: string;
  securities_size: number;
  securities_hash: string;
  status: OntologyMarketStatus;
  invalid_reason: string | null;
}

export interface OntologyMarketListing {
  configured: boolean;
  /** 无法列出时的可读原因（未配置 / 目录不存在 / 不可读）；正常为 `null` */
  reason: string | null;
  items: OntologyMarketItem[];
}

export interface OntologyMarketRef {
  scenario: string;
  ontology_dir: string;
}

export interface MarketOntologyPackage {
  scenario: string;
  ontology_dir: string;
  metadata: OntologyMetadata;
  content: string;
  size: number;
  ontologyHash: string;
  securities: string;
  securitiesHash: string;
}

function invalid(message: string): ApiError {
  return new ApiError(ERROR_CODES.VALIDATION_FAILED, message);
}

function readFileChecked(file: string): { content: string; size: number } {
  const stat = fs.statSync(file);
  if (stat.size > MAX_ONTOLOGY_BYTES) {
    throw invalid(`${path.basename(file)} 超过单文件上限（${MAX_ONTOLOGY_BYTES} 字节，实际 ${stat.size}）`);
  }
  return { content: fs.readFileSync(file, 'utf8'), size: stat.size };
}

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
        // 两个文件都是本体快照的组成部分：缺 securities.yaml 同属"不完整"，不可导入
        const securitiesFile = path.join(dir, SECURITIES_FILE);
        if (!fs.existsSync(securitiesFile)) {
          throw invalid(`本体目录缺少 ${SECURITIES_FILE}（行为安全管控为必需文件）`);
        }
        const securities = readFileChecked(securitiesFile);
        items.push({
          ...base,
          metadata,
          name: metadata.ontology_name,
          size,
          ontology_hash: contentHash(content),
          securities_size: securities.size,
          securities_hash: contentHash(securities.content),
          status: 'new',
          invalid_reason: null,
        });
      } catch (err) {
        items.push({
          ...base,
          metadata: null,
          name: null,
          size: 0,
          ontology_hash: '',
          securities_size: 0,
          securities_hash: '',
          status: 'invalid',
          invalid_reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return items;
}

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
      // 两个基准文件全部一致才算"无变化"：正文或安全管控任一改动都是 changed
      const sameSecurities = record.securities_hash === item.securities_hash;
      const unchanged = record.ontology_hash === item.ontology_hash && sameSecurities;
      return { ...item, status: unchanged ? ('unchanged' as const) : ('changed' as const) };
    }),
  };
}

export function readMarketOntology(root: string | null, ref: OntologyMarketRef): MarketOntologyPackage {
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
  const securitiesFile = path.join(dir, SECURITIES_FILE);
  if (!fs.existsSync(securitiesFile)) {
    throw invalid(
      `本体市场里缺少该本体的 ${SECURITIES_FILE}（行为安全管控为必需文件）：${ref.scenario}/${ref.ontology_dir}`,
    );
  }
  const securities = readFileChecked(securitiesFile);
  return {
    scenario: ref.scenario,
    ontology_dir: ref.ontology_dir,
    metadata,
    content,
    size,
    ontologyHash: contentHash(content),
    securities: securities.content,
    securitiesHash: contentHash(securities.content),
  };
}

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

import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { PlatformStore } from '../../infra/platform-store.js';
import { anomalyReason, detectAnomalies, type AgentRefSource } from './references.js';
import type { ReferenceIndex } from './reference-index.js';
import { isSafeName } from './naming.js';
import { normalizeScenario, scenarioFields, scenarioUploads, type AgentScenario } from './scenario.js';
import {
  describeSoul,
  fromLegacySoul,
  isSoulDesign,
  normalizeSoulDesign,
  readStoredFocusDepth,
  readStoredHintCount,
  type SoulDesign,
} from './soul-design.js';

export interface AgentDesignDocument {
  name: string;
  soul: SoulDesign;
  enabled_tools: string[];
  mcp_services: string[];
  skills: string[];
  ontologies: string[];
  scenario: AgentScenario;
  updated_at: string;
}

export interface AgentDesignView extends AgentDesignDocument {
  abnormal: boolean;
  abnormal_reason: string | null;
  revision: number;
}

export interface AgentListItem {
  name: string;
  description: string;
  abnormal: boolean;
  abnormal_reason: string | null;
  updated_at: string;
}

const AGENTS_DIR = 'agents';

export function deriveDescription(soul: SoulDesign): string {
  const source = describeSoul(soul);
  if (!source) return '';
  const text = source.replace(/^#+\s*/, '');
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

export interface AgentInputRaw {
  name?: unknown;
  soul?: unknown;
  enabled_tools?: unknown;
  mcp_services?: unknown;
  skills?: unknown;
  ontologies?: unknown;
  scenario?: unknown;
}

export interface ValidateOptions {
  index: ReferenceIndex;
  takenNames: ReadonlySet<string>;
  currentName?: string;
}

export function validateAgentInput(
  raw: AgentInputRaw,
  options: ValidateOptions,
): Omit<AgentDesignDocument, 'updated_at'> {
  const name = typeof raw.name === 'string' ? raw.name : '';
  if (!isSafeName(name)) {
    throw new ApiError(
      ERROR_CODES.ADM_AGENT_NAME_TAKEN,
      `数字人名称非法：${JSON.stringify(raw.name)}（不得为空、不得含路径分隔符或 ".."，且不超过 64 字符）`,
    );
  }
  if (name !== options.currentName && options.takenNames.has(name)) {
    throw new ApiError(ERROR_CODES.ADM_AGENT_NAME_TAKEN, `数字人名称已存在：${name}`);
  }

  const enabledTools = normalizeNameList(raw.enabled_tools, 'enabled_tools');
  const mcpServices = normalizeNameList(raw.mcp_services, 'mcp_services');
  const skills = normalizeNameList(raw.skills, 'skills');
  const ontologies = normalizeOntologyList(raw.ontologies);

  rejectUnknown(enabledTools, options.index.builtinTools, '内置工具', '工具目录（FR-011）');
  rejectUnknown(mcpServices, options.index.mcpServices, 'MCP 服务', '平台 MCP 服务列表（FR-043）');
  rejectUnknown(skills, options.index.skills, 'SKILL', '共享技能库（FR-036）');
  rejectUnknown(ontologies, options.index.ontologies, '本体', '本体库（FR-058）');

  // 已挂载 MCP 服务的可见工具，因此必须放在三类引用校验**之后**
  const soul = normalizeSoulDesign(raw.soul, {
    enabledTools,
    mcpTools: visibleMcpTools(mcpServices, options.index),
  });

  return {
    name,
    soul,
    enabled_tools: enabledTools,
    mcp_services: mcpServices,
    skills,
    ontologies,
    scenario: normalizeScenario(raw.scenario),
  };
}

/** 字符串数组：元素为非空字符串、无重复（重复即拒，避免"配了两遍"的隐性错误） */
function normalizeNameList(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${field} 须为字符串数组`);
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${field} 含空值或非字符串项`);
    }
    if (out.includes(item)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${field} 含重复项：${item}`);
    }
    out.push(item);
  }
  return out;
}

/**
 * 本体引用：元素必须是 `"{场景名}/{本体名}"`（与部署路径的两段一致）。
 *
 * 设计态 JSON 可被手工编辑，故这里独立校验形状：**恰好一个 `/`、两段非空、无重复**。
 * 两段本身是否存在于本体库由 `rejectUnknown` 判定。
 */
function normalizeOntologyList(raw: unknown): string[] {
  const out: string[] = [];
  for (const item of normalizeNameList(raw, 'ontologies')) {
    const ref = item.trim();
    const parts = ref.split('/');
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `ontologies 的元素须为「场景名/本体名」：${JSON.stringify(item)}`,
      );
    }
    if (out.includes(ref)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `ontologies 含重复项：${ref}`);
    }
    out.push(ref);
  }
  return out;
}

function rejectUnknown(values: string[], allowed: ReadonlySet<string>, label: string, source: string): void {
  const missing = values.filter((v) => !allowed.has(v));
  if (missing.length > 0) {
    throw new ApiError(
      ERROR_CODES.ADM_AGENT_INVALID_REF,
      `引用了清单外的${label}：${missing.join('、')}（MUST 从${source}中选择）`,
    );
  }
}

function visibleMcpTools(
  mcpServices: readonly string[],
  index: ReferenceIndex,
): Map<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  for (const service of mcpServices) {
    const visible = index.mcpTools.get(service);
    if (visible) out.set(service, visible);
  }
  return out;
}

export class AgentDesignService {
  constructor(private readonly store: PlatformStore) {}

  static relPath(name: string): string {
    return `${AGENTS_DIR}/${name}.json`;
  }

  listAll(): AgentDesignDocument[] {
    return this.store
      .listDir(AGENTS_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
      .map((name) => this.readOrNull(name))
      .filter((doc): doc is AgentDesignDocument => doc !== null);
  }

  names(): Set<string> {
    return new Set(this.listAll().map((doc) => doc.name));
  }

  refSources(): AgentRefSource[] {
    return this.listAll().map((doc) => ({
      name: doc.name,
      enabled_tools: doc.enabled_tools,
      mcp_services: doc.mcp_services,
      skills: doc.skills,
      ontologies: doc.ontologies ?? [],
    }));
  }

  exists(name: string): boolean {
    return this.store.exists(AgentDesignService.relPath(name));
  }

  readOrNull(name: string): AgentDesignDocument | null {
    const doc = this.store.readJson<AgentDesignDocument>(AgentDesignService.relPath(name));
    return doc ? AgentDesignService.withDefaults(doc) : null;
  }

  private static withDefaults(doc: AgentDesignDocument): AgentDesignDocument {
    return AgentDesignService.withSoulDefaults(
      AgentDesignService.withOntologyDefaults(AgentDesignService.withScenarioDefaults(doc)),
    );
  }

  /**
   * 读取归一化（2026-10-17）：`ontologies` 引入前保存的文档补齐为 `[]`。
   *
   * 必须补：预检与前端都假定该键存在；不补的话存量数字人会在部署时报"字段缺失"，
   * 这是最容易上线即炸的点。
   */
  private static withOntologyDefaults(doc: AgentDesignDocument): AgentDesignDocument {
    return Array.isArray(doc.ontologies) ? doc : { ...doc, ontologies: [] };
  }

  private static withSoulDefaults(doc: AgentDesignDocument): AgentDesignDocument {
    if (!isSoulDesign(doc.soul)) {
      const legacy = typeof doc.soul === 'string' ? doc.soul : '';
      return { ...doc, soul: fromLegacySoul(legacy) };
    }
    const soul = doc.soul;
    const hints = typeof soul.next_action_hints === 'boolean' ? soul.next_action_hints : false;
    const count = readStoredHintCount(soul.next_action_hints_count);
    const focus = typeof soul.intent_focus === 'boolean' ? soul.intent_focus : false;
    const depth = readStoredFocusDepth(soul.intent_focus_depth);
    const inputRewrite = typeof soul.input_rewrite === 'boolean' ? soul.input_rewrite : false;
    const termNormalize = typeof soul.term_normalize === 'boolean' ? soul.term_normalize : false;
    const effectiveHints = hints && focus;
    if (
      effectiveHints === soul.next_action_hints &&
      count === soul.next_action_hints_count &&
      focus === soul.intent_focus &&
      depth === soul.intent_focus_depth &&
      inputRewrite === soul.input_rewrite &&
      termNormalize === soul.term_normalize
    ) {
      return doc;
    }
    return {
      ...doc,
      soul: {
        ...soul,
        next_action_hints: effectiveHints,
        next_action_hints_count: count,
        intent_focus: focus,
        intent_focus_depth: depth,
        input_rewrite: inputRewrite,
        term_normalize: termNormalize,
      },
    };
  }

  private static withScenarioDefaults(doc: AgentDesignDocument): AgentDesignDocument {
    if (!doc.scenario || typeof doc.scenario !== 'object') return doc;
    const next: AgentScenario = {
      ...doc.scenario,
      data_prep_fields: scenarioFields(doc.scenario),
    };
    const uploads = scenarioUploads(doc.scenario);
    if (uploads === undefined) delete next.data_prep_uploads;
    else next.data_prep_uploads = uploads;
    return { ...doc, scenario: next };
  }

  read(name: string): AgentDesignDocument {
    const doc = this.readOrNull(name);
    if (!doc) {
      throw new ApiError(ERROR_CODES.ADM_AGENT_NOT_FOUND, `数字人不存在：${name}`);
    }
    return doc;
  }

  view(name: string, index: ReferenceIndex): AgentDesignView {
    return this.toView(this.read(name), index);
  }

  list(page: number, index: ReferenceIndex): Paged<AgentListItem> {
    const items = this.listAll().map((doc) => {
      const anomalies = detectAnomalies(doc, index);
      return {
        name: doc.name,
        description: deriveDescription(doc.soul),
        abnormal: anomalies.length > 0,
        abnormal_reason: anomalyReason(anomalies),
        updated_at: doc.updated_at,
      };
    });
    return paginate(items, page);
  }

  /** 新建（`FR-015`）；`revision` 缺省时不校验（新建无并发语义） */
  create(raw: AgentInputRaw, index: ReferenceIndex, revision?: number): AgentDesignView {
    const validate = () => validateAgentInput(raw, { index, takenNames: this.names() });
    let created: Omit<AgentDesignDocument, 'updated_at'>;
    let nextRevision: number;

    if (revision === undefined) {
      created = validate();
      this.store.writeJson(AgentDesignService.relPath(created.name), this.toDocument(created));
      nextRevision = this.store.bumpRevision();
    } else {
      const run = this.store.withRevision(revision, () => {
        const value = validate();
        this.store.writeJson(AgentDesignService.relPath(value.name), this.toDocument(value));
        return value;
      });
      created = run.result;
      nextRevision = run.revision;
    }
    return {
      ...this.toDocument(created),
      abnormal: false,
      abnormal_reason: null,
      revision: nextRevision,
    };
  }

  update(name: string, raw: AgentInputRaw, index: ReferenceIndex, revision: number): AgentDesignView {
    this.read(name);
    const taken = this.names();
    taken.delete(name);
    const { result, revision: nextRevision } = this.store.withRevision(revision, () => {
      const value = validateAgentInput(raw, { index, takenNames: taken, currentName: name });
      const doc = this.toDocument(value);
      this.store.writeJson(AgentDesignService.relPath(doc.name), doc);
      if (doc.name !== name) this.store.remove(AgentDesignService.relPath(name));
      return doc;
    });
    const anomalies = detectAnomalies(result, index);
    return {
      ...result,
      abnormal: anomalies.length > 0,
      abnormal_reason: anomalyReason(anomalies),
      revision: nextRevision,
    };
  }

  remove(name: string): void {
    this.read(name);
    this.store.remove(AgentDesignService.relPath(name));
  }

  private toDocument(input: Omit<AgentDesignDocument, 'updated_at'>): AgentDesignDocument {
    return { ...input, updated_at: new Date().toISOString() };
  }

  private toView(doc: AgentDesignDocument, index: ReferenceIndex): AgentDesignView {
    const anomalies = detectAnomalies(doc, index);
    return {
      ...doc,
      abnormal: anomalies.length > 0,
      abnormal_reason: anomalyReason(anomalies),
      revision: this.store.revision(),
    };
  }
}

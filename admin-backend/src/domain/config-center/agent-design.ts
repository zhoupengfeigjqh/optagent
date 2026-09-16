/**
 * 数字人设计态 CRUD 与五类配置校验（`FR-014`~`FR-022`，`data-model.md` §5）。
 *
 * 设计产物是**一个结构化 JSON**（`FR-018`），五类配置齐全：
 * SOUL / 内置工具（TOOL）/ MCP 服务（MCP）/ SKILL / 文件空间场景（scenario）。
 * 三类引用**只按名称引用**，MUST NOT 内嵌连接信息或技能正文（`FR-018`）。
 *
 * 校验口径（保存时）：
 * 1. `soul` 非空（`FR-019`）；
 * 2. 三类引用**只能取统一清单内的对象**，清单外即拒（`FR-019`）；
 * 3. 名称合法且唯一（`FR-015`）；
 * 4. 场景目录清单拒绝空值 / 重复 / 含分隔符 / `..`（`FR-020`）；
 * 5. 保存后 MUST **原样回显**（含换行、标点与条目顺序，`FR-017`）——故本模块
 *    对字符串一律不做 trim/规范化，只在**校验**时用 trim 判空。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { PlatformStore } from '../../infra/platform-store.js';
import { anomalyReason, detectAnomalies, type AgentRefSource } from './references.js';
import type { ReferenceIndex } from './reference-index.js';

export interface AgentScenario {
  scenario: string;
  data_prep_dirs: string[];
}

/** 落盘形态（`.platform-data/agents/{name}.json`） */
export interface AgentDesignDocument {
  name: string;
  soul: string;
  enabled_tools: string[];
  mcp_services: string[];
  skills: string[];
  scenario: AgentScenario;
  updated_at: string;
}

/** 接口返回形态：设计态 + 派生信息（异常态 + 全局 revision） */
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

/** 名称安全：非空、≤64 字符、不含分隔符 / `..` / 控制字符（`FR-015`、下沉到路径安全） */
export function isSafeName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 64) return false;
  if (name === '.' || name === '..') return false;
  if (/[/\\]/.test(name)) return false;
  if (name.includes('..')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return true;
}

/** 场景二级目录名安全：同名称规则，且不允许为空 */
export function isSafeDirName(name: string): boolean {
  return typeof name === 'string' && name.trim() !== '' && isSafeName(name);
}

/**
 * 卡片"用途描述"（`FR-006` 要求卡片含名称与用途描述）。
 *
 * 设计态**没有独立的 description 字段**（`data-model.md` §5、契约 §5.3 均未定义），
 * 因此从 SOUL 首行派生：去掉 Markdown 标题井号、截断到 80 字符。
 * 这是**派生信息**，不落库、不回写。
 */
export function deriveDescription(soul: string): string {
  const firstLine = soul
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return '';
  const text = firstLine.replace(/^#+\s*/, '');
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

export interface AgentInputRaw {
  name?: unknown;
  soul?: unknown;
  enabled_tools?: unknown;
  mcp_services?: unknown;
  skills?: unknown;
  scenario?: unknown;
}

export interface ValidateOptions {
  index: ReferenceIndex;
  /** 已存在的数字人名（除 `currentName` 外） */
  takenNames: ReadonlySet<string>;
  /** 改名场景下的原名（校验"重名"时排除自身） */
  currentName?: string;
}

/**
 * 校验并归一化输入（五类配置）。
 *
 * `soul` 与条目顺序**原样保留**（`FR-017`），只做"是否为空"的判定。
 */
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

  const soul = typeof raw.soul === 'string' ? raw.soul : '';
  if (soul.trim() === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'SOUL 必填且不能为空（FR-019）');
  }

  const enabledTools = normalizeNameList(raw.enabled_tools, 'enabled_tools');
  const mcpServices = normalizeNameList(raw.mcp_services, 'mcp_services');
  const skills = normalizeNameList(raw.skills, 'skills');

  rejectUnknown(enabledTools, options.index.builtinTools, '内置工具', '工具目录（FR-011）');
  rejectUnknown(mcpServices, options.index.mcpServices, 'MCP 服务', '容器编排声明（FR-043）');
  rejectUnknown(skills, options.index.skills, 'SKILL', '共享技能库（FR-036）');

  return {
    name,
    soul,
    enabled_tools: enabledTools,
    mcp_services: mcpServices,
    skills,
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

function rejectUnknown(
  values: string[],
  allowed: ReadonlySet<string>,
  label: string,
  source: string,
): void {
  const missing = values.filter((v) => !allowed.has(v));
  if (missing.length > 0) {
    throw new ApiError(
      ERROR_CODES.ADM_AGENT_INVALID_REF,
      `引用了清单外的${label}：${missing.join('、')}（MUST 从${source}中选择）`,
    );
  }
}

/** 场景：名称非空；目录清单拒绝空值 / 重复 / 含分隔符 / `..`（`FR-020`） */
function normalizeScenario(raw: unknown): AgentScenario {
  const obj = (raw ?? {}) as { scenario?: unknown; data_prep_dirs?: unknown };
  const scenario = typeof obj.scenario === 'string' ? obj.scenario.trim() : '';
  if (scenario === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '文件空间场景名必填且不能为空（FR-020）');
  }
  if (!isSafeName(scenario)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `场景名非法：${scenario}（不得含路径分隔符或 ".."）`,
    );
  }
  if (!Array.isArray(obj.data_prep_dirs)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      '数据准备二级目录清单须为数组（可为空数组，但 MUST NOT 缺字段）',
    );
  }
  const dirs: string[] = [];
  for (const item of obj.data_prep_dirs) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '数据准备二级目录清单含空值');
    }
    if (!isSafeDirName(item)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `数据准备二级目录名非法：${item}（不得含路径分隔符或 ".."）`,
      );
    }
    if (dirs.includes(item)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `数据准备二级目录重复：${item}`);
    }
    dirs.push(item);
  }
  return { scenario, data_prep_dirs: dirs };
}

export class AgentDesignService {
  constructor(private readonly store: PlatformStore) {}

  /** 该数字人的设计态文档相对路径 */
  static relPath(name: string): string {
    return `${AGENTS_DIR}/${name}.json`;
  }

  /** 全部设计态文档（按名称排序，保证分页稳定） */
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
    }));
  }

  exists(name: string): boolean {
    return this.store.exists(AgentDesignService.relPath(name));
  }

  readOrNull(name: string): AgentDesignDocument | null {
    return this.store.readJson<AgentDesignDocument>(AgentDesignService.relPath(name));
  }

  read(name: string): AgentDesignDocument {
    const doc = this.readOrNull(name);
    if (!doc) {
      throw new ApiError(ERROR_CODES.ADM_AGENT_NOT_FOUND, `数字人不存在：${name}`);
    }
    return doc;
  }

  /** 详情视图（含异常态与 revision，契约 §5.3） */
  view(name: string, index: ReferenceIndex): AgentDesignView {
    return this.toView(this.read(name), index);
  }

  /** 卡片列表（`FR-014`；异常实体可辨识且不影响其余） */
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
    const validate = () =>
      validateAgentInput(raw, { index, takenNames: this.names() });
    let created: Omit<AgentDesignDocument, 'updated_at'>;
    let nextRevision: number;

    if (revision === undefined) {
      created = validate();
      this.store.writeJson(
        AgentDesignService.relPath(created.name),
        this.toDocument(created),
      );
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

  /** 编辑（`FR-017`）；改名时删除旧文档并返回新名称 */
  update(
    name: string,
    raw: AgentInputRaw,
    index: ReferenceIndex,
    revision: number,
  ): AgentDesignView {
    this.read(name); // 不存在 → ADM_AGENT_NOT_FOUND
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

  /** 删除（`FR-021`/`FR-022`）——被用户关联时的阻止由上层判定 */
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

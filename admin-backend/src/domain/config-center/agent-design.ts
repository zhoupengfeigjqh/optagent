/**
 * 数字人设计态 CRUD 与五类配置校验（`FR-014`~`FR-022`，`data-model.md` §5）。
 *
 * 设计产物是**一个结构化 JSON**（`FR-018`），五类配置齐全：
 * SOUL / 内置工具（TOOL）/ MCP 服务（MCP）/ SKILL / 文件空间场景（scenario）。
 * 三类引用**只按名称引用**，MUST NOT 内嵌连接信息或技能正文（`FR-018`）。
 *
 * 校验口径（保存时）：
 * 1. `soul` 结构化且各字段合法（004：角色简介 / 首屏欢迎语 / 问题实例 / 主要使命 /
 *    能力标签 / 绝对禁止 / 补充说明 的长度、条数，以及**问题实例的工具引用合法性**）；
 * 2. 三类引用**只能取统一清单内的对象**，清单外即拒（`FR-019`）；
 * 3. 名称合法且唯一（`FR-015`）；
 * 4. 场景（场景名 / 目录清单 / 字段约束）由 `scenario.ts` 单独校验（`FR-020`）；
 * 5. 保存后 MUST **原样回显**（`FR-017`）——**004 起该约定仅约束存量字符串 SOUL 的
 *    读取兼容**：结构化字段参与校验与限额，保存时按 trim 后的值归一化回显。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { paginate, type Paged } from '../paging.js';
import type { PlatformStore } from '../../infra/platform-store.js';
import { anomalyReason, detectAnomalies, type AgentRefSource } from './references.js';
import type { ReferenceIndex } from './reference-index.js';
import { isSafeName } from './naming.js';
import {
  normalizeScenario,
  scenarioFields,
  scenarioUploads,
  type AgentScenario,
} from './scenario.js';
import {
  describeSoul,
  fromLegacySoul,
  isSoulDesign,
  normalizeSoulDesign,
  readStoredHintCount,
  type SoulDesign,
} from './soul-design.js';

/** 落盘形态（`.platform-data/agents/{name}.json`） */
export interface AgentDesignDocument {
  name: string;
  /** 结构化 SOUL（004 起；存量文档读取时自动包装为 `{ mission: 原文, 其余为空 }`） */
  soul: SoulDesign;
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

/**
 * 卡片"用途描述"（`FR-006` 要求卡片含名称与用途描述）。
 *
 * 设计态**没有独立的 description 字段**（`data-model.md` §5、契约 §5.3 均未定义）。
 * 004 起优先取结构化 SOUL 的**角色简介**（`intro`），存量旧文档回退主要使命首行：
 * 去掉 Markdown 标题井号、截断到 80 字符。这是**派生信息**，不落库、不回写。
 */
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

  const enabledTools = normalizeNameList(raw.enabled_tools, 'enabled_tools');
  const mcpServices = normalizeNameList(raw.mcp_services, 'mcp_services');
  const skills = normalizeNameList(raw.skills, 'skills');

  rejectUnknown(enabledTools, options.index.builtinTools, '内置工具', '工具目录（FR-011）');
  rejectUnknown(mcpServices, options.index.mcpServices, 'MCP 服务', '平台 MCP 服务列表（FR-043）');
  rejectUnknown(skills, options.index.skills, 'SKILL', '共享技能库（FR-036）');

  // SOUL 结构化（004）：问题实例关联的工具只能引用**本次提交**的启用内置工具与
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

/**
 * 本次提交的 MCP 服务 → 可见工具（004）。
 *
 * 只收**清单内**的服务：未挂载 / 已删除 / 改名后的服务不放入映射，
 * 交由 SOUL 校验按"未挂载"报错——两种失效（服务不存在 / 工具不在白名单）
 * 给出不同文案，管理员才能一眼看出问题在哪一层。
 */
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
    const doc = this.store.readJson<AgentDesignDocument>(AgentDesignService.relPath(name));
    return doc ? AgentDesignService.withDefaults(doc) : null;
  }

  /** 读取归一化：历史字段补默认值（场景字段 + 结构化 SOUL） */
  private static withDefaults(doc: AgentDesignDocument): AgentDesignDocument {
    return AgentDesignService.withSoulDefaults(AgentDesignService.withScenarioDefaults(doc));
  }

  /**
   * 读取归一化（004）：改造前的 `soul` 是自由文本字符串，
   * 整体包装为 `{ mission: 原文, 其余为空 }` —— 存量文档因此无需迁移脚本即可打开与保存。
   *
   * **2026-10-12（007）**：已结构化的存档文档补齐 `next_action_hints: false`
   * 与 `next_action_hints_count` 的缺省值。
   * 与 `data_prep_fields` 同理——目的是**对外契约恒有该键**，界面不必判空、
   * 部署物化不依赖 `undefined`（`renderSoulMd` 只在 `true` 时写 frontmatter，
   * 故补齐不会让关闭态产物多出任何键）。
   */
  private static withSoulDefaults(doc: AgentDesignDocument): AgentDesignDocument {
    if (!isSoulDesign(doc.soul)) {
      const legacy = typeof doc.soul === 'string' ? doc.soul : '';
      return { ...doc, soul: fromLegacySoul(legacy) };
    }
    // 条数同样补齐（见 `readStoredHintCount`）：键缺失（本次字段引入前的存档）或手改坏了
    // 都收敛到缺省 3，使**对外契约恒有该键**、且与 `emptySoulDesign()` 同形（脏检查不误报）
    const soul = doc.soul;
    const hints = typeof soul.next_action_hints === 'boolean' ? soul.next_action_hints : false;
    const count = readStoredHintCount(soul.next_action_hints_count);
    if (hints === soul.next_action_hints && count === soul.next_action_hints_count) return doc;
    return { ...doc, soul: { ...soul, next_action_hints: hints, next_action_hints_count: count } };
  }

  /**
   * 读取归一化：历史设计态文档（`data_prep_fields` 引入前保存的）补齐为 `{}`。
   *
   * 目的是**对外契约恒有该键**——界面与部署物化因此都不必各自判空。
   *
   * `data_prep_uploads`（2026-10-13）**取舍不同**：它是**可选键**（契约 C1"请求体与响应体皆可省略"），
   * 缺键 ≡ "全部目录用平台默认"，因此这里**不补空对象**——补成 `{}` 会让"未配置"与"显式清空"
   * 在回显上无法区分。仅在键存在且为对象时保留（非对象则丢弃，交由保存校验兜底）。
   */
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

/**
 * SOUL 结构化设计（004 · SOUL 结构化设计）。
 *
 * 设计态的 `soul` 由自由文本升级为结构化对象，物化时**渲染**为 SOUL.md：
 *
 * ```markdown
 * ---                        ← frontmatter：只给聊天前台（展示与引导）
 * soul_version: 1
 * next_action_hints: true    ← 仅开启时出现（007：运行期开关，不是给模型看的内容）
 * next_action_hints_count: 3 ← 与开关同进同出：开启时每轮最多几条提示
 * intro: 角色简介
 * welcome: 首屏欢迎语
 * starters: [ { prompt, tools } ]
 * ---
 * ## 主要使命               ← 正文：真正进模型的系统提示词
 * ## 能力标签
 * ## 绝对禁止
 * ## 补充说明
 * ```
 *
 * **为什么这样切分**：运行环境把 SOUL.md 的**正文**当作 System Prompt 主体
 * （`agent-backend/src/domain/agent-instance.ts` 的 `stripFrontmatter`），
 * frontmatter 天然进不去——于是"给模型看的"与"给用户看的"物理分离，
 * 不需要任何运行时开关，也不需要第二个配置文件。
 *
 * **存量兼容**：改造前的设计态文档 `soul` 是字符串，读取时整体作为 `mission`
 * （见 `fromLegacySoul`）；由于旧文本不含 frontmatter，物化产物与改造前逐字一致。
 */
import { stringify as stringifyYaml } from 'yaml';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

/** 问题实例关联的工具引用 */
export interface SoulStarterTool {
  kind: 'builtin' | 'mcp';
  name: string;
  /** 仅 `kind: 'mcp'` 存在：所属 MCP 服务名 */
  service?: string;
}

/** 问题实例：卡片文本（点击即发送）+ 关联工具（生成隐藏引导） */
export interface SoulStarter {
  prompt: string;
  tools: SoulStarterTool[];
}

/** 结构化 SOUL（设计态权威形态） */
export interface SoulDesign {
  /** 角色简介：数字人切换面板展示（≤100 字） */
  intro: string;
  /** 首屏欢迎语：新建对话页展示（≤100 字） */
  welcome: string;
  /** 问题实例：新建对话页平铺的卡片 */
  starters: SoulStarter[];
  /** 主要使命：进提示词（必填） */
  mission: string;
  /** 能力标签：进提示词 */
  capability_tags: string[];
  /** 绝对禁止：进提示词 */
  forbidden: string[];
  /** 补充说明：进提示词（可选） */
  prompt_extra: string;
  /**
   * 下一步动作提示开关（007，2026-10-12）：**运行期开关**，不是给模型看的内容。
   *
   * - **可选 + 缺省 `false`**：004 期存档的设计态文档没有这个键，读取时必须照常可用
   *   （`isSoulDesign` 不把它算作判据），缺省即"关"，符合 fail-closed；
   * - 物化时**仅在 `true` 时**写进 frontmatter（`renderSoulMd`）：关闭态产物与 007 之前
   *   逐字一致，不给运行环境留下任何新键（"平台是唯一权威源、未搭配的不残留"）；
   * - 它进 frontmatter 而不进正文：正文仍只装提示词，运行环境用 frontmatter 做功能开关
   *   （见文件头"为什么这样切分"）。
   */
  next_action_hints?: boolean;
  /**
   * 下一步动作提示的**条数上限**（007，2026-10-12 补充）：开关开启时每轮最多生成几条。
   *
   * - **正整数，1~`SOUL_LIMITS.nextActionHintsMax`（6）**，缺省 `SOUL_LIMITS.nextActionHintsDefault`（3）；
   * - 仅在开关开启时有意义（管理台里开关关闭时该输入框置灰），物化时**仅开关为 `true` 时**写键；
   * - 与开关同一失败口径：缺省取默认值，非法值（小数 / 0 / 负数 / 越界 / 非数字）**拒绝**保存。
   */
  next_action_hints_count?: number;
}

/**
 * 字段上限。
 *
 * 集中一处定义：**前端输入框的 maxlength / 计数与后端校验共用同一组数字**，
 * 避免"前端允许输入、后端保存失败"的割裂体验。
 */
export const SOUL_LIMITS = {
  /** 角色简介字数 */
  intro: 100,
  /** 首屏欢迎语字数 */
  welcome: 100,
  /** 单条问题内容字数 */
  starterPrompt: 150,
  /** 问题实例条数 */
  starters: 12,
  /** 单条问题实例可关联的工具数 */
  toolsPerStarter: 10,
  /** 主要使命字数 */
  mission: 4000,
  /** 补充说明字数 */
  promptExtra: 4000,
  /**
   * 下一步动作提示条数（007）：下限、上限与缺省。
   * 开关关闭时**保留**管理员填写的数字（只是不物化进产物），再次打开即恢复，不必重填。
   */
  nextActionHintsMin: 1,
  nextActionHintsMax: 6,
  nextActionHintsDefault: 3,
  /** 能力标签 / 绝对禁止的条数 */
  listItems: 20,
  /** 绝对禁止单项字数 */
  listItemLength: 100,
  /** 能力标签单项字数 */
  capabilityTagLength: 20,
} as const;

/** 空结构（新建数字人初值 / 缺省填充） */
export function emptySoulDesign(): SoulDesign {
  return {
    intro: '',
    welcome: '',
    starters: [],
    mission: '',
    capability_tags: [],
    forbidden: [],
    prompt_extra: '',
    // 显式写 `false` 而不是省略：新建数字人默认关闭（007），
    // 且前端 `emptySoulDesign()` 的"脏检查"按逐字段比较，两侧形态必须一致
    next_action_hints: false,
    // 条数同样显式落缺省：脏检查比对的是**整个对象**，少一个键就会与前端初值不等
    next_action_hints_count: SOUL_LIMITS.nextActionHintsDefault,
  };
}

/**
 * 存量兼容：旧版自由文本 → 结构化。
 *
 * 整篇文本作为 `mission`（即**原封不动成为提示词正文**），展示类字段留空——
 * 于是旧数字人部署后的 SOUL.md 与改造前逐字一致，前台则自然退回既有空状态文案。
 */
export function fromLegacySoul(text: string): SoulDesign {
  return { ...emptySoulDesign(), mission: text };
}

/**
 * 是否已是结构化形态（用于读取期判断，避免对旧文档做无谓包装）。
 *
 * **判据只有 `mission` 是字符串**——007 新增的 `next_action_hints` 不参与判定：
 * 004 期存档的文档没有该键，它们 MUST 继续被认作"已结构化"（否则会被当旧文本包装、
 * 把整篇 JSON 塞进 `mission`）。该键的缺省补齐在读取归一化处做（`agent-design.ts`
 * 的 `withSoulDefaults`）。
 */
export function isSoulDesign(raw: unknown): raw is SoulDesign {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return typeof (raw as { mission?: unknown }).mission === 'string';
}

export interface SoulNormalizeOptions {
  /** 本次提交的内置工具（问题实例的工具引用必须在此范围内） */
  enabledTools: readonly string[];
  /**
   * 本次提交的 MCP 服务 → 该服务的**可见工具**（`allowed_tools`）。
   * 调用方只放本次提交的服务，因此"未挂载"与"不在白名单"由两次查表分别判出。
   */
  mcpTools: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * 校验并归一化结构化 SOUL。
 *
 * **全部为拒绝式校验**（不做隐式剔除、不静默合并）：越界的工具引用必须让管理员
 * 看到并自行决定，符合平台"配置不做隐式协商"的一致性口径。
 */
export function normalizeSoulDesign(raw: unknown, options: SoulNormalizeOptions): SoulDesign {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      'SOUL 须为结构化对象（角色简介 / 主要使命 / 首屏欢迎语 / 问题实例 / 能力标签 / 绝对禁止）',
    );
  }
  const record = raw as Record<string, unknown>;
  return {
    intro: readRequiredText(record.intro, '角色简介', SOUL_LIMITS.intro),
    welcome: readRequiredText(record.welcome, '首屏欢迎语', SOUL_LIMITS.welcome),
    starters: readStarters(record.starters, options),
    mission: readRequiredText(record.mission, '主要使命', SOUL_LIMITS.mission),
    capability_tags: readTextList(record.capability_tags, '能力标签', SOUL_LIMITS.capabilityTagLength),
    forbidden: readTextList(record.forbidden, '绝对禁止', SOUL_LIMITS.listItemLength),
    prompt_extra: readOptionalText(record.prompt_extra, '补充说明', SOUL_LIMITS.promptExtra),
    // 007：键缺失 = 关（老表单不带这个键照常保存）；键在但类型不对 = 拒绝
    next_action_hints: readBool(record.next_action_hints, '下一步动作提示开关'),
    // 007：键缺失 = 缺省 3；非整数 / 越界 = 拒绝（不做 round / clamp：静默改数字最难排查）
    next_action_hints_count: readPositiveInt(record.next_action_hints_count),
  };
}

/**
 * 渲染 SOUL.md（物化产物）。
 *
 * - frontmatter 交由 `yaml` 序列化：`lineWidth: 0` 关闭自动折行（中文长句被折行会很难读），
 *   中文默认不转义；
 * - 空值不渲染空壳小节/空键（与 `scenario.json` "不写空壳"同一口径）。
 */
export function renderSoulMd(soul: SoulDesign): string {
  const frontmatter: Record<string, unknown> = { soul_version: 1 };
  // 007：**仅 `true` 时写**（`false` / 缺省都不写键）——关闭态的 SOUL.md 与 007 之前逐字一致，
  // 运行环境也就不会读到"开关存在但为关"的中间形态（未搭配的内容不残留）。
  // 条数紧随其后，**同样只在开启时写**：关闭态产物里连"条数"都不该出现
  if (soul.next_action_hints === true) {
    frontmatter.next_action_hints = true;
    frontmatter.next_action_hints_count = soul.next_action_hints_count ?? SOUL_LIMITS.nextActionHintsDefault;
  }
  if (soul.intro !== '') frontmatter.intro = soul.intro;
  if (soul.welcome !== '') frontmatter.welcome = soul.welcome;
  if (soul.starters.length > 0) {
    frontmatter.starters = soul.starters.map((starter) => ({
      prompt: starter.prompt,
      ...(starter.tools.length > 0
        ? {
            tools: starter.tools.map((tool) =>
              tool.kind === 'builtin'
                ? { kind: 'builtin', name: tool.name }
                : { kind: 'mcp', service: tool.service, name: tool.name },
            ),
          }
        : {}),
    }));
  }

  const sections: string[] = [];
  if (soul.mission !== '') sections.push(`## 主要使命\n\n${soul.mission}`);
  if (soul.capability_tags.length > 0) sections.push(`## 能力标签\n${bulletList(soul.capability_tags)}`);
  if (soul.forbidden.length > 0) sections.push(`## 绝对禁止\n${bulletList(soul.forbidden)}`);
  if (soul.prompt_extra !== '') sections.push(`## 补充说明\n\n${soul.prompt_extra}`);

  const yamlText = stringifyYaml(frontmatter, { lineWidth: 0 });
  return `---\n${yamlText}---\n\n${sections.join('\n\n')}\n`;
}

/**
 * **读取期容错**取提示条数（007）。
 *
 * 与保存期的 `readPositiveInt`（拒绝式）刻意不同：读取的是**自己写下的**存档，
 * 可能来自本字段引入之前（键缺失），也可能被人手改坏（越界 / 非整数）。
 * 这里一律**收敛到合法值**——读盘不该因为一个坏数字让整个数字人打不开，
 * 而"保存期拒绝"已经保证了新写入的值必然合法。
 */
export function readStoredHintCount(raw: unknown): number {
  const { nextActionHintsMin: min, nextActionHintsMax: max, nextActionHintsDefault: fallback } = SOUL_LIMITS;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : fallback;
}

/** 卡片"用途描述"：结构化后取角色简介，缺省回退主要使命首行 */
export function describeSoul(soul: SoulDesign): string {
  if (soul.intro !== '') return soul.intro;
  return (
    soul.mission
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

/* ---------- 内部：逐字段校验 ---------- */

function readRequiredText(raw: unknown, label: string, max: number): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}必填且不能为空`);
  }
  assertLength(text, label, max);
  return text;
}

/**
 * 布尔字段（007）。
 *
 * 三态口径与其它字段一致（**拒绝式校验**）：
 * - 键**缺失**（`undefined`）→ 缺省 `false`：老表单 / 存量文档不带这个键，照常保存；
 * - `true` / `false` → 原样；
 * - 其余（字符串 `"true"`、数字 `1`、`null`…）→ **拒绝**，不做隐式转换——
 *   `"false"` 这类值一旦被当成真值，界面显示关闭而运行环境已开启，属于最难排查的错配。
 */
function readBool(raw: unknown, label: string): boolean {
  if (raw === undefined) return false;
  if (typeof raw !== 'boolean') {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${label}须为布尔值（true / false，当前：${JSON.stringify(raw)}）`,
    );
  }
  return raw;
}

/**
 * 提示条数（007）：正整数，1~`SOUL_LIMITS.nextActionHintsMax`，缺省 `SOUL_LIMITS.nextActionHintsDefault`。
 *
 * **拒绝式**，不做自动纠正（不四舍五入、不 clamp、不把 `"3"` 当 `3`）：
 * 管理员填错时应当立刻看到"保存被拒"，而不是存下一个与界面显示不一致的数字——
 * 这个数字直接决定后台生成几条提示、以及多花多少 token，静默改写属于最难的错配。
 */
function readPositiveInt(raw: unknown): number {
  const { nextActionHintsMin: min, nextActionHintsMax: max, nextActionHintsDefault: fallback } = SOUL_LIMITS;
  // **只有键缺失**才落缺省（与 `readBool` 的开关口径一致）；`null` 是"显式给了个空值"，
  // 按非法拒绝——静默当成缺省会让界面显示的 `null` 与产物里的 `3` 对不上
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `下一步动作提示条数须为 ${min}~${max} 的整数（当前：${JSON.stringify(raw)}）`,
    );
  }
  return raw;
}

function readOptionalText(raw: unknown, label: string, max: number): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}须为字符串`);
  }
  const text = raw.trim();
  if (text === '') return '';
  assertLength(text, label, max);
  return text;
}

function assertLength(text: string, label: string, max: number): void {
  if (text.length > max) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}不得超过 ${max} 字（当前 ${text.length} 字）`);
  }
}

/** 字符串数组：非空、限长、去重（重复即拒，避免"配了两遍"的隐性错误） */
function readTextList(raw: unknown, label: string, maxItemLength: number): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}须为字符串数组`);
  }
  if (raw.length > SOUL_LIMITS.listItems) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${label}最多 ${SOUL_LIMITS.listItems} 项（当前 ${raw.length} 项）`,
    );
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}含空值或非字符串项`);
    }
    const text = item.trim();
    if (text.length > maxItemLength) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `${label}单项不得超过 ${maxItemLength} 字：「${truncate(text)}」`,
      );
    }
    if (out.includes(text)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}含重复项：${text}`);
    }
    out.push(text);
  }
  return out;
}

function readStarters(raw: unknown, options: SoulNormalizeOptions): SoulStarter[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '问题实例须为数组');
  }
  if (raw.length > SOUL_LIMITS.starters) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `问题实例最多 ${SOUL_LIMITS.starters} 条（当前 ${raw.length} 条）`,
    );
  }
  const starters: SoulStarter[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const label = `问题实例第 ${index + 1} 条`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}须为对象`);
    }
    const record = item as Record<string, unknown>;
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
    if (prompt === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}的问题内容必填且不能为空`);
    }
    if (prompt.length > SOUL_LIMITS.starterPrompt) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `${label}的问题内容不得超过 ${SOUL_LIMITS.starterPrompt} 字（当前 ${prompt.length} 字）`,
      );
    }
    if (seen.has(prompt)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}与其它问题实例重复：${truncate(prompt)}`);
    }
    seen.add(prompt);
    starters.push({ prompt, tools: readStarterTools(record.tools, label, options) });
  });
  return starters;
}

function readStarterTools(raw: unknown, label: string, options: SoulNormalizeOptions): SoulStarterTool[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}的关联工具须为数组`);
  }
  if (raw.length > SOUL_LIMITS.toolsPerStarter) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${label}的关联工具最多 ${SOUL_LIMITS.toolsPerStarter} 个（当前 ${raw.length} 个）`,
    );
  }
  const enabledBuiltin = new Set(options.enabledTools);
  const out: SoulStarterTool[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}的关联工具项须为对象`);
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (name === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}的关联工具缺少工具名`);
    }

    if (record.kind === 'builtin') {
      if (!enabledBuiltin.has(name)) {
        throw new ApiError(
          ERROR_CODES.ADM_AGENT_INVALID_REF,
          `${label}关联的内置工具「${name}」未在该数字人启用的内置工具中`,
        );
      }
      if (seen.has(`builtin:${name}`)) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}重复关联了内置工具「${name}」`);
      }
      seen.add(`builtin:${name}`);
      out.push({ kind: 'builtin', name });
      continue;
    }

    if (record.kind === 'mcp') {
      const service = typeof record.service === 'string' ? record.service.trim() : '';
      if (service === '') {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}的 MCP 工具缺少服务名`);
      }
      const visible = options.mcpTools.get(service);
      if (!visible) {
        throw new ApiError(
          ERROR_CODES.ADM_AGENT_INVALID_REF,
          `${label}关联的 MCP 服务「${service}」未挂载在该数字人上`,
        );
      }
      if (!visible.has(name)) {
        throw new ApiError(
          ERROR_CODES.ADM_AGENT_INVALID_REF,
          `${label}关联的 MCP 工具「${service} / ${name}」不在该服务的可见工具白名单内`,
        );
      }
      if (seen.has(`mcp:${service}:${name}`)) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `${label}重复关联了 MCP 工具「${service} / ${name}」`,
        );
      }
      seen.add(`mcp:${service}:${name}`);
      out.push({ kind: 'mcp', service, name });
      continue;
    }

    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `${label}的关联工具 kind 须为 builtin 或 mcp（当前：${JSON.stringify(record.kind)}）`,
    );
  }
  return out;
}

function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function truncate(text: string, max = 20): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

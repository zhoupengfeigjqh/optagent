import { stringify as stringifyYaml } from 'yaml';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import {
  readBool,
  readFocusDepth,
  readOptionalText,
  readPositiveInt,
  readRequiredText,
  readTextList,
  truncate,
} from './soul-fields.js';
import { SOUL_LIMITS } from './soul-limits.js';

export interface SoulStarterTool {
  kind: 'builtin' | 'mcp';
  name: string;
  service?: string;
}

export interface SoulStarter {
  prompt: string;
  tools: SoulStarterTool[];
}

export interface SoulDesign {
  intro: string;
  welcome: string;
  starters: SoulStarter[];
  mission: string;
  capability_tags: string[];
  /** 绝对禁止：进提示词 */
  forbidden: string[];
  prompt_extra: string;
  next_action_hints?: boolean;
  next_action_hints_count?: number;
  intent_focus?: boolean;
  intent_focus_depth?: number;
  input_rewrite?: boolean;
  /**
   * 术语替换开关（027，2026-11-19）：意图聚焦配置区内的独立开关。
   *
   * 018 原本"意图聚焦即替换"，本键把它拆出来（缺省关）：替换会改写用户输入，
   * 属于"用户可见"的行为变化，必须由管理员显式开启并重新部署。
   * 与 `intent_focus` 同样是逻辑与；关闭时值保留、产物不写键。
   */
  term_normalize?: boolean;
  task_planning?: boolean;
}

// 字段上限已外移到 `soul-limits.ts`（渲染 / 读取器 / 前端计数共用同一组数字）；
export { SOUL_LIMITS } from './soul-limits.js';

export function emptySoulDesign(): SoulDesign {
  return {
    intro: '',
    welcome: '',
    starters: [],
    mission: '',
    capability_tags: [],
    forbidden: [],
    prompt_extra: '',
    // 且前端 `emptySoulDesign()` 的"脏检查"按逐字段比较，两侧形态必须一致
    next_action_hints: false,
    next_action_hints_count: SOUL_LIMITS.nextActionHintsDefault,
    intent_focus: false,
    intent_focus_depth: SOUL_LIMITS.focusDepthDefault,
    input_rewrite: false,
    term_normalize: false,
    task_planning: false,
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

export function isSoulDesign(raw: unknown): raw is SoulDesign {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return typeof (raw as { mission?: unknown }).mission === 'string';
}

export interface SoulNormalizeOptions {
  /** 本次提交的内置工具（问题实例的工具引用必须在此范围内） */
  enabledTools: readonly string[];
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
  const intentFocus = readBool(record.intent_focus, '意图聚焦开关');
  return {
    intro: readRequiredText(record.intro, '角色简介', SOUL_LIMITS.intro),
    welcome: readRequiredText(record.welcome, '首屏欢迎语', SOUL_LIMITS.welcome),
    starters: readStarters(record.starters, options),
    mission: readRequiredText(record.mission, '主要使命', SOUL_LIMITS.mission),
    capability_tags: readTextList(record.capability_tags, '能力标签', SOUL_LIMITS.capabilityTagLength),
    forbidden: readTextList(record.forbidden, '绝对禁止', SOUL_LIMITS.listItemLength),
    prompt_extra: readOptionalText(record.prompt_extra, '补充说明', SOUL_LIMITS.promptExtra),
    next_action_hints: readBool(record.next_action_hints, '下一步动作提示开关') && intentFocus,
    next_action_hints_count: readPositiveInt(record.next_action_hints_count),
    intent_focus: intentFocus,
    intent_focus_depth: readFocusDepth(record.intent_focus_depth),
    input_rewrite: readBool(record.input_rewrite, '输入重写开关'),
    term_normalize: readBool(record.term_normalize, '术语替换开关'),
    task_planning: readBool(record.task_planning, '任务规划开关'),
  };
}

export function renderSoulMd(soul: SoulDesign): string {
  const frontmatter: Record<string, unknown> = { soul_version: 1 };
  if (soul.intent_focus === true) {
    frontmatter.intent_focus = true;
  }
  const depth = soul.intent_focus_depth ?? SOUL_LIMITS.focusDepthDefault;
  if (soul.intent_focus === true && depth > 0) {
    frontmatter.intent_focus_depth = depth;
  }
  if (soul.intent_focus === true && soul.input_rewrite === true) {
    frontmatter.input_rewrite = true;
  }
  if (soul.intent_focus === true && soul.term_normalize === true) {
    frontmatter.term_normalize = true;
  }
  if (soul.intent_focus === true && soul.task_planning === true) {
    frontmatter.task_planning = true;
  }
  if (soul.intent_focus === true && soul.next_action_hints === true) {
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

export function readStoredFocusDepth(raw: unknown): number {
  const { focusDepthMin: min, focusDepthMax: max, focusDepthDefault: fallback } = SOUL_LIMITS;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : fallback;
}

export function describeSoul(soul: SoulDesign): string {
  if (soul.intro !== '') return soul.intro;
  return (
    soul.mission
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
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

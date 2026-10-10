/**
 * SOUL.md 结构化解析（004 · SOUL 结构化设计）。
 *
 * SOUL.md 由两半组成：
 * - **YAML frontmatter**（首个 `---` 到下一个 `---`）：只给聊天前台的展示/引导数据
 *   （`intro` 角色简介 / `welcome` 首屏欢迎语 / `starters` 问题实例）；
 * - **正文**：给模型的系统提示词主体（主要使命 / 能力标签 / 绝对禁止 / 补充说明）。
 *
 * 两个消费者，一个解析入口：
 * - `agent-instance.ts`：`stripFrontmatter(soul)` → `systemPrompt`（正文即提示词）；
 * - `agent-catalog.ts`：`parseSoulMeta(soul)` → 接口下发 `intro` / `welcome` / `starters`。
 *
 * **容错口径（存量零破坏）**：
 * - 无 frontmatter（改造前的旧 SOUL.md）→ `stripFrontmatter` 返回原文，
 *   模型看到的 System Prompt 与改造前**逐字一致**；`parseSoulMeta` 返回空值，
 *   前台自然退回既有空状态文案。
 * - frontmatter 有头无尾、YAML 非法、字段类型不符 → 一律按"该项缺失"降级，
 *   **不抛错、不吞掉整篇配置**（配置损坏不应该让数字人不可用）。
 */
import { parse as parseYaml } from 'yaml';

/**
 * frontmatter 定界：**只认文件首行**的 `---`，且**必须有闭合的 `---`**。
 *
 * 三个刻意的约束：
 * - `^` 锚定首行：正文里出现的水平线（`---`）不会被误判为 frontmatter 起点；
 * - 要求闭合：有头无尾时整体不匹配 → 按无 frontmatter 处理（整篇当正文），
 *   避免"半个配置被吃掉"；
 * - 闭合行后要求换行或文件结束：防止把正文中 `---` 开头的分隔行误当闭合。
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** 问题实例关联的工具引用。 */
export type SoulToolRef =
  | { kind: 'builtin'; name: string }
  | { kind: 'mcp'; service: string; name: string };

/** 问题实例：卡片文本（点击即发送）+ 关联工具（生成隐藏引导）。 */
export interface SoulStarter {
  prompt: string;
  tools: SoulToolRef[];
}

/** 只给前台的展示/引导数据。 */
export interface SoulMeta {
  intro: string;
  welcome: string;
  starters: SoulStarter[];
}

/** 空值工厂（每次返回新对象，避免调用方误改共享引用）。 */
export function emptySoulMeta(): SoulMeta {
  return { intro: '', welcome: '', starters: [] };
}

/**
 * 去掉 frontmatter，只留正文（= 进模型的系统提示词主体）。
 *
 * 无 frontmatter 时**原样返回**——这是存量数字人 System Prompt 不变的关键。
 */
export function stripFrontmatter(raw: string): string {
  const match = FRONTMATTER_RE.exec(raw);
  return match ? raw.slice(match[0].length) : raw;
}

/**
 * 解析 frontmatter 中的展示/引导数据。
 *
 * 任何异常（无 frontmatter / YAML 语法错 / 类型不符）都返回空值或跳过该条，
 * 不向上抛错：展示数据缺失只影响前台引导，不应影响对话本身。
 */
export function parseSoulMeta(raw: string): SoulMeta {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return emptySoulMeta();

  let data: unknown;
  try {
    data = parseYaml(match[1]!);
  } catch {
    return emptySoulMeta();
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return emptySoulMeta();
  }

  const record = data as Record<string, unknown>;
  return {
    intro: readText(record.intro),
    welcome: readText(record.welcome),
    starters: readStarters(record.starters),
  };
}

/**
 * 工具**暴露给模型**的名字。
 *
 * 与 `infra/mcp/mcp-tool-adapter.ts:120` 的命名规则同口径：MCP 工具带服务前缀
 * `{server}__{tool}`（避免多服务重名），内置工具即目录中的 `name`。
 * 引导文本必须写"模型实际看到的工具名"，否则模型对不上工具表。
 */
export function toolExposedName(tool: SoulToolRef): string {
  return tool.kind === 'builtin' ? tool.name : `${tool.service}__${tool.name}`;
}

/**
 * 生成问题实例的**隐藏工具引导**（经请求级 `systemExtra` 注入本轮系统提示词，
 * 不改动用户消息正文，故对用户不可见）。
 *
 * 无关联工具时返回空串——调用方据此不下发该字段（避免空引导占用 token）。
 */
export function buildStarterGuidance(tools: readonly SoulToolRef[]): string {
  if (tools.length === 0) return '';
  const names = tools.map(toolExposedName);
  return `本轮请优先使用以下工具完成任务：${names.join('、')}`;
}

/* ---------- 内部：逐字段容错读取 ---------- */

function readText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function readStarters(raw: unknown): SoulStarter[] {
  if (!Array.isArray(raw)) return [];
  const starters: SoulStarter[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const prompt = readText(record.prompt);
    if (prompt === '') continue;
    starters.push({ prompt, tools: readTools(record.tools) });
  }
  return starters;
}

function readTools(raw: unknown): SoulToolRef[] {
  if (!Array.isArray(raw)) return [];
  const tools: SoulToolRef[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = readText(record.name);
    if (name === '') continue;
    if (record.kind === 'builtin') {
      tools.push({ kind: 'builtin', name });
      continue;
    }
    if (record.kind === 'mcp') {
      const service = readText(record.service);
      if (service === '') continue;
      tools.push({ kind: 'mcp', service, name });
    }
  }
  return tools;
}

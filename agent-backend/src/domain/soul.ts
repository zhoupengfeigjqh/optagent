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
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { agentDir } from './dirs.js';

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
  { kind: 'builtin'; name: string } | { kind: 'mcp'; service: string; name: string };

/** 问题实例：卡片文本（点击即发送）+ 关联工具（生成隐藏引导）。 */
export interface SoulStarter {
  prompt: string;
  tools: SoulToolRef[];
}

/**
 * 「下一步动作提示条数」的取值范围与缺省（frontmatter `next_action_hints_count`）。
 *
 * 与 `admin-backend` `SOUL_LIMITS.nextActionHintsMin / Max / Default` **MUST 同步**：
 * 平台侧拒绝越界值，运行侧对坏值只做**收敛**（见 `readHintCount`）——
 * 两侧共用同一组数字，才不会出现"平台存得下、运行读不懂"的断点。
 */
export const NEXT_ACTION_HINTS_MIN = 1;
export const NEXT_ACTION_HINTS_MAX = 6;
export const NEXT_ACTION_HINTS_DEFAULT = 3;

/**
 * 「聚焦阶数」的取值范围与缺省（frontmatter `intent_focus_depth`，019）。
 *
 * 与 `admin-backend` `SOUL_LIMITS.focusDepth*` **MUST 同步**：平台侧拒绝越界值，
 * 运行侧对坏值只做**收敛**（收敛到 0 = 不发散），口径与 `readHintCount` 同构。
 */
export const INTENT_FOCUS_DEPTH_MIN = 0;
export const INTENT_FOCUS_DEPTH_MAX = 2;
export const INTENT_FOCUS_DEPTH_DEFAULT = 0;

/** 只给前台的展示/引导数据。 */
export interface SoulMeta {
  intro: string;
  welcome: string;
  starters: SoulStarter[];
  /**
   * 007：是否开启「下一步动作提示」（frontmatter `next_action_hints`）。
   *
   * 与其它字段的关键差异：它是**功能开关**而非展示数据，故缺省口径是 `false`
   * （fail-closed：写错类型就关闭功能，不会因为一个笔误让数字人额外发起模型调用）。
   */
  nextActionHints: boolean;
  /**
   * 007：开关开启时**每轮最多几条**提示（frontmatter `next_action_hints_count`）。
   *
   * 缺省 / 坏值一律收敛到 `NEXT_ACTION_HINTS_DEFAULT`（3）：条数只影响"多生成几条、
   * 多花多少 token"，读不出来时按缺省走即可，不必像开关那样 fail-closed 到关闭。
   */
  nextActionHintsCount: number;
  /**
   * 013：是否开启「意图聚焦」（frontmatter `intent_focus`）。
   *
   * 同样是**功能开关**：缺键 / 非布尔一律 `false`（fail-closed）。
   * 它不进 System Prompt 正文，只决定运行环境要不要在主模型调用前多发一次判定。
   */
  intentFocus: boolean;
  /**
   * 019：聚焦阶数（frontmatter `intent_focus_depth`），`0~2`。
   *
   * 语义：以 Laya 命中的本体行为所属概念为起点，**单向**向上/向下各走 N 跳
   * （上游进提示词、下游进下一步动作卡片）。缺省 / 坏值一律收敛到 `0`（只聚焦本身），
   * 与 `016` 的既有行为逐字一致。
   */
  intentFocusDepth: number;
  /**
   * 027：是否开启「输入重写」（frontmatter `input_rewrite`）。
   *
   * 与 `intentFocus` 是**逻辑与**关系：平台仅在两个开关皆真时才写该键，
   * 运行侧仍按 fail-closed 读（缺键 / 非布尔 → `false`）。
   * 它是"是否多花一次模型调用"的开关，读不出来必须收敛到关。
   */
  inputRewrite: boolean;
  /**
   * 027：是否开启「术语替换」（frontmatter `term_normalize`）。
   *
   * 018 原本"意图聚焦即替换"，本键把它拆成独立闸门（缺省关）；
   * 同样只有与 `intentFocus` 逻辑与为真时才写进产物。
   */
  termNormalize: boolean;
  /**
   * 028：是否开启「任务规划」（frontmatter `task_planning`）。
   *
   * 与 `intentFocus` 是**逻辑与**关系：任一方为假即零规划调用。
   * 同样 fail-closed（缺键 / 非布尔 → `false`），因为多开一次规划就是多一次模型往返。
   */
  taskPlanning: boolean;
}

/** 空值工厂（每次返回新对象，避免调用方误改共享引用）。 */
export function emptySoulMeta(): SoulMeta {
  return {
    intro: '',
    welcome: '',
    starters: [],
    nextActionHints: false,
    nextActionHintsCount: NEXT_ACTION_HINTS_DEFAULT,
    intentFocus: false,
    intentFocusDepth: INTENT_FOCUS_DEPTH_DEFAULT,
    inputRewrite: false,
    termNormalize: false,
    taskPlanning: false,
  };
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
    // 007：非布尔一律 false（fail-closed，见 SoulMeta.nextActionHints）
    nextActionHints: record.next_action_hints === true,
    // 007：缺省 / 非整数 / 越界一律收敛到缺省（见 SoulMeta.nextActionHintsCount）
    nextActionHintsCount: readHintCount(record.next_action_hints_count),
    // 013：非布尔一律 false（fail-closed，见 SoulMeta.intentFocus）
    intentFocus: record.intent_focus === true,
    // 019：缺省 / 坏值收敛到 0（见 SoulMeta.intentFocusDepth）
    intentFocusDepth: readDepth(record.intent_focus_depth),
    // 027：两个新开关同为 fail-closed（非布尔一律 false，见 SoulMeta）
    inputRewrite: record.input_rewrite === true,
    termNormalize: record.term_normalize === true,
    // 028：任务规划开关，fail-closed（逻辑与的意图聚焦一侧由调用方判）
    taskPlanning: record.task_planning === true,
  };
}

/**
 * 逐次读盘取一个字段（**唯一读盘入口**，四个开关 / 两个参数共用）。
 *
 * 三个口径在这里一次定死，调用方不必各自重复：
 * - **不缓存**：开关随部署整体覆盖，读一次缓存反而会让"部署后不生效"难以解释；
 *   SOUL.md 体积极小，逐次读盘的成本可忽略；
 * - **只有"读不出来"才告警**：文件缺失 / 读取异常。YAML 写坏或键类型不对属于
 *   "读得到但写错了"，按 `parseSoulMeta` 的容错口径静默收敛（否则每个请求刷一条日志）；
 * - **失败取值由调用方给**：开关必须 fail-closed（`false`），而条数 / 阶数读不到时
 *   按缺省收敛（少给建议才是过度降级）——两种语义相反，不能共用同一个兜底值。
 */
function readSoulField<T>(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  pick: (meta: SoulMeta) => T,
  fallback: T,
  failureLabel: string,
  logger?: { warn(msg: string): void },
): T {
  try {
    const raw = fs.readFileSync(
      path.join(agentDir(optAgentRoot, userId, agentName), 'SOUL.md'),
      'utf8',
    );
    return pick(parseSoulMeta(raw));
  } catch (err) {
    logger?.warn(
      `${failureLabel}（user=${userId} agent=${agentName}）：${err instanceof Error ? err.message : String(err)}`,
    );
    return fallback;
  }
}

/**
 * 007：读取某数字人「是否开启下一步动作提示」。
 *
 * **fail-closed**：文件缺失、读取异常、YAML 非法、键缺失/非布尔 → 一律 `false`（读不出来时告警）。
 * 理由：开关只影响"要不要多发一次模型调用"，任何不确定性都应当收敛到关。
 */
export function isNextActionsEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.nextActionHints,
    false,
    '读取数字人开关失败按关闭处理',
    logger,
  );
}

/**
 * 013：读取某数字人「是否开启意图聚焦」。
 *
 * 与 `isNextActionsEnabled` 同口径：**fail-closed**（读不出来一律按关闭），且**逐次读盘**。
 */
export function isIntentFocusEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.intentFocus,
    false,
    '读取意图聚焦开关失败按关闭处理',
    logger,
  );
}

/**
 * 027：读取某数字人「是否开启输入重写」。
 *
 * 与 `isIntentFocusEnabled` 同构（fail-closed、逐次读盘）。调用方（runner）已经先过了
 * 意图聚焦开关，因此这里只读本键即可——平台侧物化时已经保证"聚焦关闭则本键不出现"。
 */
export function isInputRewriteEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.inputRewrite,
    false,
    '读取输入重写开关失败按关闭处理',
    logger,
  );
}

/**
 * 027：读取某数字人「是否开启术语替换」。
 *
 * 同构于 `isInputRewriteEnabled`；`POST /api/term-normalize` 是它**唯一**的判定点。
 */
export function isTermNormalizeEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.termNormalize,
    false,
    '读取术语替换开关失败按关闭处理',
    logger,
  );
}

/**
 * 028：读取某数字人「是否开启任务规划」。
 *
 * 与 `intentFocus` **逻辑与**（FR-001）：聚焦关闭时即使本键为真也不规划——
 * 没有「起点」的规划只会退化成自由发挥。读盘口径与其它开关同构（fail-closed、逐次读盘）。
 */
export function isTaskPlanningEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.taskPlanning && meta.intentFocus,
    false,
    '读取任务规划开关失败按关闭处理',
    logger,
  );
}

/**
 * 019：读取某数字人的「聚焦阶数」。
 *
 * 与开关同口径（**逐次读盘、不缓存**），但失败语义不同：
 * 读不出来返回缺省 `0`（= 不发散）而不是"关闭功能"——开关仍然生效，只是退回 016 行为。
 */
export function intentFocusDepth(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): number {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.intentFocusDepth,
    INTENT_FOCUS_DEPTH_DEFAULT,
    `读取聚焦阶数失败按缺省 ${INTENT_FOCUS_DEPTH_DEFAULT} 处理`,
    logger,
  );
}

/**
 * 007：读取某数字人「每轮最多几条下一步动作提示」。
 *
 * 与开关的**失败口径刻意不同**：读不出来时返回缺省 3，而不是 0——
 * 条数只是"生成几条"的上限，只有开关才是非开即关的硬判据。
 */
export function nextActionHintsCount(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): number {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.nextActionHintsCount,
    NEXT_ACTION_HINTS_DEFAULT,
    `读取数字人提示条数失败按缺省 ${NEXT_ACTION_HINTS_DEFAULT} 处理`,
    logger,
  );
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
 * `toolExposedName` 的**逆**：把模型看到的工具名还原成规范引用。
 *
 * 为什么要逆一次（007 实测发现）：工具清单只以**暴露名**给模型看，模型照抄时
 * `kind` 基本靠猜——真实产物里 MCP 工具被写成 `{ kind: 'builtin', name: 'hd-algorithm__hd_algorithm_input_parser' }`。
 * 这种"名字对、类型错"的引用今天不报错，但任何按 `kind` 解析的消费方都会找不到工具，
 * 且 `tools` 与 `guidance` 不再同源（`guidance` 由暴露名拼出，是对的）。
 *
 * 判据只有命名规则（`{server}__{tool}`，见 `infra/mcp/mcp-tool-adapter.ts:120`）：
 * 含 `__` 且两侧非空 → MCP；否则 → 内置。**与 `toolExposedName` 成对维护**，
 * 两者互为往返（`soul.spec.ts` 用往返断言钉住，改任一侧都会红）。
 */
export function parseExposedName(exposed: string): SoulToolRef {
  const name = exposed.trim();
  const sep = name.indexOf('__');
  // 无分隔符 / 任一侧为空 → 内置工具（内置工具名用 snake_case，不含 `__`）
  if (sep <= 0 || sep >= name.length - 2) return { kind: 'builtin', name };
  return { kind: 'mcp', service: name.slice(0, sep), name: name.slice(sep + 2) };
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

/**
 * 提示条数：**收敛式**读取（与 `parseSoulMeta` 的其它容错字段同口径）。
 *
 * 平台侧（`normalizeSoulDesign`）是拒绝式——非法值根本存不下去；这里面对的是
 * 磁盘上可能被人手改过的文件，收敛到缺省比抛错或取 0 都更符合"少给建议也不能多花 token"。
 */
function readHintCount(raw: unknown): number {
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= NEXT_ACTION_HINTS_MIN &&
    raw <= NEXT_ACTION_HINTS_MAX
  ) {
    return raw;
  }
  return NEXT_ACTION_HINTS_DEFAULT;
}

/**
 * 聚焦阶数：**收敛式**读取（与 `readHintCount` 同口径）。
 *
 * 平台侧是拒绝式（越界值存不下去）；这里面对磁盘上可能被手改的文件，
 * 收敛到 0（不发散）比抛错或放大都安全——阶数只影响"多带几条上下文"，
 * 读错时宁可退回 016 的既有行为。
 */
function readDepth(raw: unknown): number {
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= INTENT_FOCUS_DEPTH_MIN &&
    raw <= INTENT_FOCUS_DEPTH_MAX
  ) {
    return raw;
  }
  return INTENT_FOCUS_DEPTH_DEFAULT;
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

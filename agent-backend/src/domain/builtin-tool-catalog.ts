/**
 * 内置工具目录（`plan.md` R1，`contracts/runtime-api-delta.md` §1）。
 *
 * 改造前的两处问题：
 * 1. 工具元数据**内联在 `builtin-tools.ts` 的 `if (on(...))` 分支里**——
 *    清单是隐式的（靠分支存在与否表达），**无可枚举目录**；
 * 2. 说明文案是**运行期字符串拼接**，模板不可读，平台无法只读投影
 *    （`FR-011`、`FR-012`）。
 *
 * 本模块把元数据抽为**纯数据目录**（无副作用、可单测），并承担**单一来源**：
 * `infra/builtin-tools.ts` 消费它装配 `AgentTool`，`domain/agent-instance.ts`
 * 的 `BUILTIN_TOOL_NAMES` 也从它派生——消除两处重复。
 *
 * **不变式**（由 `tests/unit/builtin-tool-catalog.spec.ts` 守住）：
 * 用现状的运行期取值渲染本目录后，结果 MUST 与改造前 `buildBuiltinTools`
 * 产出的 `description` 与 `parameters` **逐字相等**。改造**只改变元数据的组织方式，
 * 不改变任何对模型可见的文本**。
 */

export interface BuiltinToolCatalogEntry {
  name: string;
  label: string;
  /** 含占位符的用途说明模板（`FR-012`） */
  description_template: string;
  /** JSON Schema 形态的入参说明（字符串中同样可含占位符） */
  parameters: Record<string, unknown>;
  /** 是否具备写能力（`FR-011`） */
  writable: boolean;
}

/**
 * 模板占位符取值（`data-model.md` §2 的占位符约定）。
 *
 * `{可用目录}` / `{示例路径}` / `{会话标识}` / `{临时空间}` 为约定项；
 * `{首个目录}` 为 `list_dir` 的目录示例单独引入（原实现取的是
 * 「可用目录首项，不带 `/示例.csv` 后缀」，与 `{示例路径}` 不同值）。
 */
export interface TemplateValues {
  可用目录: string;
  示例路径: string;
  首个目录: string;
  会话标识: string;
  临时空间: string;
}

/** 内置工具目录（本期 5 项） */
export const BUILTIN_TOOL_CATALOG: readonly BuiltinToolCatalogEntry[] = [
  {
    name: 'read_file',
    label: '读取文件',
    description_template:
      '读取用户空间（数据准备/共享空间/临时空间）下的文件内容。支持 .csv/.xlsx/.txt/.json/.pdf/.md/.log；' +
      'xlsx 自动转 CSV，pdf 提取文本层。大文件返回截断内容，可用 offset 继续分段读取。' +
      '参数 path 为相对空间的路径，如 "{示例路径}"。',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: '相对路径，如 "{示例路径}"' },
        offset: { type: 'number', description: '字节偏移（续读截断内容时用）' },
        limit: { type: 'number', description: '本次最多返回字节数' },
      },
    },
    writable: false,
  },
  {
    name: 'write_file',
    label: '写入临时文件',
    description_template:
      '把内容写入临时空间，文件名会自动要求以 "{会话标识}_" 开头。' +
      '数据准备与共享空间为只读，写入会被拒绝。写成功后可用路径 临时空间/{filename} 告知用户下载。',
    parameters: {
      type: 'object',
      required: ['filename', 'content'],
      properties: {
        filename: { type: 'string', description: '文件名，必须以 {会话标识}_ 开头' },
        content: { type: 'string', description: '文件内容（utf8 文本）' },
      },
    },
    writable: true,
  },
  {
    name: 'list_dir',
    label: '列目录',
    description_template: '列出指定目录的文件（名称/大小/更新时间）。目录限：{可用目录}。',
    parameters: {
      type: 'object',
      required: ['dir'],
      properties: {
        dir: { type: 'string', description: '目录路径，如 "{首个目录}"' },
      },
    },
    writable: false,
  },
  {
    name: 'grep_files',
    label: '检索文件内容',
    description_template:
      '在文本类文件（.csv/.txt/.json/.md/.log）中按正则检索关键词；xlsx/pdf 会被跳过（请改用 read_file）。' +
      '可指定目录，缺省检索全部开放目录。',
    parameters: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: '检索词或正则表达式' },
        dir: { type: 'string', description: '限定目录（可选）' },
      },
    },
    writable: false,
  },
  {
    name: 'calculator',
    label: '计算器',
    description_template:
      '计算数学表达式。支持 + - * / % ^、括号、sqrt/abs/round/floor/ceil/min/max/pow 函数与常量 pi/e。',
    parameters: {
      type: 'object',
      required: ['expression'],
      properties: {
        expression: { type: 'string', description: '数学表达式，如 "(1+2)*3"' },
      },
    },
    writable: false,
  },
];

/** 可枚举的内置工具目录（`FR-011` 的唯一来源） */
export function listBuiltinTools(): BuiltinToolCatalogEntry[] {
  return BUILTIN_TOOL_CATALOG.map((entry) => ({
    ...entry,
    parameters: entry.parameters,
  }));
}

/** 按名称查找（不存在返回 `undefined`） */
export function findBuiltinTool(name: string): BuiltinToolCatalogEntry | undefined {
  return BUILTIN_TOOL_CATALOG.find((entry) => entry.name === name);
}

/** 派生全部工具名（供 `agent-instance.ts` 的 `BUILTIN_TOOL_NAMES` 使用，消除重复来源） */
export function builtinToolNames(): string[] {
  return BUILTIN_TOOL_CATALOG.map((entry) => entry.name);
}

/**
 * 渲染模板中的占位符（供 `buildBuiltinTools` 复用）。
 *
 * **未登记的 `{...}` 原样保留**——例如 `write_file` 说明里的
 * `临时空间/{filename}` 是给模型看的字面量，不是占位符。
 */
export function renderTemplate(template: string, values: Partial<TemplateValues>): string {
  return template.replace(/\{([^{}]+)\}/g, (match, key: string) => {
    const value = values[key as keyof TemplateValues];
    return value === undefined ? match : value;
  });
}

/** 递归渲染对象/数组中的所有字符串（`parameters` 内的说明同样含占位符） */
export function renderDeep<T>(value: T, values: Partial<TemplateValues>): T {
  if (typeof value === 'string') {
    return renderTemplate(value, values) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderDeep(item, values)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderDeep(item, values);
    }
    return out as unknown as T;
  }
  return value;
}

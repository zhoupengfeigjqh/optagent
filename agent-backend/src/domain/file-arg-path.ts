/**
 * `file_args` 的**取值路径**（2026-09-16）。
 * 与 `admin-backend/src/domain/mcp/file-arg-path.ts` **同构**（平台侧只做语法校验，
 * 服务端独有改写引擎）——保证"能保存的配置"与"能生效的配置"是同一个判据。
 *
 * 起因（真实对接）：对方 MCP 服务的入参是**对象数组**——
 * `items: [{ businessType, excelFileUrl }]`（`parse_excel_files`），
 * 要铸造的是数组元素里的字段。而此前 `file_args` 的键被当作**顶层参数名**、
 * 值必须是字符串，于是这类声明"配了也不生效"：
 * 数组值不满足 `typeof value === 'string'` 被静默跳过；换成 `items.excelFileUrl`
 * 也取不到值（`items` 是数组，没有 `.excelFileUrl`）。
 *
 * 因此把键从"参数名"泛化为**取值路径**：
 *
 * | 写法 | 含义 |
 * |---|---|
 * | `image` | 顶层参数（与既有配置完全等价，向后兼容） |
 * | `files[]` | 字符串数组 `files` 的**每个元素** |
 * | `items[].excelFileUrl` | 数组 `items` 的**每个元素**的 `excelFileUrl` |
 * | `a.b` / `groups[].files[].url` | 任意层级的对象/数组组合 |
 *
 * 语法刻意保持最小：分段用 `.`，数组写 `[]`（"每个元素"），**不支持下标**——
 * "第 0 项要铸造"没有业务含义，且下标写法会让配置随数据形状漂移（数组少一项就全错位）。
 */

export interface FileArgStep {
  /** 对象键名 */
  key: string;
  /** 该键的值是数组，路径的其余部分应用于**每个元素** */
  array: boolean;
}

/** 提示文案里给用户看的写法说明（错误信息与界面共用同一句） */
export const FILE_ARG_PATH_HINT = '参数名或取值路径（如 image、items[].excelFileUrl）';

/**
 * 单段：键名 + 可选的 `[]`。键名不得含 `.`、`[`、`]`——
 * 它们是路径分隔符，含进去就无法无歧义地切分（这类键名在 JSON 里也是反模式）。
 */
const SEGMENT = /^([^.[\]]+)(\[\])?$/;

/**
 * 解析取值路径；语法不合法返回 `null`（由调用方给出可读错误）。
 *
 * 合法：`image`、`items[].excelFileUrl`、`files[]`、`a.b`、`groups[].files[].url`
 * 非法：空串、`a.b.`（空段）、`a[0]`（不支持下标）、`a[][].b`（同一段最多一个 `[]`）、`[].b`
 */
export function parseFileArgPath(raw: string): FileArgStep[] | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const steps: FileArgStep[] = [];
  for (const segment of raw.split('.')) {
    const matched = SEGMENT.exec(segment);
    if (!matched) return null;
    steps.push({ key: matched[1]!, array: matched[2] === '[]' });
  }
  return steps;
}

/** 配置校验用：路径写法是否合法（平台保存与 `MCP.json` 加载两侧同一判据） */
export function isValidFileArgPath(raw: unknown): boolean {
  return typeof raw === 'string' && parseFileArgPath(raw) !== null;
}

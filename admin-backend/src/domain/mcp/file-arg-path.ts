/**
 * `file_args` 的**取值路径**（2026-09-16）。
 * 与 `agent-backend/src/domain/file-arg-path.ts` **同构**（此处只有语法校验，
 * 改写引擎在运行环境）——保证"平台保存得进去"与"运行环境生效得了"是同一个判据。
 *
 * 起因（真实对接）：对方 MCP 服务的入参是**对象数组**——
 * `items: [{ businessType, excelFileUrl }]`（`parse_excel_files`），
 * 要铸造的是数组元素里的字段。旧口径把 `file_args` 的键当**顶层参数名**、
 * 值必须是字符串，管理员按真实入参写成 `items[].excelFileUrl` 时，
 * 平台这边若不认就会在保存时就报错（而后台其实已经支持）；反之平台放行、
 * 运行环境不认则变成"配了不生效"。两侧必须同一口径。
 *
 * 写法（详见运行环境侧文件的完整说明）：
 * `image`（顶层参数，向后兼容）、`files[]`（字符串数组逐元素）、
 * `items[].excelFileUrl`（对象数组的元素字段）、`groups[].files[].url`（多级嵌套）。
 */

export interface FileArgStep {
  /** 对象键名 */
  key: string;
  /** 该键的值是数组，路径的其余部分应用于**每个元素** */
  array: boolean;
}

/** 提示文案里给用户看的写法说明（错误信息与界面共用同一句） */
export const FILE_ARG_PATH_HINT = '参数名或取值路径（如 image、items[].excelFileUrl）';

/** 单段：键名 + 可选的 `[]`（键名不得含 `.`、`[`、`]`） */
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

/**
 * `file_args` 声明的**转换模式**（2026-09-18，与运行环境侧同构）：
 * `"url"`（模型填相对路径，原位铸造）或 `"url:from=<取值路径>"`（派生模式——
 * 目标字段由运行环境从来源路径推导注入、覆盖模型填写，且对 LLM 隐藏，
 * 用来根治模型对 http 地址字段的幻觉）。平台侧只做语法校验，原样存贮。
 */
export type FileArgMode = 'url' | `url:from=${string}`;

export const FILE_ARG_FROM_PREFIX = 'url:from=';

/** 解析转换模式；不合法返回 `null`（由调用方给出可读错误）。 `"url"` → `{ from: undefined }` */
export function parseFileArgMode(raw: unknown): { from?: string } | null {
  if (raw === 'url') return {};
  if (typeof raw !== 'string' || !raw.startsWith(FILE_ARG_FROM_PREFIX)) return null;
  return { from: raw.slice(FILE_ARG_FROM_PREFIX.length) };
}

/**
 * 派生模式的来源路径与目标路径是否**形状相容**：
 * 两段数相同，且除最后一段外逐段一致（键名与是否数组都相同）——
 * 这是"来源值与目标字段逐元素一一对应"的必要条件。
 */
export function isCompatibleFromPath(targetPath: string, fromPath: string): boolean {
  const target = parseFileArgPath(targetPath);
  const from = parseFileArgPath(fromPath);
  if (!target || !from || target.length !== from.length) return false;
  for (let i = 0; i < target.length - 1; i += 1) {
    if (target[i]!.key !== from[i]!.key || target[i]!.array !== from[i]!.array) return false;
  }
  return true;
}

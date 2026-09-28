/**
 * 算法规则字段路径（`rules_fields` 的取值，2026-09-22）。
 *
 * 与 `admin-backend/src/domain/mcp/rules-field-path.ts` **同构**（平台侧只做保存期语法校验，
 * 服务端独有"对工具 schema 求值"这一步）——保证"能保存的配置"与"能生效的配置"
 * 是同一个判据（与 `file-arg-path.ts` 同一约定）。
 *
 * 为什么从"顶层字段名"泛化为**对象路径**：真实对接里规则数组常嵌在入参对象内部
 * （如 `hd_scheduling_submit` 的 `input.targetPriorities`——`input` 承载 7 个排产输入项，
 * 规则清单只是其一）。旧实现只在顶层 `properties` 里找名字，于是这类声明"配了也
 * 不生效"，而且**静默**：配置已保存、界面也回显，只是弹窗里的入口永远不出现。
 *
 * 语法刻意保持最小：分段用 `.`，**只走对象**、不支持数组段（`[]`）——规则入口写入的是
 * "一个数组"，若目标本身位于数组元素里（`items[].rules`），到底写第几个元素没有业务
 * 含义。含 `[]` 的路径一律判非法并给出可读原因。
 */

/** 提示文案里给用户看的写法说明（错误信息与平台界面共用同一句） */
export const RULES_FIELD_PATH_HINT = '字段名或对象路径（如 rules、input.targetPriorities）';

/** 单段：非空且不含分隔符 `.` `[` `]` */
const SEGMENT = /^[^.[\]]+$/;

/**
 * 解析规则字段路径；语法不合法返回 `null`（由调用方给出可读错误）。
 *
 * 合法：`rules`、`input.targetPriorities`、`a.b.c`
 * 非法：空串/纯空白、`a.b.`（空段）、`items[].rules`（数组段）、`a..b`（空段）
 */
export function parseRulesFieldPath(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;
  const segments = text.split('.');
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) return null;
  }
  return segments;
}

/**
 * 该路径在工具的入参 schema 里是否走得通：沿 `properties` 逐段下行，末段存在即可。
 *
 * 判据与旧实现**保持同强度**（只查存在性，不要求末段是数组）：存量配置里指向非数组
 * 字段也照旧透传，是否装配入口由前端按控件类型决定——不在运行期新增拒绝条件，
 * 否则一次升级就可能把既有数字人的配置判为无效。
 */
export function hasRulesFieldPath(schema: unknown, path: string): boolean {
  const segments = parseRulesFieldPath(path);
  if (segments === null) return false;

  let node: unknown = schema;
  for (const segment of segments) {
    const properties =
      typeof node === 'object' && node !== null
        ? (node as { properties?: unknown }).properties
        : undefined;
    if (typeof properties !== 'object' || properties === null) return false;
    const property = (properties as Record<string, unknown>)[segment];
    if (property === undefined) return false;
    node = property;
  }
  return true;
}

/**
 * 算法规则字段路径的**语法**判据（`rules_fields` 的取值，2026-09-22）。
 *
 * 与 `agent-backend/src/domain/rules-field-path.ts` **同构**——平台只做语法校验，
 * 运行环境另做"该路径在工具 schema 里是否走得通"的求值。两侧同一判据保证
 * "能保存的配置"与"能生效的配置"不漂移（与 `file-arg-path.ts` 同一约定）。
 *
 * 保存期**只校验语法、不校验 schema**：与 `file_args` 同口径——工具清单是探测结果
 * （服务可能正好不可达），拿不到就拒保存会让"服务抖动"变成"配置改不了"。
 * schema 是否命中由运行环境在装配期判定（走不通就不下发声明，静默失效到此为止）。
 *
 * 语法：分段用 `.`，**只走对象**、不支持数组段（`[]`）——规则入口写入的是"一个数组"，
 * 若目标位于数组元素里（`items[].rules`），到底写第几个元素没有业务含义。
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

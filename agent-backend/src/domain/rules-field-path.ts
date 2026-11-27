
export const RULES_FIELD_PATH_HINT = '字段名或对象路径（如 rules、input.targetPriorities）';

const SEGMENT = /^[^.[\]]+$/;

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

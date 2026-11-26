
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

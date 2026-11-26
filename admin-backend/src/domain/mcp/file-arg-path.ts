
export interface FileArgStep {
  key: string;
  array: boolean;
}

export const FILE_ARG_PATH_HINT = '参数名或取值路径（如 image、items[].excelFileUrl）';

/** 单段：键名 + 可选的 `[]`（键名不得含 `.`、`[`、`]`） */
const SEGMENT = /^([^.[\]]+)(\[\])?$/;

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

export function isValidFileArgPath(raw: unknown): boolean {
  return typeof raw === 'string' && parseFileArgPath(raw) !== null;
}

export type FileArgMode = 'url' | `url:from=${string}`;

export const FILE_ARG_FROM_PREFIX = 'url:from=';

export function parseFileArgMode(raw: unknown): { from?: string } | null {
  if (raw === 'url') return {};
  if (typeof raw !== 'string' || !raw.startsWith(FILE_ARG_FROM_PREFIX)) return null;
  return { from: raw.slice(FILE_ARG_FROM_PREFIX.length) };
}

export function isCompatibleFromPath(targetPath: string, fromPath: string): boolean {
  const target = parseFileArgPath(targetPath);
  const from = parseFileArgPath(fromPath);
  if (!target || !from || target.length !== from.length) return false;
  for (let i = 0; i < target.length - 1; i += 1) {
    if (target[i]!.key !== from[i]!.key || target[i]!.array !== from[i]!.array) return false;
  }
  return true;
}

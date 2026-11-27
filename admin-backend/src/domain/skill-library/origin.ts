import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

export interface SkillOrigin {
  kind: 'onto_market';
  scenario: string;
  ontology: string;
  hash: string;
}

export function isReadOnlyOrigin(origin: SkillOrigin | undefined | null): boolean {
  return origin?.kind === 'onto_market';
}

export function assertSkillEditable(name: string, origin: SkillOrigin | undefined | null): void {
  if (!isReadOnlyOrigin(origin)) return;
  throw new ApiError(
    ERROR_CODES.ADM_SKILL_READ_ONLY,
    `本体市场导入的技能为只读：${name}；如需更新其内容，请在「从本体市场导入」窗口中对该技能执行「更新」`,
  );
}

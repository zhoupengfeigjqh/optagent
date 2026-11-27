import fs from 'node:fs';
import type { PlatformStore } from '../../infra/platform-store.js';
import { SKILLS_DIR } from './file-access.js';
import type { SkillRecord } from './install.js';
import { parseSkillMetadata } from './metadata.js';

function readSkillDisplayName(store: PlatformStore, name: string): string | null {
  try {
    const raw = fs.readFileSync(store.abs(`${SKILLS_DIR}/${name}/SKILL.md`), 'utf8');
    return parseSkillMetadata(raw).display_name;
  } catch {
    return null;
  }
}

export function withDisplayNames(
  store: PlatformStore,
  items: SkillRecord[],
): { items: SkillRecord[]; backfilled: boolean } {
  let backfilled = false;
  const next = items.map((item) => {
    if (typeof item.display_name === 'string' && item.display_name !== '') return item;
    backfilled = true;
    return { ...item, display_name: readSkillDisplayName(store, item.name) ?? item.name };
  });
  return { items: next, backfilled };
}

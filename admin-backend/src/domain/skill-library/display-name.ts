/**
 * 存量索引的展示名回填（2026-11-04）。
 *
 * `SkillRecord.display_name` 是 2026-11-04 新增字段：**升级前写入的索引没有它**，
 * 而市场侧 `SKILL.md` 早已带 `metadata` 段（如 `metadata.ontology_name`）——
 * 若只回落 `name`，卡片会一直显示英文名。这里回读磁盘 `SKILL.md` 重新解析，
 * 由 `SkillLibraryService.listAll()` 一次性写回索引。
 *
 * 读不到 / frontmatter 非法 → `null`（调用方回落 `name`）：单个脏技能不应拖垮列表
 * （与 `listAll()` 剔除"幽灵卡片"的容错口径一致）。
 */
import fs from 'node:fs';
import type { PlatformStore } from '../../infra/platform-store.js';
import { SKILLS_DIR } from './file-access.js';
import type { SkillRecord } from './install.js';
import { parseSkillMetadata } from './metadata.js';

/** 读 `skills/{name}/SKILL.md` 并解析展示名；文件缺失或格式坏返回 `null` */
function readSkillDisplayName(store: PlatformStore, name: string): string | null {
  try {
    const raw = fs.readFileSync(store.abs(`${SKILLS_DIR}/${name}/SKILL.md`), 'utf8');
    return parseSkillMetadata(raw).display_name;
  } catch {
    return null;
  }
}

/**
 * 给索引条目补齐 `display_name`（缺字段的旧记录才回读磁盘）。
 *
 * @returns `backfilled` 为真表示至少补过一条——调用方据此**一次性写回索引**，
 *   补完即不再进入该分支，读路径不留写放大。
 */
export function withDisplayNames(
  store: PlatformStore,
  items: SkillRecord[],
): { items: SkillRecord[]; backfilled: boolean } {
  let backfilled = false;
  const next = items.map((item) => {
    if (typeof item.display_name === 'string' && item.display_name !== '') return item;
    backfilled = true;
    // 脏文件（缺 SKILL.md / frontmatter 坏）回落 `name`，不拖垮列表
    return { ...item, display_name: readSkillDisplayName(store, item.name) ?? item.name };
  });
  return { items: next, backfilled };
}

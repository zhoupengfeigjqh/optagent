/**
 * `read_skill` 工具的领域实现（2026-09-23）。
 *
 * **补的是一个真实缺口**：SKILL 此前只把 frontmatter 的 `name`/`description` 注入
 * System Prompt（见 `agent-instance.ts`），**正文与 `references/` 附件没有任何读取通道**——
 * 内置文件的沙箱 `FileAccess` 只覆盖用户三空间（`users/{uid}/user-data/{数据准备|共享空间|临时空间}`），
 * 而技能在 `users/{uid}/agents/{agent}/skills/` 下，是**另一个子树**，`read_file` 一律被拒。
 *
 * 安全口径（与平台侧的 `resolveInsideSkill` 同一判据，**只读**）已抽到
 * `./skill-access.ts`——2026-10-17 新增 `grep_skill` 时抽出，两条技能访问通道
 * 共用同一份校验，避免安全判据出现第二份实现。
 *
 * 与 `read_file` 的分工：那条服务于**用户数据**（三空间、支持 xlsx/pdf 解析）；
 * 这条服务于**技能文档**（技能根、纯文本，不做格式解析）。
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  SkillAccessError,
  availableSkills,
  isBinaryBuffer,
  isDirectory,
  listSkillFiles,
  normalizeSkillRelPath,
  requireSkillName,
  resolveInsideSkill,
} from './skill-access.js';

/** 默认截断上限（字节）；实际由调用方注入，与 `read_file` 同一配置来源 */
const DEFAULT_TRUNCATE_BYTES = 128 * 1024;

/**
 * 越权访问异常。定义已移至 `./skill-access.ts`（两条技能访问通道共用），
 * 此处**再导出**以保持既有引用方（单测）无需改动。
 */
export { SkillAccessError };

export interface ReadSkillResult {
  /** 交给模型的文本（含截断提示，或可读的失败/清单说明） */
  text: string;
  truncated: boolean;
  totalSize: number;
}

export interface ReadSkillOptions {
  /** 字节偏移（续读截断内容时用） */
  offset?: number | undefined;
  /** 本次最多返回字节数（上限为 `truncateBytes`） */
  limit?: number | undefined;
  /** 截断上限（字节），默认 128KB */
  truncateBytes?: number | undefined;
}

/**
 * 读取技能内的文件。
 *
 * @param skillsRoot 本数字人的技能根（`users/{uid}/agents/{agent}/skills`）
 * @param skill 技能名（单个目录名）
 * @param relPath 技能内相对路径；缺省/空串为 `SKILL.md`
 */
export function readSkillFile(
  skillsRoot: string,
  skill: unknown,
  relPath?: unknown,
  opts: ReadSkillOptions = {},
): ReadSkillResult {
  const skillName = requireSkillName(skill);
  const skillDir = path.join(skillsRoot, skillName);
  if (!isDirectory(skillDir)) {
    // 名字合法但不存在：属用法问题（可能只是记错了名字），给可读提示而非越权告警
    return note(`本数字人没有名为「${skillName}」的技能。可用技能：${availableSkills(skillsRoot)}`);
  }

  const rel = normalizeSkillRelPath(relPath);
  const abs = resolveInsideSkill(skillDir, rel);

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return note(
      `技能「${skillName}」下没有「${rel}」。可用文件：\n${listSkillFiles(skillDir, skillDir) || '（空）'}`,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new SkillAccessError(`不接受符号链接：${skillName}/${rel}`);
  }
  if (stat.isDirectory()) {
    // 清单一律**相对技能根**，模型可直接回填给 path（相对被问目录的写法回填后会取不到）
    return note(
      `技能「${skillName}」下「${rel}」是目录，包含：\n${listSkillFiles(skillDir, abs) || '（空目录）'}`,
    );
  }
  if (!stat.isFile()) {
    throw new SkillAccessError(`只读取普通文件：${skillName}/${rel}`);
  }

  const buf = fs.readFileSync(abs);
  if (isBinaryBuffer(buf)) {
    // 二进制（字节 0 判定，与 admin 侧同一口径）：不返回乱码，明说原因与体积
    return note(`「${skillName}/${rel}」是二进制文件（${buf.length} 字节），无法直接阅读`);
  }

  const truncateBytes = opts.truncateBytes ?? DEFAULT_TRUNCATE_BYTES;
  const offset = Math.max(opts.offset ?? 0, 0);
  const limit = Math.min(opts.limit ?? truncateBytes, truncateBytes);
  const slice = buf.subarray(offset, offset + limit).toString('utf8');
  const consumed = offset + Buffer.byteLength(slice, 'utf8');
  const truncated = consumed < buf.length;
  return {
    text: truncated
      ? `${slice}\n\n[内容已截断：本次返回至第 ${consumed} 字节，共 ${buf.length} 字节；` +
        `可用 offset=${consumed} 继续读取]`
      : slice,
    truncated,
    totalSize: buf.length,
  };
}

function note(text: string): ReadSkillResult {
  return { text, truncated: false, totalSize: 0 };
}

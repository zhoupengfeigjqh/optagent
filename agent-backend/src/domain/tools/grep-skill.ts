/**
 * `grep_skill` 工具的领域实现（2026-10-17）。
 *
 * **补的是 `read_skill` 留下的另一半**：能读之后仍缺"在技能里找一句话"的能力——
 * `grep_files` 只覆盖用户三空间（技能在另一个子树，`FileAccess` 一律拒），
 * 于是技能内容此前只能靠 `read_skill` 逐个文件人工翻，技能一多就等于没有。
 *
 * 与 `read_skill` **同一套安全口径、同一个沙箱根**（共用 `./skill-access.ts`）：
 * 技能名限单个目录名、限定技能必须真实存在、越界/非法名一律上抛 `SkillAccessError`。
 * 差别只在"读一个文件" vs "在一批文件里找匹配"。
 *
 * 有界且**有界必须可见**（宪章原则九）：匹配数、扫描文件数、单文件体积三者都有上限，
 * 触顶一律在结果里写明——静默截断会让模型以为"技能里没有"，进而给出错误结论。
 * 二进制不返回乱码（与 `read_skill` 同口径：字节 0 判定），只计数并提示改用 `read_skill`。
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  availableSkills,
  isBinaryBuffer,
  isDirectory,
  listSkillNames,
  requireSkillName,
} from './skill-access.js';

/** 单次最多返回的匹配条数（与 `grep_files` 同一口径） */
const MAX_MATCHES = 100;
/** 单次最多扫描的文件数（防止技能树异常庞大时把一次工具调用拖死） */
const MAX_SCANNED_FILES = 500;
/** 单文件扫描上限（字节）：超过即跳过并计数，不做流式分片检索 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * 在技能内容中按正则检索关键词。
 *
 * @param skillsRoot 本数字人的技能根（`users/{uid}/agents/{agent}/skills`）
 * @param pattern 检索式（大小写不敏感，与 `grep_files` 同口径）
 * @param skill 限定技能名（单个目录名）；缺省/空串 = 检索**全部**技能
 * @returns 交给模型的文本：`技能名/相对路径:行号: 内容`，路径可直接回填给 `read_skill`
 */
export function grepSkillFiles(skillsRoot: string, pattern: unknown, skill?: unknown): string {
  // ① 表达式：空或非法属**预期内的用法问题**（模型可自我纠正），
  //    返回可读说明而非上抛——上抛会走越权分支记 alert 日志，那是"恶意访问"的口径
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    return '检索式不能为空：请给出要查找的关键词或正则表达式。';
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    return `非法检索表达式「${pattern}」：请改用普通关键词或合法正则。`;
  }

  // ② 目标技能：限定名必须真实存在，否则给可读提示 + 可用清单（与 `read_skill` 同款）
  const limited = skill !== undefined && skill !== null && skill !== '';
  let skillNames: string[];
  if (limited) {
    const name = requireSkillName(skill);
    if (!isDirectory(path.join(skillsRoot, name))) {
      return `本数字人没有名为「${name}」的技能。可用技能：${availableSkills(skillsRoot)}`;
    }
    skillNames = [name];
  } else {
    skillNames = listSkillNames(skillsRoot);
    if (skillNames.length === 0) {
      return '本数字人当前没有配置任何技能（技能名见系统提示中的「技能」小节）。';
    }
  }

  // ③ 遍历：跳过符号链接/超体积/二进制（逐项计数），命中按行收集
  const matches: string[] = [];
  let total = 0;
  let scanned = 0;
  let scannedCapped = false;
  let skippedBinary = 0;
  let skippedLarge = 0;
  let skippedLink = 0;

  /** 命中行前缀带上技能名：跨技能检索时模型据此回填 `read_skill` 的 skill 参数 */
  const walk = (skillName: string, dir: string, relPrefix: string): void => {
    if (scannedCapped) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 目录读不到（权限/已删）不中断检索，其余文件继续
    }
    for (const entry of entries) {
      if (scannedCapped) return;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        skippedLink += 1;
        continue;
      }
      if (entry.isDirectory()) {
        walk(skillName, path.join(dir, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (scanned >= MAX_SCANNED_FILES) {
        scannedCapped = true;
        return;
      }
      scanned += 1;

      const abs = path.join(dir, entry.name);
      let buf: Buffer;
      try {
        if (fs.statSync(abs).size > MAX_FILE_BYTES) {
          skippedLarge += 1;
          continue;
        }
        buf = fs.readFileSync(abs);
      } catch {
        continue;
      }
      if (isBinaryBuffer(buf)) {
        skippedBinary += 1;
        continue;
      }

      const lines = buf.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (!re.test(line)) continue;
        total += 1;
        // 超上限只计数不收集，末尾统一明示"仅显示前 N 条"
        if (matches.length < MAX_MATCHES) {
          matches.push(`${skillName}/${rel}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  };

  for (const name of skillNames) {
    if (scannedCapped) break;
    walk(name, path.join(skillsRoot, name), '');
  }

  const parts: string[] = [];
  if (total === 0) {
    parts.push(`未找到匹配 "${pattern}" 的技能内容`);
  } else {
    parts.push(
      `找到 ${total} 处匹配${total > MAX_MATCHES ? `（仅显示前 ${MAX_MATCHES} 条）` : ''}：`,
      ...matches,
    );
  }

  const notes: string[] = [];
  if (skippedBinary > 0) {
    notes.push(`已跳过 ${skippedBinary} 个二进制文件（请用 read_skill 读其原文）`);
  }
  if (skippedLarge > 0) {
    notes.push(`已跳过 ${skippedLarge} 个超过 ${MAX_FILE_BYTES / 1024 / 1024}MB 的文件`);
  }
  if (skippedLink > 0) {
    notes.push(`已跳过 ${skippedLink} 个符号链接`);
  }
  if (scannedCapped) {
    notes.push(
      `已达单次扫描上限（${MAX_SCANNED_FILES} 个文件），结果可能不完整：可指定 skill 缩小范围`,
    );
  }
  if (notes.length > 0) parts.push(`（${notes.join('；')}）`);

  return parts.join('\n');
}

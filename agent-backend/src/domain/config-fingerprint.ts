import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KEY_FILES = ['SOUL.md', 'TOOL.json', 'MCP.json', 'scenario.json'] as const;

/**
 * 计算数字人目录的配置指纹。
 *
 * 目录不存在或文件缺失不会抛错——缺失本身也是配置状态的一部分
 * （例如场景未配置），必须能被区分出来而不是与"读不到"混淆。
 */
export function computeConfigFingerprint(agentDir: string): string {
  const hash = createHash('sha1');

  for (const name of KEY_FILES) {
    hash.update(name);
    hash.update('\0');
    hash.update(statSignature(path.join(agentDir, name)));
    hash.update('\0');
  }

  const skillsDir = path.join(agentDir, 'skills');
  const relatives: string[] = [];
  collectFiles(skillsDir, skillsDir, relatives);
  relatives.sort();
  for (const rel of relatives) {
    hash.update(rel);
    hash.update('\0');
    hash.update(statSignature(path.join(skillsDir, ...rel.split('/'))));
    hash.update('\0');
  }

  return hash.digest('hex');
}

function statSignature(file: string): string {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return 'not-a-file';
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

function collectFiles(current: string, base: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(current, entry.name);
    if (entry.isDirectory()) {
      collectFiles(abs, base, out);
    } else {
      out.push(path.relative(base, abs).replace(/\\/g, '/'));
    }
  }
}

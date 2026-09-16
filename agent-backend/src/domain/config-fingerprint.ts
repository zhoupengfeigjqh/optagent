/**
 * 数字人配置指纹（`plan.md` R7 / `contracts/runtime-api-delta.md` §8，`FR-034`）。
 *
 * **要解决的问题**：`FR-034` 要求"部署生效后，其后的新对话立即使用新配置"，
 * 但实例池按 `(用户, 数字人)` 缓存、仅在**空闲超时**（默认 10 分钟）或池满 LRU
 * 时回收——部署后只要池中已有该数字人的实例，**新对话会继续用旧配置**，
 * 最长 10 分钟，且**不报任何错**（最难排查的一类静默缺陷）。
 *
 * **方案**：对数字人目录下的关键文件取"**大小 + 修改时间**"的组合摘要作为指纹，
 * 在**取用池中实例之前**比对；不一致即视为配置已变。
 *
 * 取"大小 + mtime"而非内容摘要：
 * - 配置体量极小，但每次取用都要计算，内容摘要会读全部文件（含 `skills/**`）；
 * - 部署是"**目录级原子改名**"，改名必然改变 mtime，因此 mtime 的变化
 *   与内容的变化在部署路径上等价；
 * - 与 `agent-catalog.ts` 既有的"现扫现解析"思路一致。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 参与指纹的关键文件（与 `loadAgentConfig` 实际读取的文件一致） */
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

  // 技能目录：物化后的 `skills/{name}/**`（含附件）都参与指纹
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

/** 文件签名：`size:mtimeMs`；不存在用 `missing` 明确表达 */
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

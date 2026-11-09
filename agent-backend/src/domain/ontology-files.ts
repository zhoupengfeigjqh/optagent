/**
 * 本体文件的**唯一**枚举与读取入口（020）。
 *
 * 为什么单独抽一层：意图聚焦（016/019）与本体行为权限闸门（020）都需要
 * "找到 `{agentDir}/ontology/{场景}/{本体}/` 并解析其中的 yaml"。这条规则是
 * **安全相关**的（真实目录、拒绝符号链接、坏文件降级），两处各写一套必然漂移，
 * 因此收敛到这里（宪章原则二：同一规则唯一来源）。
 *
 * 三条口径：
 * 1. **只读真实文件**：目录与文件都过 `lstat`，符号链接一律跳过（禁止逃逸）；
 * 2. **坏文件不中断**：解析失败只记 warning，调用方照常继续；
 * 3. **本层不含业务判断**：不认行为、不认 scope，只做"枚举 + 解析成对象"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** 一个已物化的本体目录 */
export interface OntologyDirRef {
  /** 场景目录名 */
  scenario: string;
  /** 本体目录名 */
  ontology: string;
  /** 绝对目录路径（`{agentDir}/ontology/{场景}/{本体}`） */
  dir: string;
}

/**
 * 目录签名：`{agentDir}/ontology` 根目录的 `mtimeMs`；目录不存在为 `missing`。
 *
 * 单次 `stat`。本体的部署是目录级原子改名，会改变 `mtime`，因此可作为
 * "是否需要用新配置"的判据（020 权限闸门与 021 规则闸门共用）。
 */
export function ontologyDirSignature(agentDir: string): string {
  try {
    return String(fs.statSync(path.join(agentDir, 'ontology')).mtimeMs);
  } catch {
    return 'missing';
  }
}

/**
 * 枚举 `{agentDir}/ontology/{场景}/{本体}/`。
 *
 * - `agentDir` 下没有 `ontology` 目录 → 空数组且**不记 warning**（常态，不是异常）；
 * - 目录不可读（非 ENOENT）→ `<label>:unreadable:<原因>`；
 * - 只保留真实目录，符号链接跳过；按名称排序（判定顺序可复现）。
 */
export function listOntologyDirs(
  agentDir: string,
  warnings: string[],
  label = 'ontology',
): OntologyDirRef[] {
  const root = path.join(agentDir, 'ontology');
  const result: OntologyDirRef[] = [];
  for (const scenario of safeReadDirs(root, warnings, label)) {
    const scenarioDir = path.join(root, scenario);
    for (const ontology of safeReadDirs(scenarioDir, warnings, `${label}/${scenario}`)) {
      result.push({ scenario, ontology, dir: path.join(scenarioDir, ontology) });
    }
  }
  return result;
}

/**
 * 读取一个 yaml 文件并解析为对象；失败返回 `null` 并写 warning（**永不抛**）。
 *
 * warning 形态与意图聚焦既有口径一致，便于日志检索：
 * `:not_regular_file` / `:invalid_yaml:<原因>` / `:not_object`。
 */
export function readYamlObject(file: string, warnings: string[]): Record<string, unknown> | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    // 文件不存在是常态（可选文件），不记 warning
    return null;
  }
  // 符号链接文件同样拒绝：物化产物应是普通文件
  if (!stat.isFile() || stat.isSymbolicLink()) {
    warnings.push(`${file}:not_regular_file`);
    return null;
  }

  let data: unknown;
  try {
    data = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    warnings.push(`${file}:invalid_yaml:${(err as Error).message}`);
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    warnings.push(`${file}:not_object`);
    return null;
  }
  return data as Record<string, unknown>;
}

/** 读子目录名（只保留真实目录；不存在返回空数组，不记 warning） */
function safeReadDirs(dir: string, warnings: string[], label: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnings.push(`${label}:unreadable:${(err as Error).message}`);
    }
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

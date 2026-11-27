import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface OntologyDirRef {
  scenario: string;
  ontology: string;
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

export function readYamlObject(file: string, warnings: string[]): Record<string, unknown> | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
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

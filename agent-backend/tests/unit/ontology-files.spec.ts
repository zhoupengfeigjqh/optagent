/**
 * 单元测试：本体文件枚举与读取（020 收敛的唯一来源）。
 *
 * 守住的边界：
 * - 只认**真实目录**：符号链接目录被跳过（禁止逃逸）；
 * - 只认**普通文件**：符号链接文件、目录同名文件一律拒绝并告警；
 * - 坏 YAML / 非对象根只告警、返回 null，**永不抛**；
 * - `ontology` 目录不存在是常态：空数组且零告警（否则每轮对话都会刷告警）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { listOntologyDirs, readYamlObject } from '../../src/domain/ontology-files.js';

const tmpDirs: string[] = [];

function tmpDir(prefix = 'optagent-ontology-files-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(file: string, content: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

/** Windows 上目录软链需要权限，用 junction；失败时返回 false 让用例降级跳过 */
function tryLinkDir(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, 'junction');
    return true;
  } catch {
    return false;
  }
}

function tryLinkFile(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('listOntologyDirs', () => {
  it('枚举两层的真实目录，按名称排序，并给出绝对路径', () => {
    const agent = tmpDir();
    writeFile(path.join(agent, 'ontology', '生产调度', '原材料采购和库存', 'ontology.yaml'), 'a: 1');
    writeFile(path.join(agent, 'ontology', '生产调度', 'B本体', 'ontology.yaml'), 'a: 1');
    writeFile(path.join(agent, 'ontology', '其他场景', 'X', 'ontology.yaml'), 'a: 1');

    const warnings: string[] = [];
    const dirs = listOntologyDirs(agent, warnings, 'scope_guard');

    expect(warnings).toEqual([]);
    expect(dirs.map((d) => `${d.scenario}/${d.ontology}`)).toEqual([
      '其他场景/X',
      '生产调度/B本体',
      '生产调度/原材料采购和库存',
    ]);
    expect(dirs[0]!.dir).toBe(path.join(agent, 'ontology', '其他场景', 'X'));
  });

  it('没有 ontology 目录时返回空数组且零告警（常态，不是异常）', () => {
    const agent = tmpDir();
    const warnings: string[] = [];

    expect(listOntologyDirs(agent, warnings, 'scope_guard')).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('跳过符号链接目录（禁止通过链接逃出本体目录）', () => {
    const agent = tmpDir();
    const outside = tmpDir('optagent-outside-');
    writeFile(path.join(outside, 'ontology.yaml'), 'metadata: { ontology_id: 9 }');
    writeFile(path.join(agent, 'ontology', '生产调度', '真实本体', 'ontology.yaml'), 'a: 1');

    const linked = tryLinkDir(outside, path.join(agent, 'ontology', '生产调度', '链接本体'));
    if (!linked) return; // 环境不支持软链（无权限）时不做断言

    const warnings: string[] = [];
    const dirs = listOntologyDirs(agent, warnings, 'scope_guard');

    expect(dirs.map((d) => d.ontology)).toEqual(['真实本体']);
  });
});

describe('readYamlObject', () => {
  it('读取合法 yaml 对象', () => {
    const dir = tmpDir();
    const file = writeFile(path.join(dir, 'a.yaml'), 'metadata:\n  ontology_name: 采购\nscope:\n  - admin\n');
    const warnings: string[] = [];

    expect(readYamlObject(file, warnings)).toEqual({
      metadata: { ontology_name: '采购' },
      scope: ['admin'],
    });
    expect(warnings).toEqual([]);
  });

  it('文件不存在：返回 null 且不告警（可选文件是常态）', () => {
    const warnings: string[] = [];
    expect(readYamlObject(path.join(tmpDir(), 'missing.yaml'), warnings)).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('坏 YAML：返回 null 并告警 invalid_yaml', () => {
    const file = writeFile(path.join(tmpDir(), 'bad.yaml'), 'securities: [\n');
    const warnings: string[] = [];

    expect(readYamlObject(file, warnings)).toBeNull();
    expect(warnings.join('\n')).toContain('invalid_yaml');
  });

  it('非对象根（数组）：返回 null 并告警 not_object', () => {
    const file = writeFile(path.join(tmpDir(), 'array.yaml'), '- a\n- b\n');
    const warnings: string[] = [];

    expect(readYamlObject(file, warnings)).toBeNull();
    expect(warnings.join('\n')).toContain('not_object');
  });

  it('目录同名文件：拒绝并告警 not_regular_file', () => {
    const dir = path.join(tmpDir(), 'dir.yaml');
    fs.mkdirSync(dir, { recursive: true });
    const warnings: string[] = [];

    expect(readYamlObject(dir, warnings)).toBeNull();
    expect(warnings.join('\n')).toContain('not_regular_file');
  });

  it('符号链接文件：拒绝并告警 not_regular_file', () => {
    const dir = tmpDir();
    const target = writeFile(path.join(dir, 'real.yaml'), 'a: 1');
    const link = path.join(dir, 'link.yaml');
    if (!tryLinkFile(target, link)) return; // 环境不支持软链时跳过

    const warnings: string[] = [];
    expect(readYamlObject(link, warnings)).toBeNull();
    expect(warnings.join('\n')).toContain('not_regular_file');
  });

  it('中文路径可正常读取', () => {
    const agent = tmpDir();
    const file = writeFile(
      path.join(agent, 'ontology', '生产调度', '原材料采购和库存', 'ontology.yaml'),
      'metadata:\n  ontology_name: 原材料采购和库存\n',
    );
    const warnings: string[] = [];

    expect(readYamlObject(file, warnings)).toEqual({
      metadata: { ontology_name: '原材料采购和库存' },
    });
    expect(warnings).toEqual([]);
  });
});

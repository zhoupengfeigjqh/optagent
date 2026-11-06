/**
 * 单元测试：术语字典生成（017，`specs/017-ontology-term-mapping/spec.md`）。
 *
 * 守四条最容易走样的口径：
 * ① 每个 term 一个键，value = concept 的 title；
 * ② 同一 term 多义时按 concepts 原序用 `或` 合并，同一 title 不重复；
 * ③ `terms` 为空（现存本体的常态）→ 跳过该 concept，产出 `{}` 而不是空串键；
 * ④ 任何解析异常都只降级为 `{}` + warning，绝不抛错（部署不得被派生件阻断）。
 */
import { describe, expect, it } from 'vitest';
import { buildTermMapping } from '../../src/domain/ontology/term-mapping.js';

/** 最小本体：metadata 两个名字与库内路径必须一致（导入期强校验），这里只关心 concepts */
function ontology(concepts: string, metadata = ''): string {
  return `metadata:
  scenario_name: 生产调度
  ontology_name: 原材料采购和库存
${metadata}concepts:
${concepts}`;
}

describe('buildTermMapping · 键值形态', () => {
  it('每个 term 一个键，value 为该 concept 的 title', () => {
    const { json, entries, warnings } = buildTermMapping(
      ontology(`- name: RawMaterial
  title: 原材料
  terms: [钢板, 物料]
`),
    );

    expect(entries).toBe(2);
    expect(warnings).toEqual([]);
    expect(JSON.parse(json)).toEqual({ 钢板: '原材料', 物料: '原材料' });
  });

  it('同一 term 命中多个 concept：value 按 concepts 原序用「或」合并', () => {
    const { json } = buildTermMapping(
      ontology(`- name: Supplier
  title: 供应商
  terms: [供应商信息]
- name: SupplierCode
  title: 供应商编号
  terms: [供应商编码, 供应商信息]
`),
    );

    expect(JSON.parse(json)).toEqual({
      供应商信息: '供应商或供应商编号',
      供应商编码: '供应商编号',
    });
  });

  it('同一 concept 内重复 term 与重复 title 不产生自我重复', () => {
    const { json, entries } = buildTermMapping(
      ontology(`- name: Supplier
  title: 供应商
  terms: [供应商, 供应商]
- name: SupplierAlias
  title: 供应商
  terms: [供应商]
`),
    );

    expect(entries).toBe(1);
    expect(JSON.parse(json)).toEqual({ 供应商: '供应商' });
  });

  it('非字符串 / 空串 term 被跳过，其余照常', () => {
    const { json } = buildTermMapping(
      ontology(`- name: RawMaterial
  title: 原材料
  terms: [钢板, '', '   ', 1]
`),
    );

    expect(JSON.parse(json)).toEqual({ 钢板: '原材料' });
  });
});

describe('buildTermMapping · 跳过与降级', () => {
  it('terms 为空数组 → 该 concept 跳过，产出 {}（现存本体的常态）', () => {
    const result = buildTermMapping(
      ontology(`- name: RawMaterial
  title: 原材料
  terms: []
- name: Supplier
  title: 供应商
  terms: []
`),
    );

    expect(result.json).toBe('{}\n');
    expect(result.entries).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('concept 缺 title 时其 terms 全部跳过，并留一条汇总 warning', () => {
    const result = buildTermMapping(
      ontology(`- name: RawMaterial
  terms: [钢板]
- name: Supplier
  title: 供应商
  terms: [供应商信息]
`),
    );

    expect(JSON.parse(result.json)).toEqual({ 供应商信息: '供应商' });
    expect(result.warnings).toEqual(['1 个 concept 缺 title，其 terms 已跳过']);
  });

  it('concepts 缺失 / 为 null / 非数组 → 空字典，只有非数组才告警', () => {
    expect(buildTermMapping('metadata: {}\n').json).toBe('{}\n');
    expect(buildTermMapping('metadata: {}\nconcepts:\n').warnings).toEqual([]);
    expect(buildTermMapping('metadata: {}\nconcepts: 钢板\n').warnings).toEqual([
      'concepts 不是数组，按空处理',
    ]);
  });

  it('YAML 语法非法 → 空字典 + warning，不抛错', () => {
    const result = buildTermMapping('metadata: [\n');

    expect(result.json).toBe('{}\n');
    expect(result.warnings[0]).toContain('不是合法 YAML');
  });
});

describe('buildTermMapping · 落盘格式', () => {
  it('2 空格缩进、末尾换行（与仓库其余 .json 产物一致）', () => {
    const { json } = buildTermMapping(
      ontology(`- name: RawMaterial
  title: 原材料
  terms: [钢板]
`),
    );

    expect(json).toBe('{\n  "钢板": "原材料"\n}\n');
  });
});

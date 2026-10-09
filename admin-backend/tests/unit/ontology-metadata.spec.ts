/**
 * 单元测试：本体 `ontology.yaml` 的 metadata 解析（2026-10-03，`FR-058`）
 *
 * 重点：**只取 6 项**、缺项为 `null`（不阻塞导入）、id 类字段保留数字、
 * YAML 非法/缺 `metadata` 段判为格式无效（`VALIDATION_FAILED` + 可读原因）。
 * 扫描与状态判定见 `ontology-market.spec.ts`，端到端见 `ontologies.spec.ts`。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  EMPTY_ONTOLOGY_METADATA,
  ontologyDisplayName,
  parseOntologyMetadata,
} from '../../src/domain/ontology/metadata.js';

const FULL_YAML = `metadata:
  source_file: 原材料采购需求分析.md
  source_thread: 原材料采购与库存管理
  created_at: '2026-07-15 16:05:02'
  deployed_version: v1.0
  shard_hash: d8d9a8bb2ad1b019
  scenario_name: 生产调度
  scenario_id: 1
  ontology_name: 原材料采购和库存
  ontology_id: 1
concepts:
- name: RawMaterial
  description: 原材料
`;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as ApiError).code;
  }
  throw new Error('期望抛错但没有');
}

describe('parseOntologyMetadata', () => {
  it('取齐 6 项 metadata；未在清单内的项（source_file/shard_hash 等）不进结果', () => {
    const metadata = parseOntologyMetadata(FULL_YAML);

    expect(metadata).toEqual({
      created_at: '2026-07-15 16:05:02',
      deployed_version: 'v1.0',
      scenario_name: '生产调度',
      scenario_id: 1,
      ontology_name: '原材料采购和库存',
      ontology_id: 1,
    });
    expect(Object.keys(metadata)).toHaveLength(6);
    expect(metadata).not.toHaveProperty('source_file');
    expect(metadata).not.toHaveProperty('shard_hash');
  });

  it('缺项为 null（市场字段演进不阻塞导入）', () => {
    const metadata = parseOntologyMetadata('metadata:\n  ontology_name: 只有名字\n');

    expect(metadata.ontology_name).toBe('只有名字');
    expect(metadata.created_at).toBeNull();
    expect(metadata.deployed_version).toBeNull();
    expect(metadata.scenario_id).toBeNull();
  });

  it('空 metadata 段 → 6 项全为 null', () => {
    expect(parseOntologyMetadata('metadata: {}\n')).toEqual(EMPTY_ONTOLOGY_METADATA);
  });

  it('id 类字段保留数字；其余字段一律字符串（数字也转文本）', () => {
    const metadata = parseOntologyMetadata(
      'metadata:\n  scenario_id: 7\n  ontology_id: "8"\n  deployed_version: 1.5\n',
    );

    expect(metadata.scenario_id).toBe(7);
    expect(metadata.ontology_id).toBe('8');
    expect(metadata.deployed_version).toBe('1.5');
  });

  it('非标量取值（数组/对象）→ null，不抛错', () => {
    const metadata = parseOntologyMetadata(
      'metadata:\n  ontology_name: [a, b]\n  scenario_id: {x: 1}\n',
    );

    expect(metadata.ontology_name).toBeNull();
    expect(metadata.scenario_id).toBeNull();
  });

  it('YAML 语法错误 → VALIDATION_FAILED（原因可读）', () => {
    let caught: unknown;
    try {
      parseOntologyMetadata('metadata:\n  a: [未闭合\n');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((caught as ApiError).message).toContain('不是合法 YAML');
  });

  it('顶层不是对象（数组/标量）→ VALIDATION_FAILED', () => {
    expect(codeOf(() => parseOntologyMetadata('- a\n- b\n'))).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(codeOf(() => parseOntologyMetadata('just a string\n'))).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('缺 metadata 段（或为空）→ VALIDATION_FAILED', () => {
    let caught: unknown;
    try {
      parseOntologyMetadata('concepts: []\n');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((caught as ApiError).message).toContain('metadata');
  });
});

describe('ontologyDisplayName', () => {
  it('优先 metadata.ontology_name，缺失时兜底目录名', () => {
    expect(ontologyDisplayName({ ...EMPTY_ONTOLOGY_METADATA, ontology_name: '库存' }, 'dir')).toBe(
      '库存',
    );
    expect(ontologyDisplayName(EMPTY_ONTOLOGY_METADATA, 'dir')).toBe('dir');
  });
});

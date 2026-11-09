/**
 * 性能门槛（`SC-004`）：`prepare` 的 P95 ≤ 500ms。
 *
 * 测量口径（须与规格一致）：
 * - **热路径**：同一进程内连续 200 次 `prepare`（快照已加载，每次只做一次
 *   `stat` + 集合查找 + 求值），取 P50 / P95 / max；
 * - **冷路径**：新建闸门后第一次 `prepare`（含一次完整目录扫描 + YAML 解析），
 *   取 20 个独立数字人目录的中位数与最大值；
 * - 机器：本机（宿主机，非容器）；时间为 `performance.now()` 墙钟。
 *
 * 用例同时是回归门槛：任何一次改动导致 P95 越界都会红灯。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { matchKeys } from '../../src/domain/ontology-doc.js';
import { createRuleGate } from '../../src/domain/rule-gate/gate.js';
import { createFunctionRecord } from '../../src/domain/rule-gate/record.js';

const P95_BUDGET_MS = 500;
const WARM_SAMPLES = 200;
const COLD_SAMPLES = 20;

const tmpDirs: string[] = [];

function fixtureAgentDir(): string {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-rule-gate-perf-'));
  tmpDirs.push(agentDir);
  const dir = path.join(agentDir, 'ontology', '生产调度', '采购单');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ontology.yaml'),
    [
      'metadata:',
      '  scenario_name: 生产调度',
      '  ontology_name: 采购单',
      'behaviors:',
      '  - name: CreatePurchaseRecord',
      '    title: 创建采购单',
      'functions:',
      '  - name: checkSupplierExistence',
      '    type: query',
      '    response:',
      '      pass: boolean',
      'rules:',
      '  - name: 采购-供应商名称一致',
      '    behavior: CreatePurchaseRecord',
      '    position: 前置',
      '    related_functions:',
      '      - checkSupplierExistence',
      '    rule_design:',
      '      combine: and',
      '      groups:',
      '        - combine: and',
      '          conditions:',
      '            - function: checkSupplierExistence',
      '              field: pass',
      '              operator: eq',
      '              values: ["true"]',
    ].join('\n'),
    'utf8',
  );
  return agentDir;
}

function availableOf(...names: string[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const name of names) for (const key of matchKeys(name)) set.add(key);
  return set;
}

function percentile(sorted: number[], ratio: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index]!;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('SC-004：prepare 性能', () => {
  it('热路径 200 次 P95 ≤ 500ms', () => {
    const agentDir = fixtureAgentDir();
    const gate = createRuleGate({ agentDir });
    const record = createFunctionRecord();
    record.add('checkSupplierExistence', { pass: true });
    const available = availableOf('erp__CreatePurchaseRecord', 'erp__checkSupplierExistence');
    const input = { toolName: 'erp__CreatePurchaseRecord', record, available };

    // 预热（含首轮快照加载，不计入样本）
    gate.prepare(input);

    const samples: number[] = [];
    for (let i = 0; i < WARM_SAMPLES; i += 1) {
      const started = performance.now();
      const result = gate.prepare(input);
      samples.push(performance.now() - started);
      expect(result.kind).toBe('behavior');
    }

    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    const max = samples[samples.length - 1]!;
    console.log(
      `[SC-004] prepare 热路径 n=${WARM_SAMPLES} P50=${p50.toFixed(3)}ms P95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms`,
    );

    expect(p95).toBeLessThan(P95_BUDGET_MS);
  });

  it('冷路径（含目录扫描 + YAML 解析）首调用 ≤ 500ms', () => {
    const samples: number[] = [];
    for (let i = 0; i < COLD_SAMPLES; i += 1) {
      const agentDir = fixtureAgentDir();
      const gate = createRuleGate({ agentDir });
      const record = createFunctionRecord();
      record.add('checkSupplierExistence', { pass: true });
      const available = availableOf('erp__CreatePurchaseRecord', 'erp__checkSupplierExistence');

      const started = performance.now();
      gate.prepare({ toolName: 'erp__CreatePurchaseRecord', record, available });
      samples.push(performance.now() - started);
    }

    samples.sort((a, b) => a - b);
    const p95 = percentile(samples, 0.95);
    const max = samples[samples.length - 1]!;
    console.log(
      `[SC-004] prepare 冷路径 n=${COLD_SAMPLES} P50=${percentile(samples, 0.5).toFixed(3)}ms P95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms`,
    );

    expect(p95).toBeLessThan(P95_BUDGET_MS);
  });
});

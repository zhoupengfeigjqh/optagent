/**
 * 单元测试：判定视图加载 + 判定合成（020）。
 *
 * 守住的口径：
 * - 行为与 `action_name` 只做"归一化后精确匹配"，不猜、不模糊；
 * - 缺文件 / 坏 YAML / `securities` 非数组 / 缺条目 → **fail-closed** 且告警；
 * - 同名行为跨多个本体 → **拒绝优先**，且冲突只告警一次；
 * - 缓存按 `ontology` 目录签名失效：改文件内容不改目录签名 → 仍用旧快照；
 *   目录签名变化 → 下一次 `check` 重载；
 * - 无本体 → 全放行且**零告警**（`FR-021`）；
 * - `check` 永不抛错（异常 → `internal_error` 拒绝）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogSignature, loadGuardCatalog } from '../../src/domain/scope-guard/catalog.js';
import { createScopeGuard } from '../../src/domain/scope-guard/guard.js';

const tmpDirs: string[] = [];

function tmpAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-scope-guard-'));
  tmpDirs.push(dir);
  return dir;
}

interface WriteOptions {
  behaviors?: string[];
  securities?: string | null;
  scenario?: string;
  ontology?: string;
  ontologyName?: string;
  scenarioName?: string;
}

const BEHAVIOR = 'CreatePurchaseRecord';

function writeOntology(agentDir: string, options: WriteOptions = {}): string {
  const scenario = options.scenario ?? '生产调度';
  const ontology = options.ontology ?? '原材料采购和库存';
  const dir = path.join(agentDir, 'ontology', scenario, ontology);
  fs.mkdirSync(dir, { recursive: true });

  const behaviors = options.behaviors ?? [BEHAVIOR];
  const lines = [
    'metadata:',
    `  ontology_name: ${options.ontologyName ?? ontology}`,
    `  scenario_name: ${options.scenarioName ?? scenario}`,
    'behaviors:',
  ];
  for (const name of behaviors) {
    lines.push(`  - name: ${name}`, '    title: 测试行为', '    op_type: command');
  }
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), lines.join('\n'), 'utf8');

  if (options.securities !== null) {
    const securities =
      options.securities ??
      [
        'securities:',
        `  - action_name: ${BEHAVIOR}`,
        '    title: 创建原材料采购单',
        '    op_type: command',
        '    scope:',
        '      - admin',
      ].join('\n');
    fs.writeFileSync(path.join(dir, 'securities.yaml'), securities, 'utf8');
  }
  return dir;
}

function guardFor(agentDir: string, username = 'admin') {
  const warn = vi.fn<(warnings: string[]) => void>();
  const guard = createScopeGuard({ agentDir, username, warn });
  return { guard, warn };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('loadGuardCatalog', () => {
  it('两文件齐全：行为绑定、条目 scope 归一化、状态 ok', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, {
      securities: [
        'securities:',
        `  - action_name: ${BEHAVIOR}`,
        '    scope:',
        '      - "  ADMIN  "',
        '      - everyOne',
      ].join('\n'),
    });

    const snapshot = loadGuardCatalog(agent);

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.byBehavior.get('createpurchaserecord')).toEqual([
      { behaviorName: BEHAVIOR, ontologyKey: '生产调度/原材料采购和库存' },
    ]);
    const ontology = snapshot.ontologies.get('生产调度/原材料采购和库存');
    expect(ontology).toMatchObject({
      scenarioName: '生产调度',
      ontologyName: '原材料采购和库存',
      status: 'ok',
    });
    expect(ontology!.entries.get('createpurchaserecord')).toEqual({
      actionName: BEHAVIOR,
      scope: ['admin', 'everyone'],
      ignored: 0,
    });
  });

  it('行为缺 name / 同名重复：丢弃或保留首个，并告警', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, {
      behaviors: [BEHAVIOR, BEHAVIOR, '  '],
    });

    const snapshot = loadGuardCatalog(agent);

    expect(snapshot.byBehavior.get('createpurchaserecord')).toHaveLength(1);
    expect(snapshot.warnings.join('\n')).toContain('behavior_duplicated');
    expect(snapshot.warnings.join('\n')).toContain('behavior_missing_name');
  });

  it('缺 securities.yaml：状态 no_securities 并告警 missing', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, { securities: null });

    const snapshot = loadGuardCatalog(agent);
    expect(snapshot.ontologies.get('生产调度/原材料采购和库存')!.status).toBe('no_securities');
    expect(snapshot.warnings.join('\n')).toContain('securities.yaml:missing');
  });

  it('securities 坏 YAML / 非数组：一律 no_securities', () => {
    const broken = tmpAgentDir();
    writeOntology(broken, { securities: 'securities: [\n' });
    expect(loadGuardCatalog(broken).ontologies.get('生产调度/原材料采购和库存')!.status).toBe(
      'no_securities',
    );
    expect(loadGuardCatalog(broken).warnings.join('\n')).toContain('invalid_yaml');

    const notArray = tmpAgentDir();
    writeOntology(notArray, { securities: 'securities:\n  action_name: x\n' });
    const snapshot = loadGuardCatalog(notArray);
    expect(snapshot.ontologies.get('生产调度/原材料采购和库存')!.status).toBe('no_securities');
    expect(snapshot.warnings.join('\n')).toContain('securities_not_array');
  });

  it('scope 非数组：按空 scope 处理并告警', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, {
      securities: [
        'securities:',
        `  - action_name: ${BEHAVIOR}`,
        '    scope: admin',
      ].join('\n'),
    });

    const snapshot = loadGuardCatalog(agent);
    expect(snapshot.warnings.join('\n')).toContain('scope_not_array');
    expect(snapshot.ontologies.get('生产调度/原材料采购和库存')!.entries.get('createpurchaserecord'))
      .toMatchObject({ scope: [] });
  });

  it('scope 混入非字符串/空串：剔除并计 ignored', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, {
      securities: [
        'securities:',
        `  - action_name: ${BEHAVIOR}`,
        '    scope:',
        '      - admin',
        '      - 42',
        '      - "   "',
      ].join('\n'),
    });

    const snapshot = loadGuardCatalog(agent);
    expect(snapshot.ontologies.get('生产调度/原材料采购和库存')!.entries.get('createpurchaserecord')).toEqual(
      { actionName: BEHAVIOR, scope: ['admin'], ignored: 2 },
    );
    expect(snapshot.warnings.join('\n')).toContain('scope_ignored_elements');
  });

  it('ontology.yaml 不可解析的本体不参与判定（工具按非本体行为放行）', () => {
    const agent = tmpAgentDir();
    // 用坏 YAML 代替"删除文件"：Windows + 中文路径下的删除操作不可靠，
    // 而两条路径在加载层的处理完全一致（读不到行为清单 ⇒ 跳过该本体）
    const dir = writeOntology(agent);
    fs.writeFileSync(path.join(dir, 'ontology.yaml'), 'behaviors: [\n', 'utf8');

    const snapshot = loadGuardCatalog(agent);
    expect(snapshot.byBehavior.size).toBe(0);
    expect(snapshot.ontologies.size).toBe(0);
    expect(snapshot.warnings.join('\n')).toContain('invalid_yaml');
  });

  it('目录签名：无 ontology 目录为 missing，写入后变为时间戳', () => {
    const agent = tmpAgentDir();
    expect(catalogSignature(agent)).toBe('missing');
    writeOntology(agent);
    expect(catalogSignature(agent)).toMatch(/^\d/);
  });
});

describe('createScopeGuard', () => {
  it('用户名命中 → allow（携带本体与行为）', () => {
    const agent = tmpAgentDir();
    writeOntology(agent);
    const { guard, warn } = guardFor(agent, 'admin');

    expect(guard.check('mes__CreatePurchaseRecord')).toEqual({
      kind: 'allow',
      behavior: {
        ontologyKey: '生产调度/原材料采购和库存',
        scenarioName: '生产调度',
        ontologyName: '原材料采购和库存',
        behaviorName: BEHAVIOR,
      },
      rule: 'user',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('非本体工具 → not_ontology（不做任何读取告警）', () => {
    const agent = tmpAgentDir();
    writeOntology(agent);
    const { guard } = guardFor(agent);

    expect(guard.check('read_file')).toEqual({ kind: 'not_ontology' });
    expect(guard.check('other__Something')).toEqual({ kind: 'not_ontology' });
  });

  it('空 scope → 拒绝 empty_scope', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, {
      securities: ['securities:', `  - action_name: ${BEHAVIOR}`, '    scope: []'].join('\n'),
    });
    const { guard } = guardFor(agent);

    expect(guard.check(BEHAVIOR)).toMatchObject({
      kind: 'deny',
      code: 'ONTOLOGY_SCOPE_DENIED',
      reason: 'empty_scope',
      scopeKind: 'users',
      scopeSize: 0,
    });
  });

  it('缺 action_name 条目 → 管控不可用 no_entry', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, {
      securities: ['securities:', '  - action_name: OtherBehavior', '    scope:', '      - admin'].join('\n'),
    });
    const { guard } = guardFor(agent);

    expect(guard.check(BEHAVIOR)).toMatchObject({
      kind: 'deny',
      code: 'ONTOLOGY_SCOPE_UNAVAILABLE',
      reason: 'no_entry',
    });
  });

  it('缺 securities.yaml → 管控不可用 no_securities', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, { securities: null });
    const { guard } = guardFor(agent);

    expect(guard.check(BEHAVIOR)).toMatchObject({
      kind: 'deny',
      code: 'ONTOLOGY_SCOPE_UNAVAILABLE',
      reason: 'no_securities',
    });
  });

  it('文案：讲清本体与行为，且不含 scope 名单', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, {
      securities: ['securities:', `  - action_name: ${BEHAVIOR}`, '    scope:', '      - zpf'].join('\n'),
    });
    const { guard } = guardFor(agent, 'admin');

    const decision = guard.check(BEHAVIOR);
    expect(decision.kind).toBe('deny');
    if (decision.kind !== 'deny') return;
    expect(decision.message).toContain('原材料采购和库存');
    expect(decision.message).toContain(BEHAVIOR);
    expect(decision.message).not.toContain('zpf');
  });

  it('同名行为跨两个本体：拒绝优先，冲突只告警一次', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, { ontology: 'A本体' });
    writeOntology(agent, {
      ontology: 'B本体',
      securities: ['securities:', `  - action_name: ${BEHAVIOR}`, '    scope:', '      - disable'].join('\n'),
    });
    const { guard, warn } = guardFor(agent, 'admin');

    const first = guard.check(BEHAVIOR);
    expect(first).toMatchObject({
      kind: 'deny',
      code: 'ONTOLOGY_BEHAVIOR_DISABLED',
      reason: 'disabled',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0].join('\n')).toContain('behavior_conflict');

    guard.check(BEHAVIOR);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('同名行为跨两个本体但都放行 → 放行', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, { ontology: 'A本体' });
    writeOntology(agent, {
      ontology: 'B本体',
      securities: ['securities:', `  - action_name: ${BEHAVIOR}`, '    scope:', '      - everyone'].join('\n'),
    });
    const { guard } = guardFor(agent, 'admin');

    expect(guard.check(BEHAVIOR)).toMatchObject({ kind: 'allow' });
  });

  it('无本体：全放行且零告警（FR-021）', () => {
    const agent = tmpAgentDir();
    const { guard, warn } = guardFor(agent);

    expect(guard.check(BEHAVIOR)).toEqual({ kind: 'not_ontology' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('缓存按目录签名失效：只改文件不重载，改目录签名才重载', () => {
    const agent = tmpAgentDir();
    const dir = writeOntology(agent);
    const { guard } = guardFor(agent, 'admin');
    expect(guard.check(BEHAVIOR)).toMatchObject({ kind: 'allow' });

    // 只改文件内容（目录 mtime 不变）→ 仍用旧快照
    fs.writeFileSync(
      path.join(dir, 'securities.yaml'),
      ['securities:', `  - action_name: ${BEHAVIOR}`, '    scope:', '      - zpf'].join('\n'),
      'utf8',
    );
    expect(guard.check(BEHAVIOR)).toMatchObject({ kind: 'allow' });

    // 目录签名变化 → 下一次 check 重载，按新配置拒绝
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(agent, 'ontology'), future, future);
    expect(guard.check(BEHAVIOR)).toMatchObject({
      kind: 'deny',
      code: 'ONTOLOGY_SCOPE_DENIED',
      reason: 'not_in_scope',
    });
  });

  it('invalidate() 丢弃缓存，下一次 check 重新读盘', () => {
    const agent = tmpAgentDir();
    const dir = writeOntology(agent);
    const { guard } = guardFor(agent, 'admin');
    expect(guard.check(BEHAVIOR)).toMatchObject({ kind: 'allow' });

    fs.writeFileSync(
      path.join(dir, 'securities.yaml'),
      ['securities:', `  - action_name: ${BEHAVIOR}`, '    scope:', '      - zpf'].join('\n'),
      'utf8',
    );
    guard.invalidate();

    expect(guard.check(BEHAVIOR)).toMatchObject({ kind: 'deny', reason: 'not_in_scope' });
  });

  it('判定内部异常 → fail-closed internal_error，且永不抛错', () => {
    // 非法 agentDir 让底层 path.join 抛错，验证 catch 分支而不是崩溃
    const warn = vi.fn();
    const guard = createScopeGuard({ agentDir: undefined as never, username: 'admin', warn });

    expect(() => guard.check(BEHAVIOR)).not.toThrow();
    expect(guard.check(BEHAVIOR)).toMatchObject({
      kind: 'deny',
      behavior: null,
      code: 'ONTOLOGY_SCOPE_UNAVAILABLE',
      reason: 'internal_error',
    });
    expect(warn).toHaveBeenCalled();
  });

  it('怪输入不抛：空 agentDir、空工具名、超长工具名', () => {
    const warn = vi.fn();
    const guard = createScopeGuard({ agentDir: '', username: '', warn });

    expect(() => guard.check('')).not.toThrow();
    expect(() => guard.check('a'.repeat(4096))).not.toThrow();
    expect(guard.check('')).toEqual({ kind: 'not_ontology' });
  });
});

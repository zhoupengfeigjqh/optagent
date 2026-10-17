/**
 * 单元测试：本体市场扫描、状态判定与导入/更新/删除（2026-10-03，`FR-060`/`FR-061`）
 *
 * 重点：**认 `ontology.yaml` + `securities.yaml` 两个必需文件**（2026-10-17 起缺任一即
 * `invalid`）、两个文件的哈希共同作为"市场是否变化"的判据、状态流转
 * （new → unchanged → changed → invalid）、落盘结构与市场前两级一致、
 * 重复导入/更新不存在的边界拒绝、路径安全。端到端见 `ontologies.spec.ts`。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  importOntoMarketOntology,
  listOntoMarketOntologies,
  updateOntoMarketOntology,
} from '../../src/domain/ontology/market.js';
import {
  ONTO_MARKET_DIR,
  ONTOLOGY_FILE,
  SECURITIES_FILE,
  OntologyStore,
} from '../../src/domain/ontology/store.js';
import { removeTree } from '../../src/infra/fs-remove.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

const SCENARIO = '生产调度';
const ONTOLOGY = '原材料采购和库存';
const REF = { scenario: SCENARIO, ontology_dir: ONTOLOGY };

const YAML = `metadata:
  created_at: '2026-07-15 16:05:02'
  deployed_version: v1.0
  scenario_name: ${SCENARIO}
  scenario_id: 1
  ontology_name: ${ONTOLOGY}
  ontology_id: 1
concepts: []
`;

/**
 * 生成与市场路径**完全一致**的 ontology.yaml。
 *
 * 2026-10-17 起 `metadata.scenario_name / ontology_name` 就是本体身份
 * （索引不再单独存目录名），入库时强校验二者相等——用 ASCII 目录名做删除用例时
 * 必须让正文跟着改名，否则导入会被拒。
 */
function yamlFor(scenario: string, ontologyDir: string): string {
  return `metadata:
  created_at: '2026-07-15 16:05:02'
  deployed_version: v1.0
  scenario_name: ${scenario}
  scenario_id: 1
  ontology_name: ${ontologyDir}
  ontology_id: 1
concepts: []
`;
}

/** 行为安全管控（必需文件）：样例内容，断言"原样同步" */
const SECURITIES = `securities:
- action_name: CreatePurchaseRecord
  op_type: command
  scope:
  - everyone
  confirm: true
  confirm_content: 请再次确认采购信息。
`;

let root: string;
let market: string;
let dataDir: string;
let ontologies: OntologyStore;

function writeMarket(
  ontologyDir: string,
  content: string,
  scenario = SCENARIO,
  withSecurities = true,
): void {
  const dir = path.join(market, scenario, ontologyDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ONTOLOGY_FILE), content);
  // 2026-10-17：securities.yaml 为必需文件，缺它整条即 invalid；
  // 专门测"缺文件"的用例传 false，其余默认齐全
  if (withSecurities) fs.writeFileSync(path.join(dir, SECURITIES_FILE), SECURITIES);
}

/**
 * 写/删市场侧的安全管控文件（`null` = 删掉，模拟本体未配置或后续移除）。
 *
 * 删除走 `removeTree`（见 `src/infra/fs-remove.ts`）：修复前用 `fs.rmSync` 删含非 ASCII
 * 段的路径会**静默不删**，残留会让"移除"用例变成假失败。改后中文场景/目录名也能真删。
 */
function writeMarketSecurities(ontologyDir: string, content: string | null, scenario = SCENARIO): void {
  const file = path.join(market, scenario, ontologyDir, SECURITIES_FILE);
  if (content === null) {
    removeTree(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function statusOf(target: string): string {
  const listing = listOntoMarketOntologies(market, ontologies);
  return listing.items.find((item) => item.ontology_dir === target)!.status;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-market-unit-'));
  market = path.join(root, 'market');
  dataDir = path.join(root, 'data');
  const store = new PlatformStore(dataDir);
  store.ensureLayout();
  ontologies = new OntologyStore(store);
  writeMarket(ONTOLOGY, YAML);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('市场扫描', () => {
  it('识别 {场景}/{本体}/ontology.yaml 并解析 6 项 metadata', () => {
    const listing = listOntoMarketOntologies(market, ontologies);

    expect(listing.configured).toBe(true);
    expect(listing.reason).toBeNull();
    expect(listing.items).toHaveLength(1);
    expect(listing.items[0]).toMatchObject({
      scenario: SCENARIO,
      ontology_dir: ONTOLOGY,
      name: ONTOLOGY,
      status: 'new',
      invalid_reason: null,
    });
    expect(listing.items[0]!.metadata).toMatchObject({
      deployed_version: 'v1.0',
      scenario_id: 1,
      ontology_id: 1,
    });
    expect(listing.items[0]!.ontology_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('只认 ontology.yaml：缺该文件的二级目录 → invalid（原因可读），场景级散文件不产生条目', () => {
    fs.mkdirSync(path.join(market, SCENARIO, '没有本体的目录'), { recursive: true });
    fs.writeFileSync(path.join(market, SCENARIO, 'meta.json'), '{}');
    fs.mkdirSync(path.join(market, SCENARIO, '__pycache__'), { recursive: true });

    const listing = listOntoMarketOntologies(market, ontologies);
    const broken = listing.items.find((item) => item.ontology_dir === '没有本体的目录')!;

    expect(broken.status).toBe('invalid');
    expect(broken.invalid_reason).toContain(ONTOLOGY_FILE);
    // 其余条目不受影响
    expect(statusOf(ONTOLOGY)).toBe('new');
    expect(listing.items).toHaveLength(2);
  });

  it('YAML 无效 → invalid；单条失效不拖垮整个列表', () => {
    writeMarket('坏本体', 'metadata:\n  a: [未闭合\n');

    expect(statusOf('坏本体')).toBe('invalid');
    expect(statusOf(ONTOLOGY)).toBe('new');
  });

  it('超过单文件上限（16MB）→ invalid', () => {
    writeMarket('巨大本体', `metadata:\n  notes: ${'x'.repeat(16 * 1024 * 1024)}\n`);

    const item = listOntoMarketOntologies(market, ontologies).items.find(
      (entry) => entry.ontology_dir === '巨大本体',
    )!;
    expect(item.status).toBe('invalid');
    expect(item.invalid_reason).toContain('上限');
  });

  it('未配置市场目录 → configured=false；目录不存在 → 原因可读且不报错', () => {
    expect(listOntoMarketOntologies(null, ontologies).configured).toBe(false);
    const missing = listOntoMarketOntologies(path.join(root, '不存在'), ontologies);
    expect(missing.configured).toBe(true);
    expect(missing.reason).toContain('不存在');
    expect(missing.items).toEqual([]);
  });
});

describe('状态流转：new → unchanged → changed', () => {
  it('导入后 unchanged；市场文件改动后 changed（判据 = 两个基准文件的哈希）', () => {
    expect(statusOf(ONTOLOGY)).toBe('new');

    importOntoMarketOntology(market, ontologies, REF);
    expect(statusOf(ONTOLOGY)).toBe('unchanged');

    // 改市场文件
    writeMarket(ONTOLOGY, YAML.replace('v1.0', 'v1.1'));
    expect(statusOf(ONTOLOGY)).toBe('changed');

    // 更新后回到 unchanged
    updateOntoMarketOntology(market, ontologies, REF);
    expect(statusOf(ONTOLOGY)).toBe('unchanged');
  });
});

describe('导入 / 更新 / 删除', () => {
  it('导入落盘结构与市场前两级一致：onto_market/{场景}/{本体}/ontology.yaml，内容同市场', () => {
    const result = importOntoMarketOntology(market, ontologies, REF);
    const saved = path.join(dataDir, ONTO_MARKET_DIR, SCENARIO, ONTOLOGY, ONTOLOGY_FILE);

    // 身份只有 metadata 一份来源：响应也不下发副本字段（2026-10-17）
    expect(result).toMatchObject({ overwritten: false });
    expect(result).not.toHaveProperty('scenario');
    expect(result).not.toHaveProperty('ontology_dir');
    expect(result).not.toHaveProperty('name');
    expect(result.metadata.scenario_name).toBe(SCENARIO);
    expect(result.metadata.ontology_name).toBe(ONTOLOGY);
    expect(result.metadata.deployed_version).toBe('v1.0');
    expect(fs.readFileSync(saved, 'utf8')).toBe(YAML);
  });

  it('index.json 只落 metadata + 两个内容指纹 + 时间戳（身份不重复落盘）', () => {
    importOntoMarketOntology(market, ontologies, REF);
    const index = JSON.parse(
      fs.readFileSync(path.join(dataDir, ONTO_MARKET_DIR, 'index.json'), 'utf8'),
    ) as { items: Array<Record<string, unknown>> };
    const stored = index.items[0]!;

    expect(Object.keys(stored).sort()).toEqual([
      'installed_at',
      'metadata',
      'ontology_hash',
      'securities_hash',
      'updated_at',
    ]);
    expect(stored).not.toHaveProperty('scenario');
    expect(stored).not.toHaveProperty('ontology_dir');
    expect(stored).not.toHaveProperty('name');
    expect(stored).not.toHaveProperty('source');

    // 视图层同样不派生副本：身份只在 metadata 的两个名字里
    const record = ontologies.find(SCENARIO, ONTOLOGY)!;
    expect(record.metadata.scenario_name).toBe(SCENARIO);
    expect(record.metadata.ontology_name).toBe(ONTOLOGY);
    expect(record).not.toHaveProperty('scenario');
    expect(record).not.toHaveProperty('ontology_dir');
    expect(record).not.toHaveProperty('name');
    expect(record).not.toHaveProperty('source');
  });

  it('metadata 与市场路径不一致 → 导入被拒（身份只来自 metadata，不能漂移）', () => {
    // 目录名与 ontology.yaml 里的 ontology_name 不同
    writeMarket('名字不一样', YAML);

    let caught: unknown;
    try {
      importOntoMarketOntology(market, ontologies, {
        scenario: SCENARIO,
        ontology_dir: '名字不一样',
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((caught as ApiError).message).toContain('metadata');
  });

  it('重复导入 → ADM_ONTOLOGY_EXISTS（提示改用更新）', () => {
    importOntoMarketOntology(market, ontologies, REF);

    let caught: unknown;
    try {
      importOntoMarketOntology(market, ontologies, REF);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_ONTOLOGY_EXISTS);
  });

  it('更新换新内容与 ontology_hash、保留 installed_at；库内不存在 → VALIDATION_FAILED', () => {
    const first = importOntoMarketOntology(market, ontologies, REF);
    const before = ontologies.read(SCENARIO, ONTOLOGY).ontology_hash;

    writeMarket(ONTOLOGY, YAML.replace('v1.0', 'v2.0'));
    const updated = updateOntoMarketOntology(market, ontologies, REF);
    const after = ontologies.read(SCENARIO, ONTOLOGY);

    expect(updated.overwritten).toBe(true);
    expect(updated.installed_at).toBe(first.installed_at);
    expect(after.ontology_hash).not.toBe(before);
    expect(after.content).toContain('v2.0');
    expect(after.metadata.deployed_version).toBe('v2.0');

    let caught: unknown;
    try {
      updateOntoMarketOntology(market, ontologies, {
        scenario: SCENARIO,
        ontology_dir: '没导入过',
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('读取详情返回全文（中文路径）', () => {
    importOntoMarketOntology(market, ontologies, REF);
    const detail = ontologies.read(SCENARIO, ONTOLOGY);

    expect(detail.content).toBe(YAML);
    expect(detail.size).toBe(Buffer.byteLength(YAML, 'utf8'));
    expect(detail.metadata.scenario_name).toBe(SCENARIO);
    expect(detail.securities_content).toBe(SECURITIES);
  });

  /**
   * 删除的落地断言：磁盘目录清除、记录消失、再删报 `ADM_ONTOLOGY_NOT_FOUND`。
   *
   * 这里用 ASCII 目录名只是用例可读性——与中文名已无行为差异：修复 `fs.rmSync`
   * 静默失败后（2026-10-09），中文路径同样能真删，见下一条用例。
   */
  it('删除：磁盘目录清除、记录消失、再删 → ADM_ONTOLOGY_NOT_FOUND', () => {
    const scenario = 'demo-scenario';
    const ontologyDir = 'demo-ontology';
    writeMarket(ontologyDir, yamlFor(scenario, ontologyDir), scenario);
    importOntoMarketOntology(market, ontologies, { scenario, ontology_dir: ontologyDir });
    const dir = path.join(dataDir, ONTO_MARKET_DIR, scenario, ontologyDir);
    expect(fs.existsSync(dir)).toBe(true);

    ontologies.remove(scenario, ontologyDir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(ontologies.find(scenario, ontologyDir)).toBeNull();

    let caught: unknown;
    try {
      ontologies.remove(scenario, ontologyDir);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_ONTOLOGY_NOT_FOUND);
  });

  /**
   * 中文路径删除：**必须是真删**（2026-10-09 起）。
   *
   * 修正前本用例还容得下"删不掉 → 抛可读错误且不半删"的分支：根因是 `fs.rmSync`
   * 在 Windows 上对非 ASCII 路径静默失败。现删除走 `removeTree`，中文名同样能删，
   * 故断言收紧为**记录消失且磁盘目录清除**。
   */
  it('中文路径删除：记录消失、磁盘目录清除', () => {
    importOntoMarketOntology(market, ontologies, REF);
    const dir = path.join(dataDir, ONTO_MARKET_DIR, SCENARIO, ONTOLOGY);
    expect(fs.existsSync(dir)).toBe(true);

    ontologies.remove(SCENARIO, ONTOLOGY);

    expect(ontologies.find(SCENARIO, ONTOLOGY)).toBeNull();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('路径安全：场景名/目录名含 `..` 或分隔符 → VALIDATION_FAILED', () => {
    const bad = [
      { scenario: '..', ontology_dir: ONTOLOGY },
      { scenario: SCENARIO, ontology_dir: '../x' },
      { scenario: 'a/b', ontology_dir: ONTOLOGY },
    ];
    for (const ref of bad) {
      let caught: unknown;
      try {
        importOntoMarketOntology(market, ontologies, ref);
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });

  it('未配置市场目录时导入/更新 → VALIDATION_FAILED（不报 500）', () => {
    expect(
      (() => {
        try {
          importOntoMarketOntology(null, ontologies, REF);
        } catch (err) {
          return (err as ApiError).code;
        }
        return 'no-error';
      })(),
    ).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('安全管控同步（securities.yaml，2026-10-17 转为必需文件）', () => {
  it('两个文件齐全 → 可导入；导入后两个文件都原样落盘并记入详情', () => {
    const listing = listOntoMarketOntologies(market, ontologies);
    const item = listing.items[0]!;
    expect(item.status).toBe('new');
    expect(item.securities_size).toBe(Buffer.byteLength(SECURITIES, 'utf8'));
    expect(item.securities_hash).toMatch(/^[0-9a-f]{64}$/);

    importOntoMarketOntology(market, ontologies, REF);
    const saved = path.join(dataDir, ONTO_MARKET_DIR, SCENARIO, ONTOLOGY, SECURITIES_FILE);
    expect(fs.readFileSync(saved, 'utf8')).toBe(SECURITIES);

    const detail = ontologies.read(SCENARIO, ONTOLOGY);
    expect(detail.securities_content).toBe(SECURITIES);
    expect(detail.securities_size).toBe(Buffer.byteLength(SECURITIES, 'utf8'));
    expect(ontologies.find(SCENARIO, ONTOLOGY)!.securities_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('市场缺 securities.yaml → 该条 invalid（原因可读），导入被拒', () => {
    writeMarket('缺安全管控', YAML, SCENARIO, false);
    const item = listOntoMarketOntologies(market, ontologies).items.find(
      (entry) => entry.ontology_dir === '缺安全管控',
    )!;
    expect(item.status).toBe('invalid');
    expect(item.invalid_reason).toContain(SECURITIES_FILE);

    let caught: unknown;
    try {
      importOntoMarketOntology(market, ontologies, {
        scenario: SCENARIO,
        ontology_dir: '缺安全管控',
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('只改 securities.yaml（正文不动）→ changed；更新后回 unchanged', () => {
    writeMarketSecurities(ONTOLOGY, SECURITIES);
    importOntoMarketOntology(market, ontologies, REF);
    expect(statusOf(ONTOLOGY)).toBe('unchanged');

    writeMarketSecurities(ONTOLOGY, SECURITIES.replace('请再次确认', '请再次核对'));
    expect(statusOf(ONTOLOGY)).toBe('changed');

    updateOntoMarketOntology(market, ontologies, REF);
    expect(statusOf(ONTOLOGY)).toBe('unchanged');
    expect(ontologies.read(SCENARIO, ONTOLOGY).securities_content).toContain('请再次核对');
  });

  it('市场移除安全管控 → 该条 invalid、更新被拒；库内副本保留（无半更新）', () => {
    // 本用例要真删文件（市场侧），用 ASCII 名避开 Windows 对非 ASCII 路径的删除限制
    const scenario = 'demo-scenario';
    const ontologyDir = 'demo-ontology';
    const ref = { scenario, ontology_dir: ontologyDir };
    writeMarket(ontologyDir, yamlFor(scenario, ontologyDir), scenario);
    importOntoMarketOntology(market, ontologies, ref);

    const saved = path.join(dataDir, ONTO_MARKET_DIR, scenario, ontologyDir, SECURITIES_FILE);
    expect(fs.existsSync(saved)).toBe(true);

    writeMarketSecurities(ontologyDir, null, scenario);
    expect(statusOf(ontologyDir)).toBe('invalid');

    let caught: unknown;
    try {
      updateOntoMarketOntology(market, ontologies, ref);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    // 拒绝发生在写入之前：库内快照仍是完整的两个文件
    expect(fs.existsSync(saved)).toBe(true);
    expect(ontologies.read(scenario, ontologyDir).securities_content).toBe(SECURITIES);
  });

  it('securities.yaml 超限 → 该条 invalid（不拖垮其它条目）', () => {
    writeMarket('超大本体', YAML);
    writeMarketSecurities('超大本体', `securities: ${'x'.repeat(16 * 1024 * 1024)}\n`);

    const item = listOntoMarketOntologies(market, ontologies).items.find(
      (entry) => entry.ontology_dir === '超大本体',
    )!;
    expect(item.status).toBe('invalid');
    expect(item.invalid_reason).toContain(SECURITIES_FILE);
    expect(statusOf(ONTOLOGY)).toBe('new');
  });
});

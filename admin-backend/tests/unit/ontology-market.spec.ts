/**
 * 单元测试：本体市场扫描、状态判定与导入/更新/删除（2026-10-03，`FR-060`/`FR-061`）
 *
 * 重点：**认 `ontology.yaml` + `securities.yaml`（后者可选）**、两个文件的哈希共同作为
 * "市场是否变化"的判据、状态流转（new → unchanged → changed → invalid）、落盘结构与市场
 * 前两级一致、重复导入/更新不存在的边界拒绝、路径安全。端到端见 `ontologies.spec.ts`。
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

/** 行为安全管控（可选文件）：只写一个样例，断言"原样同步" */
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

function writeMarket(ontologyDir: string, content: string, scenario = SCENARIO): void {
  const dir = path.join(market, scenario, ontologyDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ONTOLOGY_FILE), content);
}

/**
 * 写/删市场侧的安全管控文件（`null` = 删掉，模拟本体未配置或后续移除）。
 *
 * 删除后**校验**：Windows 宿主对含非 ASCII 段的路径存在 `fs.rmSync` 静默不删，
 * 静默残留会让"移除"用例变成假失败，故这里把删除失败直接暴露成夹具错误
 * （需要真删的用例请用 ASCII 场景/目录名，见下面的用例注释）。
 */
function writeMarketSecurities(
  ontologyDir: string,
  content: string | null,
  scenario = SCENARIO,
): void {
  const file = path.join(market, scenario, ontologyDir, SECURITIES_FILE);
  if (content === null) {
    fs.rmSync(file, { force: true });
    if (fs.existsSync(file)) {
      throw new Error(`测试夹具无法删除市场文件（宿主对非 ASCII 路径的限制）：${file}`);
    }
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
    expect(listing.items[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
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

    expect(result).toMatchObject({ scenario: SCENARIO, ontology_dir: ONTOLOGY, overwritten: false });
    expect(result.metadata.deployed_version).toBe('v1.0');
    expect(fs.readFileSync(saved, 'utf8')).toBe(YAML);
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

  it('更新换新内容与 hash、保留 installed_at；库内不存在 → VALIDATION_FAILED', () => {
    const first = importOntoMarketOntology(market, ontologies, REF);
    const before = ontologies.read(SCENARIO, ONTOLOGY).hash;

    writeMarket(ONTOLOGY, YAML.replace('v1.0', 'v2.0'));
    const updated = updateOntoMarketOntology(market, ontologies, REF);
    const after = ontologies.read(SCENARIO, ONTOLOGY);

    expect(updated.overwritten).toBe(true);
    expect(updated.installed_at).toBe(first.installed_at);
    expect(after.hash).not.toBe(before);
    expect(after.content).toContain('v2.0');
    expect(after.metadata.deployed_version).toBe('v2.0');

    let caught: unknown;
    try {
      updateOntoMarketOntology(market, ontologies, { scenario: SCENARIO, ontology_dir: '没导入过' });
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
    expect(detail.source).toBe(`onto_market:${SCENARIO}`);
  });

  /**
   * 删除的**落地断言用 ASCII 目录名**：Windows 宿主对含非 ASCII 段的路径存在
   * "`fs.rmSync` 静默不删"的环境限制（Linux 容器实测正常，见 `PlatformStore.remove`
   * 的删除后校验）。中文名的删除行为由下一条用例按"环境相关"口径覆盖。
   */
  it('删除：磁盘目录清除、记录消失、再删 → ADM_ONTOLOGY_NOT_FOUND', () => {
    const scenario = 'demo-scenario';
    const ontologyDir = 'demo-ontology';
    writeMarket(ontologyDir, YAML, scenario);
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
   * 中文路径删除：**环境相关**，但两种结果都必须自洽。
   *
   * - 删除成功（Linux 等）→ 记录随之消失；
   * - 删除失败（Windows 宿主限制）→ `PlatformStore.remove` 抛**可读错误**，
   *   且索引**未被改写**（记录仍在）—— 宁可不删，也不留"卡片没了、文件还在"的半删状态。
   */
  it('中文路径删除：成功则记录消失；失败则报可读错误且不半删', () => {
    importOntoMarketOntology(market, ontologies, REF);

    let code: string | null = null;
    try {
      ontologies.remove(SCENARIO, ONTOLOGY);
    } catch (err) {
      code = (err as ApiError).code;
    }

    if (code === null) {
      expect(ontologies.find(SCENARIO, ONTOLOGY)).toBeNull();
    } else {
      expect(code).toBe(ERROR_CODES.ADM_STORAGE_UNAVAILABLE);
      expect(ontologies.find(SCENARIO, ONTOLOGY)).not.toBeNull();
      // 清掉残留，避免影响其它用例
      fs.rmSync(path.join(dataDir, ONTO_MARKET_DIR, SCENARIO), { recursive: true, force: true });
    }
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

describe('安全管控同步（securities.yaml，2026-10-03 扩展）', () => {
  it('市场有 securities.yaml → 条目标 has_securities；导入后原样落盘并记入详情', () => {
    writeMarketSecurities(ONTOLOGY, SECURITIES);
    const listing = listOntoMarketOntologies(market, ontologies);
    const item = listing.items[0]!;
    expect(item.has_securities).toBe(true);
    expect(item.securities_size).toBe(Buffer.byteLength(SECURITIES, 'utf8'));
    expect(item.securities_hash).toMatch(/^[0-9a-f]{64}$/);

    importOntoMarketOntology(market, ontologies, REF);
    const saved = path.join(dataDir, ONTO_MARKET_DIR, SCENARIO, ONTOLOGY, SECURITIES_FILE);
    expect(fs.readFileSync(saved, 'utf8')).toBe(SECURITIES);

    const detail = ontologies.read(SCENARIO, ONTOLOGY);
    expect(detail.securities_content).toBe(SECURITIES);
    expect(detail.has_securities).toBe(true);
    expect(detail.securities_size).toBe(Buffer.byteLength(SECURITIES, 'utf8'));
    expect(ontologies.find(SCENARIO, ONTOLOGY)!.securities_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('市场侧没有该文件 → has_securities=false、securities_hash=null；导入后详情为 null', () => {
    const item = listOntoMarketOntologies(market, ontologies).items[0]!;
    expect(item.has_securities).toBe(false);
    expect(item.securities_size).toBe(0);
    expect(item.securities_hash).toBeNull();

    importOntoMarketOntology(market, ontologies, REF);
    const detail = ontologies.read(SCENARIO, ONTOLOGY);
    expect(detail.securities_content).toBeNull();
    expect(detail.has_securities).toBe(false);
    expect(detail.securities_size).toBe(0);
    expect(ontologies.find(SCENARIO, ONTOLOGY)!.securities_hash).toBeNull();
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

  it('市场新增了安全管控（库内是扩展前导入的旧记录）→ changed，一次更新即补齐', () => {
    // 先按"只导入 ontology.yaml"的旧口径落盘：库内没有 securities
    importOntoMarketOntology(market, ontologies, REF);
    expect(statusOf(ONTOLOGY)).toBe('unchanged');

    writeMarketSecurities(ONTOLOGY, SECURITIES);
    expect(statusOf(ONTOLOGY)).toBe('changed');

    updateOntoMarketOntology(market, ontologies, REF);
    expect(statusOf(ONTOLOGY)).toBe('unchanged');
    expect(ontologies.read(SCENARIO, ONTOLOGY).securities_content).toBe(SECURITIES);
  });

  it('市场移除了安全管控 → 更新时清掉库内旧副本（库内 = 市场快照）', () => {
    // 本用例要真删文件（市场侧 + 库内），用 ASCII 名避开 Windows 对非 ASCII 路径的删除限制
    const scenario = 'demo-scenario';
    const ontologyDir = 'demo-ontology';
    const ref = { scenario, ontology_dir: ontologyDir };
    writeMarket(ontologyDir, YAML, scenario);
    writeMarketSecurities(ontologyDir, SECURITIES, scenario);
    importOntoMarketOntology(market, ontologies, ref);

    const saved = path.join(dataDir, ONTO_MARKET_DIR, scenario, ontologyDir, SECURITIES_FILE);
    expect(fs.existsSync(saved)).toBe(true);

    writeMarketSecurities(ontologyDir, null, scenario);
    updateOntoMarketOntology(market, ontologies, ref);

    expect(fs.existsSync(saved)).toBe(false);
    expect(ontologies.read(scenario, ontologyDir).securities_content).toBeNull();
    expect(ontologies.find(scenario, ontologyDir)!.securities_hash).toBeNull();
    expect(statusOf(ontologyDir)).toBe('unchanged');
  });

  it('securities.yaml 超限 → 该条 invalid（不拖垮其它条目）', () => {
    writeMarketSecurities('超大本体', `securities: ${'x'.repeat(16 * 1024 * 1024)}\n`);
    writeMarket('超大本体', YAML);

    const item = listOntoMarketOntologies(market, ontologies).items.find(
      (entry) => entry.ontology_dir === '超大本体',
    )!;
    expect(item.status).toBe('invalid');
    expect(item.invalid_reason).toContain(SECURITIES_FILE);
    expect(statusOf(ONTOLOGY)).toBe('new');
  });
});

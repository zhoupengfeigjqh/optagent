/**
 * dirs 模块单测：场景（scenario.json）随**数字人**存放
 *
 * 运行方式（本地执行；容器只负责部署，见宪章原则三 / 原则八）：
 *   npm run test:all   # 全部测试
 *   npm run test       # 仅本目录单测
 *
 * 覆盖本次变更的核心约束：场景的存放与读取位置由**用户级**改为**数字人级**
 * （`users/{uid}/agents/{agent}/scenario.json`），使同一用户的不同数字人
 * 可以看到不同的文件空间。
 *
 * 说明：`tests/` 不在 tsconfig 的 include 内（不参与构建），此处用无扩展名导入，
 * 由 Vitest 解析到 `src/domain/dirs.ts`。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  DirValidationError,
  ScenarioNotConfiguredError,
  ensureAgentDataDirs,
  ensureRootDirs,
  ensureUserDirs,
  listAvailableDirs,
  loadScenario,
  parseSpaceDir,
  scenarioPath,
  threadDir,
  userDataDir,
  userDataRoot,
} from '../../src/domain/dirs';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-dirs-'));
const userId = 'admin';

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * 写入某个数字人的场景文件。
 *
 * 每个用例使用**独立的数字人名**：`loadScenario` 按 mtime 缓存，同一文件在同毫秒内
 * 被重写会命中旧缓存，用不同名字可彻底避开该抖动。
 */
function writeScenario(agentName: string, content: unknown): void {
  const dir = path.join(root, 'users', userId, 'agents', agentName);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'scenario.json');
  if (content === null) {
    rmSync(file, { force: true });
    return;
  }
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
}

/** 执行并返回抛出的错误；未抛错时返回 `null` */
function capture(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe('scenarioPath - 场景随数字人存放', () => {
  it('落在数字人配置目录内', () => {
    expect(scenarioPath(root, userId, 'demo')).toBe(
      path.join(root, 'users', userId, 'agents', 'demo', 'scenario.json'),
    );
  });

  it('不再指向用户级路径（users/{uid}/scenario.json）', () => {
    expect(scenarioPath(root, userId, 'demo')).not.toBe(
      path.join(root, 'users', userId, 'scenario.json'),
    );
  });

  it('不同数字人的场景路径互不相同', () => {
    expect(scenarioPath(root, userId, 'demo')).not.toBe(scenarioPath(root, userId, 'demo2'));
  });
});

describe('loadScenario - 按数字人各自读取', () => {
  it('同一用户的两个数字人解析出不同的目录清单', () => {
    writeScenario('agent-full', { scenario: '生产调度', data_prep_dirs: ['生产计划', '产线信息'] });
    writeScenario('agent-lite', { scenario: '只读报表', data_prep_dirs: ['产线电价'] });

    const full = loadScenario(root, userId, 'agent-full');
    const lite = loadScenario(root, userId, 'agent-lite');

    expect(full.name).toBe('生产调度');
    expect(full.dataPrepDirs).toEqual(['生产计划', '产线信息']);
    expect(lite.name).toBe('只读报表');
    expect(lite.dataPrepDirs).toEqual(['产线电价']);
  });

  it('场景缺失时抛 ScenarioNotConfiguredError，且报错文案指名该数字人', () => {
    writeScenario('agent-missing', null);

    const error = capture(() => loadScenario(root, userId, 'agent-missing'));

    expect(error).toBeInstanceOf(ScenarioNotConfiguredError);
    expect((error as Error).message).toContain('agent-missing');
  });

  it('场景损坏（非法 JSON）时按未配置处理', () => {
    writeScenario('agent-broken', '{ not json');

    expect(capture(() => loadScenario(root, userId, 'agent-broken'))).toBeInstanceOf(
      ScenarioNotConfiguredError,
    );
  });

  it('场景名为空时按未配置处理', () => {
    writeScenario('agent-noname', { scenario: '   ', data_prep_dirs: ['产线信息'] });

    expect(capture(() => loadScenario(root, userId, 'agent-noname'))).toBeInstanceOf(
      ScenarioNotConfiguredError,
    );
  });

  it('非法目录名被跳过，合法项去重后保留', () => {
    writeScenario('agent-filter', {
      scenario: '生产调度',
      data_prep_dirs: ['产线信息', '../etc', '产线信息', ''],
    });

    expect(loadScenario(root, userId, 'agent-filter').dataPrepDirs).toEqual(['产线信息']);
  });
});

describe('loadScenario - 字段约束（data_prep_fields）', () => {
  it('解析字段约束：按目录归置，保留类型与 required', () => {
    writeScenario('agent-fields', {
      scenario: '全量',
      data_prep_dirs: ['生产计划', '产线电价'],
      data_prep_fields: {
        生产计划: [
          { name: '产线编号', type: 'string', required: true },
          { name: '计划量', type: 'integer', required: false },
        ],
        产线电价: [{ name: '电价', type: 'number', required: true }],
      },
    });

    expect(loadScenario(root, userId, 'agent-fields').dataPrepFields).toEqual({
      生产计划: [
        { name: '产线编号', type: 'string', required: true },
        { name: '计划量', type: 'integer', required: false },
      ],
      产线电价: [{ name: '电价', type: 'number', required: true }],
    });
  });

  it('边界：历史配置（无 data_prep_fields）按"该目录无约束"处理', () => {
    writeScenario('agent-legacy', { scenario: '生产调度', data_prep_dirs: ['生产计划'] });
    expect(loadScenario(root, userId, 'agent-legacy').dataPrepFields).toEqual({});
  });

  it('非法内容一律丢弃，且**不影响场景可用**（运行环境是消费方）', () => {
    writeScenario('agent-bad-fields', {
      scenario: '全量',
      data_prep_dirs: ['生产计划'],
      data_prep_fields: {
        生产计划: [
          { name: '好字段', type: 'string', required: true },
          { name: '坏类型', type: 'text', required: true },
          { name: 'no-required', type: 'string' },
          { name: '', type: 'string', required: true },
          { name: 'a..b', type: 'string', required: true },
          { name: '好字段', type: 'integer', required: false },
          'not-an-object',
        ],
        不在清单的目录: [{ name: 'x', type: 'string', required: true }],
        另一个非数组的目录: 'oops',
      },
    });

    const scenario = loadScenario(root, userId, 'agent-bad-fields');
    expect(scenario.dataPrepDirs).toEqual(['生产计划']);
    expect(scenario.dataPrepFields).toEqual({
      生产计划: [{ name: '好字段', type: 'string', required: true }],
    });
  });

  it('边界：字段清单为空数组的目录**不产生键**（缺失即无约束）', () => {
    writeScenario('agent-empty-fields', {
      scenario: '全量',
      data_prep_dirs: ['生产计划'],
      data_prep_fields: { 生产计划: [] },
    });
    expect(loadScenario(root, userId, 'agent-empty-fields').dataPrepFields).toEqual({});
  });

  it('边界：data_prep_fields 整体非对象时忽略，不影响目录清单', () => {
    writeScenario('agent-fields-not-object', {
      scenario: '全量',
      data_prep_dirs: ['生产计划'],
      data_prep_fields: ['x'],
    });
    const scenario = loadScenario(root, userId, 'agent-fields-not-object');
    expect(scenario.dataPrepDirs).toEqual(['生产计划']);
    expect(scenario.dataPrepFields).toEqual({});
  });
});

describe('parseSpaceDir - 目录清单按数字人判定', () => {
  it('同一目录在一个数字人下合法、在另一个数字人下被拒（403）', () => {
    writeScenario('agent-wide', { scenario: '全量', data_prep_dirs: ['生产计划', '产线电价'] });
    writeScenario('agent-narrow', { scenario: '精简', data_prep_dirs: ['产线电价'] });

    expect(parseSpaceDir(root, userId, 'agent-wide', '数据准备/生产计划').relPath).toBe(
      '数据准备/生产计划',
    );

    const error = capture(() => parseSpaceDir(root, userId, 'agent-narrow', '数据准备/生产计划'));

    expect(error).toBeInstanceOf(DirValidationError);
    expect((error as DirValidationError).statusCode).toBe(403);
  });

  it('共享空间与临时空间不受场景清单限制', () => {
    expect(parseSpaceDir(root, userId, 'agent-narrow', '共享空间').relPath).toBe('共享空间');
    expect(parseSpaceDir(root, userId, 'agent-narrow', '临时空间').relPath).toBe('临时空间');
  });

  it('路径穿越仍为 400（与场景无关的既有防线）', () => {
    const error = capture(() => parseSpaceDir(root, userId, 'agent-narrow', '../etc'));

    expect(error).toBeInstanceOf(DirValidationError);
    expect((error as DirValidationError).statusCode).toBe(400);
  });

  it('非三空间的一级目录为 403', () => {
    const error = capture(() => parseSpaceDir(root, userId, 'agent-narrow', '别的目录'));

    expect(error).toBeInstanceOf(DirValidationError);
    expect((error as DirValidationError).statusCode).toBe(403);
  });
});

describe('路径工厂 - 数据域归到数字人一级（009）', () => {
  const userDataChildNames = (uid: string, agent: string): string[] =>
    readdirSync(userDataDir(root, uid, agent)).sort();

  it('userDataDir 是**数字人数据根**，其父目录才是用户级落点', () => {
    expect(userDataDir(root, userId, 'agent-a')).toBe(
      path.join(userDataRoot(root, userId), 'agent-a'),
    );
    expect(userDataRoot(root, userId)).toBe(path.join(root, 'users', userId, 'user-data'));
  });

  it('**跨用户**同名数字人的数据域互不相同（FR-004 的路径层保证）', () => {
    // 运行期是单用户，但路径里始终带 uid：同名的两个数字人各自一份数据域
    expect(userDataDir(root, 'admin', '同名数字人')).not.toBe(
      userDataDir(root, 'bob', '同名数字人'),
    );
    expect(threadDir(root, 'admin', '同名数字人', 'th_1')).not.toBe(
      threadDir(root, 'bob', '同名数字人', 'th_1'),
    );
  });

  it('threadDir 落在该数字人的数据域下（会话按数字人隔离）', () => {
    expect(threadDir(root, userId, 'agent-a', 'th_1')).toBe(
      path.join(userDataDir(root, userId, 'agent-a'), 'threads', 'th_1'),
    );
    expect(threadDir(root, userId, 'agent-a', 'th_1')).not.toBe(
      threadDir(root, userId, 'agent-b', 'th_1'),
    );
  });

  it('ensureAgentDataDirs 建齐三空间 + threads，且幂等（重复调用不报错、已有内容不动）', () => {
    ensureAgentDataDirs(root, userId, 'agent-skel');
    expect(userDataChildNames(userId, 'agent-skel')).toEqual(
      ['共享空间', '临时空间', '数据准备', 'threads'].sort(),
    );

    const marker = path.join(userDataDir(root, userId, 'agent-skel'), '临时空间', 'keep.txt');
    writeFileSync(marker, 'x', 'utf8');

    expect(() => ensureAgentDataDirs(root, userId, 'agent-skel')).not.toThrow();
    expect(existsSync(marker)).toBe(true);
  });

  it('ensureUserDirs **只**建 agents/：不再预建用户级三空间与 threads（009）', () => {
    // 用独立用户，避免与其他用例已建的数据目录互相干扰
    const onlyUser = 'dirs-only-user';
    ensureUserDirs(root, onlyUser);

    expect(existsSync(path.join(root, 'users', onlyUser, 'agents'))).toBe(true);
    // 用户级不再有数据目录（数据域全在数字人一级，随选中/使用时惰性创建）
    expect(existsSync(userDataRoot(root, onlyUser))).toBe(false);
  });

  it('ensureRootDirs 对已知用户只建 agents/（数字人数据域留给 ensureAgentDataDirs）', () => {
    ensureRootDirs(root, ['dirs-skel-user']);

    expect(existsSync(path.join(root, 'users', 'dirs-skel-user', 'agents'))).toBe(true);
    expect(existsSync(path.join(root, 'users', 'dirs-skel-user', 'user-data'))).toBe(false);
  });
});

describe('listAvailableDirs - 模型可用目录清单（契约 §10.8）', () => {
  it('顺序固定：数据准备子目录 → 共享空间 → 临时空间 → 临时空间/后台产出', () => {
    writeScenario('agent-dirs-full', {
      scenario: '生产调度',
      data_prep_dirs: ['生产计划', '产线信息'],
    });

    expect(listAvailableDirs(root, userId, 'agent-dirs-full')).toEqual([
      '数据准备/生产计划',
      '数据准备/产线信息',
      '共享空间',
      '临时空间',
      '临时空间/后台产出',
    ]);
  });

  it('产出目录**恒在末尾**：{示例路径}/{首个目录} 取首项，末尾追加才不改动那两处取值', () => {
    writeScenario('agent-dirs-order', { scenario: '生产调度', data_prep_dirs: ['生产计划'] });

    const dirs = listAvailableDirs(root, userId, 'agent-dirs-order');

    expect(dirs[0]).toBe('数据准备/生产计划');
    expect(dirs[dirs.length - 1]).toBe('临时空间/后台产出');
  });

  it('场景未配置：退化为三空间根（不含数据准备子目录），产出目录仍在末尾', () => {
    writeScenario('agent-dirs-missing', null);

    expect(listAvailableDirs(root, userId, 'agent-dirs-missing')).toEqual([
      '共享空间',
      '临时空间',
      '临时空间/后台产出',
    ]);
  });
});

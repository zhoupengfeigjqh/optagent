/**
 * 单元测试：场景模块拆分的**契约锁定**（009 T004/T005）
 *
 * `dirs.ts` 已达 504 行（越过宪章原则二 500 行门禁），故把 scenario.json 解析块整体
 * 搬到 `scenario.ts`。拆分是**纯搬移**：行为 MUST 零变化，且既有导入路径 MUST 继续有效
 * （`dirs.ts` 原样 re-export）。本文件守这两条：
 *
 * 1. **同一实现**：`dirs.js` 与 `scenario.js` 导出的同名符号是**同一个对象**
 *    （若是两处各写一份，会在这里失败）
 * 2. **空间策略与场景覆盖的合成口径**：`uploadExtensionsOf`（2026-10-13 的"唯一实现"）
 *    在拆分后仍按"数据准备+二级目录取场景、其余取空间策略"的规则合成
 *
 * 场景解析的逐条规则（非法目录名、孤儿约束、mtime 热更新…）见 `dirs.spec.ts`。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as dirs from '../../src/domain/dirs.js';
import * as scenarioModule from '../../src/domain/scenario.js';
import {
  DATA_PREP_UPLOAD_EXTS,
  SPACE_PREP,
  SPACE_POLICIES,
  SPACE_SHARED,
  SPACE_TMP,
} from '../../src/domain/dirs.js';

const userId = 'admin';
const agentName = 'demo';

let root: string;

function writeScenario(content: string): void {
  const dir = path.join(root, 'users', userId, 'agents', agentName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'scenario.json'), content, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'scenario-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('拆分后的导出契约（dirs.ts re-export ⇒ 同一实现）', () => {
  it('dirs.ts 与 scenario.ts 导出的同为**同一个**函数/类对象', () => {
    expect(dirs.loadScenario).toBe(scenarioModule.loadScenario);
    expect(dirs.parseSpaceDir).toBe(scenarioModule.parseSpaceDir);
    expect(dirs.listAvailableDirs).toBe(scenarioModule.listAvailableDirs);
    expect(dirs.uploadExtensionsOf).toBe(scenarioModule.uploadExtensionsOf);
    expect(dirs.ScenarioNotConfiguredError).toBe(scenarioModule.ScenarioNotConfiguredError);
    expect(dirs.DirValidationError).toBe(scenarioModule.DirValidationError);
    expect(dirs.SCENARIO_FIELD_TYPES).toEqual(scenarioModule.SCENARIO_FIELD_TYPES);
  });

  it('既有导入路径（dirs.js）仍可直接使用：loadScenario 正常解析', () => {
    writeScenario(
      JSON.stringify({
        scenario: '排产',
        data_prep_dirs: ['生产计划'],
        data_prep_fields: { 生产计划: [{ name: '车间', type: 'string', required: true }] },
        data_prep_uploads: { 生产计划: ['.csv'] },
      }),
    );

    const scenario = dirs.loadScenario(root, userId, agentName);
    expect(scenario.name).toBe('排产');
    expect(scenario.dataPrepDirs).toEqual(['生产计划']);
    expect(scenario.dataPrepFields['生产计划']).toEqual([
      { name: '车间', type: 'string', required: true },
    ]);
    expect(scenario.dataPrepUploads['生产计划']).toEqual(['.csv']);
  });
});

describe('uploadExtensionsOf —— 空间策略与场景覆盖的合成', () => {
  it('共享空间/临时空间恒取空间策略（与场景无关，scenario 可缺省）', () => {
    expect(dirs.uploadExtensionsOf(null, SPACE_SHARED)).toEqual(
      SPACE_POLICIES[SPACE_SHARED].uploadExtensions,
    );
    expect(dirs.uploadExtensionsOf(null, SPACE_TMP)).toEqual(
      SPACE_POLICIES[SPACE_TMP].uploadExtensions,
    );
  });

  it('数据准备 + 二级目录：有配置取配置，无配置回落平台默认', () => {
    const scenario = {
      name: 's',
      dataPrepDirs: ['生产计划', '其它'],
      dataPrepFields: {},
      dataPrepUploads: { 生产计划: ['.xlsx'] },
    };
    expect(dirs.uploadExtensionsOf(scenario, SPACE_PREP, '生产计划')).toEqual(['.xlsx']);
    expect(dirs.uploadExtensionsOf(scenario, SPACE_PREP, '其它')).toEqual(
      SPACE_POLICIES[SPACE_PREP].uploadExtensions,
    );
  });

  it('数据准备 + 未指定二级目录（空间根）：取空间策略', () => {
    expect(dirs.uploadExtensionsOf(null, SPACE_PREP)).toEqual(
      SPACE_POLICIES[SPACE_PREP].uploadExtensions,
    );
  });

  it('候选枚举是平台级常量，与空间策略解耦（三处 MUST 同步）', () => {
    expect(DATA_PREP_UPLOAD_EXTS).toContain('.xls');
  });
});

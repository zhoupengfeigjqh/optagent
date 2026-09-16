/**
 * 单元测试：部署清单与差异检测（`FR-031`、`FR-032`）
 *
 * 守住两条边界：
 * ① 只有"**清单内且本次不再需要**"的数字人才允许被移除；
 * ② 运行环境里"非本平台管辖"的内容只会被**报出**，不会被删。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeployManifestService } from '../../src/domain/deploy/manifest.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let store: PlatformStore;
let manifest: DeployManifestService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  manifest = new DeployManifestService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('DeployManifestService', () => {
  it('初始为空清单', () => {
    expect(manifest.read()).toEqual([]);
    expect(manifest.get('admin')).toBeNull();
  });

  it('updateUser 写入并可按用户读取；同一用户重复写入为覆盖', () => {
    manifest.updateUser('admin', ['b', 'a'], '2026-09-15T00:00:00.000Z');
    manifest.updateUser('admin', ['c'], '2026-09-15T01:00:00.000Z');

    expect(manifest.read()).toHaveLength(1);
    expect(manifest.get('admin')).toMatchObject({
      user_id: 'admin',
      agent_names: ['c'],
      last_deployed_at: '2026-09-15T01:00:00.000Z',
    });
  });

  it('数字人名清单按名称排序（便于稳定比对）', () => {
    manifest.updateUser('admin', ['zeta', 'alpha'], 'now');
    expect(manifest.get('admin')?.agent_names).toEqual(['alpha', 'zeta']);
  });

  it('多用户按标识排序（便于人工检视与 diff）', () => {
    manifest.updateUser('ops', [], 'now');
    manifest.updateUser('admin', [], 'now');
    expect(manifest.read().map((e) => e.user_id)).toEqual(['admin', 'ops']);
  });

  it('save 整体替换；损坏的文档按空清单处理（不抛错）', () => {
    manifest.save([{ user_id: 'a', agent_names: [], last_deployed_at: 'x' }]);
    expect(manifest.read()).toHaveLength(1);

    store.writeJson('deploy/manifest.json', { entries: 'not-an-array' });
    expect(manifest.read()).toEqual([]);
  });
});

describe('diff —— 与运行环境的差异（FR-032）', () => {
  it('清单要求但运行环境缺失 → agent_missing_in_runtime', () => {
    const diffs = manifest.diff('admin', ['demo', 'demo2'], ['demo']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ kind: 'agent_missing_in_runtime', target: 'demo2' });
    expect(diffs[0]?.detail).toContain('被手工删除');
  });

  it('运行环境多出、且**由本平台分发过**（在清单内）→ 报出将移除', () => {
    manifest.updateUser('admin', ['demo', 'legacy'], 'now');
    const diffs = manifest.diff('admin', ['demo'], ['demo', 'legacy']);
    expect(diffs.map((d) => d.kind)).toEqual(['agent_unexpected_in_runtime']);
    expect(diffs[0]?.target).toBe('legacy');
  });

  it('运行环境多出、但**不在清单内**（非本平台管辖）→ 不报出、更不会删（FR-031）', () => {
    const diffs = manifest.diff('admin', ['demo'], ['demo', 'manual-agent']);
    expect(diffs).toEqual([]);
  });

  it('完全一致 → 无差异', () => {
    manifest.updateUser('admin', ['demo'], 'now');
    expect(manifest.diff('admin', ['demo'], ['demo'])).toEqual([]);
  });

  it('双方都为空 → 无差异', () => {
    expect(manifest.diff('admin', [], [])).toEqual([]);
  });
});

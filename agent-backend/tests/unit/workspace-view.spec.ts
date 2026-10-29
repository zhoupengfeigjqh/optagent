/**
 * 单元测试：工作空间视图装配的 `predefined` 标记（014）。
 *
 * 为什么需要：前端靠该标记区分"参与空数据判定的目录"，而"预定义目录"是平台业务常量，
 * 前端 MUST NOT 硬编码（宪章原则七）。这里钉住运行端的派生口径：
 * - 只有「数据准备」下、且属于 `PREDEFINED_DATA_PREP_DIRS` 的二级目录为 `true`；
 * - 扁平空间（共享 / 临时）与管理员自定义目录恒为 `false`；
 * - 空目录不改变标记（"目录性质"与"目录里有没有文件"是两件事）。
 */
import { describe, expect, it } from 'vitest';

import type { FileAccess, FileEntry } from '../../src/domain/file-access';
import type { Scenario } from '../../src/domain/dirs';
import { buildWorkspaceView } from '../../src/domain/workspace-view';

/** 最小场景：预定义目录 + 自定义目录 + 一个"名字相近"的目录（防模糊匹配） */
function scenario(): Scenario {
  return {
    name: '测试场景',
    dataPrepDirs: ['算法规则', '生产计划', '算法规则备份'],
    dataPrepFields: {},
    dataPrepUploads: {},
  };
}

/** 只按目录返回固定文件清单的桩；`data` 未列出的目录一律空 */
function access(data: Record<string, FileEntry[]> = {}): FileAccess {
  return {
    list: async (dir: string) => data[dir] ?? [],
  } as unknown as FileAccess;
}

function file(name: string, size = 1): FileEntry {
  return { name, size, isDirectory: false, modifiedAt: '2026-10-29T00:00:00.000Z' };
}

/** 便于按路径取目录项 */
async function viewOf(accessImpl: FileAccess) {
  const view = await buildWorkspaceView(scenario(), accessImpl);
  const dir = (path: string) => {
    const found = view.spaces.flatMap((space) => space.dirs).find((item) => item.dir === path);
    if (!found) throw new Error(`目录不存在: ${path}`);
    return found;
  };
  return { view, dir };
}

describe('buildWorkspaceView —— predefined 标记（014）', () => {
  it('数据准备：预定义目录为 true，自定义目录为 false', async () => {
    const { dir } = await viewOf(access());

    expect(dir('数据准备/算法规则').predefined).toBe(true);
    expect(dir('数据准备/生产计划').predefined).toBe(false);
  });

  it('扁平空间（共享 / 临时）恒为 false', async () => {
    const { dir } = await viewOf(access());

    expect(dir('共享空间').predefined).toBe(false);
    expect(dir('临时空间').predefined).toBe(false);
  });

  it('空目录不改变标记：性质与"有没有文件"相互独立', async () => {
    const { dir } = await viewOf(access());

    expect(dir('数据准备/算法规则').files).toEqual([]);
    expect(dir('数据准备/算法规则').predefined).toBe(true);
  });

  it('名称相近但不属于预定义清单的目录 → false（不做模糊匹配）', async () => {
    const { dir } = await viewOf(access());

    expect(dir('数据准备/算法规则备份').predefined).toBe(false);
  });

  it('既有的文件清单与目录级上传类型不受新字段影响', async () => {
    const { dir } = await viewOf(
      access({ '数据准备/生产计划': [file('计划.csv', 64), file('子目录', 0)] }),
    );

    expect(dir('数据准备/生产计划').files).toEqual([
      { filename: '计划.csv', size: 64, updated_at: '2026-10-29T00:00:00.000Z' },
      { filename: '子目录', size: 0, updated_at: '2026-10-29T00:00:00.000Z' },
    ]);
    expect(dir('数据准备/生产计划').upload_extensions.length).toBeGreaterThan(0);
  });
});

/**
 * 单元测试：三空间路径的**词法判据**（`domain/space-path.ts`，2026-11-02 收敛）。
 *
 * 为什么要有这个文件：此前"哪条路径合法"有两份实现（`FileAccess.resolveSafe` 与
 * `scenario.parseSpaceDir`），口径已经漂移——同一个路径"模型能读、前端看不到"，
 * 以及"场景清单收缩后模型仍能读"。本文件把那张表**逐格钉住**，任何一侧的漂移都会红。
 *
 * 覆盖口径（表驱动）：
 * - 输入形状：空 / 绝对路径 / 盘符相对（`C:foo`）/ UNC / `..` / 多分隔符 / 反斜杠
 * - 四空间 × 四视角（`model-read` / `model-write` / `browse` / `browse-produced`）
 * - 唯一登记例外：`临时空间/后台产出`（模型可读整棵子树，浏览只读该目录本身）
 * - 数据准备清单：**惰性取值**——扁平空间的判定不得触发 scenario 读取（否则"场景未配置"
 *   会连带让共享/临时空间不可用）
 *
 * 本文件只测词法判据；fs 层（存在性 / realpath / 符号链接）由 `file-access.spec.ts` 负责。
 */
import { describe, expect, it } from 'vitest';

import { judgeSpacePath } from '../../src/domain/space-path.js';
import type {
  SpaceCapability,
  SpacePathRules,
  SpacePathVerdict,
} from '../../src/domain/space-path.js';

/** 场景清单：`生产计划` 在清单内，`已下线` 只在磁盘上 */
const RULES: SpacePathRules = { dataPrepDirs: () => ['生产计划', '产线电价'] };
/** 场景未配置（清单为空） */
const EMPTY: SpacePathRules = { dataPrepDirs: () => [] };

const judge = (p: string, cap: SpaceCapability, rules: SpacePathRules = RULES): SpacePathVerdict =>
  judgeSpacePath(p, cap, rules);

/** 断言"被拒且原因命中" */
function expectDeny(
  p: string,
  cap: SpaceCapability,
  kind: string,
  rules: SpacePathRules = RULES,
): void {
  const v = judge(p, cap, rules);
  expect(v.ok, `${cap} ${p} 本应被拒`).toBe(false);
  if (!v.ok) expect(v.kind).toBe(kind);
}

/** 断言"放行且规范化路径命中" */
function expectOk(
  p: string,
  cap: SpaceCapability,
  relPath: string,
  rules: SpacePathRules = RULES,
): void {
  const v = judge(p, cap, rules);
  expect(v.ok, `${cap} ${p} 本应放行，实际 ${JSON.stringify(v)}`).toBe(true);
  if (v.ok) expect(v.relPath).toBe(relPath);
}

describe('space-path —— 输入形状（任何视角一律拒）', () => {
  const caps: SpaceCapability[] = ['model-read', 'model-write', 'browse', 'browse-produced'];

  it('空 / 绝对路径 / UNC / 盘符相对 / NUL 均为 bad-input', () => {
    for (const cap of caps) {
      for (const p of [
        '',
        '/etc/passwd',
        '\\\\server\\share\\x',
        'C:foo',
        'C:\\Windows\\win.ini',
        '临时空间/a\0b',
      ]) {
        expectDeny(p, cap, 'bad-input');
      }
    }
  });

  it('`..` 段一律判非法（不做"收敛后再判"，不依赖后续 path.relative 兜底）', () => {
    for (const p of ['..', '临时空间/../../secret.txt', '数据准备/../threads/x']) {
      expectDeny(p, 'model-read', 'bad-input');
    }
  });

  it('非三空间的一级目录为 space-forbidden', () => {
    for (const p of ['threads/th_1.jsonl', 'skills/SKILL.md', 'scheduled-tasks', '别的目录']) {
      expectDeny(p, 'model-read', 'space-forbidden');
    }
  });
});

describe('space-path —— 数据准备（目录空间，清单是唯一权威）', () => {
  it('缺二级目录 → missing-sub（四个视角一致）', () => {
    for (const cap of ['model-read', 'browse', 'browse-produced'] as SpaceCapability[]) {
      expectDeny('数据准备', cap, 'missing-sub');
      expectDeny('数据准备/', cap, 'missing-sub');
    }
  });

  it('清单内的二级目录：模型可读整棵子树，浏览只到二级', () => {
    expectOk('数据准备/生产计划', 'model-read', '数据准备/生产计划');
    expectOk(
      '数据准备/生产计划/2026-11计划.csv',
      'model-read',
      '数据准备/生产计划/2026-11计划.csv',
    );
    expectOk(
      '数据准备/生产计划/子目录/深层/x.csv',
      'model-read',
      '数据准备/生产计划/子目录/深层/x.csv',
    );

    expectOk('数据准备/生产计划', 'browse', '数据准备/生产计划');
    expectDeny('数据准备/生产计划/子目录', 'browse', 'too-deep');
    expectDeny('数据准备/生产计划/子目录', 'browse-produced', 'too-deep');
  });

  it('清单外的二级目录 → not-in-scenario（即使磁盘上存在、即使模型视角）', () => {
    expectDeny('数据准备/已下线', 'model-read', 'not-in-scenario');
    expectDeny('数据准备/已下线/2026-10计划.csv', 'model-read', 'not-in-scenario');
    expectDeny('数据准备/已下线', 'browse', 'not-in-scenario');
  });

  it('场景未配置（清单为空）⇒ 数据准备整体不可达', () => {
    expectDeny('数据准备/生产计划', 'model-read', 'not-in-scenario', EMPTY);
    expectDeny('数据准备/生产计划', 'browse', 'not-in-scenario', EMPTY);
  });
});

describe('space-path —— 扁平空间（共享空间/临时空间只允许一层）', () => {
  it('空间根对两侧都放行；直属文件只对模型放行（浏览侧传的是目录）', () => {
    for (const cap of ['model-read', 'browse'] as SpaceCapability[]) {
      expectOk('共享空间', cap, '共享空间');
      expectOk('临时空间', cap, '临时空间');
    }
    expectOk('共享空间/说明.txt', 'model-read', '共享空间/说明.txt');
    expectOk('临时空间/th_1_汇总.csv', 'model-read', '临时空间/th_1_汇总.csv');
    expectDeny('共享空间/说明.txt', 'browse', 'not-flat');
    expectDeny('临时空间/别处', 'browse-produced', 'not-flat');
  });

  it('深层子目录 → not-flat（与前端"看不到"对齐，堵住 UI 外直读）', () => {
    expectDeny('共享空间/2026/报价单.xlsx', 'model-read', 'not-flat');
    expectDeny('临时空间/别处/x.csv', 'model-read', 'not-flat');
    expectDeny('临时空间/后台产出/子目录', 'browse', 'not-flat');
  });

  it('词法上无法区分"一层文件"与"同名目录"：`共享空间/2026` 形状合法，目录级拒绝在 stat 之后', () => {
    // 判据只管路径形状（"空间下的一层条目"），是否目录由 `FileAccess.list` 在 readdir 前判定
    expectOk('共享空间/2026', 'model-read', '共享空间/2026');
  });

  it('`临时空间/后台产出` = 唯一登记例外：模型可读整棵子树', () => {
    expectOk('临时空间/后台产出', 'model-read', '临时空间/后台产出');
    expectOk('临时空间/后台产出/ocr_7f3a.json', 'model-read', '临时空间/后台产出/ocr_7f3a.json');
    // 服务自己再分层的产出同样可读（model-read 不限深）
    expectOk('临时空间/后台产出/2026/x.json', 'model-read', '临时空间/后台产出/2026/x.json');
  });

  it('浏览侧只放行产出目录**本身**（读方向），常规浏览仍拒', () => {
    expectOk('临时空间/后台产出', 'browse-produced', '临时空间/后台产出');
    expectDeny('临时空间/后台产出/x.xlsx', 'browse-produced', 'not-flat');
    expectDeny('临时空间/后台产出/子目录', 'browse-produced', 'not-flat');
    expectDeny('临时空间/后台产出', 'browse', 'not-flat');
  });
});

describe('space-path —— 写方向（model-write：仅临时空间顶层）', () => {
  it('临时空间一层放行（前缀/冒号等产品规则不在本判据内）', () => {
    expectOk('临时空间/th_1_汇总.csv', 'model-write', '临时空间/th_1_汇总.csv');
  });

  it('共享空间 / 数据准备 → space-forbidden（只读）', () => {
    expectDeny('共享空间/说明.txt', 'model-write', 'space-forbidden');
    expectDeny('数据准备/生产计划/x.csv', 'model-write', 'space-forbidden');
  });

  it('临时空间子目录 / 后台产出 → not-flat（模型写不进去）', () => {
    expectDeny('临时空间/子目录/x.csv', 'model-write', 'not-flat');
    expectDeny('临时空间/后台产出/x.json', 'model-write', 'not-flat');
  });
});

describe('space-path —— 规范化与惰性清单', () => {
  it('多分隔符 / 尾随分隔符 / `./` 段收敛成 posix 路径', () => {
    expectOk('数据准备//生产计划/', 'model-read', '数据准备/生产计划');
    expectOk('临时空间/./th_1_a.csv', 'model-read', '临时空间/th_1_a.csv');
  });

  it('反斜杠视作分隔符（模型可能给 Windows 分隔符）', () => {
    expectOk('临时空间\\th_1_a.csv', 'model-read', '临时空间/th_1_a.csv');
    expectOk('数据准备\\生产计划\\x.csv', 'model-read', '数据准备/生产计划/x.csv');
  });

  it('扁平空间的判定**不读**场景清单（场景未配置不影响共享/临时空间）', () => {
    const boom: SpacePathRules = {
      dataPrepDirs: () => {
        throw new Error('数据准备判定不应触发场景读取');
      },
    };

    expectOk('共享空间', 'browse', '共享空间', boom);
    expectOk('共享空间/说明.txt', 'model-read', '共享空间/说明.txt', boom);
    expectOk('临时空间/后台产出/x.json', 'model-read', '临时空间/后台产出/x.json', boom);
    expectOk('临时空间/后台产出', 'browse-produced', '临时空间/后台产出', boom);
    // 数据准备才会触发；这里只钉"不抛错就说明没被调用"，故不在此断言其行为
  });
});

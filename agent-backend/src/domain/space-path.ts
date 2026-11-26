import { PRODUCED_SUBDIR, SPACES, SPACE_PREP, SPACE_TMP } from './dirs.js';
import type { SpaceName } from './dirs.js';

export type SpaceCapability = 'model-read' | 'model-write' | 'browse' | 'browse-produced';

/**
 * 浏览侧能力子集：HTTP 文件接口只在这两者间选择。
 *
 * 与 `SpaceCapability` 分开，是为了让 `parseSpaceDir` 在类型上**不可能**被传入
 * `model-*` 视角——模型与浏览的差异只能体现在这张表里，不能顺手借用。
 */
export type BrowseCapability = 'browse' | 'browse-produced';

export type SpacePathDenyKind =
  | 'bad-input'
  /** 一级目录不是已知空间之一，或该能力不允许该空间（如向数据准备写） */
  | 'space-forbidden'
  | 'missing-sub'
  | 'too-deep'
  | 'not-in-scenario'
  /** 扁平空间出现二级目录，且不命中登记例外（`临时空间/后台产出`） */
  | 'not-flat';

export interface SpacePathRules {
  /**
   * 该数字人的数据准备二级目录清单（= `scenario.json` 的 `data_prep_dirs`）。
   *
   * 刻意做成**惰性取值**：判定临时空间时不会调用，因此"场景未配置"不会
   * 连带让临时空间不可用（与 `listAvailableDirs` 的退化口径一致）。
   * 未配置场景时返回空数组即可——数据准备随之整体不可达。
   */
  dataPrepDirs(): readonly string[];
}

export interface SpacePathOk {
  readonly ok: true;
  readonly space: SpaceName;
  /** 数据准备的二级目录名；`临时空间/后台产出` 时为 `后台产出`；其余为 undefined */
  readonly sub?: string;
  readonly relPath: string;
}

export interface SpacePathDeny {
  readonly ok: false;
  readonly kind: SpacePathDenyKind;
  readonly relPath: string;
  readonly space?: string;
  readonly sub?: string;
}

export type SpacePathVerdict = SpacePathOk | SpacePathDeny;

/**
 * 判定一条**相对数字人数据根**的路径在该能力下是否合法。
 *
 * 分隔符 `/` 与 `\` 等价（模型可能给 Windows 分隔符）；`..` 段一律判非法（不做"收敛后再判"，
 * 避免 `临时空间/../threads/x` 这类路径依赖后续 `path.relative` 兜底）。
 */
export function judgeSpacePath(
  relPath: string,
  capability: SpaceCapability,
  rules: SpacePathRules,
): SpacePathVerdict {
  const raw = typeof relPath === 'string' ? relPath : '';
  const deny = (
    kind: SpacePathDenyKind,
    extra?: { space?: string; sub?: string },
  ): SpacePathDeny => ({
    ok: false,
    kind,
    relPath: raw,
    ...(extra?.space !== undefined ? { space: extra.space } : {}),
    ...(extra?.sub !== undefined ? { sub: extra.sub } : {}),
  });

  // 是"盘符相对路径"，解析结果取决于进程 cwd，必须第一道就判死
  if (raw === '' || raw.includes('\0') || raw.startsWith('/') || raw.startsWith('\\')) {
    return deny('bad-input');
  }
  if (/^[a-zA-Z]:/.test(raw)) return deny('bad-input');

  const segments = raw.split(/[/\\]+/).filter((s) => s !== '' && s !== '.');
  if (segments.length === 0 || segments.some((s) => s === '..')) return deny('bad-input');

  const space = segments[0]!;
  if (!(SPACES as readonly string[]).includes(space)) return deny('space-forbidden', { space });

  // 写方向只有临时空间顶层（扁平名；`{threadId}_` 前缀与冒号判据属产品规则，留在 FileAccess.write）
  if (capability === 'model-write') {
    if (space !== SPACE_TMP) return deny('space-forbidden', { space });
    if (segments.length !== 2) return deny('not-flat', { space });
    return { ok: true, space: SPACE_TMP, relPath: `${space}/${segments[1]}` };
  }

  if (space === SPACE_PREP) {
    const sub = segments[1];
    if (!sub) return deny('missing-sub', { space });
    if (capability !== 'model-read' && segments.length > 2) {
      return deny('too-deep', { space, sub });
    }
    if (!rules.dataPrepDirs().includes(sub)) return deny('not-in-scenario', { space, sub });
    return { ok: true, space: SPACE_PREP, sub, relPath: segments.join('/') };
  }

  // 扁平空间：临时空间（含唯一登记例外 后台产出）
  const sub = segments[1];
  if (space === SPACE_TMP && sub === PRODUCED_SUBDIR) {
    if (capability === 'browse-produced') {
      if (segments.length > 2) return deny('not-flat', { space, sub });
      return { ok: true, space: SPACE_TMP, sub, relPath: `${space}/${sub}` };
    }
    if (capability === 'model-read') {
      return { ok: true, space: SPACE_TMP, sub, relPath: segments.join('/') };
    }
    return deny('not-flat', { space, sub });
  }
  if (segments.length > 2) return deny('not-flat', { space, ...(sub ? { sub } : {}) });
  // 浏览侧传的是**目录**：扁平空间只有空间根本身（`临时空间/后台产出` 已在上面单独放行），
  // `临时空间/别处` 这种二级目录一律不可浏览（否则 download/preview 会把它当目录打开）
  if (capability !== 'model-read' && segments.length > 1) {
    return deny('not-flat', { space, ...(sub ? { sub } : {}) });
  }
  return { ok: true, space: space as SpaceName, relPath: segments.join('/') };
}

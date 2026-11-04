/**
 * 三空间路径的**词法判据**（唯一来源，2026-11-02）。
 *
 * 背景：此前"哪条路径合法"有两份实现——`FileAccess.resolveSafe`（模型工具）与
 * `scenario.parseSpaceDir`（HTTP 文件接口），口径不同且已漂移：
 * - 模型侧只判一级目录名 ⇒ `共享空间/2026/报价单.xlsx` 这种前端根本看不到的深层目录能读；
 * - 模型侧对数据准备只验"磁盘上是否存在" ⇒ 场景清单收缩后，已下线目录仍可被 agent 读取
 *   （部署不改文件空间内容，目录与文件都还在磁盘上）。
 *
 * 本模块把"合法性"收敛成一张表，两个消费者共用。**只做字符串判定**，不碰 fs：
 * 目录是否真实存在、符号链接穿越（realpath）、写入文件名前缀（`{threadId}_`）等
 * 仍留在各自实现里——那些是物理判据与产品规则，不是路径合法性。
 *
 * ## 规则（按"空间声明的形态"，而非单纯层级数）
 *
 * - `数据准备` = **目录空间**：必须给二级目录，且该二级目录在**该数字人**的场景清单内；
 *   二级目录之下任意深度可读（目录内容，不额外限深）
 * - `共享空间` / `临时空间` = **扁平空间**：只允许一层（空间本身，或空间下的一个文件）
 * - `数据准备` 与扁平空间的差异不是"松紧"，而是形态不同；MUST NOT 用"统一成同一种深度"
 *   来消除差异
 * - `临时空间/后台产出` = 扁平空间里**唯一登记的例外子树**：MCP 异步工具回写结果落在这里，
 *   换会话后模型要靠 `list_dir` + `read_file` 自己取回（契约 §10.8），故 `model-read` 放行其
 *   全子树；浏览侧（`browse-produced`）只放行这一个目录本身，`browse` 完全不放行
 *
 * **词法判据的边界**：本模块只判"路径形状"，分不清"空间下的一层文件"与"同名子目录"。
 * 因此 `共享空间/2026` 在词法上合法（二层条目），但**列出它是子目录**这件事由
 * `FileAccess.list` 在 stat 之后拒绝（扁平空间不可下钻）。目录级拒绝不在这里，
 * 因为那需要 fs；这里只管"再往下一层就不合法"（三层及以上一律 `not-flat`）。
 *
 * ## 能力矩阵
 *
 * | 空间 | model-read | model-write | browse | browse-produced |
 * |---|---|---|---|---|
 * | 数据准备 | 清单内二级目录及其子树 | 禁止 | 恰好二级（清单内） | 同 browse |
 * | 共享空间 | 一层 | 禁止 | 一层 | 一层 |
 * | 临时空间 | 一层 + `后台产出/**` | 仅顶层扁平名 | 一层 | 恰好 `后台产出` |
 * | 其他 | 禁止 | 禁止 | 禁止 | 禁止 |
 *
 * 判定结果**不携带文案**：HTTP 侧要 400/403 + 面向运维的中文，模型侧要"可自我纠正"的
 * 引导语，两者措辞不同但**合法性必须来自同一处**。文案由消费者按 `kind` 自行映射。
 */
import { PRODUCED_SUBDIR, SPACES, SPACE_PREP, SPACE_TMP } from './dirs.js';
import type { SpaceName } from './dirs.js';

/**
 * 判定视角（能力）。同一路径在不同视角下合法与否不同，一切差异都在这张表里表达。
 *
 * - `model-read`：模型内置工具读（read_file / list_dir / grep_files / MCP file_args）
 * - `model-write`：模型内置工具写（write_file，仅临时空间顶层）
 * - `browse`：HTTP 文件接口的常规口径（列表/上传/删除/预览/下载）
 * - `browse-produced`：HTTP **读方向**额外放行 `临时空间/后台产出`（聊天区产出入口点开）
 */
export type SpaceCapability = 'model-read' | 'model-write' | 'browse' | 'browse-produced';

/**
 * 浏览侧能力子集：HTTP 文件接口只在这两者间选择。
 *
 * 与 `SpaceCapability` 分开，是为了让 `parseSpaceDir` 在类型上**不可能**被传入
 * `model-*` 视角——模型与浏览的差异只能体现在这张表里，不能顺手借用。
 */
export type BrowseCapability = 'browse' | 'browse-produced';

/** 拒绝原因（消费者据此映射状态码与文案） */
export type SpacePathDenyKind =
  /** 空 / 绝对路径 / 盘符 / 含 `..` / 含 NUL */
  | 'bad-input'
  /** 一级目录不是三空间之一，或该能力不允许该空间（如向共享空间写） */
  | 'space-forbidden'
  /** 数据准备未给二级目录 */
  | 'missing-sub'
  /** 数据准备给了三级及以上（仅浏览侧判） */
  | 'too-deep'
  /** 数据准备的二级目录不在该数字人的场景清单内 */
  | 'not-in-scenario'
  /** 扁平空间出现二级目录，且不命中登记例外（`临时空间/后台产出`） */
  | 'not-flat';

export interface SpacePathRules {
  /**
   * 该数字人的数据准备二级目录清单（= `scenario.json` 的 `data_prep_dirs`）。
   *
   * 刻意做成**惰性取值**：判定共享空间/临时空间时不会调用，因此"场景未配置"不会
   * 连带让这两个空间不可用（与 `listAvailableDirs` 的退化口径一致）。
   * 未配置场景时返回空数组即可——数据准备随之整体不可达。
   */
  dataPrepDirs(): readonly string[];
}

export interface SpacePathOk {
  readonly ok: true;
  readonly space: SpaceName;
  /** 数据准备的二级目录名；`临时空间/后台产出` 时为 `后台产出`；其余为 undefined */
  readonly sub?: string;
  /** 规范化后的 posix 相对路径（多分隔符/冗余段已收敛） */
  readonly relPath: string;
}

export interface SpacePathDeny {
  readonly ok: false;
  readonly kind: SpacePathDenyKind;
  /** 原始入参（文案用） */
  readonly relPath: string;
  /** 一级目录名（可能是非三空间的名字）；空入参时为 undefined */
  readonly space?: string;
  /** 被判定的二级目录名（如有） */
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

  // 绝对路径（POSIX / UNC）与盘符前缀：`C:foo` 在 win32 下 path.isAbsolute 为 false，
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

  // 目录空间：数据准备（清单是可见性的唯一权威）
  if (space === SPACE_PREP) {
    const sub = segments[1];
    if (!sub) return deny('missing-sub', { space });
    if (capability !== 'model-read' && segments.length > 2) {
      return deny('too-deep', { space, sub });
    }
    if (!rules.dataPrepDirs().includes(sub)) return deny('not-in-scenario', { space, sub });
    return { ok: true, space: SPACE_PREP, sub, relPath: segments.join('/') };
  }

  // 扁平空间：共享空间 / 临时空间（含唯一登记例外 后台产出）
  const sub = segments[1];
  if (space === SPACE_TMP && sub === PRODUCED_SUBDIR) {
    if (capability === 'browse-produced') {
      if (segments.length > 2) return deny('not-flat', { space, sub });
      return { ok: true, space: SPACE_TMP, sub, relPath: `${space}/${sub}` };
    }
    // model-read：整棵子树可读（产出可能带 sidecar，甚至服务自己再分层）
    if (capability === 'model-read') {
      return { ok: true, space: SPACE_TMP, sub, relPath: segments.join('/') };
    }
    // browse：产出目录对浏览侧不开放（写进去会打乱 `.meta.json` 索引）
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

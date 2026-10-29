/**
 * 工作空间视图装配（`GET /api/files/workspace` 的响应体）。
 *
 * 2026-10-13 从 `routes/files.ts` 拆出（原则二：单文件 ≤ 500 行；拆前该路由文件实测 520 行）。
 * 本模块是**纯装配**：不读会话、不抛业务错误，输入为已加载的场景与该用户的文件访问器。
 *
 * 目录项同时下发两个只读提示字段：
 * - `fields`：该目录的字段约束（无约束 = `[]`），前端做上传入口提示；
 * - `upload_extensions`：该目录**允许上传的类型**（2026-10-13 新增，目录级）。
 *
 * 两者都**只是提示**：权威校验在上传路由，前端 MUST NOT 自行判定（契约 `runtime-api-delta.md` §3.1）。
 */
import {
  SPACE_POLICIES,
  SPACE_PREP,
  SPACE_SHARED,
  SPACE_TMP,
  isPredefinedDataPrepDir,
  uploadExtensionsOf,
  type Scenario,
  type ScenarioField,
} from './dirs.js';
import type { FileAccess } from './file-access.js';

export interface WorkspaceFileItem {
  filename: string;
  size: number;
  updated_at: string;
}

export interface WorkspaceDirItem {
  dir: string;
  label: string;
  deletable: boolean;
  files: WorkspaceFileItem[];
  /** 字段约束（仅数据准备目录可能有值，其余空间恒为 `[]`） */
  fields: ScenarioField[];
  /** 该目录允许上传的扩展名（目录级；与上传路由共用 `uploadExtensionsOf`） */
  upload_extensions: string[];
  /**
   * 是否为平台预定义二级目录（2026-10-29，014）：仅「数据准备/算法规则」为 `true`，
   * 其余二级目录与扁平空间（共享/临时）恒为 `false`。
   *
   * 由运行端派生而非前端硬编码：前端据它区分"参与空数据判定的目录"（宪章原则七）。
   */
  predefined: boolean;
}

export interface WorkspaceSpaceItem {
  name: string;
  agent_writable: boolean;
  upload_extensions: readonly string[];
  dirs: WorkspaceDirItem[];
}

export interface WorkspaceView {
  scenario: string;
  spaces: WorkspaceSpaceItem[];
}

/** 装配三空间视图：空间 → 子目录 → 文件 */
export async function buildWorkspaceView(
  scenario: Scenario,
  access: FileAccess,
): Promise<WorkspaceView> {
  // 目录初始化时已预创建；运行中被删（如手动清理）按空目录容错
  const listFiles = async (relPath: string): Promise<WorkspaceFileItem[]> => {
    const entries = await access.list(relPath).catch(() => []);
    return entries
      .filter((e) => !e.isDirectory)
      .map((e) => ({ filename: e.name, size: e.size, updated_at: e.modifiedAt }));
  };

  const spaces: WorkspaceSpaceItem[] = [];
  for (const space of [SPACE_PREP, SPACE_SHARED, SPACE_TMP] as const) {
    const policy = SPACE_POLICIES[space];
    const subDirs =
      space === SPACE_PREP ? scenario.dataPrepDirs.map((d) => `${SPACE_PREP}/${d}`) : [space];
    const dirs: WorkspaceDirItem[] = [];
    for (const relPath of subDirs) {
      const sub = relPath === space ? undefined : relPath.slice(space.length + 1);
      dirs.push({
        dir: relPath,
        label: sub ?? space,
        deletable: space !== SPACE_SHARED,
        files: await listFiles(relPath),
        fields: scenario.dataPrepFields[sub ?? ''] ?? [],
        // 与上传校验**共用** uploadExtensionsOf ⇒ "界面允许的"与"服务端放行的"单一口径
        upload_extensions: [...uploadExtensionsOf(scenario, space, sub)],
        // 预定义标记只对「数据准备」的二级目录有意义：扁平空间（sub 为 undefined）恒为 false
        predefined: sub !== undefined && isPredefinedDataPrepDir(sub),
      });
    }
    spaces.push({
      name: space,
      agent_writable: policy.agentWritable,
      upload_extensions: policy.uploadExtensions,
      dirs,
    });
  }
  return { scenario: scenario.name, spaces };
}

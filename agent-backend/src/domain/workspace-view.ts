import {
  SPACES,
  SPACE_POLICIES,
  SPACE_PREP,
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
  fields: ScenarioField[];
  upload_extensions: string[];
  /**
   * 是否为平台预定义二级目录（2026-10-29，014）：仅「数据准备/算法规则」为 `true`，
   * 其余二级目录与扁平空间（临时空间）恒为 `false`。
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

export async function buildWorkspaceView(
  scenario: Scenario,
  access: FileAccess,
): Promise<WorkspaceView> {
  const listFiles = async (relPath: string): Promise<WorkspaceFileItem[]> => {
    const entries = await access.list(relPath).catch(() => []);
    return entries
      .filter((e) => !e.isDirectory)
      .map((e) => ({ filename: e.name, size: e.size, updated_at: e.modifiedAt }));
  };

  const spaces: WorkspaceSpaceItem[] = [];
  for (const space of SPACES) {
    const policy = SPACE_POLICIES[space];
    const subDirs =
      space === SPACE_PREP ? scenario.dataPrepDirs.map((d) => `${SPACE_PREP}/${d}`) : [space];
    const dirs: WorkspaceDirItem[] = [];
    for (const relPath of subDirs) {
      const sub = relPath === space ? undefined : relPath.slice(space.length + 1);
      dirs.push({
        dir: relPath,
        label: sub ?? space,
        deletable: true,
        files: await listFiles(relPath),
        fields: scenario.dataPrepFields[sub ?? ''] ?? [],
        upload_extensions: [...uploadExtensionsOf(scenario, space, sub)],
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

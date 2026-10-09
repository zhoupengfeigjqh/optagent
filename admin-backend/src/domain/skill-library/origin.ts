/**
 * SKILL 来源标记与**只读判据**（2026-10-02 来源标记；2026-10-03 只读，`FR-062`）。
 *
 * 独立成模块的原因：`install.ts` 已触及 500 行硬门禁（原则二），而"来源 → 是否可编辑"
 * 是一族自洽的纯判据（含可读报错），拆出来既不牵动安装流程，又能被单测直接覆盖（原则三）。
 *
 * 只读口径（产品决定 2026-10-03）：从本体市场导入的技能是**市场快照**——
 * - 内容只能经「从本体市场导入」窗口的**更新**以市场现版本整体替换；
 * - 在线编辑会让库内内容悄悄偏离市场版本，并使 `origin.hash`（"市场是否变化"的内容指纹）
 *   失去判据意义，故 MUST 拒绝（`ADM_SKILL_READ_ONLY`）。界面不渲染编辑入口，服务端是权威。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

/**
 * 技能来源（2026-10-02）：本体市场导入的技能记录溯源信息与内容指纹。
 * 缺省 = 非市场来源（ZIP 上传等，界面统一标记"外部安装"）。
 */
export interface SkillOrigin {
  kind: 'onto_market';
  /** 市场侧场景名 */
  scenario: string;
  /** 市场侧本体名 */
  ontology: string;
  /** 导入时的整包内容指纹：与市场现算哈希对比即知"市场文件是否变化" */
  hash: string;
}

/** 该来源是否只读（当前只有市场导入一种来源） */
export function isReadOnlyOrigin(origin: SkillOrigin | undefined | null): boolean {
  return origin?.kind === 'onto_market';
}

/**
 * 只读拦截：来源只读即抛 `ADM_SKILL_READ_ONLY`（可读原因 + 替代路径）。
 *
 * @param name 技能名（报错文案用）
 * @param origin 该技能记录的来源标记（缺省 = 非市场来源，放行）
 */
export function assertSkillEditable(name: string, origin: SkillOrigin | undefined | null): void {
  if (!isReadOnlyOrigin(origin)) return;
  throw new ApiError(
    ERROR_CODES.ADM_SKILL_READ_ONLY,
    `本体市场导入的技能为只读：${name}；如需更新其内容，请在「从本体市场导入」窗口中对该技能执行「更新」`,
  );
}

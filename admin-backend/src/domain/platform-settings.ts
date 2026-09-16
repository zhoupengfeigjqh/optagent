/**
 * 平台级设置：**目标运行形态**（`FR-056`／`FR-057`，`data-model.md` §1.2）。
 *
 * 「运行形态」是本期的一个一等概念：MCP 服务的连接地址**随形态而异**
 * （容器编排内网用服务名，宿主机本地用 127.0.0.1），因此平台必须显式知道
 * **本次部署面向哪种形态**，MUST NOT 由平台自身的运行位置推断。
 *
 * 切换形态属**破坏性操作**：既有部署产物需按新形态重新物化，界面 MUST 二次确认；
 * 本接口**不写入** `.opt-agent/`，须由随后的"部署生效"落地。
 */
import { ApiError } from './api-error.js';
import { ERROR_CODES } from './error-codes.js';
import type { PlatformStore } from '../infra/platform-store.js';

/** 运行形态枚举（本期固定两种；`data-model.md` §1.2 的运行形态标识表） */
export const RUNTIME_FORMS = [
  { value: 'container_network', label: '容器编排内网', hint: '容器服务名，如 http://ocr:8000/mcp' },
  { value: 'host_local', label: '宿主机本地', hint: '宿主机可达地址，如 http://127.0.0.1:8000/mcp' },
] as const;

export type RuntimeForm = (typeof RUNTIME_FORMS)[number]['value'];

export const DEFAULT_RUNTIME_FORM: RuntimeForm = 'container_network';

export function isRuntimeForm(value: unknown): value is RuntimeForm {
  return typeof value === 'string' && RUNTIME_FORMS.some((f) => f.value === value);
}

/** 形态标识 → 中文名的可读化（错误信息用） */
export function runtimeFormLabel(value: string): string {
  return RUNTIME_FORMS.find((f) => f.value === value)?.label ?? value;
}

export interface SettingsDocument {
  target_runtime_form: RuntimeForm;
}

const SETTINGS_REL = 'settings.json';

export class PlatformSettingsService {
  constructor(private readonly store: PlatformStore) {}

  /** 当前目标运行形态（文件缺失/损坏时回退默认值，不抛错——保证平台可用） */
  targetForm(): RuntimeForm {
    const doc = this.store.readJson<SettingsDocument>(SETTINGS_REL);
    return isRuntimeForm(doc?.target_runtime_form) ? doc.target_runtime_form : DEFAULT_RUNTIME_FORM;
  }

  /** 读取设置（`contracts/admin-api.md` §1.2） */
  get(): { target_runtime_form: RuntimeForm; revision: number } {
    return { target_runtime_form: this.targetForm(), revision: this.store.revision() };
  }

  /** 列出可选形态（§1.3）——前端 MUST NOT 硬编码（原则七） */
  listForms(): Array<{ value: string; label: string; hint: string }> {
    return RUNTIME_FORMS.map((f) => ({ value: f.value, label: f.label, hint: f.hint }));
  }

  /**
   * 切换目标运行形态（§1.4）。
   * 非枚举值 → `VALIDATION_FAILED`；版本不符 → `ADM_CONFIG_REVISION_CONFLICT`。
   */
  set(
    form: unknown,
    revision: number,
  ): { target_runtime_form: RuntimeForm; revision: number; deploy_required: boolean } {
    if (!isRuntimeForm(form)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `目标运行形态非法：${String(form)}（可选：${RUNTIME_FORMS.map((f) => f.value).join(' / ')}）`,
      );
    }
    const { revision: nextRevision } = this.store.withRevision(revision, () => {
      this.store.writeJson(SETTINGS_REL, { target_runtime_form: form } satisfies SettingsDocument);
    });
    // 切换形态即意味着既有部署产物需按新形态重新物化（FR-057）
    return { target_runtime_form: form, revision: nextRevision, deploy_required: true };
  }
}

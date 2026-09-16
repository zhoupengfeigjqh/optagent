/**
 * 单元测试：平台级设置 —— 目标运行形态（`FR-056`、`FR-057`）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  DEFAULT_RUNTIME_FORM,
  PlatformSettingsService,
  RUNTIME_FORMS,
  isRuntimeForm,
  runtimeFormLabel,
} from '../../src/domain/platform-settings.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let store: PlatformStore;
let settings: PlatformSettingsService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-settings-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  settings = new PlatformSettingsService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('运行形态枚举', () => {
  it('固定两种形态，默认容器编排内网（FR-056）', () => {
    expect(RUNTIME_FORMS.map((f) => f.value)).toEqual(['container_network', 'host_local']);
    expect(DEFAULT_RUNTIME_FORM).toBe('container_network');
  });

  it('isRuntimeForm 严格判定', () => {
    expect(isRuntimeForm('host_local')).toBe(true);
    expect(isRuntimeForm('made_up')).toBe(false);
    expect(isRuntimeForm(undefined)).toBe(false);
    expect(isRuntimeForm(1)).toBe(false);
  });

  it('runtimeFormLabel 取中文名，未知值原样返回', () => {
    expect(runtimeFormLabel('container_network')).toBe('容器编排内网');
    expect(runtimeFormLabel('whatever')).toBe('whatever');
  });
});

describe('PlatformSettingsService', () => {
  it('settings.json 缺失时回退默认形态（保证平台可用）', () => {
    expect(settings.targetForm()).toBe(DEFAULT_RUNTIME_FORM);
    expect(settings.get().target_runtime_form).toBe('container_network');
  });

  it('settings.json 内容非法时同样回退默认（不抛错）', () => {
    store.writeJson('settings.json', { target_runtime_form: 'bogus' });
    expect(settings.targetForm()).toBe('container_network');
  });

  it('set：写入并递增 revision，且提示需重新部署（FR-057）', () => {
    const before = store.revision();
    const result = settings.set('host_local', before);

    expect(result).toEqual({
      target_runtime_form: 'host_local',
      revision: before + 1,
      deploy_required: true,
    });
    expect(settings.targetForm()).toBe('host_local');
  });

  it('set：非枚举值 → VALIDATION_FAILED，且不写入', () => {
    const before = store.revision();
    let caught: unknown;
    try {
      settings.set('nope', before);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(store.revision()).toBe(before);
    expect(settings.targetForm()).toBe('container_network');
  });

  it('set：版本不符 → ADM_CONFIG_REVISION_CONFLICT，且不写入（FR-008）', () => {
    let caught: unknown;
    try {
      settings.set('host_local', 99);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT);
    expect(settings.targetForm()).toBe('container_network');
  });

  it('listForms 提供 value / label / hint，供界面渲染（前端不硬编码，原则七）', () => {
    const forms = settings.listForms();
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form.value).toBeTruthy();
      expect(form.label).toBeTruthy();
      expect(form.hint).toBeTruthy();
    }
  });
});

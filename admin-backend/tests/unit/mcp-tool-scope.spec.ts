/**
 * 单元测试：MCP 服务**工具白名单**（2026-10-03 产品决定）
 *
 * 口径：
 * - 新建**必填非空**（白名单创建后不可改，故在创建这一步就问清楚，不留"全部放行"的后门）；
 * - 归一：元素 trim + 同服务去重；非数组/残缺值即 `VALIDATION_FAILED`；
 * - **保存调用配置不得改白名单**：携带即 `ADM_MCP_TOOL_SCOPE_LOCKED`，不携带则**沿用原值**
 *   （保存 MUST NOT 顺手清空它）；
 * - 存量记录（白名单上线前）读取为 `[]` = **不限制**，存量行为零变化。
 *
 * 自 `service-config.spec.ts` 独立成文件：该文件已接近 500 行门禁（原则二）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { McpServiceConfigService } from '../../src/domain/mcp/service-config.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let store: PlatformStore;
let configs: McpServiceConfigService;

const BASE = { transport: 'http' as const, url: 'http://ocr:8000/mcp' };

/** 取下当前 revision 后新建（新建不传 revision 即按当前版本写入） */
function create(name: string, overrides: Record<string, unknown> = {}): void {
  configs.create({ name, ...BASE, ...overrides });
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as ApiError).code;
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tool-scope-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  configs = new McpServiceConfigService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('新建：白名单必填非空', () => {
  it('缺字段 / 空数组 → VALIDATION_FAILED，且**不落盘**', () => {
    for (const allowed of [undefined, []]) {
      expect(codeOf(() => create('svc', { allowed_tools: allowed }))).toBe(
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
    expect(configs.exists('svc')).toBe(false);
  });

  it('归一：去空白、同服务去重；非字符串元素 → VALIDATION_FAILED', () => {
    create('svc', { allowed_tools: [' ocr_image ', 'ocr_image', 'query_price'] });
    expect(configs.read('svc').allowed_tools).toEqual(['ocr_image', 'query_price']);

    expect(codeOf(() => create('svc2', { allowed_tools: ['ok', 42] }))).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
    expect(codeOf(() => create('svc3', { allowed_tools: 'ocr_image' }))).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('validateForCreate：只校验不落盘（给路由层"先校验、后连接"用）', () => {
    configs.validateForCreate({ name: 'svc', ...BASE, allowed_tools: ['t1'] });
    expect(configs.exists('svc')).toBe(false);

    // 重名 / 白名单缺失都在这一步就被挡下（省掉一次无意义的 MCP 连接）
    create('taken', { allowed_tools: ['t1'] });
    expect(codeOf(() => configs.validateForCreate({ name: 'taken', ...BASE, allowed_tools: ['t1'] }))).toBe(
      ERROR_CODES.ADM_MCP_SERVICE_EXISTS,
    );
    expect(codeOf(() => configs.validateForCreate({ name: 'n1', ...BASE }))).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
  });
});

describe('保存：白名单不可二次调整', () => {
  it('携带 allowed_tools → ADM_MCP_TOOL_SCOPE_LOCKED，且原值不变', () => {
    create('ocr', { allowed_tools: ['ocr_image'] });

    expect(
      codeOf(() =>
        configs.upsert('ocr', { ...BASE, allowed_tools: ['ocher'] }, store.revision()),
      ),
    ).toBe(ERROR_CODES.ADM_MCP_TOOL_SCOPE_LOCKED);
    expect(configs.read('ocr').allowed_tools).toEqual(['ocr_image']);
  });

  it('不携带 → 沿用已存白名单（保存调用配置 MUST NOT 顺手清空它）', () => {
    create('ocr', { allowed_tools: ['ocr_image', 'query_price'] });
    configs.upsert('ocr', { ...BASE, description: '改后的用途' }, store.revision());

    const saved = configs.read('ocr');
    expect(saved.description).toBe('改后的用途');
    expect(saved.allowed_tools).toEqual(['ocr_image', 'query_price']);
  });
});

describe('存量兼容', () => {
  it('旧记录没有该字段 → 读取为 []（= 不限制，存量行为零变化）', () => {
    store.writeJson('mcp-services.json', {
      items: { ocr: { name: 'ocr', description: 'x', ...BASE, file_args: {} } },
    });
    expect(configs.read('ocr').allowed_tools).toEqual([]);
  });

  it('旧记录里该字段是残缺值（非数组）→ 收敛为 []（不阻断读取）', () => {
    store.writeJson('mcp-services.json', {
      items: { ocr: { name: 'ocr', ...BASE, allowed_tools: 'ocr_image' } },
    });
    expect(configs.read('ocr').allowed_tools).toEqual([]);
  });
});

/**
 * 单元测试：MCP 服务的**新建与删除**（2026-09-27，全人工配置）
 *
 * 自 `service-config.spec.ts` 拆出（宪章原则二：单文件 ≤500 行）。
 * 覆盖：名称判据与去空白、重名拒绝、`upsert` 与 `create` 的分工、删除语义。
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

const BASE = {
  description: 'OCR 识别服务',
  transport: 'http' as const,
  url: 'http://ocr:8000/mcp',
  file_args: { ocr_image: { image: 'url' } },
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'service-config-create-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  configs = new McpServiceConfigService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('新建与删除（2026-09-27）', () => {
  it('create 后可按名称读取', () => {
    configs.create({
      name: 'svc',
      transport: 'http',
      url: 'http://host:8000/mcp',
      allowed_tools: ['t1'],
    });
    expect(configs.read('svc').url).toBe('http://host:8000/mcp');
  });

  it('重名 → ADM_MCP_SERVICE_EXISTS（且不覆盖既有配置）', () => {
    configs.create({ name: 'ocr', allowed_tools: ['t1'], ...BASE });
    let caught: unknown;
    try {
      configs.create({
        name: 'ocr',
        transport: 'http',
        url: 'http://other:8000/mcp',
        allowed_tools: ['t2'],
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_MCP_SERVICE_EXISTS);
    expect(configs.read('ocr').url).toBe('http://ocr:8000/mcp');
  });

  it('服务名非法 → VALIDATION_FAILED（该名称会成为运行环境的工具前缀）', () => {
    for (const bad of ['', 'a b', 'a/b', '中文', 'a'.repeat(65)]) {
      expect(() =>
        configs.create({
          name: bad,
          transport: 'http',
          url: 'http://x/mcp',
          allowed_tools: ['t1'],
        }),
      ).toThrow(ApiError);
    }
  });

  it('服务名首尾空白被去掉后保存（便于复制粘贴）', () => {
    configs.create({
      name: '  svc  ',
      transport: 'http',
      url: 'http://x/mcp',
      allowed_tools: ['t1'],
    });
    expect(configs.exists('svc')).toBe(true);
  });

  it('upsert 不存在的服务 → ADM_MCP_SERVICE_NOT_FOUND（新建必须走 create）', () => {
    let caught: unknown;
    try {
      configs.upsert('ghost', BASE, store.revision());
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND);
  });

  it('remove 删除后读不到、listAll 不再包含；删不存在的 → 404', () => {
    configs.create({ name: 'ocr', allowed_tools: ['t1'], ...BASE });
    expect(configs.remove('ocr').name).toBe('ocr');
    expect(configs.readOrNull('ocr')).toBeNull();
    expect(configs.listAll()).toEqual([]);

    let caught: unknown;
    try {
      configs.remove('ghost');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND);
  });
});

/**
 * 单元测试：容器编排声明读取（T022）
 *
 * 覆盖正常 / 畸形 / 缺失文件三类场景，并守住 `FR-043` 的核心口径：
 * MCP 服务清单**以编排声明为唯一来源**，平台服务被排除。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { ComposeReader } from '../../src/infra/compose-reader.js';

let root: string;
let file: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-reader-'));
  file = path.join(root, 'docker-compose.yml');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ComposeReader', () => {
  it('正常解析：服务名、镜像、容器名、端口、环境变量', () => {
    fs.writeFileSync(
      file,
      `services:
  ocr:
    build: ./ocr-service
    container_name: optagent-ocr
    ports:
      - "8000"
    environment:
      - OCR_URL_ALLOW_HOSTS=backend
  api:
    image: nginx:alpine
    environment:
      KEY: value
`,
      'utf8',
    );
    const reader = new ComposeReader(file);
    const list = reader.list();
    expect(list.map((s) => s.name)).toEqual(['ocr', 'api']);
    expect(list[0]?.containerName).toBe('optagent-ocr');
    expect(list[0]?.environment).toEqual({ OCR_URL_ALLOW_HOSTS: 'backend' });
    expect(list[1]?.environment).toEqual({ KEY: 'value' });
    expect(list[1]?.image).toBe('nginx:alpine');
  });

  it('MCP 服务清单排除平台自身服务（FR-043）', () => {
    fs.writeFileSync(
      file,
      `services:
  gateway:
    build: ./gateway
  frontend:
    build: ./frontend
  backend:
    build: ./agent-backend
  admin-frontend:
    build: ./admin-frontend
  admin-backend:
    build: ./admin-backend
  ocr:
    build: ./ocr-service
    ports:
      - "8000"
  new-mcp:
    image: example/mcp:1
    ports:
      - "9000"
`,
      'utf8',
    );
    const reader = new ComposeReader(file);
    // 新增服务无需平台侧登记即被识别（SC-010）
    expect(reader.listMcpServices().map((s) => s.name).sort()).toEqual(['new-mcp', 'ocr']);
  });

  it('文件缺失 → ADM_COMPOSE_FILE_UNREADABLE（不静默返回空）', () => {
    const reader = new ComposeReader(path.join(root, 'not-exists.yml'));
    expect(reader.isReadable()).toBe(false);
    let caught: unknown;
    try {
      reader.list();
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_COMPOSE_FILE_UNREADABLE);
    expect((caught as ApiError).statusCode).toBe(503);
  });

  it('YAML 语法错误 → ADM_COMPOSE_FILE_UNREADABLE 且给出解析原因', () => {
    fs.writeFileSync(file, 'services:\n  ocr: [unclosed\n', 'utf8');
    const reader = new ComposeReader(file);
    expect(reader.isReadable()).toBe(true);
    let caught: unknown;
    try {
      reader.list();
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_COMPOSE_FILE_UNREADABLE);
  });

  it('缺少 services 段 → ADM_COMPOSE_FILE_UNREADABLE', () => {
    fs.writeFileSync(file, 'version: "3"\n', 'utf8');
    expect(() => new ComposeReader(file).list()).toThrow(ApiError);
  });

  it('find 命中/未命中', () => {
    fs.writeFileSync(file, 'services:\n  ocr:\n    build: ./ocr-service\n', 'utf8');
    const reader = new ComposeReader(file);
    expect(reader.find('ocr')?.name).toBe('ocr');
    expect(reader.find('nope')).toBeNull();
  });

  it('传输方式推断：编排内服务一律按 http（内网 MCP 服务不暴露端口，不能据此判成 stdio）', () => {
    fs.writeFileSync(file, 'services:\n  a:\n    ports: ["1"]\n  b:\n    image: x\n', 'utf8');
    const reader = new ComposeReader(file);
    expect(ComposeReader.inferTransport(reader.find('a')!)).toBe('http');
    expect(ComposeReader.inferTransport(reader.find('b')!)).toBe('http');
  });

  it('无 container_name 时容器名退化为服务名', () => {
    fs.writeFileSync(file, 'services:\n  ocr:\n    image: x\n', 'utf8');
    const reader = new ComposeReader(file);
    expect(ComposeReader.containerNameOf(reader.find('ocr')!)).toBe('ocr');
  });
});

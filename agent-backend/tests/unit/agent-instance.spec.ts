/**
 * 单元测试：数字人配置解析（`MCP.json`）
 *
 * 重点守住 2026-09-16 的真实报错回归：管理员把 `MCP.json` 里的 `transport`
 * 按 MCP 生态的写法改成 `streamable-http` 后，运行环境报
 * "transport 须为 stdio|http" 并**把整个数字人从列表排除**。
 * `http` 与 `streamable-http` 本就是一回事（SDK 的 Streamable HTTP 传输），
 * 因此别名必须被接受，且归一到规范值 `http`。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigError, loadAgentConfig } from '../../src/domain/agent-instance.js';

let root: string;

/** 写一个最小可加载的数字人目录（SOUL/TOOL/MCP 三件套） */
function writeAgent(name: string, servers: unknown): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${name}。\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers }), 'utf8');
  return dir;
}

const httpServer = (transport: string) => ({
  name: 'ocr',
  transport,
  url: 'http://ocr:8000/mcp',
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-instance-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('MCP.json 的 transport 兼容性', () => {
  it('`http`（规范值）可加载', () => {
    const bundle = loadAgentConfig(writeAgent('demo', [httpServer('http')]));
    expect(bundle.mcpServers).toHaveLength(1);
    expect(bundle.mcpServers[0]).toMatchObject({ name: 'ocr', transport: 'http' });
  });

  it('`streamable-http`（生态叫法）可加载，并归一到 `http`', () => {
    const bundle = loadAgentConfig(writeAgent('demo', [httpServer('streamable-http')]));
    expect(bundle.mcpServers[0]).toMatchObject({ transport: 'http', url: 'http://ocr:8000/mcp' });
  });

  it('下划线与无分隔符写法同样接受（同一语义的常见变体）', () => {
    for (const variant of ['streamable_http', 'StreamableHTTP']) {
      const bundle = loadAgentConfig(writeAgent('demo', [httpServer(variant)]));
      expect(bundle.mcpServers[0]?.transport).toBe('http');
    }
  });

  it('`stdio` 仍可加载（带 command）', () => {
    const bundle = loadAgentConfig(
      writeAgent('demo', [{ name: 'local', transport: 'stdio', command: 'node', args: ['x.js'] }]),
    );
    expect(bundle.mcpServers[0]).toMatchObject({
      transport: 'stdio',
      command: 'node',
      args: ['x.js'],
    });
  });

  it('未知取值：报错文案给出可接受取值（含别名），便于自查', () => {
    let caught: unknown;
    try {
      loadAgentConfig(writeAgent('demo', [httpServer('websocket')]));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgentConfigError);
    const message = (caught as Error).message;
    expect(message).toContain('streamable-http');
    expect(message).toContain('stdio');
    expect(message).toContain('websocket');
  });

  it('http 形态缺 url / stdio 形态缺 command 仍按原规则拒绝', () => {
    for (const servers of [
      [{ name: 'a', transport: 'streamable-http' }],
      [{ name: 'b', transport: 'stdio' }],
    ]) {
      expect(() => loadAgentConfig(writeAgent('demo', servers))).toThrow(AgentConfigError);
    }
  });
});

describe('MCP.json 的 file_args 取值路径', () => {
  const withFileArgs = (fileArgs: unknown) => ({
    name: 'parse',
    transport: 'http',
    url: 'http://parse:8000/mcp',
    file_args: fileArgs,
  });

  it('对象数组的元素字段路径可加载（items[].excelFileUrl）', () => {
    const bundle = loadAgentConfig(
      writeAgent('demo', [withFileArgs({ parse_excel_files: { 'items[].excelFileUrl': 'url' } })]),
    );

    expect(bundle.mcpServers[0]?.fileArgs).toEqual({
      parse_excel_files: { 'items[].excelFileUrl': 'url' },
    });
  });

  it('顶层参数名（旧写法）照旧可加载', () => {
    const bundle = loadAgentConfig(
      writeAgent('demo', [withFileArgs({ ocr_image: { image: 'url' } })]),
    );

    expect(bundle.mcpServers[0]?.fileArgs).toEqual({ ocr_image: { image: 'url' } });
  });

  it('非法路径：报错并回显正确写法（而不是留个永不生效的声明）', () => {
    let caught: unknown;
    try {
      loadAgentConfig(
        writeAgent('demo', [withFileArgs({ parse_excel_files: { 'items[0]': 'url' } })]),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentConfigError);
    const message = (caught as Error).message;
    expect(message).toContain('items[0]');
    expect(message).toContain('items[].excelFileUrl');
  });
});

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

  it('派生模式 url:from= 可加载（目标字段由引擎注入，覆盖模型填写）', () => {
    const bundle = loadAgentConfig(
      writeAgent('demo', [
        withFileArgs({
          hd_algorithm_input_parser: { 'items[].excelFileUrl': 'url:from=items[].realRelativePath' },
        }),
      ]),
    );

    expect(bundle.mcpServers[0]?.fileArgs).toEqual({
      hd_algorithm_input_parser: { 'items[].excelFileUrl': 'url:from=items[].realRelativePath' },
    });
  });

  it('派生模式：来源路径非法 → AgentConfigError', () => {
    let caught: unknown;
    try {
      loadAgentConfig(
        writeAgent('demo', [
          withFileArgs({ tool: { excelFileUrl: 'url:from=items[0].path' } }),
        ]),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentConfigError);
    expect((caught as Error).message).toContain('不是合法取值路径');
  });

  it('派生模式：来源与目标形状不相容（数组层不一致）→ AgentConfigError', () => {
    let caught: unknown;
    try {
      loadAgentConfig(
        writeAgent('demo', [
          withFileArgs({ tool: { 'items[].excelFileUrl': 'url:from=files[].realRelativePath' } }),
        ]),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentConfigError);
    expect((caught as Error).message).toContain('形状不相容');
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

describe('MCP.json 的 confirmation 调用确认策略（HITL）', () => {
  const withConfirmation = (confirmation: unknown) => ({
    name: 'svc',
    transport: 'http',
    url: 'http://svc:8000/mcp',
    confirmation,
  });

  it('缺省字段：不显式写入 confirmation（运行环境按 never 语义）', () => {
    const bundle = loadAgentConfig(writeAgent('demo', [httpServer('http')]));
    expect(bundle.mcpServers[0]?.confirmation).toBeUndefined();
  });

  it('always 与 { tools } 按原样解析', () => {
    const a = loadAgentConfig(writeAgent('demo', [withConfirmation('always')]));
    expect(a.mcpServers[0]?.confirmation).toBe('always');

    const b = loadAgentConfig(writeAgent('demo', [withConfirmation({ tools: ['query_price'] })]));
    expect(b.mcpServers[0]?.confirmation).toEqual({ tools: ['query_price'] });
  });

  it('never 显式写出也可解析（平台物化在 never 时不写该字段，手写防御）', () => {
    const bundle = loadAgentConfig(writeAgent('demo', [withConfirmation('never')]));
    expect(bundle.mcpServers[0]?.confirmation).toBe('never');
  });

  it('非法形状（typo / tools 空 / 非字符串元素）→ AgentConfigError，挡在加载期', () => {
    for (const bad of ['when_write', { tools: [] }, { tools: ['ok', 42] }]) {
      expect(() => loadAgentConfig(writeAgent('demo', [withConfirmation(bad)]))).toThrow(
        AgentConfigError,
      );
    }
  });
});

describe('MCP.json 的 rules_fields 算法规则参数设置（按工具映射）', () => {
  const withRulesFields = (rules_fields: unknown) => ({
    name: 'svc',
    transport: 'http',
    url: 'http://svc:8000/mcp',
    rules_fields,
  });

  it('缺省：不写入 rulesFields（不启用）', () => {
    const a = loadAgentConfig(writeAgent('demo', [httpServer('http')]));
    expect(a.mcpServers[0]?.rulesFields).toBeUndefined();
  });

  it('{ 工具名: 字段名 }：去空白后解析进 McpServerConfig.rulesFields', () => {
    const bundle = loadAgentConfig(
      writeAgent('demo', [withRulesFields({ optimize: '  rules  ' })]),
    );
    expect(bundle.mcpServers[0]?.rulesFields).toEqual({ optimize: 'rules' });
  });

  it('非法结构（非对象 / 值非非空字符串）→ AgentConfigError（typo 挡在加载期）', () => {
    for (const bad of ['rules', 42, { optimize: 42 }, { optimize: '  ' }]) {
      expect(() => loadAgentConfig(writeAgent('demo', [withRulesFields(bad)]))).toThrow(
        AgentConfigError,
      );
    }
  });

  it('对象路径：支持嵌套字段（如 input.targetPriorities），去空白后原样保留', () => {
    const bundle = loadAgentConfig(
      writeAgent('demo', [withRulesFields({ submit: ' input.targetPriorities ' })]),
    );

    expect(bundle.mcpServers[0]?.rulesFields).toEqual({ submit: 'input.targetPriorities' });
  });

  it('非法路径（数组段 / 空段）→ AgentConfigError', () => {
    for (const path of ['items[].rules', 'a..b', 'a.', '.a']) {
      expect(() => loadAgentConfig(writeAgent('demo', [withRulesFields({ t: path })]))).toThrow(
        AgentConfigError,
      );
    }
  });
});

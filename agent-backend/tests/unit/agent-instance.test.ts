/**
 * agent-instance 配置加载测试（T018）：SOUL.md + skills frontmatter 拼 System Prompt、
 * TOOL.json 过滤启用工具、配置损坏抛 AgentConfigError（上层跳过并告警）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigError, loadAgentConfig } from '../../src/domain/agent-instance';

describe('agent-instance 配置加载', () => {
  let root: string;
  let agentDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-inst-'));
    agentDir = path.join(root, 'agents', 'demo');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, 'SOUL.md'), '# 人设\n你是严谨的生产计划助手。');
    writeFileSync(path.join(agentDir, 'TOOL.json'), JSON.stringify({ enabled: ['read_file', 'calculator'] }));
    writeFileSync(path.join(agentDir, 'MCP.json'), JSON.stringify({ servers: [] }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('完整配置：SOUL + skills frontmatter 拼入 System Prompt，工具按 TOOL.json 过滤', () => {
    const skillDir = path.join(agentDir, 'skills', 'qa');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: qa\ndescription: 问答技能\n---\n# 正文不加载\n详细说明……',
    );
    writeFileSync(
      path.join(agentDir, 'MCP.json'),
      JSON.stringify({
        servers: [
          { name: 'fs-ext', transport: 'stdio', command: 'npx', args: ['mcp-fs'] },
          { name: 'api', transport: 'http', url: 'http://localhost:9000/mcp', write: true, permission_boundary: '只写 tmp' },
        ],
      }),
    );

    const bundle = loadAgentConfig(agentDir);
    expect(bundle.agentName).toBe('demo');
    expect(bundle.systemPrompt).toContain('你是严谨的生产计划助手');
    expect(bundle.systemPrompt).toContain('qa');
    expect(bundle.systemPrompt).toContain('问答技能');
    expect(bundle.systemPrompt).not.toContain('正文不加载');
    expect(bundle.skills).toEqual([{ name: 'qa', description: '问答技能' }]);
    expect(bundle.enabledTools).toEqual(['read_file', 'calculator']);
    expect(bundle.mcpServers).toHaveLength(2);
    expect(bundle.mcpServers[1]).toMatchObject({ name: 'api', write: true, permissionBoundary: '只写 tmp' });
  });

  it('TOOL.json 声明未知内置工具 → 过滤并告警，不整体失败', () => {
    writeFileSync(path.join(agentDir, 'TOOL.json'), JSON.stringify({ enabled: ['read_file', 'hack_everything'] }));
    const warnings: string[] = [];
    const bundle = loadAgentConfig(agentDir, {
      logger: { warn: (msg: string) => warnings.push(msg) },
    });
    expect(bundle.enabledTools).toEqual(['read_file']);
    expect(warnings.join()).toContain('hack_everything');
  });

  it('skills 目录缺失或 SKILL.md 无 frontmatter → 跳过该技能并告警，不影响整体', () => {
    const bad = path.join(agentDir, 'skills', 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(path.join(bad, 'SKILL.md'), '# 没有 frontmatter');
    const warnings: string[] = [];
    const bundle = loadAgentConfig(agentDir, { logger: { warn: (msg: string) => warnings.push(msg) } });
    expect(bundle.skills).toEqual([]);
    expect(bundle.systemPrompt).toContain('生产计划助手');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('SOUL.md 缺失 → AgentConfigError', () => {
    rmSync(path.join(agentDir, 'SOUL.md'));
    expect(() => loadAgentConfig(agentDir)).toThrow(AgentConfigError);
  });

  it('TOOL.json 非法 JSON → AgentConfigError', () => {
    writeFileSync(path.join(agentDir, 'TOOL.json'), '{oops');
    expect(() => loadAgentConfig(agentDir)).toThrow(AgentConfigError);
  });

  it('MCP.json 缺失 → AgentConfigError（配置文件缺失视为损坏）', () => {
    rmSync(path.join(agentDir, 'MCP.json'));
    expect(() => loadAgentConfig(agentDir)).toThrow(AgentConfigError);
  });

  it('MCP 服务声明写能力但无权限边界 → AgentConfigError（FR-024）', () => {
    writeFileSync(
      path.join(agentDir, 'MCP.json'),
      JSON.stringify({ servers: [{ name: 'evil', transport: 'http', url: 'http://x/mcp', write: true }] }),
    );
    expect(() => loadAgentConfig(agentDir)).toThrow(AgentConfigError);
  });

  it('MCP 服务字段非法（缺 name / 未知 transport）→ AgentConfigError', () => {
    writeFileSync(path.join(agentDir, 'MCP.json'), JSON.stringify({ servers: [{ transport: 'stdio' }] }));
    expect(() => loadAgentConfig(agentDir)).toThrow(AgentConfigError);
  });
});

/**
 * 单元测试：数字人作用域判定（009 FR-023/032/050，`domain/agent-scope.ts`）
 *
 * 守住四件事：
 * 1. **两类拒绝分明** —— 未选中 `AGENT_NOT_SELECTED`（沿用既有码/文案）；
 *    已选中但不可用 `AGENT_NOT_AVAILABLE`（新增码，409）
 * 2. **可用性判据是"能完整加载"** —— 目录不存在、或配置损坏（缺 TOOL/MCP）都算不可用；
 *    只看"目录在不在"会让部分配置被静默加载（FR-050 禁止）
 * 3. **不自动清空选中态** —— 陈旧上下文留在内存里，由用户显式重选（前端据此提示）
 * 4. **降级可观测** —— 不可用时落结构化 warn（uid / agent_name / route / reason，FR-051）
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/context.js';
import {
  AgentScopeError,
  resolveAgentScope,
  unavailableReason,
} from '../../src/domain/agent-scope.js';
import { CurrentAgentStore } from '../../src/domain/current-agent.js';
import { agentDir } from '../../src/domain/dirs.js';

const userId = 'admin';
const agentName = 'demo';

let root: string;

function writeAgent(
  name: string,
  opts: { tool?: boolean; mcp?: boolean; soul?: boolean } = {},
): void {
  const dir = agentDir(root, userId, name);
  mkdirSync(dir, { recursive: true });
  if (opts.soul !== false) writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
  if (opts.tool !== false)
    writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  if (opts.mcp !== false)
    writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

/** 最小可用上下文：真实 currentAgent + 假 logger（只记录） */
function makeCtx(): { ctx: AppContext; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const ctx = {
    config: { optAgentRoot: root },
    currentAgent: new CurrentAgentStore(),
    loggers: { logger: { warn, info: vi.fn(), error: vi.fn() } },
  } as unknown as AppContext;
  return { ctx, warn };
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'agent-scope-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveAgentScope —— 未选中', () => {
  it('抛 AGENT_NOT_SELECTED（409），且不落 warn（未选中是正常状态，不是异常）', () => {
    const { ctx, warn } = makeCtx();

    expect(() => resolveAgentScope(ctx, userId)).toThrowError(AgentScopeError);
    try {
      resolveAgentScope(ctx, userId);
    } catch (err) {
      expect((err as AgentScopeError).code).toBe('AGENT_NOT_SELECTED');
      expect((err as AgentScopeError).statusCode).toBe(409);
      expect((err as AgentScopeError).message).toBe('请先选定数字人');
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('文案可覆写：各路由沿用各自既有文案（判定同源、呈现不变）', () => {
    const { ctx } = makeCtx();
    try {
      resolveAgentScope(ctx, userId, { notSelectedMessage: '请先选定数字人再创建对话' });
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as AgentScopeError).message).toBe('请先选定数字人再创建对话');
    }
  });
});

describe('resolveAgentScope —— 已选中且可用', () => {
  it('返回 (用户, 数字人) 二元组', () => {
    writeAgent(agentName);
    const { ctx, warn } = makeCtx();
    ctx.currentAgent.select(userId, agentName);

    expect(resolveAgentScope(ctx, userId)).toEqual({ userId, agentName });
    expect(warn).not.toHaveBeenCalled();
  });

  it('选中态按用户隔离：他人选中不影响本用户', () => {
    writeAgent(agentName);
    const { ctx } = makeCtx();
    ctx.currentAgent.select('someone-else', agentName);

    expect(() => resolveAgentScope(ctx, userId)).toThrowError(AgentScopeError);
  });
});

describe('resolveAgentScope —— 已选中但不可用（AGENT_NOT_AVAILABLE）', () => {
  it('配置目录不存在 → 409 AGENT_NOT_AVAILABLE + 结构化 warn（uid/agent/route/reason）', () => {
    const { ctx, warn } = makeCtx();
    ctx.currentAgent.select(userId, 'ghost');

    try {
      resolveAgentScope(ctx, userId, { route: 'GET /api/files/list' });
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as AgentScopeError).code).toBe('AGENT_NOT_AVAILABLE');
      expect((err as AgentScopeError).statusCode).toBe(409);
      expect((err as AgentScopeError).message).toContain('该数字人已不可用');
      expect((err as AgentScopeError).message).toContain('ghost');
    }

    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, msg] = warn.mock.calls[0]!;
    expect(fields).toMatchObject({
      event: 'agent.scope.unavailable',
      user_id: userId,
      agent_name: 'ghost',
      route: 'GET /api/files/list',
    });
    expect(typeof fields.reason).toBe('string');
    expect(String(msg)).toContain('ghost');
  });

  it('配置损坏（缺 TOOL.json / MCP.json）同样判不可用——不做部分加载', () => {
    writeAgent('broken', { tool: false, mcp: false });
    const { ctx } = makeCtx();
    ctx.currentAgent.select(userId, 'broken');

    expect(() => resolveAgentScope(ctx, userId)).toThrowError(AgentScopeError);
  });

  it('不可用时**不自动清空**选中态（由用户显式重选，FR-032）', () => {
    const { ctx } = makeCtx();
    ctx.currentAgent.select(userId, 'ghost');

    expect(() => resolveAgentScope(ctx, userId)).toThrowError(AgentScopeError);
    expect(ctx.currentAgent.current(userId)).toEqual({ userId, agentName: 'ghost' });
  });
});

describe('unavailableReason —— 判据的唯一实现', () => {
  it('可用 → undefined；目录不存在 → 给原因；配置损坏 → 给原因', () => {
    writeAgent(agentName);
    writeAgent('broken', { soul: false });

    expect(unavailableReason(root, userId, agentName)).toBeUndefined();
    expect(unavailableReason(root, userId, 'ghost')).toBeTruthy();
    expect(unavailableReason(root, userId, 'broken')).toBeTruthy();
  });
});

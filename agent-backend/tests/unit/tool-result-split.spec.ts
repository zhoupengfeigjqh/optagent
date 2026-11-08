/**
 * 单元测试：工具结果的体积分流策略（2026-11-07）。
 *
 * 守三条规则（`inline_content` 任何分支都只存前 `TOOL_INLINE_MAX_BYTES`）：
 * 1. ≤ 内联阈值 → 原文内联（与是否内置无关）；
 * 2. **内置工具**超阈值 → 截断内联 + 说明「完整内容未保存」，**永不落盘**（`artifact` 缺席）；
 * 3. **外部来源**超阈值 → 截断内联（说明里给副本路径）+ 落盘计划，2MB 上限只在这条路径上生效。
 *
 * 内置工具清单**不在这里另写一份**：用 `builtinToolNames()` 逐项参数化，
 * 目录新增/删除工具时这份用例自动覆盖。
 */
import { describe, expect, it } from 'vitest';
import { builtinToolNames } from '../../src/domain/builtin-tool-catalog.js';
import { SPACE_TMP } from '../../src/domain/dirs.js';
import { planSplit, planTruncatedInline } from '../../src/domain/tool-result-split.js';
import {
  TOOL_ARTIFACT_MAX_BYTES,
  TOOL_INLINE_MAX_BYTES,
  artifactFileName,
} from '../../src/domain/tool-result.js';

const THREAD = 'th1';
const CALL = 'call_1';

/** 恰好超过内联阈值 1KB 的文本（ASCII：1 字符 = 1 字节） */
const OVER = 'x'.repeat(TOOL_INLINE_MAX_BYTES + 1024);

function split(name: string, resultText: string, canArtifact = true) {
  return planSplit({
    name,
    resultText,
    size: Buffer.byteLength(resultText, 'utf8'),
    canArtifact,
    threadId: THREAD,
    callId: CALL,
  });
}

describe('tool-result-split —— 内联阈值以内', () => {
  it('原文内联：不截断、不落盘、无摘要', () => {
    const plan = split('read_file', '车间,计划量');
    expect(plan.inlineContent).toBe('车间,计划量');
    expect(plan.artifact).toBeUndefined();
    expect(plan.truncated).toBeUndefined();
    expect(plan.summary).toBeUndefined();
  });

  it('恰好等于阈值仍内联（判据是 ≤）', () => {
    const exact = 'y'.repeat(TOOL_INLINE_MAX_BYTES);
    const plan = split('read_file', exact);
    expect(plan.inlineContent).toBe(exact);
    expect(plan.artifact).toBeUndefined();
  });
});

describe('tool-result-split —— 内置工具超阈值：截断内联，不落副本', () => {
  it.each(builtinToolNames())('%s：截断到阈值 + 末尾说明，且没有落盘计划', (name) => {
    const plan = split(name, OVER);

    expect(plan.artifact).toBeUndefined();
    expect(plan.truncated).toBe(true);
    expect(plan.summary).toBeUndefined();
    expect(plan.inlineContent).toContain('记录已截断');
    expect(plan.inlineContent).toContain('要查看更多请重新调用该工具');
    const body = (plan.inlineContent ?? '').split('\n\n（记录已截断')[0]!;
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(TOOL_INLINE_MAX_BYTES);
  });

  it('截断说明里带原始体积（模型据此判断差多少）', () => {
    const plan = planTruncatedInline(OVER, TOOL_INLINE_MAX_BYTES + 1024);
    expect(plan.inlineContent).toContain('原文 33.0 KB');
  });
});

describe('tool-result-split —— 外部来源超阈值：截断内联 + 外置落盘', () => {
  it('落盘计划：文件名按 {threadId, callId} 推导，正文与体积一致', () => {
    const plan = split('mcp_sql_query', OVER);

    expect(plan.summary).toBeDefined();
    expect(plan.artifact).toMatchObject({
      filename: artifactFileName(THREAD, CALL),
      size: Buffer.byteLength(OVER, 'utf8'),
    });
    expect(plan.artifact?.content).toBe(OVER);
  });

  it('记录里同时留截断版：正文截在阈值内，说明给出副本路径（模型可 read_file 取回）', () => {
    const plan = split('mcp_sql_query', OVER);

    expect(plan.truncated).toBe(true);
    expect(plan.inlineContent).toContain(artifactFileName(THREAD, CALL));
    expect(plan.inlineContent).toContain(SPACE_TMP);
    expect(plan.inlineContent).toContain('可用 read_file 读取');
    expect(plan.inlineContent).not.toContain('完整内容未保存');
    const body = (plan.inlineContent ?? '').split('\n\n（记录已截断')[0]!;
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(TOOL_INLINE_MAX_BYTES);
  });

  it('超过 2MB 落盘上限：副本按上限截断（size > artifact.size 即判据）', () => {
    const huge = 'z'.repeat(TOOL_ARTIFACT_MAX_BYTES + 1024);
    const plan = split('mcp_sql_query', huge);

    expect(plan.truncated).toBe(true);
    expect(plan.artifact?.size).toBe(TOOL_ARTIFACT_MAX_BYTES);
    expect(TOOL_ARTIFACT_MAX_BYTES).toBeLessThan(Buffer.byteLength(huge, 'utf8'));
  });

  it('未装配外置能力（canArtifact=false）：降级为截断内联，说明改为"未保存"且不给路径', () => {
    const plan = split('mcp_sql_query', OVER, false);

    expect(plan.artifact).toBeUndefined();
    expect(plan.truncated).toBe(true);
    expect(plan.inlineContent).toContain('完整内容未保存');
    expect(plan.inlineContent).not.toContain(SPACE_TMP);
  });
});

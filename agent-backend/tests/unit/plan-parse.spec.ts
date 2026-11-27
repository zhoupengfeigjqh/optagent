import { describe, expect, it } from 'vitest';

import { parsePlanOutput } from '../../src/domain/plan/parse.js';

const VALID = '[{"seqId":1,"taskName":"查询库存","content":"调用 QueryInventory","coreAction":"QueryInventory","type":"query"}]';

describe('parsePlanOutput', () => {
  it('合法数组', () => {
    const result = parsePlanOutput(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.coreAction).toBe('QueryInventory');
  });

  it('带代码围栏与前后空白', () => {
    const result = parsePlanOutput(`\n  \`\`\`json\n${VALID}\n\`\`\`  \n`);
    expect(result.ok).toBe(true);
  });

  it('无语言标记的围栏', () => {
    expect(parsePlanOutput(`\`\`\`\n${VALID}\n\`\`\``).ok).toBe(true);
  });

  it('空数组是合法输出', () => {
    const result = parsePlanOutput('[]');
    expect(result).toEqual({ ok: true, steps: [] });
  });

  it('非 JSON → P_JSON', () => {
    const result = parsePlanOutput('抱歉，我无法完成');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('P_JSON');
  });

  it('顶层是对象而非数组 → P_ARRAY', () => {
    const result = parsePlanOutput('{"seqId":1}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('P_ARRAY');
  });

  it('超过 3 步 → P_STEPS', () => {
    const steps = [1, 2, 3, 4].map((index) => ({
      seqId: index,
      taskName: `步骤${index}`,
      content: '内容',
      coreAction: 'QueryInventory',
      type: 'query',
    }));
    const result = parsePlanOutput(JSON.stringify(steps));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('P_STEPS');
  });

  it('字段缺失 → P_FIELD 并点名字段', () => {
    const result = parsePlanOutput('[{"seqId":1,"taskName":"x","coreAction":"A","type":"query"}]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('P_FIELD');
    expect(result.failure.field).toBe('content');
    expect(result.failure.seqId).toBe(1);
  });

  it('seqId 非数值 → P_FIELD', () => {
    const result = parsePlanOutput('[{"seqId":"1","taskName":"x","content":"y","coreAction":"A","type":"query"}]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.field).toBe('seqId');
  });

  it('数组元素不是对象 → P_FIELD', () => {
    const result = parsePlanOutput('[1]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('P_FIELD');
  });
});

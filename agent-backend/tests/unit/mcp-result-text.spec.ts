/**
 * 单元测试：MCP 工具结果 → 结果文本口径（2026-10-12）
 *
 * 守住五件事：
 * 1. **字符串原样** —— 旧行为不变，且不需要扫描
 * 2. **逐块挑选** —— text 块拼接、image 块转体积占位；业务正文不再被压进"字符串里的 JSON"
 *    （本次修复的点：解析类工具结果里的 `viewUrl` 必须能被 `extractViewLinks` 抽到）
 * 3. **认不出就 JSON 兜底** —— 宁可多一层字符串，也不丢信息（含空 `content` / 非块形状）
 * 4. **可观测** —— 被跳过的块类型上报成结构化 warn，不静默（宪章原则九）
 * 5. **历史信封解包**（`unwrapMcpEnvelopeText`）—— 判据收窄，仅供回填脚本
 *
 * 适配器接线在本文件末尾用真（假 manager）端到端验证：口径只有一处实现
 * （`domain/tool-result.ts`），这里守的是"模型看到的 == 记录里的"这条结构保证。
 */
import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import { extractViewLinks } from '../../src/domain/view-links.js';
import type { McpManager } from '../../src/infra/mcp/mcp-manager.js';
import { mcpResultText, unwrapMcpEnvelopeText } from '../../src/infra/mcp/mcp-result-text.js';
import { mcpToolsAsAgentTools } from '../../src/infra/mcp/mcp-tool-adapter.js';

/** 被调工具的声明（解析类，形状无关本文件断言） */
const TOOL = {
  name: 'hd_algorithm_input_parser',
  description: '解析排产输入文件',
  inputSchema: { type: 'object', properties: {} },
};

/** 收集日志的假 logger（与 `mcp-tool-adapter.spec.ts` 同口径：成功调用也会走 info） */
function captureLogger(): { logger: Logger; warns: Array<Record<string, unknown>> } {
  const warns: Array<Record<string, unknown>> = [];
  const logger = {
    warn: (fields: Record<string, unknown>) => {
      warns.push(fields);
    },
    info: () => undefined,
  } as unknown as Logger;
  return { logger, warns };
}

describe('mcpResultText —— 形状分发与逐块挑选', () => {
  it('字符串结果原样返回（旧行为不变）', () => {
    expect(mcpResultText('车间,计划量\n冲压,1200')).toBe('车间,计划量\n冲压,1200');
  });

  it('单块 text：得到服务正文本身，而不是 CallToolResult 信封', () => {
    const payload = '[{"businessType":3,"viewUrl":"/datapage/production-line-electricity"}]';

    const text = mcpResultText({
      content: [{ type: 'text', text: payload }],
      isError: false,
    });

    expect(text).toBe(payload);
    expect(text).not.toContain('isError');
    expect(text).not.toContain('\\"businessType\\"'); // 不再是被转义的"字符串里的 JSON"
  });

  it('多块 text：按出现顺序用换行拼接', () => {
    const text = mcpResultText({
      content: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ],
    });

    expect(text).toBe('第一段\n第二段');
  });

  it('image 块转体积占位：base64 不进结果文本（不落盘、不喂给模型）', () => {
    const base64 = 'x'.repeat(4096);

    const text = mcpResultText({
      content: [{ type: 'image', mimeType: 'image/png', data: base64 }],
    });

    expect(text).toBe('[图片 image/png ~3.0 KB]');
    expect(text).not.toContain('xxxx');
  });

  it('image 块缺 data：仍给占位（只少体积）', () => {
    expect(mcpResultText({ content: [{ type: 'image', mimeType: 'image/png' }] })).toBe(
      '[图片 image/png]',
    );
  });

  it('content 数组里没有可用块 → JSON 兜底（不丢信息）', () => {
    const text = mcpResultText({ content: [{ type: 'audio', data: 'AAAA' }], isError: false });

    expect(text).toContain('"audio"');
    expect(text).toContain('AAAA');
  });

  it('空 content 数组 / content 不是数组 / 非 content 对象 → JSON 兜底', () => {
    expect(mcpResultText({ content: [] })).toContain('"content": []');
    expect(mcpResultText({ content: 'x' })).toContain('"content": "x"');
    expect(mcpResultText({ ok: true })).toContain('"ok": true');
  });
});

describe('mcpResultText —— 被跳过的块必须可观测（原则九）', () => {
  it('不传告警落点：照常出文本，不扫描也不崩', () => {
    expect(mcpResultText({ content: [{ type: 'audio' }] })).toContain('"audio"');
  });

  it('audio / resource_link 与 text 混排：text 保留，被跳过的块逐个上报', () => {
    const { logger, warns } = captureLogger();

    const text = mcpResultText(
      {
        content: [
          { type: 'text', text: '解析完成' },
          { type: 'audio', data: 'AAAA' },
          { type: 'resource_link', uri: 'file:///x' },
        ],
      },
      { logger, service: 'hd-algorithm', tool: 'hd_algorithm_input_parser' },
    );

    expect(text).toBe('解析完成');
    expect(warns).toHaveLength(2);
    expect(warns[0]).toMatchObject({
      alert: true,
      event: 'mcp.result.block_unsupported',
      service: 'hd-algorithm',
      tool: 'hd_algorithm_input_parser',
      block_type: 'audio',
    });
    expect(warns[1]).toMatchObject({ block_type: 'resource_link' });
  });

  it('text 块的 text 不是字符串：同样上报（serializeToolResult 会跳过它）', () => {
    const { logger, warns } = captureLogger();

    mcpResultText({ content: [{ type: 'text', text: 42 }] }, { logger, service: 's', tool: 't' });

    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ block_type: 'text' });
  });

  it('image 块被认识：转占位即可，不产生告警', () => {
    const { logger, warns } = captureLogger();

    mcpResultText(
      { content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] },
      { logger, service: 's', tool: 't' },
    );

    expect(warns).toEqual([]);
  });
});

describe('unwrapMcpEnvelopeText —— 历史信封解包（仅供回填脚本）', () => {
  it('标准信封 → 内层正文（不再是字符串里的 JSON）', () => {
    const payload = '[{"viewUrl":"/datapage/x","success":true}]';
    const stored = JSON.stringify({ content: [{ type: 'text', text: payload }], isError: false });

    expect(unwrapMcpEnvelopeText(stored)).toBe(payload);
  });

  it('多块 text → 换行拼接', () => {
    const stored = JSON.stringify({
      content: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ],
    });

    expect(unwrapMcpEnvelopeText(stored)).toBe('第一段\n第二段');
  });

  it('不是信封形状 → undefined（判据收窄，不做通用二次解析）', () => {
    expect(unwrapMcpEnvelopeText('[{"viewUrl":"/a"}]')).toBeUndefined(); // 顶层数组
    expect(unwrapMcpEnvelopeText('{"ok":true}')).toBeUndefined(); // 无 content
    expect(unwrapMcpEnvelopeText('{"content":[]}')).toBeUndefined(); // 无 text 块
    expect(unwrapMcpEnvelopeText('{"content":"x"}')).toBeUndefined(); // content 不是数组
    expect(unwrapMcpEnvelopeText('{"content":[{"type":"image","data":"A"}]}')).toBeUndefined();
    expect(unwrapMcpEnvelopeText('车间,计划量')).toBeUndefined(); // 非 JSON
    expect(unwrapMcpEnvelopeText('"just a string"')).toBeUndefined(); // JSON 但不是对象
    expect(unwrapMcpEnvelopeText('')).toBeUndefined();
  });
});

describe('适配器接线：模型看到的 == 记录里的（端到端）', () => {
  /** 假 manager：不触网，直接给出"服务返回的结果对象" */
  function toolReturning(result: unknown, logger?: Logger) {
    const manager = { callTool: async () => result } as unknown as McpManager;
    const [tool] = mcpToolsAsAgentTools(
      manager,
      'hd-algorithm',
      [TOOL] as never,
      undefined,
      undefined,
      undefined,
      undefined,
      logger,
    );
    return tool!;
  }

  it('对象结果：结果文本是业务 JSON，viewUrl 可被抽成入口（回归本次 bug）', async () => {
    const payload = [
      {
        businessType: 3,
        success: true,
        viewUrl: '/datapage/production-line-electricity?userId=admin',
      },
    ];
    const tool = toolReturning({ content: [{ type: 'text', text: JSON.stringify(payload) }] });

    const result = (await tool.execute('call_1' as never, {} as never)) as {
      content: Array<{ text: string }>;
    };
    const text = result.content[0]!.text;

    expect(text).toBe(JSON.stringify(payload));
    expect(extractViewLinks(text)).toEqual([
      { url: '/datapage/production-line-electricity?userId=admin' },
    ]);
  });

  it('image 块：base64 不出现在结果文本里', async () => {
    const base64 = 'A'.repeat(2048);
    const tool = toolReturning({
      content: [{ type: 'image', mimeType: 'image/png', data: base64 }],
    });

    const result = (await tool.execute('call_1' as never, {} as never)) as {
      content: Array<{ text: string }>;
    };

    expect(result.content[0]!.text).not.toContain(base64);
    expect(result.content[0]!.text).toContain('[图片 image/png');
  });

  it('不支持的块类型：记一条结构化 warn，不静默丢弃', async () => {
    const { logger, warns } = captureLogger();
    const tool = toolReturning({ content: [{ type: 'audio', data: 'AAAA' }] }, logger);

    await tool.execute('call_1' as never, {} as never);

    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({
      event: 'mcp.result.block_unsupported',
      service: 'hd-algorithm',
      tool: 'hd_algorithm_input_parser',
      block_type: 'audio',
    });
  });
});

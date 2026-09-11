/**
 * 联调用的最小 stdio MCP server（仅暴露一个 `itest_echo` 工具）。
 *
 * 用途：给 `demo2` 提供一个**能真连上**的 MCP 服务，从而在前端数字人面板里
 * 同时看到一绿（连接正常）一红（连接失败），完整覆盖 FR-033 的双通道标识。
 * 正常无需手动启动——后端 MCP 客户端会按 `agents/demo2/MCP.json` 自动拉起。
 *
 *   npx tsx scripts/itest-mcp-server.ts --self-check   # 自检：以 MCP 客户端连自己并调用工具
 *   npx tsx scripts/itest-mcp-server.ts                # 作为 stdio server 常驻
 *
 * ⚠️ stdio 模式下 stdout 是 JSON-RPC 通道，**任何 console.log 都会破坏协议**，
 * 因此本文件在 server 模式下不向 stdout 写任何内容。
 */
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const TOOL_NAME = 'itest_echo';

/** 组装本文件的绝对路径（自检时需要再拉起一次自身） */
const SELF_PATH = fileURLToPath(import.meta.url);

async function serve(): Promise<void> {
  const server = new Server(
    { name: 'itest-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: TOOL_NAME,
        description: '联调占位工具：把 text 参数原样回显。',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: '要回显的文本' } },
          required: [],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as { text?: unknown };
    const text = typeof args.text === 'string' ? args.text : '';
    return { content: [{ type: 'text', text: `itest-echo: ${text}` }] };
  });

  await server.connect(new StdioServerTransport());
}

/** 自检：用 SDK 客户端连自己，验证握手 + listTools + callTool 全链路 */
async function selfCheck(): Promise<void> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const failures: string[] = [];
  const client = new Client({ name: 'itest-mcp-selfcheck', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    // tsx 作为 loader 注入：Node 20+ 均可用，不依赖 Node 24 的原生 TS 剥离
    args: ['--import', 'tsx', SELF_PATH],
  });

  await client.connect(transport);

  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name);
  console.log(`  listTools → ${JSON.stringify(names)}`);
  if (!names.includes(TOOL_NAME)) failures.push(`listTools 未返回 ${TOOL_NAME}`);

  const called = await client.callTool({ name: TOOL_NAME, arguments: { text: 'ping' } });
  const first = (called.content as Array<{ type: string; text?: string }>)[0];
  console.log(`  callTool → ${JSON.stringify(first)}`);
  if (!first || first.text !== 'itest-echo: ping') failures.push('callTool 回显内容不符');

  await client.close();

  if (failures.length > 0) {
    console.error('❌ MCP server 自检失败：');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✅ MCP server 自检通过（握手 / listTools / callTool）');
}

if (process.argv.includes('--self-check')) {
  await selfCheck();
} else {
  await serve();
}

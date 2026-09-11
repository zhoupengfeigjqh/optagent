/** 复现工具循环报错：node --env-file=.env 不行，tsx 传 --env-file */
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { loadConfig } from '../src/config.js';
import { createStreamFn, runAgentLoopEvents } from '../src/infra/agent-loop.js';

try {
  process.loadEnvFile();
} catch { /* ignore */ }

const config = loadConfig();
const provider = deepseekProvider();
const model = provider.getModels().find((m) => m.id === config.defaultModel.model)!;

const tool = {
  name: 'echo',
  description: '回显输入文本',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute(_id: string, args: { text: string }) {
    return { content: [{ type: 'text', text: args.text }], details: {} };
  },
};

const stream = runAgentLoopEvents({
  model: model as never,
  streamFn: createStreamFn(provider, config.defaultModel.apiKey),
  systemPrompt: '你是助手。用户让你回显时，调用 echo 工具。',
  messages: [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好！有什么可以帮你？' }, // 历史轮：无 usage 字段
    { role: 'user', content: '请用 echo 工具回显"你好"' },
  ],
  tools: [tool as never],
  thinking: false,
  signal: new AbortController().signal,
});

for await (const e of stream) {
  console.log(e.type, e.type === 'error' ? `${e.code}: ${e.message}` : e.type === 'done' ? `usage in=${e.usage.inputTokens} out=${e.usage.outputTokens}` : '');
}

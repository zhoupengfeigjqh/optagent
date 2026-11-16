/**
 * 一次性诊断（用完即删）：观察"多轮工具"期间正文何时出现。
 * 关键是量出 tool_call 开始前 content 是否已输出、执行期间是否停止。
 */
const BASE = 'http://127.0.0.1:3000';

const created = await (
  await fetch(`${BASE}/api/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: '生鲜识别辅助' }),
  })
).json();
const threadId = created.thread_id ?? created.result?.thread_id;

const started = Date.now();
const t = () => ((Date.now() - started) / 1000).toFixed(1);
let chars = 0;
let lastChars = 0;
let lastT = 0;

const res = await fetch(`${BASE}/api/threads/${encodeURIComponent(threadId)}/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify({
    content:
      '必须调用 fresh_order_parse 工具（image_path=数据准备/生鲜订单图片/order1.png，' +
      'sku_path=数据准备/生鲜sku表/SKU清单.xlsx），不要用 read_file 代替；调用完把三表结果汇总给我。',
    thinking: false,
  }),
  signal: AbortSignal.timeout(240000),
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let eventName = '';

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith('data:')) continue;
    let obj = {};
    try {
      obj = JSON.parse(line.slice(5).trim());
    } catch {
      obj = {};
    }
    if (eventName === 'content') {
      chars += (obj.delta ?? '').length;
      continue;
    }
    if (eventName === 'thinking') continue;
    if (eventName === 'tool_call') {
      console.log(`+${t()}s  [工具开始] ${obj.name}   此前正文累计=${chars} 字（距上次变化 ${(Date.now() - started) / 1000 - lastT}s）`);
      lastT = (Date.now() - started) / 1000;
      lastChars = chars;
      continue;
    }
    if (eventName === 'tool_call_end') {
      console.log(`+${t()}s  [工具结束] ${obj.status}   此后正文累计=${chars} 字（执行期间新增 ${chars - lastChars} 字）`);
      lastT = (Date.now() - started) / 1000;
      lastChars = chars;
      continue;
    }
    if (eventName === 'done') {
      console.log(`+${t()}s  [done] 总正文=${chars} 字`);
    }
  }
}
console.log(`总时长 ${t()}s，最终正文 ${chars} 字`);

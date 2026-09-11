/**
 * 前后端联调数据准备（手动运行，不进 CI）。
 *
 *   cd agent-backend
 *   npx tsx scripts/prepare-integration-data.ts all        # 造全部
 *   npx tsx scripts/prepare-integration-data.ts files oversize agents thread
 *   npx tsx scripts/prepare-integration-data.ts clean      # 清理本脚本的产物
 *
 * 产物一律带 `itest-` 前缀（或固定目录名 demo2 / integration-fixtures），
 * `clean` 只删这些标记物，不触碰你已有的会话、数字人与文件。
 *
 * 数据根默认 `<cwd>/.opt-agent`，与 .env 的 OPT_AGENT_ROOT 一致。
 *
 * 覆盖的联调盲区（见 frontend/specs/001-agent-chat-ui/contracts/backend-api.md）：
 * - 9 个空间目录默认全空 → 上传/@ 引用/右侧预览/工作空间抽屉都没东西可点
 * - 只有 1 个数字人 demo → 切换流程（US6）永远置灰，验不了
 * - demo 的 MCP.json 为空 → FR-033 的红/绿双通道只看得见"空"
 * - 没有失败轮 / 带引用的历史消息 / 带用量的消息 → FR-016/028/049 靠现造很慢
 * - 没有 >50MB / >10MB 样本 → 上传预校验(FR-010) 与预览 413(FR-048) 验不了
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/* ------------------------------------------------------------------ 基础 */

const USER_ID = 'admin';
const MARK = 'itest-';
const FIXTURES_DIRNAME = 'integration-fixtures';
const SECOND_AGENT = 'demo2';
/** 9 个空间目录（与 src/domain/dirs.ts 同源，勿单独改动） */
const BUSINESS_DIRS = [
  '生产计划',
  '产线信息',
  '切换时间',
  '求解时间',
  '产线电价',
  '目标优先级',
  '使用规则',
] as const;
const SHARED_DIR = 'shared';
const ALL_SPACE_DIRS = [...BUSINESS_DIRS, SHARED_DIR, 'tmp'] as const;

const cwd = process.cwd();
const root = path.resolve(cwd, '.opt-agent');
const userData = path.join(root, 'users', USER_ID, 'user-data');
const fixturesDir = path.join(cwd, FIXTURES_DIRNAME);

const created: string[] = [];

function info(msg: string): void {
  console.log(`  ${msg}`);
}

function head(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function writeText(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  created.push(file);
  info(`✓ ${path.relative(cwd, file)}`);
}

function assertBackendRoot(): void {
  if (!fs.existsSync(path.join(cwd, 'config.yaml'))) {
    console.error(`✗ 请在 agent-backend 目录下运行（当前：${cwd}）——未找到 config.yaml。`);
    process.exit(1);
  }
}

/* --------------------------------------------------- 1. 9 个空间目录文件 */

const SAMPLE_FILES: ReadonlyArray<readonly [string, string, string]> = [
  [
    '生产计划',
    `${MARK}排产表.csv`,
    '日期,产线,产品,数量\n2026-09-01,产线A,P-100,120\n2026-09-02,产线B,P-200,80\n',
  ],
  ['产线信息', `${MARK}产线清单.csv`, '产线,工序数,节拍\n产线A,5,42\n产线B,4,55\n'],
  [
    '切换时间',
    `${MARK}切换时间.json`,
    '{\n  "产线A": {"P-100→P-200": 45},\n  "产线B": {"P-200→P-100": 30}\n}\n',
  ],
  [
    '求解时间',
    `${MARK}求解说明.txt`,
    '联调样本：求解时间口径测试。\n基准：单次求解 30s 以内为达标。\n',
  ],
  [
    '产线电价',
    `${MARK}电价.csv`,
    '时段,电价\n00:00-08:00,0.32\n08:00-12:00,1.05\n12:00-18:00,0.78\n',
  ],
  [
    '目标优先级',
    `${MARK}优先级.json`,
    '{\n  "objectives": ["交期达成", "切换次数最少", "能耗最低"]\n}\n',
  ],
  [
    '使用规则',
    `${MARK}使用规则说明.txt`,
    '联调样本：使用规则说明。\n1. 引用文件前先确认目录。\n2. 输出的临时文件仅保留 7 天。\n',
  ],
  [SHARED_DIR, `${MARK}共享说明.txt`, '联调样本：跨数字人共享目录。\n'],
];

function runFiles(): void {
  head('1/4 空间目录测试文件（7 业务 + shared；tmp 故意留空供 UI 上传）');
  for (const dir of ALL_SPACE_DIRS) {
    fs.mkdirSync(path.join(userData, dir), { recursive: true });
  }
  for (const [dir, name, content] of SAMPLE_FILES) {
    writeText(path.join(userData, dir, name), content);
  }
  info('tmp/ 留空：请用前端「+」上传入口往 tmp 传一个文件，既造数据又验 US3');
}

/* ----------------------------------------------------- 2. 大文件与样本 */

/** 生成一个合法（含正确 xref）的单页 PDF；正文限 ASCII。 */
function buildPdf(contentStream: string): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${Buffer.byteLength(contentStream, 'latin1')}>>\nstream\n${contentStream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** 生成指定大小的 PDF：正文重复填充，xref 仍正确。 */
function buildLargePdf(targetBytes: number): Buffer {
  const unit = 'itest filler line for preview size limit test\n';
  const repeat = Math.ceil(targetBytes / unit.length);
  const stream = `BT /F1 10 Tf 20 820 Td 12 TL ${Array.from({ length: repeat }, () => `(${unit.trim()}) Tj T*`).join(' ')} ET`;
  return buildPdf(stream);
}

function writeBuffer(file: string, buf: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  created.push(file);
  info(`✓ ${path.relative(cwd, file)}  (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}

/** 写一个指定大小的文本文件（分块，避免一次性构造大字符串）。 */
function writeLargeText(file: string, targetBytes: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const chunk = Buffer.from('itest-oversize\t'.repeat(4096), 'utf8');
  const fd = fs.openSync(file, 'w');
  try {
    let written = 0;
    while (written < targetBytes) {
      fs.writeSync(fd, chunk);
      written += chunk.length;
    }
  } finally {
    fs.closeSync(fd);
  }
  created.push(file);
  const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
  info(`✓ ${path.relative(cwd, file)}  (${mb} MB)`);
}

function runOversize(): void {
  head('2/4 上传/预览样本（用浏览器文件选择器挑这些文件）');
  const smallPdf = path.join(fixturesDir, `${MARK}small.pdf`);
  writeBuffer(
    smallPdf,
    buildPdf('BT /F1 14 Tf 40 780 Td (itest small pdf - inline preview) Tj ET'),
  );
  writeBuffer(path.join(fixturesDir, `${MARK}preview-toobig.pdf`), buildLargePdf(11 * 1024 * 1024));
  writeLargeText(path.join(fixturesDir, `${MARK}toobig-51mb.txt`), 51 * 1024 * 1024);
  writeText(path.join(fixturesDir, `${MARK}bad-ext.exe`), 'not a supported extension\n');
  writeText(path.join(fixturesDir, `${MARK}plain.csv`), 'a,b\n1,2\n');
  writeText(path.join(fixturesDir, `${MARK}plain.json`), '{"itest": true}\n');
  writeText(
    path.join(fixturesDir, `${MARK}fake.xlsx`),
    'itest junk bytes (前端只按扩展名回退下载)\n',
  );
  info('');
  info('用法：small.pdf → 上传后 iframe 预览；preview-toobig.pdf → 预览 413 + 下载引导');
  info('       toobig-51mb.txt / bad-ext.exe → 前端预校验拦截（Network 里不应出现任何请求）');
  info('       fake.xlsx → 右侧预览区回退下载（V-11）');
}

/* ------------------------------------------------------- 3. 第二个数字人 */

function runAgents(force: boolean): void {
  head(`3/4 第二个数字人 ${SECOND_AGENT}（验 US6 切换与 MCP 红态）`);
  const agentDir = path.join(root, 'users', USER_ID, 'agents', SECOND_AGENT);
  if (fs.existsSync(agentDir) && !force) {
    info(`已存在，跳过（要重建加 --force）：${path.relative(cwd, agentDir)}`);
    return;
  }
  writeText(
    path.join(agentDir, 'SOUL.md'),
    [
      '你是「联调演示数字人」，仅用于前后端联调验证。',
      '',
      '你的职责：回答极简短（一到两句），用于快速观察流式输出、中断与工具调用。',
      '风格：中文、不复述问题、不展开解释。',
      '',
    ].join('\n'),
  );
  writeText(
    path.join(agentDir, 'TOOL.json'),
    `${JSON.stringify({ enabled: ['read_file', 'list_dir', 'grep_files', 'calculator'] }, null, 2)}\n`,
  );
  writeText(
    path.join(agentDir, 'skills', 'itest-echo', 'SKILL.md'),
    [
      '---',
      'name: itest-echo',
      'description: 联调占位技能：仅用于验证数字人面板的技能区展示',
      '---',
      '',
      '占位正文。',
      '',
    ].join('\n'),
  );
  // 一绿一红，覆盖 FR-033 的双通道标识
  const mcpServerScript = path.join(cwd, 'scripts', 'itest-mcp-server.ts');
  if (!fs.existsSync(mcpServerScript)) {
    info(`⚠️ 未找到 ${path.relative(cwd, mcpServerScript)}，绿色通道将连不上`);
  }
  writeText(
    path.join(agentDir, 'MCP.json'),
    `${JSON.stringify(
      {
        servers: [
          {
            name: 'itest-echo',
            transport: 'stdio',
            // 直接 spawn node.exe 而非 npx（Windows 上 npx 是 .cmd，无 shell 时 spawn 会失败）
            command: process.execPath,
            args: ['--import', 'tsx', mcpServerScript],
          },
          { name: 'itest-broken-mcp', transport: 'http', url: 'http://127.0.0.1:1/mcp' },
        ],
      },
      null,
      2,
    )}\n`,
  );
  info('');
  info(`${SECOND_AGENT}：itest-echo（真实可连 → 绿） + itest-broken-mcp（必然失败 → 红）`);
  info('⚠️ 实例是「首条消息」才创建的（src/routes/chat.ts 的 getOrCreateAgent）：');
  info('   刚选中 demo2 时 MCP 全为 failed 属预期（FR-034 不弹窗不阻断）；');
  info('   发一条消息后等 1~2s，轮询（≤5s）把 echo 刷成「连接正常」，broken 保持「连接失败」');
}

/* ----------------------------------------------------------- 4. 长会话 */

function runThread(): void {
  head('4/4 长会话（120 条，验分页前插与历史渲染）');
  const threadId = randomUUID();
  const dir = path.join(userData, 'threads', threadId);
  const started = new Date(Date.now() - 120 * 60 * 1000);
  const at = (minute: number): string =>
    new Date(started.getTime() + minute * 60 * 1000).toISOString();

  const lines: string[] = [];
  const TOTAL_NORMAL = 116;
  for (let i = 1; i <= TOTAL_NORMAL; i += 1) {
    const isUser = i % 2 === 1;
    const role = isUser ? 'user' : 'assistant';
    const body = isUser ? `第 ${i} 问：这是联调样本问题。` : `第 ${i} 答：这是联调样本回答。`;
    lines.push(
      JSON.stringify({
        role,
        content: body,
        id: `${MARK}msg-${String(i).padStart(3, '0')}`,
        ts: at(i),
        ...(isUser ? {} : { status: 'completed' }),
      }),
    );
  }

  // 末尾 4 条是"要验的东西"，放在最新一页（详情按 offset 从最新往前切）
  lines.push(
    JSON.stringify({
      role: 'assistant',
      content: '这条带用量与耗时，用于验证 1 位小数格式化（后端给的 12.345 应显示 12.3s）。',
      id: `${MARK}msg-117`,
      ts: at(117),
      status: 'completed',
      usage: { input_tokens: 1234, output_tokens: 567 },
      duration_ms: 12345,
    }),
    JSON.stringify({
      role: 'user',
      content: '请分析这个文件。',
      id: `${MARK}msg-118`,
      ts: at(118),
      attachments: [{ dir: '生产计划', filename: `${MARK}排产表.csv` }],
    }),
    JSON.stringify({
      role: 'assistant',
      content: '',
      id: `${MARK}msg-119`,
      ts: at(119),
      status: 'failed',
      error: { code: 'MODEL_NOT_FOUND', message: 'itest 故意失败（源码 message 不应被直接展示）' },
    }),
    JSON.stringify({
      role: 'assistant',
      content: '这条已点赞，用于验证反馈选中态的持久化。',
      id: `${MARK}msg-120`,
      ts: at(120),
      status: 'completed',
      usage: { input_tokens: 10, output_tokens: 20 },
      duration_ms: 2500,
    }),
    JSON.stringify({ type: 'feedback', message_id: `${MARK}msg-120`, value: 'up', ts: at(120) }),
  );

  writeText(path.join(dir, 'history.jsonl'), `${lines.join('\n')}\n`);
  writeText(
    path.join(dir, 'meta.json'),
    `${JSON.stringify(
      {
        thread_id: threadId,
        agent_name: 'demo',
        title: `${MARK}长会话(120条)`,
        created_at: at(0),
        updated_at: at(120),
      },
      null,
      2,
    )}\n`,
  );
  info('');
  info(`thread_id = ${threadId}`);
  info(
    '首屏应能看到：带用量的回复(12.3s)、带 @排产表.csv 引用的提问、失败轮错误文案、已点赞的回复',
  );
  info('顶部「加载更早的消息」应能连续翻 2 页（120 条 ÷ 50）——验 offset+=limit 前插');
  info('注意：会话总数不设上限，连点「新建会话」都会成功；');
  info('      如需观察 THREAD_BUSY_LIMIT 的 409 文案，请同时发起 3 个回复后再发第 4 条（并发上限）');
}

/* --------------------------------------------------------------- 清理 */

function removeIfExists(target: string, label: string): void {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  info(`- 删除 ${label}`);
}

/** 读会话标题；meta 缺失/损坏返回 null（不视为本脚本产物） */
function readThreadTitle(metaFile: string): string | null {
  try {
    const raw = fs.readFileSync(metaFile, 'utf8');
    return String((JSON.parse(raw) as { title?: unknown }).title ?? '');
  } catch {
    return null;
  }
}

function clean(): void {
  head('清理本脚本的产物');
  for (const dir of ALL_SPACE_DIRS) {
    const abs = path.join(userData, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
      if (entry.startsWith(MARK)) removeIfExists(path.join(abs, entry), `${dir}/${entry}`);
    }
  }
  removeIfExists(
    path.join(root, 'users', USER_ID, 'agents', SECOND_AGENT),
    `数字人 ${SECOND_AGENT}`,
  );
  // 只删默认目录名，避免误删用户用 --fixtures 指定的自定义路径
  removeIfExists(fixturesDir, FIXTURES_DIRNAME + '/');

  const threadsRoot = path.join(userData, 'threads');
  if (fs.existsSync(threadsRoot)) {
    for (const entry of fs.readdirSync(threadsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory) continue;
      const metaFile = path.join(threadsRoot, entry.name, 'meta.json');
      const title = readThreadTitle(metaFile);
      if (title === null || !title.startsWith(MARK)) continue;
      removeIfExists(path.join(threadsRoot, entry.name), `会话 ${entry.name}（${title}）`);
      const tmpDir = path.join(userData, 'tmp');
      if (!fs.existsSync(tmpDir)) continue;
      for (const file of fs.readdirSync(tmpDir)) {
        if (file.startsWith(entry.name)) removeIfExists(path.join(tmpDir, file), `tmp/${file}`);
      }
    }
  }
  info('（你原有的会话/数字人/文件未受影响）');
}

/* --------------------------------------------------------------- 入口 */

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const commands = argv.filter((a) => !a.startsWith('--'));
const expanded =
  commands.includes('all') || commands.length === 0
    ? ['files', 'oversize', 'agents', 'thread']
    : commands;

assertBackendRoot();
console.log(`数据根：${root}`);
console.log(
  `待执行：${expanded.join(', ')}${flags.has('--force') ? '（--force 重建数字人）' : ''}`,
);

if (expanded.includes('files')) runFiles();
if (expanded.includes('oversize')) runOversize();
if (expanded.includes('agents')) runAgents(flags.has('--force'));
if (expanded.includes('thread')) runThread();
if (expanded.includes('clean')) clean();

if (!expanded.includes('clean')) {
  console.log('\n下一步：');
  console.log('  1) 终端 A：npm run dev   （后端 :3000）');
  console.log('  2) 终端 B：cd ../frontend && npm run dev（前端 :5173，/api 已代理）');
  console.log('  3) 浏览器打开 http://localhost:5173 ，先选数字人 demo');
  console.log('  4) 收尾：npx tsx scripts/prepare-integration-data.ts clean');
} else {
  console.log('\n清理完成。');
}

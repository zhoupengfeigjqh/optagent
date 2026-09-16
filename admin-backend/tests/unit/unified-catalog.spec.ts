/**
 * 单元测试：统一清单降级时的告警去重（任务 2026-09-16）
 *
 * 快照在每次保存校验 / 异常汇总时都会构建。运行环境不可达时若**每次都告警**，
 * 同一句话会把日志刷满——实测一次持续 5 小时的故障留下 68 条重复告警，
 * 真正需要看的其它事件被淹没。因此：**同一原因只告警一次，恢复时补一条 info**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { UnifiedCatalog } from '../../src/domain/config-center/unified-catalog.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { SkillLibraryService } from '../../src/domain/skill-library/install.js';
import { ComposeReader } from '../../src/infra/compose-reader.js';
import { RuntimeClient } from '../../src/infra/runtime-client.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

/** 可切换"不可达"与"失败原因"的运行环境桩 */
class FlakyRuntime extends RuntimeClient {
  unreachable = true;
  reason = '运行环境不可达（第一次）';

  constructor() {
    super({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 5 });
  }

  override async builtinTools(): Promise<never[]> {
    if (this.unreachable) {
      throw new ApiError(ERROR_CODES.ADM_RUNTIME_UNREACHABLE, this.reason);
    }
    return [{ name: 'read_file' }] as never[];
  }
}

type LogLine = { event?: string; msg?: string; previous_reason?: string };

let root: string;
let lines: LogLine[];

/** 用**真实 pino** 写内存流：断言的是实际产出的日志行，而不是被 mock 的调用 */
function memoryLogger() {
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') lines.push(JSON.parse(line) as LogLine);
      }
      cb();
    },
  });
  return pino({ level: 'info' }, stream);
}

function buildCatalog(runtime: FlakyRuntime): UnifiedCatalog {
  const composeFile = path.join(root, 'docker-compose.yml');
  fs.writeFileSync(composeFile, 'services:\n  ocr:\n    build: ./ocr-service\n', 'utf8');
  const store = new PlatformStore(path.join(root, '.platform-data'));
  store.ensureLayout();
  return new UnifiedCatalog({
    runtime,
    compose: new ComposeReader(composeFile),
    skills: new SkillLibraryService(store),
    logger: memoryLogger(),
  });
}

const unavailable = (): LogLine[] => lines.filter((l) => l.event === 'catalog.tools.unavailable');
const recovered = (): LogLine[] => lines.filter((l) => l.event === 'catalog.tools.recovered');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-catalog-'));
  lines = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('UnifiedCatalog —— 降级告警去重', () => {
  it('同一原因连续失败只告警一次（不刷屏）', async () => {
    const runtime = new FlakyRuntime();
    const catalog = buildCatalog(runtime);

    await catalog.snapshot();
    await catalog.snapshot();
    await catalog.snapshot();

    expect(unavailable()).toHaveLength(1);
    expect(unavailable()[0]?.msg).toContain(runtime.reason);
  });

  it('失败原因变化时再告警一次（换了问题就要看得见）', async () => {
    const runtime = new FlakyRuntime();
    const catalog = buildCatalog(runtime);

    await catalog.snapshot();
    runtime.reason = '运行环境不可达（第二次：超时）';
    await catalog.snapshot();

    expect(unavailable()).toHaveLength(2);
    expect(unavailable()[1]?.msg).toContain('第二次：超时');
  });

  it('恢复后补一条 info，并带上"上次的原因"；再恢复不重复记', async () => {
    const runtime = new FlakyRuntime();
    const catalog = buildCatalog(runtime);

    await catalog.snapshot();
    runtime.unreachable = false;
    await catalog.snapshot();
    await catalog.snapshot();

    expect(recovered()).toHaveLength(1);
    expect(recovered()[0]?.previous_reason).toContain('第一次');
    expect(unavailable()).toHaveLength(1);
  });

  it('恢复后再次不可达：仍按"新问题"告警一次', async () => {
    const runtime = new FlakyRuntime();
    const catalog = buildCatalog(runtime);

    await catalog.snapshot();
    runtime.unreachable = false;
    await catalog.snapshot();
    runtime.unreachable = true;
    runtime.reason = '运行环境不可达（第三次）';
    await catalog.snapshot();

    expect(unavailable()).toHaveLength(2);
    expect(recovered()).toHaveLength(1);
  });

  it('不可达时按空清单降级，不抛错（否则平台会因运行环境抖动整体不可用）', async () => {
    const runtime = new FlakyRuntime();
    const catalog = buildCatalog(runtime);

    const snapshot = await catalog.snapshot();
    expect(snapshot.toolsUnavailableReason).toContain('不可达');
    expect([...snapshot.index.builtinTools]).toEqual([]);
    expect([...snapshot.index.mcpServices]).toEqual(['ocr']);
  });
});

/**
 * config 模块单测
 *
 * 运行方式（本地执行；容器只负责部署，见宪章原则三 / 原则八）：
 *   npm run test:all   # 全部测试
 *   npm run test       # 仅本目录单测
 *
 * 覆盖本次变更的核心约束：`PUBLIC_BASE_URL` 必须显式声明（缺失即拒绝启动），
 * 且不再回落到 `http://localhost:PORT` 兜底——容器里该兜底会让 MCP 服务回源打到自己。
 *
 * 说明：`tests/` 不在 tsconfig 的 include 内（不参与构建），此处用无扩展名导入，
 * 由 Vitest 解析到 `src/config.ts`。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../../src/config';

/** 临时 config.yaml：自带字面量 api_key，使测试不依赖任何环境变量 */
const workDir = mkdtempSync(path.join(tmpdir(), 'optagent-config-'));
const configPath = path.join(workDir, 'config.yaml');
writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 执行 loadConfig 并返回抛出的错误；未抛错时返回 `null` */
function loadError(env: Record<string, string | undefined>): unknown {
  try {
    loadConfig({ env, configPath });
    return null;
  } catch (error) {
    return error;
  }
}

/** 必填项齐备的最小环境 */
const okEnv = { PUBLIC_BASE_URL: 'http://backend:3000' };

describe('loadConfig - PUBLIC_BASE_URL 必填', () => {
  it('缺失时拒绝启动，且报错文案指名该变量', () => {
    const error = loadError({});

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain('PUBLIC_BASE_URL');
  });

  it('不是合法 URL 时拒绝启动', () => {
    expect(loadError({ PUBLIC_BASE_URL: 'not a url' })).toBeInstanceOf(ConfigError);
  });

  it('缺少 http/https 协议头时拒绝启动（url() 会误判 backend:3000 为合法）', () => {
    const error = loadError({ PUBLIC_BASE_URL: 'backend:3000' });

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain('http://');
  });

  it('显式声明时原样落到 publicBaseUrl，不做 localhost 兜底', () => {
    const config = loadConfig({ env: okEnv, configPath });

    expect(config.publicBaseUrl).toBe('http://backend:3000');
  });
});

describe('loadConfig - 缺省值', () => {
  it('PORT 缺省 3000，OPT_AGENT_ROOT 解析为绝对路径', () => {
    const config = loadConfig({ env: okEnv, configPath });

    expect(config.port).toBe(3000);
    expect(path.isAbsolute(config.optAgentRoot)).toBe(true);
  });

  it('未配置 FILE_SIGN_SECRET 时随机生成（≥16 字符）', () => {
    const config = loadConfig({ env: okEnv, configPath });

    expect(config.fileSignSecret.length).toBeGreaterThanOrEqual(16);
  });

  it('配置 FILE_SIGN_SECRET 时原样采用（跨重启签名可复现的前提）', () => {
    const secret = 'a'.repeat(32);
    const config = loadConfig({ env: { ...okEnv, FILE_SIGN_SECRET: secret }, configPath });

    expect(config.fileSignSecret).toBe(secret);
  });
});

/**
 * 013：意图聚焦判定模型（Laya）的接入参数。
 *
 * 这一组守的是"配置写错时**启动就报**、且报错能照着改"：
 * - 整块缺失不算错（功能不可用）；
 * - 块在但字段缺失 / 越界 / 拼错键 → 拒绝启动，且文案指名 YAML 路径与合法区间；
 * - 阈值支持环境变量覆盖，但配置文件里的取值照样校验（撤掉环境变量时不静默生效）。
 */
describe('loadConfig - 013 意图聚焦判定模型', () => {
  let seq = 0;

  /** 写一份独立的临时 config.yaml（用例之间互不影响），返回其路径 */
  function writeConfig(intentFocusBlock?: string): string {
    seq += 1;
    const file = path.join(workDir, `intent-focus-${seq}.yaml`);
    const extra = intentFocusBlock === undefined ? '' : `intent_focus:\n${intentFocusBlock}`;
    writeFileSync(file, `models:\n  - model: test-model\n    api_key: test-key\n${extra}`, 'utf8');
    return file;
  }

  /** 加载并返回错误（未抛错时返回 null） */
  function errorOf(
    block: string | undefined,
    env: Record<string, string | undefined> = okEnv,
  ): unknown {
    try {
      loadConfig({ env, configPath: writeConfig(block) });
      return null;
    } catch (error) {
      return error;
    }
  }

  /** 断言拒绝启动，并返回错误文案 */
  function messageOf(block: string | undefined, env?: Record<string, string | undefined>): string {
    const error = errorOf(block, env);
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }

  const minimal = '  base_url: http://laya:8000\n  api_key: laya-dev-key\n';

  it('整块缺失：不报错，且不产生 intentFocus（功能不可用）', () => {
    const config = loadConfig({ env: okEnv, configPath: writeConfig() });

    expect(config.intentFocus).toBeUndefined();
    expect('intentFocus' in config).toBe(false);
  });

  it('可省略项走缺省：model / timeout_ms / 三个阈值 / 上限', () => {
    const config = loadConfig({ env: okEnv, configPath: writeConfig(minimal) });

    expect(config.intentFocus).toEqual({
      baseUrl: 'http://laya:8000',
      model: 'laya-multilingual',
      apiKey: 'laya-dev-key',
      timeoutMs: 30000,
      skillThreshold: 0.8,
      ontologyBehaviorThreshold: 0.8,
      ontologyFunctionThreshold: 0.8,
      maxSkills: 32,
      maxCapabilities: 96,
      // 027：输入改写的两个新参数同样有缺省，且**整块缺失不阻断启动**（上面已断言）
      rewriteThreshold: 0.8,
      rewriteTimeoutMs: 5000,
    });
  });

  it('016：行为/函数阈值与候选上限可配置，环境变量优先于 YAML', () => {
    const config = loadConfig({
      env: {
        ...okEnv,
        INTENT_FOCUS_ONTOLOGY_BEHAVIOR_THRESHOLD: '0.72',
        INTENT_FOCUS_ONTOLOGY_FUNCTION_THRESHOLD: '0.66',
      },
      configPath: writeConfig(
        `${minimal}  ontology_behavior_threshold: 0.65\n  ontology_function_threshold: 0.55\n` +
          `  max_skills: 16\n  max_capabilities: 48\n`,
      ),
    });

    expect(config.intentFocus?.ontologyBehaviorThreshold).toBe(0.72);
    expect(config.intentFocus?.ontologyFunctionThreshold).toBe(0.66);
    expect(config.intentFocus?.maxSkills).toBe(16);
    expect(config.intentFocus?.maxCapabilities).toBe(48);
  });

  it('016：阈值越界 / 上限非整数时拒绝启动', () => {
    expect(messageOf(`${minimal}  ontology_behavior_threshold: 1.5\n`)).toContain(
      'intent_focus.ontology_behavior_threshold',
    );
    expect(messageOf(`${minimal}  ontology_function_threshold: -0.1\n`)).toContain(
      'intent_focus.ontology_function_threshold',
    );
    expect(messageOf(`${minimal}  max_skills: 0\n`)).toContain('intent_focus.max_skills');
    expect(messageOf(`${minimal}  max_capabilities: 2.5\n`)).toContain(
      'intent_focus.max_capabilities',
    );
  });

  it('2026-11-20：旧键 ontology_threshold 不再接受（严格校验，启动即失败）', () => {
    expect(messageOf(`${minimal}  ontology_threshold: 0.8\n`)).toContain('ontology_threshold');
  });

  it('各项全配时逐项生效，且对象被冻结（装配后不得改）', () => {
    const config = loadConfig({
      env: okEnv,
      configPath: writeConfig(
        `${minimal}  model: laya-multilingual-v0.4.0\n  timeout_ms: 4500\n  skill_threshold: 0.65\n`,
      ),
    });

    expect(config.intentFocus).toMatchObject({
      model: 'laya-multilingual-v0.4.0',
      timeoutMs: 4500,
      skillThreshold: 0.65,
    });
    expect(Object.isFrozen(config.intentFocus)).toBe(true);
  });

  it('base_url 去掉尾部斜杠与首尾空白（拼接 /v1/systemone 不出现双斜杠）', () => {
    const config = loadConfig({
      env: okEnv,
      configPath: writeConfig('  base_url: " http://laya:8000/ "\n  api_key: k\n'),
    });

    expect(config.intentFocus?.baseUrl).toBe('http://laya:8000');
  });

  it('base_url 带路径时拒绝启动（否则请求会打到 /v1/v1/systemone）', () => {
    const message = messageOf('  base_url: http://laya:8000/v1\n  api_key: k\n');

    expect(message).toContain('intent_focus.base_url');
    expect(message).toContain('不要带路径');
  });

  it('base_url 非 http(s) 时拒绝启动', () => {
    expect(messageOf('  base_url: laya:8000\n  api_key: k\n')).toContain('http://');
  });

  it('api_key 支持 $ENV 引用，且引用为空串时按"未设置"拒绝', () => {
    const config = loadConfig({
      env: { ...okEnv, DECIS_API_KEY: 'from-env' },
      configPath: writeConfig('  base_url: http://laya:8000\n  api_key: $DECIS_API_KEY\n'),
    });
    expect(config.intentFocus?.apiKey).toBe('from-env');

    const emptyRef = messageOf('  base_url: http://laya:8000\n  api_key: $DECIS_API_KEY\n', {
      ...okEnv,
      DECIS_API_KEY: '',
    });
    expect(emptyRef).toContain('DECIS_API_KEY');
  });

  it('api_key 缺失时拒绝启动，且文案指名配置块', () => {
    expect(messageOf('  base_url: http://laya:8000\n')).toContain('intent_focus');
  });

  it('api_key 不回落 DEEPSEEK_API_KEY（落到主模型密钥只会表现为 401）', () => {
    const message = messageOf('  base_url: http://laya:8000\n  api_key: $DECIS_API_KEY\n', {
      ...okEnv,
      DEEPSEEK_API_KEY: 'sk-main-model',
    });

    expect(message).toContain('DECIS_API_KEY');
  });

  it('timeout_ms 越界 / 非整数时拒绝启动，并给出区间与当前值', () => {
    const tooSmall = messageOf(`${minimal}  timeout_ms: 299\n`);
    expect(tooSmall).toContain('intent_focus.timeout_ms');
    expect(tooSmall).toContain('300~30000');

    expect(messageOf(`${minimal}  timeout_ms: 30001\n`)).toContain('intent_focus.timeout_ms');
    expect(messageOf(`${minimal}  timeout_ms: 300.5\n`)).toContain('intent_focus.timeout_ms');
  });

  it('skill_threshold 越界时拒绝启动（即使设了环境变量也不放过坏值）', () => {
    expect(messageOf(`${minimal}  skill_threshold: 1.5\n`)).toContain(
      'intent_focus.skill_threshold',
    );
    expect(
      messageOf(`${minimal}  skill_threshold: 1.5\n`, {
        ...okEnv,
        INTENT_FOCUS_SKILL_THRESHOLD: '0.5',
      }),
    ).toContain('intent_focus.skill_threshold');
  });

  it('已移除的 max_actions 仍被拒绝（strict 键校验），避免旧配置静默失效', () => {
    expect(messageOf(`${minimal}  max_actions: 2\n`)).toContain('intent_focus');
  });

  it('拼错键（如 timeout）拒绝启动，而不是被静默忽略后跑缺省', () => {
    expect(messageOf(`${minimal}  timeout: 3000\n`)).toContain('intent_focus');
  });

  it('INTENT_FOCUS_SKILL_THRESHOLD 覆盖配置文件里的 skill_threshold', () => {
    const config = loadConfig({
      env: { ...okEnv, INTENT_FOCUS_SKILL_THRESHOLD: '0.8' },
      configPath: writeConfig(`${minimal}  skill_threshold: 0.4\n`),
    });

    expect(config.intentFocus?.skillThreshold).toBe(0.8);
  });

  it('INTENT_FOCUS_SKILL_THRESHOLD 为空串时视为未设置（不静默变成 0）', () => {
    const config = loadConfig({
      env: { ...okEnv, INTENT_FOCUS_SKILL_THRESHOLD: '' },
      configPath: writeConfig(`${minimal}  skill_threshold: 0.4\n`),
    });

    expect(config.intentFocus?.skillThreshold).toBe(0.4);
  });

  it('INTENT_FOCUS_SKILL_THRESHOLD 越界时拒绝启动，文案指名该变量', () => {
    const message = messageOf(minimal, { ...okEnv, INTENT_FOCUS_SKILL_THRESHOLD: '1.5' });

    expect(message).toContain('INTENT_FOCUS_SKILL_THRESHOLD');
  });
});

/**
 * 027：输入改写的两个配置项。
 *
 * 这一组守四件事：
 * - 缺省（0.8 / 5000）在整块存在但没写这两键时生效；
 * - 越界 / 非整数一律**拒绝启动**（不 clamp、不静默收敛）；
 * - `rewrite_timeout_ms` 不得超过 `timeout_ms`（半配置不接受）；
 * - 阈值可被 `INTENT_FOCUS_REWRITE_THRESHOLD` 覆盖，但配置文件里的坏值照样校验。
 */
describe('loadConfig - 027 输入改写参数', () => {
  let seq = 0;

  function writeConfig(block: string): string {
    seq += 1;
    const file = path.join(workDir, `rewrite-${seq}.yaml`);
    writeFileSync(
      file,
      `models:\n  - model: test-model\n    api_key: test-key\nintent_focus:\n${block}`,
      'utf8',
    );
    return file;
  }

  function messageOf(block: string, env: Record<string, string | undefined> = okEnv): string {
    try {
      loadConfig({ env, configPath: writeConfig(block) });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      return (error as Error).message;
    }
    throw new Error('期望拒绝启动，但 loadConfig 成功了');
  }

  const minimal = '  base_url: http://laya:8000\n  api_key: laya-dev-key\n';

  it('缺省：阈值 0.8、改写超时 5000ms', () => {
    const config = loadConfig({ env: okEnv, configPath: writeConfig(minimal) });

    expect(config.intentFocus?.rewriteThreshold).toBe(0.8);
    expect(config.intentFocus?.rewriteTimeoutMs).toBe(5000);
  });

  it('可配置且逐项生效（受 timeout_ms 上限约束）', () => {
    const config = loadConfig({
      env: okEnv,
      configPath: writeConfig(
        `${minimal}  timeout_ms: 8000\n  rewrite_threshold: 0.65\n  rewrite_timeout_ms: 3000\n`,
      ),
    });

    expect(config.intentFocus?.rewriteThreshold).toBe(0.65);
    expect(config.intentFocus?.rewriteTimeoutMs).toBe(3000);
  });

  it('阈值越界（>1 / <0）拒绝启动，文案指名 YAML 路径', () => {
    expect(messageOf(`${minimal}  rewrite_threshold: 1.5\n`)).toContain(
      'intent_focus.rewrite_threshold',
    );
    expect(messageOf(`${minimal}  rewrite_threshold: -0.1\n`)).toContain(
      'intent_focus.rewrite_threshold',
    );
  });

  it('改写超时越界 / 非整数拒绝启动，并给出区间与当前值', () => {
    const tooSmall = messageOf(`${minimal}  rewrite_timeout_ms: 299\n`);
    expect(tooSmall).toContain('intent_focus.rewrite_timeout_ms');
    expect(tooSmall).toContain('300~10000');

    expect(messageOf(`${minimal}  rewrite_timeout_ms: 10001\n`)).toContain(
      'intent_focus.rewrite_timeout_ms',
    );
    expect(messageOf(`${minimal}  rewrite_timeout_ms: 300.5\n`)).toContain(
      'intent_focus.rewrite_timeout_ms',
    );
  });

  it('改写超时大于整轮预算时拒绝启动（半配置不静默收敛）', () => {
    const message = messageOf(`${minimal}  timeout_ms: 3000\n  rewrite_timeout_ms: 5000\n`);

    expect(message).toContain('intent_focus.rewrite_timeout_ms');
    expect(message).toContain('timeout_ms');
  });

  it('INTENT_FOCUS_REWRITE_THRESHOLD 覆盖配置文件，空串视为未设置', () => {
    const overridden = loadConfig({
      env: { ...okEnv, INTENT_FOCUS_REWRITE_THRESHOLD: '0.9' },
      configPath: writeConfig(`${minimal}  rewrite_threshold: 0.5\n`),
    });
    expect(overridden.intentFocus?.rewriteThreshold).toBe(0.9);

    const empty = loadConfig({
      env: { ...okEnv, INTENT_FOCUS_REWRITE_THRESHOLD: '' },
      configPath: writeConfig(`${minimal}  rewrite_threshold: 0.5\n`),
    });
    expect(empty.intentFocus?.rewriteThreshold).toBe(0.5);
  });

  it('INTENT_FOCUS_REWRITE_THRESHOLD 越界时拒绝启动，文案指名该变量', () => {
    expect(messageOf(minimal, { ...okEnv, INTENT_FOCUS_REWRITE_THRESHOLD: '1.2' })).toContain(
      'INTENT_FOCUS_REWRITE_THRESHOLD',
    );
  });

  it('整块 intent_focus 缺失时不影响启动（改写随整块一起不可用）', () => {
    const file = path.join(workDir, 'rewrite-none.yaml');
    writeFileSync(file, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');

    const config = loadConfig({ env: okEnv, configPath: file });

    expect(config.intentFocus).toBeUndefined();
    expect('intentFocus' in config).toBe(false);
  });
});

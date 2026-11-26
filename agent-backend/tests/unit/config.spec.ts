import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, summarizeConfig, unknownEnvKeys } from '../../src/config';

/** 临时 config.yaml：自带字面量 api_key，使测试不依赖任何环境变量 */
const workDir = mkdtempSync(path.join(tmpdir(), 'optagent-config-'));
const configPath = path.join(workDir, 'config.yaml');
writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function loadError(env: Record<string, string | undefined>): unknown {
  try {
    loadConfig({ env, configPath });
    return null;
  } catch (error) {
    return error;
  }
}

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
      rewriteThreshold: 0.8,
      rewriteTimeoutMs: 5000,
      // 028：门禁缺键 = 关闭（不写 planThreshold），超时取缺省 5s
      planTimeoutMs: 5000,
    });
  });

  it('016：行为/函数阈值与候选上限可配置（YAML 单点生效）', () => {
    const config = loadConfig({
      env: okEnv,
      configPath: writeConfig(
        `${minimal}  ontology_behavior_threshold: 0.65\n  ontology_function_threshold: 0.55\n` +
          `  max_skills: 16\n  max_capabilities: 48\n`,
      ),
    });

    expect(config.intentFocus?.ontologyBehaviorThreshold).toBe(0.65);
    expect(config.intentFocus?.ontologyFunctionThreshold).toBe(0.55);
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

  it('base_url 支持 $ENV 引用（两形态共用同一份 config.yaml）', () => {
    const config = loadConfig({
      env: { ...okEnv, INTENT_FOCUS_BASE_URL: 'http://laya:8000' },
      configPath: writeConfig('  base_url: $INTENT_FOCUS_BASE_URL\n  api_key: k\n'),
    });
    expect(config.intentFocus?.baseUrl).toBe('http://laya:8000');

    const emptyRef = messageOf('  base_url: $INTENT_FOCUS_BASE_URL\n  api_key: k\n', {
      ...okEnv,
      INTENT_FOCUS_BASE_URL: '',
    });
    expect(emptyRef).toContain('INTENT_FOCUS_BASE_URL');
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

  it('skill_threshold 越界时拒绝启动', () => {
    expect(messageOf(`${minimal}  skill_threshold: 1.5\n`)).toContain(
      'intent_focus.skill_threshold',
    );
  });

  it('已移除的 max_actions 仍被拒绝（strict 键校验），避免旧配置静默失效', () => {
    expect(messageOf(`${minimal}  max_actions: 2\n`)).toContain('intent_focus');
  });

  it('拼错键（如 timeout）拒绝启动，而不是被静默忽略后跑缺省', () => {
    expect(messageOf(`${minimal}  timeout: 3000\n`)).toContain('intent_focus');
  });

  it('阈值只认 YAML：遗留的 INTENT_FOCUS_SKILL_THRESHOLD 不再生效（一个参数一个真源）', () => {
    const config = loadConfig({
      env: { ...okEnv, INTENT_FOCUS_SKILL_THRESHOLD: '0.8' },
      configPath: writeConfig(`${minimal}  skill_threshold: 0.4\n`),
    });

    expect(config.intentFocus?.skillThreshold).toBe(0.4);
  });
});

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

  it('改写阈值只认 YAML：遗留的 INTENT_FOCUS_REWRITE_THRESHOLD 不再生效', () => {
    const config = loadConfig({
      env: { ...okEnv, INTENT_FOCUS_REWRITE_THRESHOLD: '0.9' },
      configPath: writeConfig(`${minimal}  rewrite_threshold: 0.5\n`),
    });

    expect(config.intentFocus?.rewriteThreshold).toBe(0.5);
  });

  it('整块 intent_focus 缺失时不影响启动（改写随整块一起不可用）', () => {
    const file = path.join(workDir, 'rewrite-none.yaml');
    writeFileSync(file, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');

    const config = loadConfig({ env: okEnv, configPath: file });

    expect(config.intentFocus).toBeUndefined();
    expect('intentFocus' in config).toBe(false);
  });
});

/**
 * 028：规划门禁参数。
 *
 * 语义是"缺键 = 门禁关闭"，不是"缺键取默认值"——不能让存量部署在升级后
 * 突然因为一个没配的阈值开始拦截规划。
 */
describe('loadConfig - 028 规划门禁参数', () => {
  let seq = 0;

  function writeConfig(block: string): string {
    seq += 1;
    const file = path.join(workDir, `plan-gate-${seq}.yaml`);
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

  it('缺键：门禁关闭（planThreshold 未定义），超时取缺省 5000ms', () => {
    const config = loadConfig({ env: okEnv, configPath: writeConfig(minimal) });

    expect(config.intentFocus?.planThreshold).toBeUndefined();
    expect(config.intentFocus?.planTimeoutMs).toBe(5000);
  });

  it('可配置且逐项生效', () => {
    const config = loadConfig({
      env: okEnv,
      configPath: writeConfig(`${minimal}  plan_threshold: 0.4\n  plan_timeout_ms: 1500\n`),
    });

    expect(config.intentFocus?.planThreshold).toBe(0.4);
    expect(config.intentFocus?.planTimeoutMs).toBe(1500);
  });

  it('阈值越界（>1 / <0）拒绝启动，文案指名 YAML 路径', () => {
    expect(messageOf(`${minimal}  plan_threshold: 1.5\n`)).toContain('intent_focus.plan_threshold');
    expect(messageOf(`${minimal}  plan_threshold: -0.1\n`)).toContain(
      'intent_focus.plan_threshold',
    );
  });

  it('门禁超时越界 / 非整数 / 大于整轮预算时拒绝启动', () => {
    expect(messageOf(`${minimal}  plan_timeout_ms: 299\n`)).toContain(
      'intent_focus.plan_timeout_ms',
    );
    expect(messageOf(`${minimal}  plan_timeout_ms: 10001\n`)).toContain(
      'intent_focus.plan_timeout_ms',
    );
    expect(messageOf(`${minimal}  plan_timeout_ms: 300.5\n`)).toContain(
      'intent_focus.plan_timeout_ms',
    );
    expect(messageOf(`${minimal}  timeout_ms: 1000\n  plan_timeout_ms: 2000\n`)).toContain(
      'intent_focus.plan_timeout_ms',
    );
  });

  it('门禁阈值只认 YAML：遗留的 INTENT_FOCUS_PLAN_THRESHOLD 不再生效', () => {
    const config = loadConfig({
      env: { ...okEnv, INTENT_FOCUS_PLAN_THRESHOLD: '0.7' },
      configPath: writeConfig(`${minimal}  plan_threshold: 0.3\n`),
    });

    expect(config.intentFocus?.planThreshold).toBe(0.3);
  });
});

describe('loadConfig - 028 runtime / plan 块（2026-11-26）', () => {
  let seq = 0;

  function writeYaml(extra: string): string {
    seq += 1;
    const file = path.join(workDir, `runtime-${seq}.yaml`);
    writeFileSync(
      file,
      `models:\n  - model: test-model\n    api_key: test-key\n${extra}`,
      'utf8',
    );
    return file;
  }

  function messageOf(extra: string): string {
    try {
      loadConfig({ env: okEnv, configPath: writeYaml(extra) });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      return (error as Error).message;
    }
    throw new Error('期望拒绝启动，但 loadConfig 成功了');
  }

  it('缺省：MCP/LLM 策略与规划上限取代码缺省', () => {
    const config = loadConfig({ env: okEnv, configPath: writeYaml('') });

    expect(config.mcpTimeoutMs).toBe(90_000);
    expect(config.mcpConnectTimeoutMs).toBe(10_000);
    expect(config.llmRetry).toEqual({ maxRetries: 2, maxRetryDelayMs: 15_000 });
    expect(config.planLimits).toEqual({
      timeoutMs: 20_000,
      totalStepsMax: 20,
      replanMaxPerRun: 6,
    });
  });

  it('runtime / plan 可配置且逐项生效', () => {
    const config = loadConfig({
      env: okEnv,
      configPath: writeYaml(
        'runtime:\n  mcp_timeout_ms: 120000\n  mcp_connect_timeout_ms: 5000\n' +
          '  llm_max_retries: 0\n  llm_retry_max_delay_ms: 0\n' +
          'plan:\n  timeout_ms: 30000\n  total_steps_max: 12\n  replan_max_per_run: 3\n',
      ),
    });

    expect(config.mcpTimeoutMs).toBe(120_000);
    expect(config.mcpConnectTimeoutMs).toBe(5_000);
    expect(config.llmRetry).toEqual({ maxRetries: 0, maxRetryDelayMs: 0 });
    expect(config.planLimits).toEqual({
      timeoutMs: 30_000,
      totalStepsMax: 12,
      replanMaxPerRun: 3,
    });
  });

  it('越界 / 建连超时大于调用超时 / 拼错键一律拒绝启动', () => {
    expect(messageOf('runtime:\n  mcp_timeout_ms: 999\n')).toContain('runtime.mcp_timeout_ms');
    expect(messageOf('runtime:\n  llm_max_retries: 6\n')).toContain('runtime.llm_max_retries');
    expect(
      messageOf('runtime:\n  mcp_timeout_ms: 5000\n  mcp_connect_timeout_ms: 6000\n'),
    ).toContain('不得大于');
    expect(messageOf('plan:\n  total_steps_max: 0\n')).toContain('plan.total_steps_max');
    expect(messageOf('plan:\n  replan_max_per_run: 51\n')).toContain('plan.replan_max_per_run');
    expect(messageOf('plan:\n  total_steps: 5\n')).toContain('plan');
  });

  it('runtime / plan 只认 YAML：同名环境变量不再生效', () => {
    const config = loadConfig({
      env: { ...okEnv, MCP_TIMEOUT_MS: '15000', LLM_MAX_RETRIES: '5' },
      configPath: writeYaml(''),
    });

    expect(config.mcpTimeoutMs).toBe(90_000);
    expect(config.llmRetry.maxRetries).toBe(2);
  });
});

describe('配置可观测（2026-11-26）', () => {
  it('summarizeConfig 输出生效值且不含任何密钥 / 签名材料', () => {
    const authSecret = 'a'.repeat(40);
    const fileSignSecret = 'b'.repeat(40);
    const deepseekKey = 'sk-should-never-appear';
    const config = loadConfig({
      env: {
        ...okEnv,
        AUTH_SECRET: authSecret,
        FILE_SIGN_SECRET: fileSignSecret,
        DEEPSEEK_API_KEY: deepseekKey,
      },
      configPath,
    });

    const text = JSON.stringify(summarizeConfig(config));

    expect(text).not.toContain(authSecret);
    expect(text).not.toContain(fileSignSecret);
    expect(text).not.toContain(deepseekKey);
    expect(text).toContain('"auth_enabled":true');
    expect(text).toContain('"plan_total_steps_max":20');
  });

  it('unknownEnvKeys 只报本服务前缀的未知键（拼错 / 已废弃）', () => {
    const keys = unknownEnvKeys({
      MCON_TIMEOUT_MS: '90000',
      MCP_TIMEOUT_MS: '90000',
      PATH: '/usr/bin',
      HOME: '/root',
      PORT: '3000',
    });

    expect(keys).toEqual(['MCON_TIMEOUT_MS', 'MCP_TIMEOUT_MS']);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config';

describe('loadConfig', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'optagent-config-'));
    configPath = path.join(dir, 'config.yaml');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const baseEnv = { DEEPSEEK_API_KEY: 'sk-fallback' } as Record<string, string>;

  it('正常：默认值填充 + 兜底 key + 默认模型为第一项', () => {
    writeFileSync(configPath, 'models:\n  - model: deepseek-v4-flash-vision-exp\n  - model: other\n');
    const cfg = loadConfig({ env: baseEnv, configPath });
    expect(cfg.port).toBe(3000);
    expect(cfg.poolSize).toBe(5);
    expect(cfg.idleTimeoutMs).toBe(600_000);
    expect(cfg.defaultModel.model).toBe('deepseek-v4-flash-vision-exp');
    expect(cfg.defaultModel.apiKey).toBe('sk-fallback');
    expect(cfg.models).toHaveLength(2);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('条目 api_key 字面量优先于 DEEPSEEK_API_KEY 兜底', () => {
    writeFileSync(configPath, 'models:\n  - model: m1\n    api_key: sk-entry\n');
    const cfg = loadConfig({ env: baseEnv, configPath });
    expect(cfg.defaultModel.apiKey).toBe('sk-entry');
  });

  it('条目 api_key 支持 $ENV_VAR 引用', () => {
    writeFileSync(configPath, 'models:\n  - model: m1\n    api_key: $MY_KEY\n');
    const cfg = loadConfig({ env: { ...baseEnv, MY_KEY: 'sk-ref' }, configPath });
    expect(cfg.defaultModel.apiKey).toBe('sk-ref');
  });

  it('$ENV_VAR 引用的变量未设置 → 拒绝启动', () => {
    writeFileSync(configPath, 'models:\n  - model: m1\n    api_key: $NOPE\n');
    expect(() => loadConfig({ env: baseEnv, configPath })).toThrow(ConfigError);
  });

  it('models 缺失或为空 → 拒绝启动', () => {
    writeFileSync(configPath, 'models: []\n');
    expect(() => loadConfig({ env: baseEnv, configPath })).toThrow(ConfigError);
    writeFileSync(configPath, 'other: 1\n');
    expect(() => loadConfig({ env: baseEnv, configPath })).toThrow(ConfigError);
  });

  it('条目无 api_key 且兜底为空 → 拒绝启动', () => {
    writeFileSync(configPath, 'models:\n  - model: m1\n');
    expect(() => loadConfig({ env: {}, configPath })).toThrow(ConfigError);
  });

  it('非法运行参数 → 拒绝启动', () => {
    writeFileSync(configPath, 'models:\n  - model: m1\n');
    expect(() => loadConfig({ env: { ...baseEnv, PORT: 'abc' }, configPath })).toThrow(ConfigError);
    expect(() => loadConfig({ env: { ...baseEnv, POOL_SIZE: '0' }, configPath })).toThrow(ConfigError);
  });

  it('config.yaml 不存在 → 拒绝启动', () => {
    expect(() => loadConfig({ env: baseEnv, configPath: path.join(dir, 'nope.yaml') })).toThrow(ConfigError);
  });

  it('显式运行参数生效', () => {
    writeFileSync(configPath, 'models:\n  - model: m1\n    base_url: https://example.com\n');
    const cfg = loadConfig({
      env: { ...baseEnv, PORT: '8080', POOL_SIZE: '1', UPLOAD_MAX_MB: '10' },
      configPath,
    });
    expect(cfg.port).toBe(8080);
    expect(cfg.poolSize).toBe(1);
    expect(cfg.uploadMaxMb).toBe(10);
    expect(cfg.defaultModel.baseUrl).toBe('https://example.com');
  });
});

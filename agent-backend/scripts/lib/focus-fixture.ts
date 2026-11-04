/**
 * 意图聚焦实验脚本的公共装配：config + Laya 客户端 + 技能/本体加载。
 *
 * `intent-focus-experiment.ts` / `laya-stability.ts` / `capability-experiment.ts`
 * 三个脚本之前各自重复这段 bootstrap（`loadConfig` → `new LayaClient` → `agentDir` →
 * `loadSkillHeaders` → `loadOntologyIndex` → `buildSkillCandidates`），抽到这里避免改一处漏两处。
 */
import path from 'node:path';
import { loadConfig, type IntentFocusConfig } from '../../src/config.js';
import { agentDir } from '../../src/domain/dirs.js';
import {
  buildSkillCandidates,
  type SkillCandidateResult,
} from '../../src/domain/ontology-focus/candidates.js';
import { loadOntologyIndex } from '../../src/domain/ontology-focus/ontology-loader.js';
import type { OntologyIndex } from '../../src/domain/ontology-focus/types.js';
import { loadSkillHeaders, type SkillHeaderLoadResult } from '../../src/domain/skill-header.js';
import { LayaClient } from '../../src/infra/laya-client.js';

const ROOT = path.resolve(process.cwd(), '.opt-agent');
const USER = 'admin';
const AGENT = '生产调度测试';

/** 实验脚本共用的运行环境（三个脚本都要 config + client + 数据目录） */
export interface FocusEnv {
  root: string;
  user: string;
  agent: string;
  config: IntentFocusConfig;
  client: LayaClient;
  /** `users/{user}/agents/{agent}` 目录 */
  dir: string;
}

/** `FocusEnv` + 已加载的技能头部 / 本体索引 / 可聚焦技能候选 */
export interface FocusFixture extends FocusEnv {
  headers: SkillHeaderLoadResult;
  index: OntologyIndex;
  skillResult: SkillCandidateResult;
}

/** 装配 config + Laya 客户端 + 数据目录 */
export function loadFocusEnv(): FocusEnv {
  const config = loadConfig({
    env: process.env,
    configPath: path.resolve(process.cwd(), 'config.yaml'),
  }).intentFocus;
  if (!config) throw new Error('config.yaml 未配置 intent_focus 块');

  const client = new LayaClient({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  });

  return {
    root: ROOT,
    user: USER,
    agent: AGENT,
    config,
    client,
    dir: agentDir(ROOT, USER, AGENT),
  };
}

/** 在 `loadFocusEnv` 基础上继续加载技能头部 + 本体索引 + 可聚焦技能候选 */
export function loadFocusFixture(env: FocusEnv): FocusFixture {
  const headers = loadSkillHeaders(env.dir);
  const index = loadOntologyIndex(env.dir);
  const skillResult = buildSkillCandidates(headers.skills, index, env.config.maxSkills);
  return { ...env, headers, index, skillResult };
}

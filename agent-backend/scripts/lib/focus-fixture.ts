import path from 'node:path';
import { loadConfig, type IntentFocusConfig } from '../../src/config.js';
import { agentDir } from '../../src/domain/dirs.js';
import {
  buildSkillCandidates,
  type SkillCandidateResult,
} from '../../src/domain/intent-focus/candidates.js';
import { loadOntologyIndex } from '../../src/domain/intent-focus/ontology-loader.js';
import type { OntologyIndex } from '../../src/domain/intent-focus/types.js';
import { loadSkillHeaders, type SkillHeaderLoadResult } from '../../src/domain/skill-header.js';
import { LayaClient } from '../../src/infra/laya-client.js';

const ROOT = path.resolve(process.cwd(), '.opt-agent');
const USER = 'admin';
const AGENT = '生产调度测试';

export interface FocusEnv {
  root: string;
  user: string;
  agent: string;
  config: IntentFocusConfig;
  client: LayaClient;
  dir: string;
}

export interface FocusFixture extends FocusEnv {
  headers: SkillHeaderLoadResult;
  index: OntologyIndex;
  skillResult: SkillCandidateResult;
}

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

export function loadFocusFixture(env: FocusEnv): FocusFixture {
  const headers = loadSkillHeaders(env.dir);
  const index = loadOntologyIndex(env.dir);
  const skillResult = buildSkillCandidates(headers.skills, index, env.config.maxSkills);
  return { ...env, headers, index, skillResult };
}

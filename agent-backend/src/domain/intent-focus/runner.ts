/**
 * 意图聚焦（016）编排：
 * 开关 → 跳过 → 配置 → 技能头部 → 本体索引 → 技能判定 → 行为判定
 * → 去重 → 提示铸造 → 留档 → 返回提示。
 *
 * 2026-11-06：能力判定只到**本体行为**，函数与规则数据补充已移除。
 *
 * 三个刻意的顺序约束：
 * 1. **开关最先**：关闭轮次零读取、零调用、零留档（FR-060）；`skip` 与"未配置"都排在
 *    读文件之前，避免入口卡片也去扫目录；
 * 2. **能力依附技能**：没有任何技能入选就不读本体能力（FR-020），否则等于全量展开；
 * 3. **失败只降级**：任何异常都折成"本轮无提示"，绝不冒泡到对话主链路（FR-054）。
 *
 * 分批判定见 `batch-decider.ts`，留档写入见 `run-record.ts`
 * ——runner 只保留"顺序与决策"，不再承载 IO 细节。
 */
import type { IntentFocusConfig } from '../../config.js';
import { agentDir } from '../dirs.js';
import { MAX_QUESTIONS_PER_BATCH, decideDisposition, prepareState } from './state.js';
import {
  batchQuestions,
  buildCapabilityCandidates,
  buildCapabilityQuestions,
  buildSkillCandidates,
  buildSkillQuestions,
} from './candidates.js';
import { BatchDecider, type DecideClient } from './batch-decider.js';
import { loadOntologyIndex } from './ontology-loader.js';
import { composeFocusPrompt, type PromptOntology, type PromptSkill } from './prompt.js';
import { FocusRecordWriter } from './run-record.js';
import { selectCapabilities, selectSkills } from './selection.js';
import type {
  CapabilitySelection,
  FocusToolTip,
  SkillCandidate,
  SkillDecision,
} from './types.js';
import { loadSkillHeaders } from '../skill-header.js';

const EMPTY_SELECTION: CapabilitySelection = { behaviors: [] };

/**
 * 一轮意图聚焦的产出。
 *
 * 除「追加到 `systemExtra` 的提示」外，还要把本轮入选的行为带出去：
 * 下一步动作卡片的候选范围**只**来自这份清单（`toolTips`），而 runner 算完即丢
 * 会让轮末无从判断"本轮有没有可提示的能力"。
 */
export interface IntentFocusResult {
  /** 要追加到本轮 `systemExtra` 的提示；空串 = 不追加 */
  prompt: string;
  /** 本轮入选的行为（顺序与判定结果一致；字段值原样透传，不做校验） */
  toolTips: FocusToolTip[];
}

/** 统一空态：开关关闭 / 跳过 / 未配置 / 降级 / 无可用能力 */
const EMPTY_RESULT: IntentFocusResult = { prompt: '', toolTips: [] };

/** 一次判定的上下文（由 `consumeTurn` 提供） */
export interface IntentFocusInput {
  userId: string;
  agentName: string;
  threadId: string;
  /** 本轮 assistant 消息 id（与历史对账用；可能为空） */
  messageId: string | null;
  /** 本轮用户输入原文 */
  userInput: string;
  /** 预置动作入口（下一步动作卡片 / 首屏问题实例卡片）→ 跳过判定 */
  skip: boolean;
}

/** 域层对意图聚焦的唯一依赖口 */
export interface IntentFocusPort {
  /** 返回本轮聚焦结果（提示 + 入选能力）；空态 = 不追加提示、不产卡片 */
  judge(input: IntentFocusInput): Promise<IntentFocusResult>;
}

/** 判定客户端（保留旧名，测试与装配方无需感知内部拆分） */
export type IntentFocusClient = DecideClient;

export interface IntentFocusRunnerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface IntentFocusRunnerDeps {
  /** 运行数据根目录（`OPT_AGENT_ROOT`），用于定位技能与本体 */
  root: string;
  /** 缺省 = 判定模型未配置（功能不可用，fail-closed） */
  config?: IntentFocusConfig;
  /** 缺省 = 未装配 → 视为不可用 */
  client?: IntentFocusClient;
  /** 缺省 = 未装配 → 不落记录 */
  store?: {
    append(
      userId: string,
      agentName: string,
      threadId: string,
      draft: import('./store.js').IntentFocusRecordDraft,
    ): Promise<void>;
  };
  /** SOUL 开关（逐次现读，fail-closed） */
  isEnabled: (userId: string, agentName: string) => boolean;
  logger?: IntentFocusRunnerLogger;
  now?: () => number;
}

export class IntentFocusRunner implements IntentFocusPort {
  private readonly now: () => number;
  private readonly recorder: FocusRecordWriter;

  constructor(private readonly deps: IntentFocusRunnerDeps) {
    this.now = deps.now ?? Date.now;
    this.recorder = new FocusRecordWriter({
      ...(deps.store ? { store: deps.store } : {}),
      ...(deps.logger ? { logger: deps.logger } : {}),
    });
  }

  async judge(input: IntentFocusInput): Promise<IntentFocusResult> {
    // 开关关闭：零副作用（不读取、不判定、不落档，FR-060）
    if (!this.deps.isEnabled(input.userId, input.agentName)) return EMPTY_RESULT;

    const prepared = prepareState(input.userInput);
    const startedAt = this.now();
    const target = {
      userId: input.userId,
      agentName: input.agentName,
      threadId: input.threadId,
      messageId: input.messageId,
    };

    if (input.skip) {
      await this.recorder.write(target, prepared.state, prepared.truncated, {
        ...decideDisposition({ kind: 'skipped', reason: 'skip:preset_action' }),
        model: null,
        roundMs: null,
        candidateCount: 0,
        batches: 0,
        truncated: false,
        skills: [],
        capabilities: EMPTY_SELECTION,
        prompt: '',
        promptTruncated: false,
        warnings: [],
        error: null,
      });
      this.log(input, 'skipped', 'skip:preset_action', 0, 0, this.now() - startedAt);
      return EMPTY_RESULT;
    }

    const config = this.deps.config;
    const client = this.deps.client;
    if (!config || !client) {
      await this.recorder.write(target, prepared.state, prepared.truncated, {
        ...decideDisposition({ kind: 'unconfigured', reason: 'no_config' }),
        model: null,
        roundMs: null,
        candidateCount: 0,
        batches: 0,
        truncated: false,
        skills: [],
        capabilities: EMPTY_SELECTION,
        prompt: '',
        promptTruncated: false,
        warnings: [],
        error: null,
      });
      this.deps.logger?.warn(
        {
          event: 'intent-focus.unconfigured',
          thread_id: input.threadId,
          agent_name: input.agentName,
          stage: 'config',
          reason: 'no_config',
        },
        '意图聚焦已开启但判定模型未配置，本轮按不聚焦处理',
      );
      return EMPTY_RESULT;
    }

    const dir = agentDir(this.deps.root, input.userId, input.agentName);
    const deadline = startedAt + config.timeoutMs;
    const decider = new BatchDecider({
      client,
      ...(this.deps.logger ? { logger: this.deps.logger } : {}),
      now: this.now,
    });

    try {
      return await this.run(input, prepared.state, prepared.truncated, dir, config, decider, deadline, startedAt);
    } catch (err) {
      // 兜底：目录不可读、YAML 结构异常等未预期错误一律降级（FR-054）
      const message = (err as Error)?.message ?? String(err);
      await this.fail(input, prepared.state, prepared.truncated, config, 'unexpected_error', message, startedAt);
      return EMPTY_RESULT;
    }
  }

  private async run(
    input: IntentFocusInput,
    state: string,
    inputTruncated: boolean,
    dir: string,
    config: IntentFocusConfig,
    decider: BatchDecider,
    deadline: number,
    startedAt: number,
  ): Promise<IntentFocusResult> {
    const target = {
      userId: input.userId,
      agentName: input.agentName,
      threadId: input.threadId,
      messageId: input.messageId,
    };
    const headers = loadSkillHeaders(dir);
    const index = loadOntologyIndex(dir);
    const warnings = [...headers.warnings, ...index.warnings];
    const skillResult = buildSkillCandidates(headers.skills, index, config.maxSkills);

    // 没有任何技能：不发起调用（题量为 0 时调用没有意义）
    if (headers.skills.length === 0) {
      await this.recorder.write(target, state, inputTruncated, {
        ...decideDisposition({
          kind: 'ok',
          skillCount: 0,
          focusableCount: 0,
          selectedCount: 0,
        }),
        model: config.model,
        roundMs: 0,
        candidateCount: 0,
        batches: 0,
        truncated: false,
        skills: [],
        capabilities: EMPTY_SELECTION,
        prompt: '',
        promptTruncated: false,
        warnings,
        error: null,
      });
      this.log(input, 'done', 'no_skills', 0, 0, this.now() - startedAt);
      return EMPTY_RESULT;
    }

    // 全是"该聚焦但本体没物化"的本体技能：不发起调用（FR-014）
    if (skillResult.candidates.length === 0) {
      await this.recorder.write(target, state, inputTruncated, {
        ...decideDisposition({
          kind: 'ok',
          skillCount: headers.skills.length,
          focusableCount: 0,
          selectedCount: 0,
        }),
        model: config.model,
        roundMs: 0,
        candidateCount: 0,
        batches: 1,
        truncated: skillResult.truncated,
        skills: skillResult.excluded,
        capabilities: EMPTY_SELECTION,
        prompt: '',
        promptTruncated: false,
        warnings,
        error: null,
      });
      this.log(input, 'done', 'no_focusable_skills', 0, 0, this.now() - startedAt);
      return EMPTY_RESULT;
    }

    const skillBatches = batchQuestions(
      skillResult.candidates,
      buildSkillQuestions(skillResult.candidates),
      MAX_QUESTIONS_PER_BATCH,
    );
    const skillDecided = await decider.decideAll(state, skillBatches, deadline, 'skill');

    if (Object.keys(skillDecided.scores).length === 0) {
      const reason = skillDecided.failureReason ?? 'all_batches_failed';
      await this.recorder.write(target, state, inputTruncated, {
        ...decideDisposition({ kind: 'failed', reason }),
        model: config.model,
        roundMs: this.now() - startedAt,
        candidateCount: skillResult.candidates.length,
        batches: skillBatches.length,
        truncated: skillResult.truncated,
        skills: skillResult.excluded,
        capabilities: EMPTY_SELECTION,
        prompt: '',
        promptTruncated: false,
        warnings,
        // 走到这里必然是全批失败，失败清单不可能为空
        error: skillDecided.failures.join('; '),
      });
      this.degradedLog(input, 'skill', reason, skillDecided.failures);
      return EMPTY_RESULT;
    }

    const skillDecisions = selectSkills(skillResult.candidates, skillDecided.scores, config.skillThreshold);
    const allSkillDecisions: SkillDecision[] = [...skillResult.excluded, ...skillDecisions];
    const selectedNames = new Set(
      skillDecisions.filter((decision) => decision.selected).map((decision) => decision.header.name),
    );
    const selectedCandidates = skillResult.candidates.filter((candidate) =>
      selectedNames.has(candidate.header.name),
    );

    if (selectedCandidates.length === 0) {
      await this.recorder.write(target, state, inputTruncated, {
        ...decideDisposition({
          kind: 'ok',
          skillCount: headers.skills.length,
          focusableCount: skillResult.candidates.length,
          selectedCount: 0,
        }),
        model: config.model,
        roundMs: this.now() - startedAt,
        candidateCount: skillResult.candidates.length,
        batches: skillBatches.length,
        truncated: skillResult.truncated,
        skills: allSkillDecisions,
        capabilities: EMPTY_SELECTION,
        prompt: '',
        promptTruncated: false,
        warnings,
        error: skillDecided.failures.join('; ') || null,
      });
      this.log(
        input,
        'done',
        'below_threshold',
        skillResult.candidates.length,
        skillBatches.length,
        this.now() - startedAt,
      );
      return EMPTY_RESULT;
    }

    const capabilityResult = buildCapabilityCandidates(
      selectedCandidates,
      index,
      config.maxCapabilities,
    );
    const capabilityBatches = batchQuestions(
      capabilityResult.candidates,
      buildCapabilityQuestions(capabilityResult.candidates),
      MAX_QUESTIONS_PER_BATCH,
    );

    let capabilitySelection: CapabilitySelection = EMPTY_SELECTION;
    let capabilityFailures: string[] = [];
    if (capabilityBatches.length > 0) {
      const capabilityDecided = await decider.decideAll(state, capabilityBatches, deadline, 'capability');
      // 能力全批失败：技能已经选出来了，但本轮不给提示（FR-043：全部失败即降级）
      if (Object.keys(capabilityDecided.scores).length === 0) {
        const reason = capabilityDecided.failureReason ?? 'all_batches_failed';
        await this.recorder.write(target, state, inputTruncated, {
          ...decideDisposition({ kind: 'failed', reason }),
          model: config.model,
          roundMs: this.now() - startedAt,
          candidateCount: skillResult.candidates.length + capabilityResult.candidates.length,
          batches: skillBatches.length + capabilityBatches.length,
          truncated: skillResult.truncated || capabilityResult.truncated,
          skills: allSkillDecisions,
          capabilities: EMPTY_SELECTION,
          prompt: '',
          promptTruncated: false,
          warnings,
          // 同上：全批失败时失败清单非空
          error: capabilityDecided.failures.join('; '),
        });
        this.degradedLog(input, 'capability', reason, capabilityDecided.failures);
        return EMPTY_RESULT;
      }
      capabilitySelection = selectCapabilities(
        capabilityResult.candidates,
        capabilityDecided.scores,
        config.ontologyThreshold,
      );
      capabilityFailures = capabilityDecided.failures;
    }

    const scoreByName = new Map(skillDecisions.map((decision) => [decision.header.name, decision.score]));
    const promptSkills: PromptSkill[] = selectedCandidates.map((candidate, order) => ({
      name: candidate.header.name,
      isOntology: candidate.isOntologySkill,
      ontology: pickOntology(candidate),
      score: scoreByName.get(candidate.header.name) ?? null,
      order,
    }));
    const composed = composeFocusPrompt(promptSkills, capabilitySelection);
    const roundMs = this.now() - startedAt;

    await this.recorder.write(target, state, inputTruncated, {
      ...decideDisposition({
        kind: 'ok',
        skillCount: headers.skills.length,
        focusableCount: skillResult.candidates.length,
        selectedCount: selectedCandidates.length,
      }),
      model: config.model,
      roundMs,
      candidateCount: skillResult.candidates.length + capabilityResult.candidates.length,
      batches: skillBatches.length + capabilityBatches.length,
      truncated: skillResult.truncated || capabilityResult.truncated,
      skills: allSkillDecisions,
      capabilities: capabilitySelection,
      prompt: composed.prompt,
      promptTruncated: composed.truncated,
      warnings,
      error: [...skillDecided.failures, ...capabilityFailures].join('; ') || null,
    });

    this.deps.logger?.info(
      {
        event: 'intent-focus.done',
        thread_id: input.threadId,
        agent_name: input.agentName,
        stage: 'prompt',
        reason: null,
        skills_selected: selectedCandidates.length,
        behaviors: capabilitySelection.behaviors.length,
        prompt_chars: composed.prompt.length,
        round_ms: roundMs,
      },
      `意图聚焦：入选 ${selectedCandidates.length} 个技能、${capabilitySelection.behaviors.length} 个行为`,
    );

    return {
      prompt: composed.prompt,
      toolTips: toToolTips(capabilitySelection),
    };
  }

  private async fail(
    input: IntentFocusInput,
    state: string,
    inputTruncated: boolean,
    config: IntentFocusConfig,
    reason: string,
    message: string,
    startedAt: number,
  ): Promise<void> {
    await this.recorder.write(
      {
        userId: input.userId,
        agentName: input.agentName,
        threadId: input.threadId,
        messageId: input.messageId,
      },
      state,
      inputTruncated,
      {
        ...decideDisposition({ kind: 'failed', reason }),
        model: config.model,
        roundMs: this.now() - startedAt,
        candidateCount: 0,
        batches: 0,
        truncated: false,
        skills: [],
        capabilities: EMPTY_SELECTION,
        prompt: '',
        promptTruncated: false,
        warnings: [],
        error: message,
      },
    );
    this.deps.logger?.warn(
      {
        event: 'intent-focus.degraded',
        alert: true,
        stage: 'run',
        reason,
        thread_id: input.threadId,
        agent_name: input.agentName,
        detail: message,
      },
      `意图聚焦异常，本轮按不聚焦处理：${message}`,
    );
  }

  private log(
    input: IntentFocusInput,
    stage: string,
    reason: string | null,
    candidates: number,
    batches: number,
    roundMs: number,
  ): void {
    this.deps.logger?.info(
      {
        event: 'intent-focus.done',
        thread_id: input.threadId,
        agent_name: input.agentName,
        stage,
        reason,
        candidates,
        batches,
        round_ms: roundMs,
      },
      reason === null ? '意图聚焦完成' : `意图聚焦：${reason}`,
    );
  }

  private degradedLog(
    input: IntentFocusInput,
    stage: string,
    reason: string,
    failures: readonly string[],
  ): void {
    this.deps.logger?.warn(
      {
        event: 'intent-focus.degraded',
        alert: true,
        stage,
        reason,
        thread_id: input.threadId,
        agent_name: input.agentName,
        failed: failures.length,
        detail: failures.join('; '),
      },
      `意图聚焦（${stage}）失败，本轮按不聚焦处理`,
    );
  }
}

/**
 * 入选行为 → 卡片的 `tool_tips`。
 *
 * **纯搬运**：顺序沿用判定结果（分数降序），不做去重 / 不查本体是否存在 / 不裁剪条数
 * ——条数上限（5）是卡片铸造侧的硬约束，不在这里提前砍。
 */
function toToolTips(selection: CapabilitySelection): FocusToolTip[] {
  return selection.behaviors.map((decision) => ({
    name: decision.name,
    title: decision.title,
    ontology_id: decision.ontologyId,
    ontology_name: decision.ontologyName,
  }));
}

/**
 * 一个本体技能恒只有**一个**本体（`SKILL.md` 的单个 `ontology_id`）。
 *
 * 同一 `ontology_id` 被物化成多份文件时只取首份（本体文件枚举序），
 * 提示里不重复输出；本体名优先取 `ontology.yaml`，缺失时回落到技能头部。
 */
function pickOntology(candidate: SkillCandidate): PromptOntology | null {
  const first = candidate.matchedOntologies[0];
  if (!first) return null;
  return {
    id: first.ontologyId,
    name: first.ontologyName ?? candidate.header.metadata.ontologyName,
  };
}


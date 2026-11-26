import type { IntentFocusConfig } from '../../config.js';
import type { ModelSelection } from '../../types.js';
import { agentDir } from '../dirs.js';
import {
  runRewriteStage,
  toRewriteRecordFields,
  type ReadHistory,
  type RewriteLlm,
} from './rewrite.js';
import {
  EMPTY_REASON,
  MAX_QUESTIONS_PER_BATCH,
  decideDisposition,
  prepareState,
} from './state.js';
import {
  batchQuestions,
  buildCapabilityCandidates,
  buildCapabilityQuestions,
  buildSkillCandidates,
  buildSkillQuestions,
} from './candidates.js';
import { BatchDecider, MIN_BATCH_TIMEOUT_MS, type DecideClient } from './batch-decider.js';
import { resolveConceptQueries } from './concept-queries.js';
import { clampDepth, expandNeighborhood } from './expansion.js';
import { loadOntologyIndex } from './ontology-loader.js';
import { buildFocusPaths } from './paths.js';
import {
  composeFocusPrompt,
  maxPromptChars,
  type PromptOntology,
  type PromptSkill,
} from './prompt.js';
import { PLAN_GATE_ID, PLAN_GATE_QUESTION } from './plan-gate.js';
import type { ConceptEntry } from './record.js';
import { FocusRecordWriter } from './run-record.js';
import { selectCapabilities, selectSkills } from './selection.js';
import type {
  CapabilitySelection,
  ExpandedBehavior,
  ExpansionResult,
  FocusToolTip,
  OntologyDefinition,
  OntologyIndex,
  SkillCandidate,
  SkillDecision,
} from './types.js';
import { loadSkillHeaders } from '../skill-header.js';

const EMPTY_SELECTION: CapabilitySelection = { behaviors: [], functions: [], conceptQueries: [] };

const EMPTY_EXPANSION: ExpansionResult = {
  upstream: { concepts: [], behaviors: [], directEdges: [] },
  downstream: { concepts: [], behaviors: [], directEdges: [] },
  warnings: [],
  truncated: false,
};

export interface IntentFocusResult {
  prompt: string;
  toolTips: FocusToolTip[];
  /**
   * 028：规划门禁分数（0~1）。
   *
   * `null` = 没判（门禁关闭 / 数字人未开规划 / 判定失败或超时）。
   * 消费方按 fail-open 处理：`null` 一律走规划。
   */
  planScore: number | null;
}

/** 统一空态：开关关闭 / 跳过 / 未配置 / 降级 / 无可用能力 */
const EMPTY_RESULT: IntentFocusResult = { prompt: '', toolTips: [], planScore: null };

export interface IntentFocusInput {
  userId: string;
  agentName: string;
  threadId: string;
  messageId: string | null;
  userInput: string;
  skip: boolean;
  model?: ModelSelection;
  signal?: AbortSignal;
}

export interface IntentFocusPort {
  judge(input: IntentFocusInput): Promise<IntentFocusResult>;
}

export type IntentFocusClient = DecideClient;

export interface IntentFocusRunnerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface IntentFocusRunnerDeps {
  root: string;
  /** 缺省 = 判定模型未配置（功能不可用，fail-closed） */
  config?: IntentFocusConfig;
  /** 缺省 = 未装配 → 视为不可用 */
  client?: IntentFocusClient;
  store?: {
    append(
      userId: string,
      agentName: string,
      threadId: string,
      draft: import('./store.js').IntentFocusRecordDraft,
    ): Promise<void>;
  };
  isEnabled: (userId: string, agentName: string) => boolean;
  getDepth?: (userId: string, agentName: string) => number;
  /**
   * 027：输入改写开关（逐次现读）；缺省 = 改写不可用。
   *
   * 调用方（`server-attachments`）已保证"意图聚焦关闭则本开关不生效"，
   * 因此这里只读 `input_rewrite` 一个键即可。
   */
  isRewriteEnabled?: (userId: string, agentName: string) => boolean;
  /**
   * 028：数字人是否开启任务规划（逐次现读）。
   *
   * 只有开启时才花一次判定：没开规划的数字人不应为门禁多付一次 laya 调用。
   */
  isTaskPlanning?: (userId: string, agentName: string) => boolean;
  readHistory?: ReadHistory;
  /** 027：一次性文本生成端口；缺省 = 改写不可用（本轮按原文聚焦） */
  rewriteLlm?: RewriteLlm;
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
    const depth = clampDepth(this.deps.getDepth?.(input.userId, input.agentName) ?? 0);

    try {
      return await this.run(
        input,
        prepared.state,
        prepared.truncated,
        dir,
        config,
        decider,
        deadline,
        startedAt,
        depth,
      );
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
    depth: number,
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
      this.log(input, 'done', EMPTY_REASON.noSkills, 0, 0, this.now() - startedAt);
      return EMPTY_RESULT;
    }

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
      this.log(input, 'done', EMPTY_REASON.noFocusableSkills, 0, 0, this.now() - startedAt);
      return EMPTY_RESULT;
    }

    const rewrite = await runRewriteStage(
      {
        config,
        enabled: this.deps.isRewriteEnabled?.(input.userId, input.agentName) === true,
        ...(this.deps.client ? { client: this.deps.client } : {}),
        ...(this.deps.rewriteLlm ? { rewriteLlm: this.deps.rewriteLlm } : {}),
        ...(this.deps.readHistory ? { readHistory: this.deps.readHistory } : {}),
        ...(this.deps.logger ? { logger: this.deps.logger } : {}),
        now: this.now,
      },
      {
        userId: input.userId,
        agentName: input.agentName,
        threadId: input.threadId,
        userInput: input.userInput,
        deadline,
        ...(input.model ? { model: input.model } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    const rewriteFields = toRewriteRecordFields(rewrite);
    /** 送入评分 / 发散的素材：改写成功即改写文本，否则与改造前逐字一致 */
    const focusState = rewrite.state;

    const skillBatches = batchQuestions(
      skillResult.candidates,
      buildSkillQuestions(skillResult.candidates),
      MAX_QUESTIONS_PER_BATCH,
    );
    const skillDecided = await decider.decideAll(focusState, skillBatches, deadline, 'skill');

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
        rewrite: rewriteFields,
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
        rewrite: rewriteFields,
        error: skillDecided.failures.join('; ') || null,
      });
      this.log(
        input,
        'done',
        EMPTY_REASON.belowThreshold,
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

    const selectedOntologies = collectSelectedOntologies(index, selectedCandidates);

    let capabilitySelection: CapabilitySelection = EMPTY_SELECTION;
    let capabilityFailures: string[] = [];
    if (capabilityBatches.length > 0) {
      const capabilityDecided = await decider.decideAll(
        focusState,
        capabilityBatches,
        deadline,
        'capability',
      );
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
          rewrite: rewriteFields,
          error: capabilityDecided.failures.join('; '),
        });
        this.degradedLog(input, 'capability', reason, capabilityDecided.failures);
        return EMPTY_RESULT;
      }
      const picked = selectCapabilities(capabilityResult.candidates, capabilityDecided.scores, {
        behavior: config.ontologyBehaviorThreshold,
        function: config.ontologyFunctionThreshold,
      });
      capabilitySelection = {
        ...picked,
        conceptQueries: resolveConceptQueries(picked.functions, selectedOntologies, picked.behaviors),
      };
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

    const directConcepts = directConceptEntries(capabilitySelection, selectedOntologies);
    const expansion =
      depth > 0
        ? expandNeighborhood({
            behaviors: capabilitySelection.behaviors.map((decision) => ({
              ontologyId: decision.ontologyId,
              name: decision.name,
              concept: decision.concept,
            })),
            ontologies: selectedOntologies,
            depth,
          })
        : EMPTY_EXPANSION;

    const focusPaths =
      depth > 0
        ? buildFocusPaths({
            behaviors: capabilitySelection.behaviors.map((decision) => ({
              ontologyId: decision.ontologyId,
              name: decision.name,
              title: decision.title,
              concept: decision.concept,
              score: decision.score,
            })),
            ontologies: selectedOntologies,
            expansion,
          })
        : [];
    const composed = composeFocusPrompt(promptSkills, capabilitySelection, {
      paths: focusPaths,
      maxChars: maxPromptChars(depth),
    });
    const roundMs = this.now() - startedAt;
    const allWarnings = [...warnings, ...expansion.warnings];

    // 028：规划门禁（仅当数字人开了 task_planning 且配置了 plan_threshold）
    const gate = await this.judgePlanGate(input, config, focusState, deadline);

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
      truncated: skillResult.truncated || capabilityResult.truncated || expansion.truncated,
      depth,
      skills: allSkillDecisions,
      capabilities: capabilitySelection,
      concepts: [
        ...directConcepts,
        ...expansion.upstream.concepts.map((concept) => ({
          ontologyId: concept.ontologyId,
          ontologyName: concept.ontologyName,
          name: concept.name,
          title: concept.title,
          source: 'upstream' as const,
          hop: concept.hop,
          viaConcept: concept.viaConcept,
          edges: concept.edges.map((edge) => ({ from: edge.from, relation: edge.relation })),
        })),
      ],
      upstreamBehaviors: expansion.upstream.behaviors,
      downstreamBehaviors: expansion.downstream.behaviors,
      prompt: composed.prompt,
      promptTruncated: composed.truncated,
      warnings: allWarnings,
      rewrite: rewriteFields,
      // 028：门禁分数落档，用于事后标定阈值（0.4 只是起点）
      plan_score: gate.score,
      plan_round_ms: gate.roundMs,
      error: [...skillDecided.failures, ...capabilityFailures].join('; ') || null,
    });

    this.deps.logger?.info(
      {
        event: 'intent-focus.done',
        thread_id: input.threadId,
        agent_name: input.agentName,
        stage: 'prompt',
        reason: null,
        depth,
        skills_selected: selectedCandidates.length,
        concepts: directConcepts.length + expansion.upstream.concepts.length,
        behaviors: capabilitySelection.behaviors.length,
        functions: capabilitySelection.functions.length,
        concept_queries: capabilitySelection.conceptQueries.length,
        focus_paths: focusPaths.length,
        upstream_behaviors: expansion.upstream.behaviors.length,
        downstream_behaviors: expansion.downstream.behaviors.length,
        prompt_chars: composed.prompt.length,
        round_ms: roundMs,
      },
      `意图聚焦：入选 ${selectedCandidates.length} 个技能、${capabilitySelection.behaviors.length} 个行为、` +
        `${capabilitySelection.functions.length} 个函数、${capabilitySelection.conceptQueries.length} 个取数行为` +
        `（阶数 ${depth}：上游 +${expansion.upstream.behaviors.length}，下游 +${expansion.downstream.behaviors.length}）`,
    );

    return {
      prompt: composed.prompt,
      toolTips: buildToolTips(capabilitySelection, expansion.downstream.behaviors),
      planScore: gate.score,
    };
  }

  /**
   * 028：规划门禁判定。
   *
   * 三个前置：配置了 `plan_threshold`、数字人开了 `task_planning`、预算还够一次最小调用。
   * 任一不满足 → 不调用、分数为 `null`（消费方 fail-open 走规划）。
   * 判定失败/超时同样返回 `null`：门禁是优化项，不能把复杂任务降级掉。
   */
  private async judgePlanGate(
    input: IntentFocusInput,
    config: IntentFocusConfig,
    state: string,
    deadline: number,
  ): Promise<{ score: number | null; roundMs: number | null }> {
    const { planThreshold } = config;
    const client = this.deps.client;
    if (planThreshold === undefined || client === undefined) {
      return { score: null, roundMs: null };
    }
    if (this.deps.isTaskPlanning?.(input.userId, input.agentName) !== true) {
      return { score: null, roundMs: null };
    }
    const remaining = deadline - this.now();
    if (remaining < MIN_BATCH_TIMEOUT_MS) {
      return { score: null, roundMs: null };
    }
    const timeoutMs = Math.max(
      MIN_BATCH_TIMEOUT_MS,
      Math.min(config.planTimeoutMs, remaining - 100),
    );
    const started = this.now();
    const result = await client.decide(state, { [PLAN_GATE_ID]: PLAN_GATE_QUESTION }, timeoutMs);
    const roundMs = this.now() - started;
    if (!result.ok) {
      this.deps.logger?.warn(
        {
          event: 'plan.gate.degraded',
          reason: result.reason,
          round_ms: roundMs,
          agent_name: input.agentName,
          thread_id: input.threadId,
        },
        '规划门禁判定失败，按 fail-open 继续走规划',
      );
      return { score: null, roundMs };
    }
    const score = result.scores[PLAN_GATE_ID];
    return { score: typeof score === 'number' ? score : null, roundMs };
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
 * 卡片候选 = 直接命中 + 下游发散（019）。
 *
 * **纯搬运**：顺序沿用"判定结果（分数降序）→ 下游发散序"，不做去重 / 不查本体是否存在 /
 * 不裁剪条数——条数上限（5）是卡片铸造侧的硬约束，不在这里提前砍。
 *
 * 上游发散**不进**这里：它是"模型该参考什么"，与"能建议用户做什么"是两件事。
 */
function buildToolTips(
  selection: CapabilitySelection,
  downstream: readonly ExpandedBehavior[],
): FocusToolTip[] {
  return [
    ...selection.behaviors.map((decision) => ({
      name: decision.name,
      title: decision.title,
      ontology_id: decision.ontologyId,
      ontology_name: decision.ontologyName,
    })),
    ...downstream.map((behavior) => ({
      name: behavior.name,
      title: behavior.title,
      ontology_id: behavior.ontologyId,
      ontology_name: behavior.ontologyName,
    })),
  ];
}

/**
 * 已入选技能引用的本体（本体文件枚举序）。
 *
 * 顺序决定发散输出序，因此 MUST 沿用 `index.all` 的枚举序，不能用 Set 的插入序。
 */
function collectSelectedOntologies(
  index: OntologyIndex,
  selectedCandidates: readonly SkillCandidate[],
): OntologyDefinition[] {
  const ids = new Set<string>();
  for (const candidate of selectedCandidates) {
    if (!candidate.isOntologySkill) continue;
    for (const ontology of candidate.matchedOntologies) ids.add(ontology.ontologyId);
  }
  return index.all.filter((ontology) => ids.has(ontology.ontologyId));
}

/**
 * 直接命中的概念（发散起点）——按行为顺序去重，标题取本体 `concepts[]`。
 *
 * 概念在 `concepts[]` 里找不到时以 name 兜底（提示不留空；断链已由发散 warning 记录）。
 */
function directConceptEntries(
  selection: CapabilitySelection,
  ontologies: readonly OntologyDefinition[],
): ConceptEntry[] {
  const titles = new Map<string, string>();
  for (const ontology of ontologies) {
    for (const concept of ontology.concepts) {
      titles.set(`${ontology.ontologyId}\u0000${concept.name}`, concept.title);
    }
  }

  const seen = new Set<string>();
  const entries: ConceptEntry[] = [];
  for (const decision of selection.behaviors) {
    if (!decision.concept) continue;
    const key = `${decision.ontologyId}\u0000${decision.concept}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      ontologyId: decision.ontologyId,
      ontologyName: decision.ontologyName,
      name: decision.concept,
      title: titles.get(key) ?? decision.concept,
      source: 'direct',
      hop: 0,
      viaConcept: null,
    });
  }
  return entries;
}

function pickOntology(candidate: SkillCandidate): PromptOntology | null {
  const first = candidate.matchedOntologies[0];
  if (!first) return null;
  return {
    id: first.ontologyId,
    name: first.ontologyName ?? candidate.header.metadata.ontologyName,
  };
}


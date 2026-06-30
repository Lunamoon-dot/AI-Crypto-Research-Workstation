import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  ScenarioDecisionQueueItemResponse,
  ScenarioDecisionWorkbenchResponse,
} from './scenario-decision.types';
import {
  toBacktestRunResponse,
  toScenarioDecisionQueueItemResponse,
  toScenarioResponse,
  toTradePlaybookResponse,
} from '../contracts/frontend-contract';
import { optionalScenarioLifecycleRows } from '../database/optional-scenario-lifecycle';
import { evaluateScenario } from '../scenarios/scenario-evaluator';
import { evaluateScenarioRuntimeDecision } from '../scenarios/scenario-runtime-evaluator';
import { ScenarioReliabilityService } from '../scenarios/scenario-reliability.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class ScenarioDecisionWorkbenchService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    private readonly reliability: ScenarioReliabilityService,
  ) {}

  async workbench(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioDecisionWorkbenchResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    const states = new Map(
      (await optionalScenarioLifecycleRows(() =>
        this.journal.listScenarioDecisionItemStates(workspaceId),
      )).map((state) => [String(state.id ?? ''), state]),
    );
    const rawItems = await this.rawItems(workspaceId);
    const now = Date.now();
    const items = rawItems
      .map((item) => {
        const state = states.get(item.id);
        return state
          ? toScenarioDecisionQueueItemResponse({ ...item, ...state })
          : item;
      })
      .filter((item) => item.status !== 'resolved')
      .filter((item) => item.status !== 'snoozed' || dueAtMs(item.due_at) <= now)
      .sort((left, right) => right.priority - left.priority);
    return {
      version: 'scenario_decision_workspace.v1',
      workspace_id: workspaceId,
      generated_at: new Date().toISOString(),
      total_open: items.length,
      items,
    };
  }

  async resolveItem(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioDecisionQueueItemResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    const saved = await this.journal.saveScenarioDecisionItemState(
      { id, status: 'resolved', due_at: null },
      workspaceId,
    );
    return this.statefulItem(id, saved, workspaceId);
  }

  async snoozeItem(
    id: string,
    dueAt: string | null,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioDecisionQueueItemResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    if (!dueAt) {
      throw new BadRequestException('Snooze due_at is required.');
    }
    const saved = await this.journal.saveScenarioDecisionItemState(
      { id, status: 'snoozed', due_at: dueAt },
      workspaceId,
    );
    return this.statefulItem(id, saved, workspaceId);
  }

  private async rawItems(workspaceId: string): Promise<ScenarioDecisionQueueItemResponse[]> {
    return [
      ...(await this.scenarioItems(workspaceId)),
      ...(await this.evaluationItems(workspaceId)),
      ...(await this.playbookItems(workspaceId)),
      ...(await this.backtestItems(workspaceId)),
      ...(await this.reliabilityItems(workspaceId)),
    ];
  }

  private async statefulItem(
    id: string,
    state: JsonRecord,
    workspaceId: string,
  ): Promise<ScenarioDecisionQueueItemResponse> {
    const item = (await this.rawItems(workspaceId)).find((candidate) => candidate.id === id);
    if (!item) {
      throw new NotFoundException(`Scenario decision item ${id} not found`);
    }
    return toScenarioDecisionQueueItemResponse({ ...item, ...state });
  }

  private async scenarioItems(
    workspaceId: string,
  ): Promise<ScenarioDecisionQueueItemResponse[]> {
    const items: ScenarioDecisionQueueItemResponse[] = [];
    const theses = await this.journal.listTheses(1000, workspaceId);
    const snapshots = new Map<string, JsonRecord | null>();
    const nowIso = new Date().toISOString();
    for (const thesis of theses) {
      const thesisId = nullableString(thesis.id);
      if (!thesisId) continue;
      const thesisPayload = recordValue(thesis.payload ?? thesis.payload_json);
      const symbol = nullableString(thesis.symbol ?? thesisPayload.symbol);
      if (symbol && !snapshots.has(symbol)) {
        snapshots.set(symbol, await this.journal.getLatestMarketSnapshot(symbol, workspaceId));
      }
      const snapshot = symbol ? snapshots.get(symbol) ?? null : null;
      for (const scenario of await this.journal.listScenarios(thesisId, workspaceId)) {
        const response = toScenarioResponse(
          scenarioWithRuntimeDecision(scenario, snapshot, nowIso),
          thesis,
        );
        if (
          response.runtime_decision.trigger_status === 'triggered' ||
          response.runtime_decision.trigger_status === 'near_trigger'
        ) {
          const triggered = response.runtime_decision.trigger_status === 'triggered';
          items.push(toScenarioDecisionQueueItemResponse({
            id: `active_scenario:${response.id}`,
            workspace_id: workspaceId,
            type: 'active_scenario',
            priority: triggered ? 100 : 80,
            title: response.scenario_name || response.condition || 'Active scenario',
            summary: response.runtime_decision.status_reason || response.condition,
            scenario_id: response.id,
            thesis_id: response.thesis_id,
            playbook_id: null,
            backtest_id: null,
            status: 'open',
            blockers: response.runtime_decision.blocking_reasons,
            next_action: triggered ? 'Review triggered scenario.' : 'Monitor near-trigger scenario.',
            due_at: response.evaluation_snapshot?.planned_evaluation_at ?? null,
            created_at: response.last_evaluated_at ?? new Date().toISOString(),
          }));
        }
        if (response.evaluation_state === 'due') {
          items.push(toScenarioDecisionQueueItemResponse({
            id: `evaluation_due:${response.id}`,
            workspace_id: workspaceId,
            type: 'evaluation_due',
            priority: 90,
            title: `Evaluate ${response.scenario_name || response.id}`,
            summary: 'Scenario evaluation window has matured.',
            scenario_id: response.id,
            thesis_id: response.thesis_id,
            playbook_id: null,
            backtest_id: null,
            status: 'open',
            blockers: [],
            next_action: 'Run scenario evaluation.',
            due_at: response.evaluation_snapshot?.planned_evaluation_at ?? null,
            created_at: new Date().toISOString(),
          }));
        }
      }
    }
    return items;
  }

  private async evaluationItems(
    workspaceId: string,
  ): Promise<ScenarioDecisionQueueItemResponse[]> {
    const evaluations = await optionalScenarioLifecycleRows(() =>
      this.journal.listScenarioEvaluationsForReliability(
        { limit: 100 },
        workspaceId,
      ),
    );
    const latestInconclusiveByScenario = new Map<string, JsonRecord>();
    for (const evaluation of evaluations) {
      if (evaluation.result !== 'inconclusive') {
        continue;
      }
      const scenarioKey = nullableString(evaluation.scenario_id) ?? String(evaluation.id ?? '');
      if (!latestInconclusiveByScenario.has(scenarioKey)) {
        latestInconclusiveByScenario.set(scenarioKey, evaluation);
      }
    }
    return [...latestInconclusiveByScenario.values()].map((evaluation) =>
      toScenarioDecisionQueueItemResponse({
        id: `evaluation_inconclusive:${evaluation.id}`,
        workspace_id: workspaceId,
        type: 'evaluation_inconclusive',
        priority: 70,
        title: `Review inconclusive evaluation ${evaluation.scenario_id ?? ''}`.trim(),
        summary: 'Scenario evaluation was inconclusive or had insufficient data.',
        scenario_id: nullableString(evaluation.scenario_id),
        thesis_id: nullableString(evaluation.thesis_id),
        playbook_id: null,
        backtest_id: null,
        status: 'open',
        blockers: stringList(evaluation.warnings),
        next_action: 'Inspect data quality and decide whether to rerun later.',
        due_at: null,
        created_at: String(evaluation.evaluated_at ?? new Date().toISOString()),
      }),
    );
  }

  private async playbookItems(
    workspaceId: string,
  ): Promise<ScenarioDecisionQueueItemResponse[]> {
    return (await optionalScenarioLifecycleRows(() =>
      this.journal.listTradePlaybooks(100, workspaceId),
    ))
      .map(toTradePlaybookResponse)
      .map((playbook) => toScenarioDecisionQueueItemResponse({
        id: `playbook_candidate:${playbook.id}`,
        workspace_id: workspaceId,
        type: 'playbook_candidate',
        priority: 60,
        title: `Review playbook ${playbook.symbol}`,
        summary: playbook.entry.condition,
        scenario_id: playbook.source_scenario_id,
        thesis_id: playbook.source_thesis_id,
        playbook_id: playbook.id,
        backtest_id: null,
        status: 'open',
        blockers: playbook.compile_warnings,
        next_action: 'Review manual playbook assumptions.',
        due_at: null,
        created_at: playbook.created_at,
      }));
  }

  private async backtestItems(
    workspaceId: string,
  ): Promise<ScenarioDecisionQueueItemResponse[]> {
    return (await optionalScenarioLifecycleRows(() =>
      this.journal.listBacktestRuns(100, workspaceId),
    ))
      .map(toBacktestRunResponse)
      .filter((backtest) => backtest.status === 'completed' || backtest.status === 'partial')
      .map((backtest) => toScenarioDecisionQueueItemResponse({
        id: `backtest_ready:${backtest.id}`,
        workspace_id: workspaceId,
        type: 'backtest_ready',
        priority: 50,
        title: `Backtest ready ${backtest.playbook_id}`,
        summary: `${backtest.result.trade_count} trade(s), data ${backtest.data_quality}`,
        scenario_id: null,
        thesis_id: null,
        playbook_id: backtest.playbook_id,
        backtest_id: backtest.id,
        status: 'open',
        blockers: backtest.warnings,
        next_action: 'Review assumptions before interpreting result.',
        due_at: null,
        created_at: backtest.completed_at ?? backtest.created_at,
      }));
  }

  private async reliabilityItems(
    workspaceId: string,
  ): Promise<ScenarioDecisionQueueItemResponse[]> {
    const profiles = await this.reliability.profileForWorkspace({ limit: 100 }, workspaceId);
    return profiles
      .filter((profile) => profile.sample_size >= 5)
      .map((profile) => toScenarioDecisionQueueItemResponse({
        id: `reliability_changed:${slug([
          profile.symbol,
          profile.market_type,
          profile.horizon,
          profile.relation_to_thesis,
          profile.action_bias,
          profile.setup_type ?? 'none',
        ].join(':'))}`,
        workspace_id: workspaceId,
        type: 'reliability_changed',
        priority: 40,
        title: `Reliability updated ${profile.symbol}`,
        summary: profile.hit_rate === null
          ? `${profile.sample_size} samples; hit rate hidden until enough quality data.`
          : `${profile.sample_size} samples; ${Math.round(profile.hit_rate * 100)}% hit rate.`,
        scenario_id: null,
        thesis_id: null,
        playbook_id: null,
        backtest_id: null,
        status: 'open',
        blockers: profile.data_quality_notes,
        next_action: 'Review reliability lessons before trusting similar setups.',
        due_at: null,
        created_at: new Date().toISOString(),
      }));
  }

  private async resolveWorkspace(
    userId: string | undefined,
    workspaceHeader: string | undefined,
    role: 'viewer' | 'editor',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, role);
    return workspaceId;
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

function scenarioWithRuntimeDecision(
  scenario: JsonRecord,
  snapshot: JsonRecord | null,
  nowIso: string,
): JsonRecord {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const evaluation = evaluateScenario(scenario, snapshot, nowIso);
  const runtimeDecision = evaluateScenarioRuntimeDecision(scenario, snapshot, nowIso);
  return {
    ...scenario,
    status: evaluation.status,
    status_reason: evaluation.status_reason,
    distance_to_trigger: evaluation.distance_to_trigger,
    last_evaluated_at: evaluation.last_evaluated_at,
    trigger_spec: evaluation.trigger_spec,
    runtime_decision: runtimeDecision,
    payload: {
      ...payload,
      status: evaluation.status,
      status_reason: evaluation.status_reason,
      distance_to_trigger: evaluation.distance_to_trigger,
      last_evaluated_at: evaluation.last_evaluated_at,
      trigger_spec: evaluation.trigger_spec ?? payload.trigger_spec,
      runtime_decision: runtimeDecision,
    },
  };
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function dueAtMs(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  ScenarioMonitorItemResponse,
  ScenarioMonitorResponse,
  toAlertResponse,
  toMarketSnapshotResponse,
  toScenarioResponse,
  toThesisResponse,
  toTradePlaybookResponse,
} from '../contracts/frontend-contract';
import { optionalScenarioLifecycleRows } from '../database/optional-scenario-lifecycle';
import { evaluateTradePlaybookFreshness } from '../playbooks/playbook-freshness';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';
import { WorkspacesService, WorkspaceRole } from '../workspaces/workspaces.service';
import { ScenarioChartProjectionService } from './scenario-chart-projection.service';
import { ScenarioChartSummaryService } from './scenario-chart-summary.service';
import type {
  ScenarioChartProjectionResponse,
  ScenarioChartSummaryResponse,
  ScenarioEventResponse,
  ScenarioLiveStateResponse,
} from './scenario-chart.types';
import { evaluateScenario } from './scenario-evaluator';
import { ScenarioLiveStateService } from './scenario-live-state.service';
import { evaluateScenarioRuntimeDecision } from './scenario-runtime-evaluator';
import { ScenarioReliabilityService } from './scenario-reliability.service';
import {
  latestUsableBacktestRun,
  latestValidScenarioEvaluation,
} from './scenario-lifecycle-artifacts';

@Injectable()
export class ScenariosService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    private readonly reliability: ScenarioReliabilityService,
    private readonly liveState: ScenarioLiveStateService,
    private readonly chartProjection: ScenarioChartProjectionService,
    private readonly chartSummary: ScenarioChartSummaryService,
  ) {}

  async monitor(
    options: { symbol?: string; status?: string; limit: number },
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioMonitorResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const symbol = normalize(options.symbol);
    const statusFilter = normalize(options.status);
    const theses = (await this.journal.listTheses(options.limit, workspaceId))
      .filter((thesis) => !symbol || stringValue(thesis.symbol) === symbol);
    const items: ScenarioMonitorItemResponse[] = [];

    for (const thesis of theses) {
      const thesisId = nullableString(thesis.id);
      if (!thesisId) {
        continue;
      }
      const scenarios = await this.journal.listScenarios(thesisId, workspaceId);
      const [snapshot, alerts] = await Promise.all([
        this.journal.getLatestMarketSnapshot(stringValue(thesis.symbol), workspaceId),
        this.journal.listAlerts(
          stringValue(thesis.symbol),
          thesisId,
          false,
          10,
          workspaceId,
        ),
      ]);
      for (const scenario of scenarios) {
        const enrichedScenario = await this.enrichScenarioLifecycle(
          scenario,
          thesis,
          workspaceId,
        );
        const item = buildScenarioMonitorItem(
          thesis,
          enrichedScenario,
          snapshot,
          alerts[0] ?? null,
        );
        if (!statusFilter || item.status === statusFilter) {
          items.push(item);
        }
      }
    }

    const limited = items.sort(compareScenarioUrgency).slice(0, options.limit);
    return {
      workspace_id: workspaceId,
      generated_at: new Date().toISOString(),
      total_scenarios: limited.length,
      status_counts: countBy(limited, (item) => item.status),
      items: limited,
    };
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
    role: WorkspaceRole = 'viewer',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, role);
    return workspaceId;
  }

  async getLiveState(
    scenarioId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioLiveStateResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    return this.liveState.getLiveState(scenarioId, workspaceId);
  }

  async refreshLiveState(
    scenarioId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioLiveStateResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    return this.liveState.refreshLiveState(scenarioId, workspaceId);
  }

  async listScenarioEvents(
    scenarioId: string,
    limit: number,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioEventResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const events = await this.journal.listScenarioEvents(
      scenarioId,
      workspaceId,
      limit,
    );
    return events.map(toScenarioEventResponse);
  }

  async getChartProjection(
    input: { scenarioId: string; interval?: string; limit?: string },
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioChartProjectionResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    return this.chartProjection.getProjection({
      ...input,
      workspaceId,
    });
  }

  async getChartSummary(
    scenarioId: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioChartSummaryResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    return this.chartSummary.getSummary({ scenarioId, workspaceId });
  }

  async getChartSummaries(
    scenarioIds: string[],
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioChartSummaryResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const uniqueIds = uniqueStrings(scenarioIds).slice(0, 100);
    return Promise.all(
      uniqueIds.map((scenarioId) =>
        this.chartSummary.getSummary({ scenarioId, workspaceId }),
      ),
    );
  }

  private async enrichScenarioLifecycle(
    scenario: JsonRecord,
    thesis: JsonRecord,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const scenarioId = nullableString(scenario.id);
    if (!scenarioId) {
      return scenario;
    }
    const baseResponse = toScenarioResponse(scenario, thesis);
    const [evaluations, playbooks, reliabilityProfile] = await Promise.all([
      optionalScenarioLifecycleRows(() =>
        this.journal.listScenarioEvaluations(scenarioId, workspaceId),
      ),
      optionalScenarioLifecycleRows(() =>
        this.journal.listTradePlaybooksForScenario(scenarioId, workspaceId),
      ),
      this.reliability.profileForScenario(baseResponse, thesis, workspaceId),
    ]);
    const latestPlaybook = playbookWithStaleness(playbooks[0] ?? null, baseResponse);
    const backtests = latestPlaybook
      ? await optionalScenarioLifecycleRows(() =>
          this.journal.listBacktestRunsForPlaybook(
            String(latestPlaybook.id ?? ''),
            workspaceId,
          ),
        )
      : [];
    const latestBacktest = latestUsableBacktestRun(backtests);
    const tradeEvents = latestBacktest
      ? await optionalScenarioLifecycleRows(() =>
          this.journal.listBacktestTradeEvents(
            String(latestBacktest.id ?? ''),
            workspaceId,
          ),
        )
      : [];
    return {
      ...scenario,
      latest_evaluation: latestValidScenarioEvaluation(evaluations),
      latest_playbook: latestPlaybook,
      latest_backtest: latestBacktest
        ? { ...latestBacktest, trade_events: tradeEvents }
        : null,
      reliability_profile: reliabilityProfile,
    };
  }
}

function buildScenarioMonitorItem(
  thesis: JsonRecord,
  scenario: JsonRecord,
  snapshot: JsonRecord | null,
  latestAlert: JsonRecord | null,
): ScenarioMonitorItemResponse {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const nowIso = new Date().toISOString();
  const evaluation = evaluateScenario(scenario, snapshot, nowIso);
  const runtimeDecision = evaluateScenarioRuntimeDecision(
    scenario,
    snapshot,
    nowIso,
  );
  const evaluatedScenario = {
    ...scenario,
    status: evaluation.status,
    status_reason: evaluation.status_reason,
    distance_to_trigger: evaluation.distance_to_trigger,
    last_evaluated_at: evaluation.last_evaluated_at,
    trigger_spec: evaluation.trigger_spec,
    decision_playbook: recordValue(payload.decision_playbook),
    runtime_decision: runtimeDecision,
    payload: {
      ...payload,
      status: evaluation.status,
      status_reason: evaluation.status_reason,
      distance_to_trigger: evaluation.distance_to_trigger,
      last_evaluated_at: evaluation.last_evaluated_at,
      trigger_spec: evaluation.trigger_spec,
      runtime_decision: runtimeDecision,
    },
  };
  const status = latestAlert && !latestAlert.read_at
    ? 'alerting'
    : runtimeDecision.trigger_status;
  const currentPrice = snapshot ? numberValue(snapshot.current_price) : null;
  const condition = stringValue(scenario.condition ?? payload.condition);
  return {
    status,
    status_reason: status === 'alerting'
      ? statusReason(status, latestAlert, snapshot)
      : runtimeDecision.status_reason,
    trigger_summary: currentPrice === null
      ? condition
      : `${condition}${condition ? ' | ' : ''}latest price ${formatNumber(currentPrice)}`,
    risk_count: stringList(scenario.risk_map ?? payload.risk_map ?? payload.risk_factors).length,
    scenario: toScenarioResponse(evaluatedScenario, thesis),
    thesis: toThesisResponse(thesis),
    latest_market_snapshot: snapshot ? toMarketSnapshotResponse(snapshot) : null,
    latest_alert: latestAlert ? toAlertResponse(latestAlert) : null,
  };
}

function compareScenarioUrgency(
  left: ScenarioMonitorItemResponse,
  right: ScenarioMonitorItemResponse,
): number {
  return scenarioUrgency(right) - scenarioUrgency(left);
}

function scenarioUrgency(item: ScenarioMonitorItemResponse): number {
  const status = item.status;
  if (status === 'alerting') return 100;
  const action = item.scenario.runtime_decision.recommended_action;
  if (action === 'entry_long_now' || action === 'entry_short_now') return 95;
  if (action === 'consider_long' || action === 'consider_short') return 85;
  if (status === 'triggered') return 90;
  if (status === 'near_trigger') return 80;
  if (status === 'needs_review') return 60;
  if (status === 'stale') return 50;
  return 10;
}

function statusReason(
  status: string,
  latestAlert: JsonRecord | null,
  snapshot: JsonRecord | null,
): string {
  if (status === 'alerting') {
    return stringValue(latestAlert?.message, 'Unread alert is attached to this thesis.');
  }
  if (status === 'missing_price') {
    return 'No fresh market snapshot is available for this thesis symbol.';
  }
  if (status === 'action_required') {
    return 'Suggested action asks the user to reduce, exit, or otherwise intervene.';
  }
  if (status === 'high_attention') {
    return 'High-probability scenario with current price context available.';
  }
  return snapshot ? 'Scenario is monitored with latest persisted market context.' : 'Scenario is recorded.';
}

function countBy<T>(values: T[], keyFn: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function recordValue(value: unknown): JsonRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => nullableString(item))
      .filter((item): item is string => item !== null);
  }
  const text = nullableString(value);
  return text ? [text] : [];
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(4);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function playbookWithStaleness(
  playbook: JsonRecord | null,
  response: ReturnType<typeof toScenarioResponse>,
): TradePlaybookResponse | null {
  if (!playbook) {
    return null;
  }
  return evaluateTradePlaybookFreshness(toTradePlaybookResponse(playbook), {
    scenario: response.payload,
    decisionPlaybook: response.decision_playbook,
    recommendation: response.scenario_recommendation,
    runtimeDecision: response.runtime_decision,
  });
}

function toScenarioEventResponse(value: JsonRecord): ScenarioEventResponse {
  return {
    version: 'scenario_event.v1',
    id: stringValue(value.id),
    workspace_id: stringValue(value.workspace_id, 'local'),
    scenario_id: stringValue(value.scenario_id),
    thesis_id: nullableString(value.thesis_id),
    event_type: scenarioEventType(value.event_type),
    event_time: stringValue(value.event_time),
    summary: stringValue(value.summary),
    payload: recordValue(value.payload),
    created_at: stringValue(value.created_at),
  };
}

function scenarioEventType(value: unknown): ScenarioEventResponse['event_type'] {
  const eventType = stringValue(value);
  if (
    eventType === 'scenario.generated' ||
    eventType === 'scenario.near_trigger' ||
    eventType === 'scenario.triggered' ||
    eventType === 'scenario.condition_passed' ||
    eventType === 'scenario.condition_failed' ||
    eventType === 'scenario.target_hit' ||
    eventType === 'scenario.weakened' ||
    eventType === 'scenario.invalidated' ||
    eventType === 'scenario.expired' ||
    eventType === 'scenario.overextended'
  ) {
    return eventType;
  }
  return 'scenario.generated';
}

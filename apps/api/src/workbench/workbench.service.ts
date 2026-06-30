import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  AttentionActionResponse,
  AttentionBadgeResponse,
  AttentionItemResponse,
  AttentionPriority,
  AttentionSeverity,
  AttentionSourceType,
  BriefResponse,
  NotificationResponse,
  ScenarioResponse,
  toBriefResponse,
  toScenarioResponse,
  WorkbenchAttentionResponse,
} from '../contracts/frontend-contract';
import { evaluateScenario } from '../scenarios/scenario-evaluator';
import { evaluateScenarioRuntimeDecision } from '../scenarios/scenario-runtime-evaluator';
import { WorkspacesService } from '../workspaces/workspaces.service';

const CANDIDATE_LIMIT = 50;
const NOTIFICATION_LIMIT = 12;
const MATURE_THESIS_HOURS = 48;
const SCENARIO_THESIS_LIMIT = 25;

type AttentionDraft = {
  sourceType: AttentionSourceType;
  source: string;
  sourceId: string | null;
  symbol: string | null;
  title: string;
  summary: string;
  status: string;
  severity: AttentionSeverity;
  createdAt: string | null;
  confidence: number | null;
  hasInvalidation: boolean;
  action: AttentionActionResponse;
  payload: JsonRecord;
};

@Injectable()
export class WorkbenchService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async attention(
    limit = 10,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<WorkbenchAttentionResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const now = new Date();
    const today = localDateString(now);
    const normalizedLimit = normalizeLimit(limit);
    const [
      alerts,
      theses,
      runs,
      providerHealth,
      freshnessChecks,
      briefs,
      outcomeReviews,
      watchlists,
    ] = await Promise.all([
      this.journal.listAlerts(
        undefined,
        undefined,
        true,
        CANDIDATE_LIMIT,
        workspaceId,
      ),
      this.journal.listTheses(CANDIDATE_LIMIT, workspaceId),
      this.journal.listResearchRuns({ limit: CANDIDATE_LIMIT }, workspaceId),
      this.journal.listProviderHealth(CANDIDATE_LIMIT),
      this.journal.listDataFreshnessChecks(CANDIDATE_LIMIT, workspaceId),
      this.journal.listDailyBriefs(
        undefined,
        1,
        workspaceId,
        undefined,
        today,
      ),
      this.journal.listOutcomeReviews(undefined, 200, workspaceId),
      this.journal.listWatchlists(CANDIDATE_LIMIT, workspaceId),
    ]);

    const thesisMap = new Map(
      theses
        .map((thesis) => [nullableString(thesis.id), thesis] as const)
        .filter((entry): entry is readonly [string, JsonRecord] => entry[0] !== null),
    );
    const reviewedThesisIds = new Set(
      outcomeReviews
        .map((review) => nullableString(review.thesis_id))
        .filter((id): id is string => id !== null),
    );
    const scenariosByThesis = await this.scenariosForTheses(
      theses.slice(0, SCENARIO_THESIS_LIMIT),
      workspaceId,
    );
    const activeScenarios = await this.activeScenariosForTheses(
      theses.slice(0, SCENARIO_THESIS_LIMIT),
      scenariosByThesis,
      workspaceId,
      now.toISOString(),
    );
    const latestBrief = briefs[0] ? toBriefResponse(briefs[0]) : null;
    const briefActionDrafts = latestBrief
      ? buildBriefActionDrafts(latestBrief)
      : [];

    const drafts = [
      ...alerts.map((alert) => buildAlertDraft(alert, thesisMap)),
      ...buildThesisDrafts(theses, reviewedThesisIds, now),
      ...buildScenarioDrafts(theses, scenariosByThesis),
      ...runs.flatMap((run) => buildRunDraft(run)),
      ...providerHealth.flatMap((row) => buildProviderDraft(row)),
      ...freshnessChecks.flatMap((row) => buildFreshnessDraft(row)),
      ...buildBriefDrafts(latestBrief, now),
      ...briefActionDrafts,
      ...buildWatchlistDrafts(watchlists, now),
    ];

    const items = dedupeDrafts(drafts)
      .map((draft) => finalizeItem(draft, workspaceId, now))
      .sort(compareAttentionItems)
      .slice(0, normalizedLimit);
    const briefActions = dedupeDrafts(briefActionDrafts)
      .map((draft) => finalizeItem(draft, workspaceId, now))
      .sort(compareAttentionItems)
      .slice(0, 5);

    return {
      workspace_id: workspaceId,
      generated_at: now.toISOString(),
      item_count: items.length,
      unresolved_count: items.filter((item) => item.status !== 'read').length,
      latest_brief: latestBrief,
      active_scenarios: activeScenarios,
      brief_actions: briefActions,
      queues: queueItems(items),
      items,
      notifications: buildNotifications(
        items,
        alerts,
        latestBrief,
        watchlists,
        runs,
      ),
    };
  }

  private async scenariosForTheses(
    theses: JsonRecord[],
    workspaceId: string,
  ): Promise<Map<string, JsonRecord[]>> {
    const rows = await Promise.all(
      theses.map(async (thesis) => {
        const thesisId = nullableString(thesis.id);
        if (!thesisId) {
          return null;
        }
        const scenarios = await this.journal.listScenarios(thesisId, workspaceId);
        return [thesisId, scenarios] as const;
      }),
    );
    return new Map(
      rows.filter(
        (row): row is readonly [string, JsonRecord[]] => row !== null,
      ),
    );
  }

  private async activeScenariosForTheses(
    theses: JsonRecord[],
    scenariosByThesis: Map<string, JsonRecord[]>,
    workspaceId: string,
    nowIso: string,
  ): Promise<ScenarioResponse[]> {
    const snapshots = new Map<string, JsonRecord | null>();
    const evaluated: ScenarioResponse[] = [];
    for (const thesis of theses) {
      const thesisId = nullableString(thesis.id);
      const symbol = stringValue(thesis.symbol);
      if (!thesisId || !symbol) {
        continue;
      }
      if (!snapshots.has(symbol)) {
        snapshots.set(symbol, await this.journal.getLatestMarketSnapshot(symbol, workspaceId));
      }
      const snapshot = snapshots.get(symbol) ?? null;
      for (const scenario of scenariosByThesis.get(thesisId) ?? []) {
        const payload = recordValue(scenario.payload ?? scenario.payload_json);
        const evaluation = evaluateScenario(scenario, snapshot, nowIso);
        const runtimeDecision = evaluateScenarioRuntimeDecision(
          scenario,
          snapshot,
          nowIso,
        );
        evaluated.push(toScenarioResponse(
          {
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
          },
          thesis,
        ));
      }
    }
    return evaluated
      .sort((left, right) => activeScenarioUrgency(right) - activeScenarioUrgency(left))
      .slice(0, 5);
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    return workspaceId;
  }
}

function buildAlertDraft(
  alert: JsonRecord,
  thesisMap: Map<string, JsonRecord>,
): AttentionDraft {
  const thesisId = nullableString(alert.thesis_id);
  const watchlistItemId = nullableString(alert.watchlist_item_id);
  const thesis = thesisId ? thesisMap.get(thesisId) : undefined;
  const alertType = stringValue(alert.alert_type, 'alert');
  const symbol = nullableString(alert.symbol ?? thesis?.symbol);
  return {
    sourceType: 'alert',
    source: 'Alert',
    sourceId: nullableString(alert.id),
    symbol,
    title: `${symbol ?? 'Watchlist'} ${humanize(alertType)}`,
    summary: stringValue(alert.message, 'Unread alert needs review.'),
    status: nullableString(alert.read_at) ? 'read' : 'unread',
    severity: alertSeverity(alert),
    createdAt: nullableString(alert.created_at),
    confidence: numberValue(thesis?.confidence),
    hasInvalidation: alertType.includes('invalidat') || hasInvalidation(thesis),
    action: thesisId
      ? action('Review thesis', `/theses/${encodeURIComponent(thesisId)}`, 'thesis', thesisId)
      : watchlistItemId
        ? action('Open watchlists', '/watchlists', 'watchlist_item', watchlistItemId)
        : action('Open alerts', '/alerts', 'alert', nullableString(alert.id)),
    payload: {
      alert_type: alertType,
      trigger_key: nullableString(alert.trigger_key),
    },
  };
}

function buildThesisDrafts(
  theses: JsonRecord[],
  reviewedThesisIds: Set<string>,
  now: Date,
): AttentionDraft[] {
  const drafts: AttentionDraft[] = [];
  for (const thesis of theses) {
    const thesisId = nullableString(thesis.id);
    if (!thesisId || reviewedThesisIds.has(thesisId)) {
      continue;
    }
    const ageHours = hoursSince(nullableString(thesis.created_at), now);
    const staleData = firstStringList(
      thesis.stale_or_missing_data,
      recordValue(thesis.structured_summary).missing_data,
    );
    if (
      (ageHours === null || ageHours < MATURE_THESIS_HOURS) &&
      staleData.length === 0
    ) {
      continue;
    }
    const symbol = nullableString(thesis.symbol);
    const confidence = numberValue(thesis.confidence);
    const confidenceText =
      confidence === null ? 'unknown confidence' : `${Math.round(confidence * 100)}% confidence`;
    drafts.push({
      sourceType: 'thesis',
      source: 'Thesis',
      sourceId: thesisId,
      symbol,
      title: `${symbol ?? 'Thesis'} needs outcome review`,
      summary:
        staleData.length > 0
          ? `Review stale or missing data before relying on this thesis: ${staleData.slice(0, 3).join(', ')}.`
          : `Mature ${stringValue(thesis.direction, 'watch')} ${stringValue(thesis.setup_type, 'setup')} thesis is ${confidenceText}.`,
      status: staleData.length > 0 ? 'stale_data_review' : 'mature_review',
      severity:
        confidence !== null && confidence >= 0.72
          ? 'high'
          : staleData.length > 0
            ? 'medium'
            : 'low',
      createdAt: nullableString(thesis.created_at),
      confidence,
      hasInvalidation: hasInvalidation(thesis),
      action: action('Record review', `/theses/${encodeURIComponent(thesisId)}`, 'thesis', thesisId),
      payload: {
        direction: nullableString(thesis.direction),
        setup_type: nullableString(thesis.setup_type),
        stale_or_missing_data: staleData,
      },
    });
  }
  return drafts;
}

function buildScenarioDrafts(
  theses: JsonRecord[],
  scenariosByThesis: Map<string, JsonRecord[]>,
): AttentionDraft[] {
  const drafts: AttentionDraft[] = [];
  for (const thesis of theses) {
    const thesisId = nullableString(thesis.id);
    if (!thesisId) {
      continue;
    }
    const scenario = [...(scenariosByThesis.get(thesisId) ?? [])]
      .filter(isActionableScenario)
      .sort(compareScenarioUrgency)[0];
    if (!scenario) {
      continue;
    }
    const payload = recordValue(scenario.payload ?? scenario.payload_json);
    const scenarioId = nullableString(scenario.id);
    const probability = stringValue(scenario.probability_band, 'watch');
    const riskCount = firstStringList(payload.risk_map, payload.risks).length;
    drafts.push({
      sourceType: 'scenario',
      source: 'Scenario',
      sourceId: scenarioId,
      symbol: nullableString(thesis.symbol),
      title: `${stringValue(thesis.symbol, 'Scenario')} ${probability} scenario is active to review`,
      summary: firstString(
        payload.condition,
        payload.expected_behavior,
        scenario.suggested_user_action,
        'Scenario planner produced a watch condition that needs review.',
      ),
      status: 'scenario_review',
      severity:
        probability.toLowerCase().includes('high') || riskCount > 0
          ? 'medium'
          : 'low',
      createdAt: nullableString(thesis.created_at),
      confidence: numberValue(thesis.confidence),
      hasInvalidation: hasInvalidation(thesis),
      action: action('Open scenario', `/theses/${encodeURIComponent(thesisId)}`, 'scenario', scenarioId),
      payload: {
        thesis_id: thesisId,
        probability_band: probability,
        suggested_user_action: nullableString(scenario.suggested_user_action),
        risk_count: riskCount,
      },
    });
  }
  return drafts;
}

function buildRunDraft(run: JsonRecord): AttentionDraft[] {
  const status = stringValue(run.status, '').toLowerCase();
  if (!['failed', 'cancelled', 'timed_out'].includes(status)) {
    return [];
  }
  const runId = nullableString(run.id ?? run.run_id);
  const symbol = nullableString(run.symbol);
  return [
    {
      sourceType: 'run',
      source: 'Run',
      sourceId: runId,
      symbol,
      title: `${symbol ?? 'Research'} run ${status.replaceAll('_', ' ')}`,
      summary: firstString(
        firstStringList(run.degradation_reasons, run.missing_core_data).join(', '),
        'Research run did not complete cleanly. Inspect the run workspace.',
      ),
      status,
      severity: status === 'cancelled' ? 'high' : 'critical',
      createdAt: nullableString(run.completed_at ?? run.started_at),
      confidence: null,
      hasInvalidation: false,
      action: runId
        ? action('Open run', `/research/runs/${encodeURIComponent(runId)}`, 'run', runId)
        : action('Open history', '/research/history', 'run', null),
      payload: {
        run_id: runId,
        degradation_reasons: firstStringList(run.degradation_reasons),
      },
    },
  ];
}

function buildProviderDraft(
  row: JsonRecord,
): AttentionDraft[] {
  const status = stringValue(row.status, 'unknown').toLowerCase();
  if (healthyStatus(status)) {
    return [];
  }
  const provider = stringValue(row.provider, 'provider');
  const component = nullableString(row.component);
  return [
    {
      sourceType: 'provider',
      source: 'Provider',
      sourceId: nullableString(row.id),
      symbol: null,
      title: `${provider}${component ? ` ${component}` : ''} is ${status.replaceAll('_', ' ')}`,
      summary: firstString(
        row.error_message,
        recordValue(row.payload ?? row.payload_json).message,
        'Provider health is not green. Review operations telemetry.',
      ),
      status,
      severity: providerSeverity(status),
      createdAt: nullableString(row.checked_at),
      confidence: null,
      hasInvalidation: false,
      action: action('Open operations', '/operations', 'provider', nullableString(row.id)),
      payload: {
        provider,
        component,
        error_type: nullableString(row.error_type),
      },
    },
  ];
}

function buildFreshnessDraft(
  row: JsonRecord,
): AttentionDraft[] {
  const status = stringValue(row.status, 'unknown').toLowerCase();
  if (!staleStatus(status)) {
    return [];
  }
  const source = stringValue(row.source, 'data');
  const ageSeconds = numberValue(row.age_seconds);
  const thresholdSeconds = numberValue(row.threshold_seconds);
  const symbol = nullableString(row.symbol);
  return [
    {
      sourceType: 'provider',
      source: 'Freshness',
      sourceId: nullableString(row.id),
      symbol,
      title: `${source} data is ${status}${symbol ? ` for ${symbol}` : ''}`,
      summary:
        ageSeconds !== null && thresholdSeconds !== null
          ? `Source age is ${ageSeconds}s against a ${thresholdSeconds}s threshold.`
          : 'Freshness telemetry is stale or failed.',
      status,
      severity: status.includes('failed') ? 'critical' : 'high',
      createdAt: nullableString(row.observed_timestamp),
      confidence: null,
      hasInvalidation: false,
      action: action('Open operations', '/operations', 'freshness', nullableString(row.id)),
      payload: {
        source,
        age_seconds: ageSeconds,
        threshold_seconds: thresholdSeconds,
      },
    },
  ];
}

function buildBriefDrafts(
  latestBrief: BriefResponse | null,
  now: Date,
): AttentionDraft[] {
  const today = localDateString(now);
  if (!latestBrief) {
    return [
      {
        sourceType: 'brief',
        source: 'Brief',
        sourceId: null,
        symbol: null,
        title: 'Create today brief',
        summary: 'No daily brief exists for this workspace yet. Generate one from the active watchlist.',
        status: 'missing_brief',
        severity: 'medium',
        createdAt: now.toISOString(),
        confidence: null,
        hasInvalidation: false,
        action: action('Create brief', '/watchlists', 'brief', null),
        payload: { brief_date: null },
      },
    ];
  }
  if ((latestBrief.brief_date ?? '') < today) {
    return [
      {
        sourceType: 'brief',
        source: 'Brief',
        sourceId: latestBrief.id,
        symbol: null,
        title: 'Daily brief is stale',
        summary: `Latest brief is ${latestBrief.brief_date ?? 'undated'}; generate ${today} before using the workbench.`,
        status: 'stale_brief',
        severity: 'medium',
        createdAt: latestBrief.created_at,
        confidence: null,
        hasInvalidation: false,
        action: action('Create brief', '/watchlists', 'brief', latestBrief.id),
        payload: { brief_date: latestBrief.brief_date },
      },
    ];
  }
  if (latestBrief.top_risks.length === 0 && latestBrief.thesis_updates.length === 0) {
    return [];
  }
  return [
    {
      sourceType: 'brief',
      source: 'Brief',
      sourceId: latestBrief.id,
      symbol: null,
      title: 'Review today brief action list',
      summary: latestBrief.summary || 'Daily brief is ready for review.',
      status: 'brief_ready',
      severity: 'info',
      createdAt: latestBrief.created_at,
      confidence: null,
      hasInvalidation: latestBrief.top_risks.some((risk) =>
        risk.toLowerCase().includes('invalidation'),
      ),
      action: action('Open brief', '/briefs/daily', 'brief', latestBrief.id),
      payload: {
        brief_date: latestBrief.brief_date,
        action_count: latestBrief.top_risks.length + latestBrief.thesis_updates.length,
      },
    },
  ];
}

function buildBriefActionDrafts(
  latestBrief: BriefResponse,
): AttentionDraft[] {
  const thesisActions = latestBrief.thesis_updates.slice(0, 4).map((update) => ({
    sourceType: 'brief' as const,
    source: 'Brief',
    sourceId: latestBrief.id,
    symbol: update.symbol || null,
    title: `${update.symbol} brief action`,
    summary:
      update.recent_alerts[0] ??
      update.update ??
      'Review the thesis update from today brief.',
    status: update.status || 'brief_action',
    severity: update.recent_alerts.length > 0 ? ('medium' as const) : ('low' as const),
    createdAt: latestBrief.created_at,
    confidence: update.confidence,
    hasInvalidation: Boolean(update.invalidation_level),
    action: action(
      'Review thesis',
      `/theses/${encodeURIComponent(update.thesis_id)}`,
      'thesis',
      update.thesis_id,
    ),
    payload: {
      brief_id: latestBrief.id,
      brief_date: latestBrief.brief_date,
      invalidation_level: update.invalidation_level,
    },
  }));
  const riskActions = latestBrief.top_risks.slice(0, 3).map((risk, index) => ({
    sourceType: 'brief' as const,
    source: 'Brief',
    sourceId: latestBrief.id,
    symbol: null,
    title: `Brief risk ${index + 1}`,
    summary: risk,
    status: 'brief_risk',
    severity: risk.toLowerCase().includes('alert')
      ? ('medium' as const)
      : ('low' as const),
    createdAt: latestBrief.created_at,
    confidence: null,
    hasInvalidation: risk.toLowerCase().includes('invalidation'),
    action: action('Open brief', '/briefs/daily', 'brief', latestBrief.id),
    payload: {
      brief_id: latestBrief.id,
      brief_date: latestBrief.brief_date,
      risk,
    },
  }));
  return [...thesisActions, ...riskActions];
}

function buildWatchlistDrafts(
  watchlists: JsonRecord[],
  now: Date,
): AttentionDraft[] {
  if (watchlists.some((watchlist) => booleanValue(watchlist.enabled, true))) {
    return [];
  }
  return [
    {
      sourceType: 'watchlist',
      source: 'Watchlist',
      sourceId: null,
      symbol: null,
      title: 'No enabled watchlist',
      summary: 'Enable or create a watchlist so alerts and daily briefs have a monitoring scope.',
      status: 'watchlist_disabled',
      severity: 'medium',
      createdAt: now.toISOString(),
      confidence: null,
      hasInvalidation: false,
      action: action('Open watchlists', '/watchlists', 'watchlist', null),
      payload: { watchlist_count: watchlists.length },
    },
  ];
}

function finalizeItem(
  draft: AttentionDraft,
  workspaceId: string,
  now: Date,
): AttentionItemResponse {
  const ageMinutes = minutesSince(draft.createdAt, now);
  const score = scoreAttention(draft, ageMinutes);
  const priority = priorityFromScore(score, draft.severity);
  return {
    id: attentionId(draft),
    workspace_id: workspaceId,
    priority,
    severity: draft.severity,
    score,
    source_type: draft.sourceType,
    source: draft.source,
    source_id: draft.sourceId,
    symbol: draft.symbol,
    title: draft.title,
    summary: draft.summary,
    status: draft.status,
    created_at: draft.createdAt,
    age_minutes: ageMinutes,
    badges: badgesForDraft(draft, ageMinutes),
    action: draft.action,
    payload: draft.payload,
  };
}

function scoreAttention(
  draft: AttentionDraft,
  ageMinutes: number | null,
): number {
  return Math.round(
    severityBase(draft.severity) +
      freshnessScore(ageMinutes, draft.sourceType, draft.status) +
      symbolImportance(draft.symbol) +
      confidenceScore(draft.confidence) +
      (draft.hasInvalidation ? 8 : 0) +
      sourceWeight(draft.sourceType),
  );
}

function severityBase(severity: AttentionSeverity): number {
  switch (severity) {
    case 'critical':
      return 88;
    case 'high':
      return 68;
    case 'medium':
      return 48;
    case 'low':
      return 28;
    case 'info':
      return 16;
  }
}

function freshnessScore(
  ageMinutes: number | null,
  sourceType: AttentionSourceType,
  status: string,
): number {
  if (ageMinutes === null) {
    return 4;
  }
  if (sourceType === 'thesis' && status.includes('mature')) {
    if (ageMinutes >= 7 * 24 * 60) {
      return 12;
    }
    if (ageMinutes >= MATURE_THESIS_HOURS * 60) {
      return 18;
    }
  }
  if (ageMinutes <= 60) {
    return 22;
  }
  if (ageMinutes <= 6 * 60) {
    return 17;
  }
  if (ageMinutes <= 24 * 60) {
    return 11;
  }
  if (ageMinutes <= 72 * 60) {
    return 6;
  }
  return 2;
}

function symbolImportance(symbol: string | null): number {
  const normalized = symbol?.toUpperCase().replace(/[-_]/g, '/') ?? '';
  if (normalized.startsWith('BTC')) {
    return 12;
  }
  if (normalized.startsWith('ETH')) {
    return 10;
  }
  if (/^(SOL|BNB|XRP|ADA|DOGE)\b/.test(normalized)) {
    return 6;
  }
  return symbol ? 3 : 0;
}

function confidenceScore(confidence: number | null): number {
  if (confidence === null) {
    return 0;
  }
  if (confidence >= 0.78) {
    return 10;
  }
  if (confidence >= 0.68) {
    return 7;
  }
  if (confidence <= 0.35) {
    return 6;
  }
  return 3;
}

function sourceWeight(sourceType: AttentionSourceType): number {
  switch (sourceType) {
    case 'alert':
      return 8;
    case 'run':
      return 7;
    case 'provider':
      return 5;
    case 'thesis':
    case 'scenario':
      return 4;
    case 'brief':
      return 2;
    case 'watchlist':
      return 1;
  }
}

function priorityFromScore(
  score: number,
  severity: AttentionSeverity,
): AttentionPriority {
  if (severity === 'critical' || score >= 90) {
    return 'critical';
  }
  if (score >= 55) {
    return 'review';
  }
  return 'info';
}

function badgesForDraft(
  draft: AttentionDraft,
  ageMinutes: number | null,
): AttentionBadgeResponse[] {
  return [
    {
      label: 'Severity',
      value: humanize(draft.severity),
      tone: severityTone(draft.severity),
    },
    {
      label: 'Age',
      value: formatAge(ageMinutes),
      tone: ageTone(ageMinutes),
    },
    {
      label: 'Source',
      value: draft.source,
      tone: 'primary',
    },
  ];
}

function queueItems(items: AttentionItemResponse[]) {
  return [
    {
      priority: 'critical' as const,
      label: 'Critical',
      items: items.filter((item) => item.priority === 'critical'),
    },
    {
      priority: 'review' as const,
      label: 'Review',
      items: items.filter((item) => item.priority === 'review'),
    },
    {
      priority: 'info' as const,
      label: 'Info',
      items: items.filter((item) => item.priority === 'info'),
    },
  ];
}

function buildNotifications(
  items: AttentionItemResponse[],
  alerts: JsonRecord[],
  latestBrief: BriefResponse | null,
  watchlists: JsonRecord[],
  runs: JsonRecord[],
): NotificationResponse[] {
  const notifications: NotificationResponse[] = items.map((item) => ({
    id: `notification_${item.id}`,
    type: item.source_type,
    status: item.source_type === 'alert' ? 'unread' : item.status,
    priority: item.priority,
    source: item.source,
    source_id: item.source_id,
    symbol: item.symbol,
    title: item.title,
    message: item.summary,
    created_at: item.created_at,
    read_at: item.source_type === 'alert' ? null : item.created_at,
    action: item.action,
    badges: item.badges,
  }));

  if (latestBrief) {
    notifications.push({
      id: `notification_brief_${latestBrief.id ?? latestBrief.brief_date ?? 'latest'}`,
      type: 'brief',
      status: 'brief_ready',
      priority: 'info',
      source: 'Brief',
      source_id: latestBrief.id,
      symbol: null,
      title: latestBrief.title || 'Daily brief ready',
      message: latestBrief.summary || 'Latest daily brief is available.',
      created_at: latestBrief.created_at,
      read_at: latestBrief.created_at,
      action: action('Open brief', '/briefs/daily', 'brief', latestBrief.id),
      badges: [
        { label: 'Severity', value: 'Info', tone: 'primary' },
        { label: 'Age', value: formatAge(minutesSince(latestBrief.created_at, new Date())), tone: 'neutral' },
        { label: 'Source', value: 'Brief', tone: 'primary' },
      ],
    });
  }

  for (const watchlist of watchlists.slice(0, 2)) {
    const id = nullableString(watchlist.id);
    notifications.push({
      id: `notification_watchlist_${id ?? stringValue(watchlist.name, 'watchlist')}`,
      type: 'watchlist',
      status: booleanValue(watchlist.enabled, true) ? 'enabled' : 'disabled',
      priority: booleanValue(watchlist.enabled, true) ? 'info' : 'review',
      source: 'Watchlist',
      source_id: id,
      symbol: null,
      title: `${stringValue(watchlist.name, 'Watchlist')} watchlist`,
      message: booleanValue(watchlist.enabled, true)
        ? 'Watchlist is available for alert checks and daily briefs.'
        : 'Watchlist is disabled and will not produce alert checks.',
      created_at: nullableString(watchlist.created_at),
      read_at: nullableString(watchlist.created_at),
      action: action('Open watchlists', '/watchlists', 'watchlist', id),
      badges: [
        {
          label: 'Severity',
          value: booleanValue(watchlist.enabled, true) ? 'Info' : 'Medium',
          tone: booleanValue(watchlist.enabled, true) ? 'primary' : 'warning',
        },
        {
          label: 'Age',
          value: formatAge(minutesSince(nullableString(watchlist.created_at), new Date())),
          tone: 'neutral',
        },
        { label: 'Source', value: 'Watchlist', tone: 'primary' },
      ],
    });
  }

  for (const run of runs.filter((run) => run.status === 'completed').slice(0, 2)) {
    const id = nullableString(run.id ?? run.run_id);
    notifications.push({
      id: `notification_run_${id ?? 'completed'}`,
      type: 'run',
      status: 'completed',
      priority: 'info',
      source: 'Run',
      source_id: id,
      symbol: nullableString(run.symbol),
      title: `${stringValue(run.symbol, 'Research')} run completed`,
      message: 'Research run completed and can be reviewed from the workspace.',
      created_at: nullableString(run.completed_at ?? run.started_at),
      read_at: nullableString(run.completed_at ?? run.started_at),
      action: id
        ? action('Open run', `/research/runs/${encodeURIComponent(id)}`, 'run', id)
        : action('Open history', '/research/history', 'run', null),
      badges: [
        { label: 'Severity', value: 'Info', tone: 'primary' },
        {
          label: 'Age',
          value: formatAge(minutesSince(nullableString(run.completed_at ?? run.started_at), new Date())),
          tone: 'neutral',
        },
        { label: 'Source', value: 'Run', tone: 'primary' },
      ],
    });
  }

  const alertIds = new Set(
    alerts.map((alert) => nullableString(alert.id)).filter((id): id is string => id !== null),
  );
  return dedupeNotifications(notifications)
    .sort((left, right) => notificationSortScore(right, alertIds) - notificationSortScore(left, alertIds))
    .slice(0, NOTIFICATION_LIMIT);
}

function notificationSortScore(
  notification: NotificationResponse,
  alertIds: Set<string>,
): number {
  const recency = timestampMillis(notification.created_at) / 100000000000;
  const unread = notification.source_id && alertIds.has(notification.source_id) ? 20 : 0;
  const priority =
    notification.priority === 'critical'
      ? 50
      : notification.priority === 'review'
        ? 30
        : 10;
  return priority + unread + recency;
}

function dedupeDrafts(drafts: AttentionDraft[]): AttentionDraft[] {
  const seen = new Set<string>();
  const result: AttentionDraft[] = [];
  for (const draft of drafts) {
    const key = attentionId(draft);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(draft);
  }
  return result;
}

function dedupeNotifications(
  notifications: NotificationResponse[],
): NotificationResponse[] {
  const seen = new Set<string>();
  const result: NotificationResponse[] = [];
  for (const notification of notifications) {
    const key = notification.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(notification);
  }
  return result;
}

function compareAttentionItems(
  left: AttentionItemResponse,
  right: AttentionItemResponse,
): number {
  return (
    right.score - left.score ||
    timestampMillis(right.created_at) - timestampMillis(left.created_at) ||
    left.id.localeCompare(right.id)
  );
}

function compareScenarioUrgency(left: JsonRecord, right: JsonRecord): number {
  return scenarioUrgency(right) - scenarioUrgency(left);
}

function scenarioUrgency(scenario: JsonRecord): number {
  const probability = stringValue(scenario.probability_band).toLowerCase();
  const actionText = stringValue(scenario.suggested_user_action).toLowerCase();
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const riskCount = firstStringList(payload.risk_map, payload.risks).length;
  return (
    (probability.includes('high') ? 30 : probability.includes('medium') ? 18 : 8) +
    (actionText.includes('exit') || actionText.includes('hedge') ? 20 : 0) +
    riskCount * 4
  );
}

function activeScenarioUrgency(scenario: ScenarioResponse): number {
  const action = scenario.runtime_decision.recommended_action;
  if (action === 'entry_long_now' || action === 'entry_short_now') return 100;
  if (action === 'consider_long' || action === 'consider_short') return 85;
  if (scenario.runtime_decision.trigger_status === 'triggered') return 80;
  if (scenario.runtime_decision.trigger_status === 'near_trigger') return 70;
  if (scenario.runtime_decision.validity_status === 'expired') return 50;
  const status = scenario.status;
  if (status === 'alerting') return 100;
  if (status === 'triggered') return 90;
  if (status === 'near_trigger') return 80;
  if (status === 'needs_review') return 60;
  if (status === 'stale') return 50;
  return 10;
}

function isActionableScenario(scenario: JsonRecord): boolean {
  const probability = stringValue(scenario.probability_band).toLowerCase();
  const actionText = stringValue(scenario.suggested_user_action).toLowerCase();
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  return (
    probability.includes('high') ||
    actionText.includes('review') ||
    actionText.includes('watch') ||
    actionText.includes('hedge') ||
    actionText.includes('exit') ||
    firstStringList(payload.risk_map, payload.risks).length > 0
  );
}

function alertSeverity(alert: JsonRecord): AttentionSeverity {
  const payload = recordValue(alert.payload ?? alert.payload_json);
  const explicit = nullableString(payload.severity);
  if (isSeverity(explicit)) {
    return explicit;
  }
  const alertType = stringValue(alert.alert_type).toLowerCase();
  if (alertType.includes('invalidat')) {
    return 'critical';
  }
  if (alertType.includes('target') || alertType.includes('scenario')) {
    return 'high';
  }
  return 'medium';
}

function providerSeverity(status: string): AttentionSeverity {
  if (
    status.includes('down') ||
    status.includes('failed') ||
    status.includes('error')
  ) {
    return 'critical';
  }
  if (status.includes('stale') || status.includes('degraded')) {
    return 'high';
  }
  return 'medium';
}

function healthyStatus(status: string): boolean {
  return ['ok', 'healthy', 'success', 'configured', 'available'].includes(status);
}

function staleStatus(status: string): boolean {
  return (
    status.includes('stale') ||
    status.includes('expired') ||
    status.includes('failed')
  );
}

function hasInvalidation(thesis: JsonRecord | undefined): boolean {
  if (!thesis) {
    return false;
  }
  const summary = recordValue(thesis.structured_summary);
  return Boolean(
    nullableString(thesis.invalidation_level) ??
      nullableString(thesis.invalidation) ??
      nullableString(summary.invalidation),
  );
}

function attentionId(draft: AttentionDraft): string {
  const sourceId =
    draft.sourceId ??
    `${draft.symbol ?? 'global'}:${draft.title}:${draft.status}`;
  return `${draft.sourceType}:${sourceId}`.replace(/[^A-Za-z0-9:_-]/g, '_');
}

function action(
  label: string,
  href: string,
  entityType: string,
  entityId: string | null,
): AttentionActionResponse {
  return {
    label,
    href,
    entity_type: entityType,
    entity_id: entityId,
  };
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 10;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), 10);
}

function timestampMillis(value: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function minutesSince(value: string | null, now: Date): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.max(0, Math.round((now.getTime() - timestamp) / 60000));
}

function hoursSince(value: string | null, now: Date): number | null {
  const minutes = minutesSince(value, now);
  return minutes === null ? null : minutes / 60;
}

function formatAge(ageMinutes: number | null): string {
  if (ageMinutes === null) {
    return 'unknown';
  }
  if (ageMinutes < 60) {
    return `${ageMinutes}m`;
  }
  const hours = Math.round(ageMinutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.round(hours / 24)}d`;
}

function severityTone(severity: AttentionSeverity): string {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'risk';
    case 'medium':
      return 'warning';
    case 'low':
      return 'degraded';
    case 'info':
      return 'primary';
  }
}

function ageTone(ageMinutes: number | null): string {
  if (ageMinutes === null) {
    return 'neutral';
  }
  if (ageMinutes <= 6 * 60) {
    return 'constructive';
  }
  if (ageMinutes <= 48 * 60) {
    return 'warning';
  }
  return 'degraded';
}

function isSeverity(value: string | null): value is AttentionSeverity {
  return (
    value === 'critical' ||
    value === 'high' ||
    value === 'medium' ||
    value === 'low' ||
    value === 'info'
  );
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function recordValue(value: unknown): JsonRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
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

function firstStringList(...values: unknown[]): string[] {
  for (const value of values) {
    const result = stringList(value);
    if (result.length > 0) {
      return result;
    }
  }
  return [];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = nullableString(value);
    if (text) {
      return text;
    }
  }
  return '';
}

function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

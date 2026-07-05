import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Download,
  GitBranch,
  ListChecks,
  Play,
  RefreshCw,
  Square,
  Target,
  XCircle,
} from 'lucide-react';
import { ScenarioChart } from '@/components/scenarios/ScenarioChart';
import { getResearchRunEvidenceBundle } from '@/services/research-runs';
import {
  getScenarioChartProjection,
  refreshScenarioLiveState,
} from '@/services/scenario-chart';
import {
  activeForwardRun,
  latestCompletedForwardRun,
  latestReplayRun,
  replayHistoryRuns,
} from '@/components/scenarios/paper-simulation-read-model';
import {
  compileScenarioDecisionPlaybook,
  createScenarioDecisionBacktest,
  evaluateScenarioDecisionItem,
} from '@/services/scenario-decision';
import {
  cancelSimulation,
  closeSimulation,
  createPlaybookSimulation,
  getSimulation,
  listPlaybookSimulations,
  refreshSimulation,
} from '@/services/paper-execution';
import {
  getThesis,
  getThesisScenarios,
  recordThesisDecision,
  recordThesisReview,
} from '@/services/theses';
import { normalizeThesisResponse } from '@/services/thesis-response-normalizer';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import {
  useWorkspaceStore,
  type WorkspaceRequestContext,
} from '@/store/useWorkspaceStore';
import {
  ConfidenceBadge,
  DataQualityBadge,
  DirectionBadge,
  IdChip,
  RatingBadge,
} from '@/components/research/badges';
import { JsonView } from '@/components/research/json-view';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import {
  THESIS_DETAIL_TABS,
  normalizeThesisDetailTab,
  setThesisDetailTabParam,
  type ThesisDetailTab,
} from './thesis-detail-tabs';
import { scenarioDetailViewModel, scenarioHorizon } from './scenario-view-model';
import type {
  BacktestRunResponse,
  ExecutionEventResponse,
  JsonRecord,
  PaperPositionResponse,
  PlaybookCompileReportResponse,
  ScenarioEvaluationResponse,
  ScenarioHorizon,
  ScenarioLiveStateResponse,
  ScenarioResponse,
  SimulationDetailResponse,
  SimulationRunResponse,
  ThesisResponse,
} from '@/types';

type ScenarioHorizonFilter = 'all' | ScenarioHorizon;
type ScenarioLifecycleAction = 'evaluate' | 'compile' | 'backtest';
type ScenarioLifecycleRequest = {
  action: ScenarioLifecycleAction;
  scenario: ScenarioResponse;
};
type ScenarioLifecycleResult =
  | ScenarioEvaluationResponse
  | PlaybookCompileReportResponse
  | BacktestRunResponse;
type ScenarioLatestPlaybook = ScenarioResponse['latest_playbook'];
type ScenarioActionFeedback = {
  tone: 'constructive' | 'warning' | 'risk' | 'primary';
  message: string;
  details: string[];
};
type CompiledTradePlaybook = NonNullable<PlaybookCompileReportResponse['playbook']>;
type PendingScenarioAction = {
  action: ScenarioLifecycleAction;
  key: string;
};
type PaperSimulationAction =
  | 'start-forward'
  | 'run-replay'
  | 'refresh'
  | 'cancel'
  | 'close-manual'
  | 'abandon-inconclusive';
const SCENARIO_HORIZON_FILTER_ORDER: ScenarioHorizon[] = [
  'short_term',
  'mid_term',
  'long_term',
  'unknown',
];

export function ThesisDetailPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeThesisDetailTab(searchParams.get('tab'));
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const thesisId = id ?? '';
  const thesisQuery = useQuery({
    queryKey: queryKeys.thesis(thesisId),
    queryFn: () => getThesis(thesisId, auth),
  });
  const scenariosQuery = useQuery({
    queryKey: queryKeys.thesisScenarios(thesisId),
    queryFn: () => getThesisScenarios(thesisId, auth),
    enabled: activeTab === 'scenario',
  });

  const [decisionAction, setDecisionAction] = useState('watched');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionEntry, setDecisionEntry] = useState('');
  const [decisionStopLoss, setDecisionStopLoss] = useState('');
  const [decisionTakeProfit, setDecisionTakeProfit] = useState('');
  const [positionIntent, setPositionIntent] = useState('watch_only');
  const [reviewResult, setReviewResult] = useState('unknown');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewMfe, setReviewMfe] = useState('');
  const [reviewMae, setReviewMae] = useState('');
  const [exportingBundle, setExportingBundle] = useState(false);
  const [exportError, setExportError] = useState('');
  const [scenarioHorizonFilter, setScenarioHorizonFilter] = useState<ScenarioHorizonFilter>('all');
  const [scenarioActionFeedback, setScenarioActionFeedback] = useState<Record<string, ScenarioActionFeedback>>({});
  const [pendingScenarioAction, setPendingScenarioAction] = useState<PendingScenarioAction | null>(null);
  const [expandedScenarioId, setExpandedScenarioId] = useState<string | null>(null);

  const decisionMutation = useMutation({
    mutationFn: () =>
      recordThesisDecision(
        thesisId,
        {
          action: decisionAction,
          notes: decisionNotes,
          entry: optionalString(decisionEntry),
          stop_loss: optionalString(decisionStopLoss),
          take_profit: optionalString(decisionTakeProfit),
          position_intent: optionalString(positionIntent),
        },
        auth,
      ),
    onSuccess: () => {
      setDecisionNotes('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.thesis(thesisId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.thesesRoot() });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      recordThesisReview(
        thesisId,
        {
          result: reviewResult,
          notes: reviewNotes,
          max_favorable_excursion: optionalNumber(reviewMfe),
          max_adverse_excursion: optionalNumber(reviewMae),
        },
        auth,
      ),
    onSuccess: () => {
      setReviewNotes('');
      setReviewMfe('');
      setReviewMae('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.thesis(thesisId) });
    },
  });
  const scenarioLifecycleMutation = useMutation({
    mutationFn: async (request: ScenarioLifecycleRequest): Promise<ScenarioLifecycleResult> => {
      const scenarioId = persistedScenarioId(request.scenario);
      if (!scenarioId) {
        throw new Error('Derived thesis boundary scenarios cannot be actioned.');
      }
      if (request.action === 'evaluate') {
        return evaluateScenarioDecisionItem(scenarioId, auth);
      }
      if (request.action === 'compile') {
        return compileScenarioDecisionPlaybook(scenarioId, auth);
      }
      const playbookId = request.scenario.latest_playbook?.id;
      if (!playbookId) {
        throw new Error('Compile a playbook before running a backtest.');
      }
      return createScenarioDecisionBacktest(playbookId, auth);
    },
    onMutate: (request) => {
      const key = scenarioActionKey(request.scenario);
      setPendingScenarioAction({ action: request.action, key });
      setScenarioActionFeedback((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    onSuccess: (result, request) => {
      setScenarioActionFeedback((current) => ({
        ...current,
        [scenarioActionKey(request.scenario)]: scenarioLifecycleFeedback(request.action, result),
      }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.thesisScenarios(thesisId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scenarioDecisionWorkbench() });
    },
    onError: (error, request) => {
      setScenarioActionFeedback((current) => ({
        ...current,
        [scenarioActionKey(request.scenario)]: {
          tone: 'risk',
          message: errorMessage(error),
          details: [],
        },
      }));
    },
    onSettled: () => {
      setPendingScenarioAction(null);
    },
  });
  const scenarioCards = thesisQuery.data
    ? buildScenarioCards(thesisQuery.data, scenariosQuery.data ?? [])
    : [];
  const availableScenarioHorizons = scenarioHorizonOptions(scenarioCards);
  useEffect(() => {
    if (
      scenarioHorizonFilter !== 'all' &&
      !availableScenarioHorizons.includes(scenarioHorizonFilter)
    ) {
      setScenarioHorizonFilter('all');
    }
  }, [availableScenarioHorizons, scenarioHorizonFilter]);

  if (thesisQuery.isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading thesis..." />
      </main>
    );
  }
  if (thesisQuery.isError) {
    return (
      <main className="page">
        <ErrorState error={thesisQuery.error} />
      </main>
    );
  }
  const rawThesis = thesisQuery.data;
  if (!rawThesis) {
    return (
      <main className="page">
        <EmptyState label="Thesis not found." />
      </main>
    );
  }
  const thesis = normalizeThesisResponse(rawThesis);
  const stabilityGuard = thesis.stability_guard ?? {};
  const actionSummary = thesis.artifact_status === 'blocked'
    ? 'Thesis blocked. Review validation reasons before using this artifact.'
    : thesis.summary.action_summary || thesis.thesis_text || 'No thesis text.';
  const fullThesisText = thesis.thesis_text.trim();
  const showFullThesis =
    fullThesisText.length > 0 && fullThesisText !== actionSummary.trim();
  const showDiagnosticThesis =
    thesis.artifact_status === 'blocked' &&
    thesis.thesis_text_source === 'diagnostic' &&
    fullThesisText.length > 0;
  const showValidatedThesisPlan = thesis.artifact_status !== 'blocked';
  const entry = thesis.entry_zone || thesis.summary.entry_zone;
  const entryPlanIsEmpty = thesis.entry_plan_status === 'no_trade';
  const entryPlanText =
    entry ||
    (entryPlanIsEmpty
      ? 'No trade currently. This thesis does not recommend opening a new position right now.'
      : thesis.entry_plan_status_label || 'Entry requires confirmation before action.');
  const confirmation =
    thesis.confirmation_condition ||
    thesis.summary.confirmation_condition ||
    'No confirmation condition recorded.';
  const dataGaps =
    thesis.summary.missing_data.length > 0
      ? thesis.summary.missing_data
      : thesis.stale_or_missing_data;
  const profitTargets =
    thesis.profit_targets.length > 0 ? thesis.profit_targets : thesis.summary.profit_targets;
  const downsideObjectives =
    thesis.downside_objectives.length > 0
      ? thesis.downside_objectives
      : thesis.summary.downside_objectives;
  const accumulationZones =
    thesis.accumulation_zones.length > 0
      ? thesis.accumulation_zones
      : thesis.summary.accumulation_zones;
  const indicatorThresholds =
    thesis.indicator_thresholds.length > 0
      ? thesis.indicator_thresholds
      : thesis.summary.indicator_thresholds;
  const unclassifiedObjectives = thesis.target_zones;
  const objectiveLevels = [
    ...levelAuditValues('profit target', profitTargets),
    ...levelAuditValues('downside objective', downsideObjectives),
    ...levelAuditValues('accumulation zone', accumulationZones),
    ...levelAuditValues('indicator threshold', indicatorThresholds),
    ...levelAuditValues('unclassified objective', unclassifiedObjectives),
  ];
  const takeProfitPlaceholder =
    profitTargets[0] ||
    (thesis.direction.toLowerCase() === 'short' ? downsideObjectives[0] : '') ||
    unclassifiedObjectives[0] ||
    '110000';
  const invalidation =
    thesis.invalidation_level || thesis.summary.invalidation || 'No invalidation recorded.';
  const filteredScenarioCards = scenarioCards.filter((scenario) => (
    scenarioHorizonFilter === 'all' || scenarioHorizon(scenario) === scenarioHorizonFilter
  ));
  const headerMeta = [
    thesis.analysis_mode_label,
    thesis.thesis_status_label,
    thesis.created_at ? `Updated ${formatDateTime(thesis.created_at)}` : '',
  ].filter(Boolean).join(' · ');

  function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    decisionMutation.mutate();
  }

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reviewMutation.mutate();
  }

  function selectTab(tab: ThesisDetailTab) {
    setSearchParams(setThesisDetailTabParam(searchParams, tab));
  }

  async function exportEvidenceBundle() {
    const currentThesis = thesis;
    if (!currentThesis?.research_run_id) {
      return;
    }
    const runId = currentThesis.research_run_id;
    setExportingBundle(true);
    setExportError('');
    try {
      const bundle = await getResearchRunEvidenceBundle(runId, auth);
      downloadJson(
        bundle,
        `evidence-bundle-${safeFileName(runId)}.json`,
      );
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExportingBundle(false);
    }
  }

  return (
    <main className="page thesis-detail-page">
      <div className="thesis-detail-tabs" role="tablist" aria-label="Thesis detail sections">
        {THESIS_DETAIL_TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              aria-controls={`thesis-detail-panel-${tab.id}`}
              aria-selected={selected}
              className={`thesis-detail-tab${selected ? ' active' : ''}`}
              id={`thesis-detail-tab-${tab.id}`}
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              role="tab"
              type="button"
            >
              <span>{tab.label}</span>
              <small>{tab.description}</small>
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby={`thesis-detail-tab-${activeTab}`}
        className="thesis-detail-tab-panel"
        id={`thesis-detail-panel-${activeTab}`}
        role="tabpanel"
      >
        {activeTab === 'brief' ? (
          <div className="thesis-detail-tab-stack">
            <Panel
              className="thesis-brief-panel"
              title={`${thesis.symbol || 'Asset'} Thesis`}
              description={headerMeta}
            >
              <div className="thesis-brief">
                <div className="thesis-brief-kpis" aria-label="Thesis status summary">
                  <ThesisBriefKpi label="Decision">
                    <RatingBadge value={thesis.decision} />
                  </ThesisBriefKpi>
                  <ThesisBriefKpi label="Action" tone={thesisActionTone(thesis.recommended_action)}>
                    <span className={`badge ${thesisActionTone(thesis.recommended_action)}`}>
                      {thesis.recommended_action_label}
                    </span>
                  </ThesisBriefKpi>
                  <ThesisBriefKpi label="Bias" tone={biasTone(thesis.market_bias)}>
                    <DirectionBadge value={thesis.market_bias_label} />
                  </ThesisBriefKpi>
                </div>

                <ThesisContractStatus thesis={thesis} />

                <section className="thesis-brief-summary">
                  <span>Main recommendation</span>
                  <StructuredRichText value={actionSummary} />
                </section>

                {showFullThesis && thesis.artifact_status !== 'blocked' ? (
                  <section className="thesis-full-text">
                    <span>Full thesis</span>
                    <StructuredRichText value={fullThesisText} />
                  </section>
                ) : null}

                {showDiagnosticThesis ? (
                  <section className="thesis-diagnostic-text">
                    <span>Diagnostic thesis</span>
                    <StructuredRichText value={fullThesisText} />
                  </section>
                ) : null}

                {showValidatedThesisPlan ? (
                  <>
                    <section className={`thesis-entry-state${entryPlanIsEmpty ? ' empty' : ''}`}>
                      <span>Entry plan</span>
                      <StructuredRichText value={entryPlanText} />
                    </section>

                    <div className="thesis-boundary-grid">
                      <section className="thesis-boundary thesis-boundary-confirmation">
                        <span>Confirmation</span>
                        <StructuredRichText value={confirmation} />
                      </section>
                      <section className="thesis-boundary">
                        <span>Invalidation</span>
                        <StructuredRichText value={invalidation} />
                      </section>
                    </div>
                  </>
                ) : null}

                <div className="top-strip-meta thesis-brief-actions">
                  <span className="thesis-run-inline">
                    <span>Run</span>
                    <IdChip value={thesis.research_run_id} />
                  </span>
                  {thesis.research_run_id ? (
                    <Link className="button" to={routes.researchRun(thesis.research_run_id)}>
                      Open run
                    </Link>
                  ) : null}
                  {thesis.research_run_id ? (
                    <button
                      className="button"
                      disabled={exportingBundle}
                      onClick={exportEvidenceBundle}
                      type="button"
                    >
                      <Download aria-hidden size={15} />
                      {exportingBundle ? 'Exporting' : 'Export evidence'}
                    </button>
                  ) : null}
                  {thesis.id ? (
                    <Link className="button" to={routes.calibrationThesis(thesis.id)}>
                      <Target aria-hidden size={15} />
                      Evaluate thesis
                    </Link>
                  ) : null}
                </div>
                {exportError ? <span className="badge risk">{exportError}</span> : null}
              </div>
            </Panel>

            <Panel title="Monitor next" description="Typed objective levels, follow-up checks, and missing data">
              <div className="grid three">
                <EvidenceBlock title="Profit targets" tone="constructive" values={profitTargets} />
                <EvidenceBlock title="Downside objectives" tone="risk" values={downsideObjectives} />
                <EvidenceBlock title="Accumulation zones" tone="constructive" values={accumulationZones} />
                <EvidenceBlock title="Indicator thresholds" tone="primary" values={indicatorThresholds} />
                <EvidenceBlock title="Monitor next" tone="primary" values={thesis.monitor_next} />
                <EvidenceBlock title="Stale or missing data" tone="warning" values={dataGaps} />
                {unclassifiedObjectives.length > 0 ? (
                  <EvidenceBlock
                    title="Unclassified objectives"
                    tone="warning"
                    values={unclassifiedObjectives}
                  />
                ) : null}
              </div>
              <div style={{ marginTop: 14 }} className="badge">
                <GitBranch aria-hidden size={14} />
                {thesis.summary.market_type || thesis.summary.direction || 'research thesis'}
              </div>
            </Panel>
          </div>
        ) : null}

        {activeTab === 'evidence' ? (
          <Panel
            title="Evidence and contradictions"
            description="Readable thesis drivers first, source IDs second."
          >
            <EvidenceAndContradictions
              contradictingSignalIds={thesis.contradicting_signal_ids}
              keyReasons={thesis.summary.key_reasons}
              risks={thesis.summary.risks}
              supportingSignalIds={thesis.supporting_signal_ids}
            />
            <TechnicalThesisDetails
              confidence={thesis.confidence}
              confidenceSource={thesis.confidence_source}
              dataQuality={thesis.summary.data_quality}
              dataQualityLabel={thesis.summary.data_quality_label}
              dataGaps={dataGaps}
              quantConfidence={thesis.quant_confidence}
              setupType={thesis.setup_type}
              stabilityGuard={stabilityGuard}
              objectiveLevels={objectiveLevels}
            />
            {stabilityGuard.applied === true ? (
              <div className="stack small">
                <strong>Stability guard audit</strong>
                <JsonView value={stabilityGuard} />
              </div>
            ) : null}
          </Panel>
        ) : null}

        {activeTab === 'scenario' ? (
          <Panel title="Scenario radar" description="Conditional outcomes">
            {scenariosQuery.isLoading ? <LoadingState /> : null}
            {scenariosQuery.isError ? <ErrorState error={scenariosQuery.error} /> : null}
            {scenarioCards.length > 0 ? (
              <label className="scenario-filter-label">
                Horizon
                <select
                  className="select"
                  onChange={(event) => setScenarioHorizonFilter(event.target.value as ScenarioHorizonFilter)}
                  value={scenarioHorizonFilter}
                >
                  <option value="all">All</option>
                  {availableScenarioHorizons.map((horizon) => (
                    <option key={horizon} value={horizon}>
                      {scenarioHorizonFilterLabel(horizon)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {filteredScenarioCards.length === 0 && !scenariosQuery.isLoading && !scenariosQuery.isError ? (
              <EmptyState label={emptyScenarioFilterLabel(scenarioHorizonFilter)} />
            ) : null}
            <div className="scenario-radar-list">
              {filteredScenarioCards.map((scenario, index) => {
                const scenarioId = persistedScenarioId(scenario);
                return (
                  <ScenarioRadarCard
                    auth={auth}
                    index={index}
                    isExpandedScenario={scenarioId === expandedScenarioId}
                    key={scenario.id ?? scenario.condition}
                    lifecycle={{
                      canRun: Boolean(scenarioId),
                      feedback: scenarioActionFeedback[scenarioActionKey(scenario)],
                      onAction: (action) => scenarioLifecycleMutation.mutate({ action, scenario }),
                      pendingAction:
                        pendingScenarioAction?.key === scenarioActionKey(scenario)
                          ? pendingScenarioAction.action
                          : null,
                    }}
                    onToggleExpanded={() =>
                      setExpandedScenarioId((current) =>
                        scenarioId && current !== scenarioId ? scenarioId : null,
                      )
                    }
                    scenario={scenario}
                    thesis={thesis}
                  />
                );
              })}
            </div>
          </Panel>
        ) : null}

        {activeTab === 'journal' ? (
          <Panel title="Manual decision journal and AI source rail">
            <div className="grid two">
              <form className="stack" onSubmit={submitDecision}>
                <strong>Record decision</strong>
                <label className="label">
                  Action
                  <select
                    className="select"
                    value={decisionAction}
                    onChange={(event) => setDecisionAction(event.target.value)}
                  >
                    <option value="watched">watched</option>
                    <option value="accepted">accepted</option>
                    <option value="rejected">rejected</option>
                    <option value="ignored">ignored</option>
                    <option value="needs_more_research">needs_more_research</option>
                  </select>
                </label>
                <label className="label">
                  Notes
                  <textarea
                    className="textarea"
                    value={decisionNotes}
                    onChange={(event) => setDecisionNotes(event.target.value)}
                  />
                </label>
                <div className="grid three">
                  <label className="label">
                    Entry
                    <input
                      className="input"
                      onChange={(event) => setDecisionEntry(event.target.value)}
                      placeholder={thesis.entry_zone || '100000-101500'}
                      value={decisionEntry}
                    />
                  </label>
                  <label className="label">
                    SL
                    <input
                      className="input"
                      onChange={(event) => setDecisionStopLoss(event.target.value)}
                      placeholder={thesis.invalidation_level || '95000'}
                      value={decisionStopLoss}
                    />
                  </label>
                  <label className="label">
                    TP
                    <input
                      className="input"
                      onChange={(event) => setDecisionTakeProfit(event.target.value)}
                      placeholder={takeProfitPlaceholder}
                      value={decisionTakeProfit}
                    />
                  </label>
                </div>
                <label className="label">
                  Position intent
                  <select
                    className="select"
                    onChange={(event) => setPositionIntent(event.target.value)}
                    value={positionIntent}
                  >
                    <option value="watch_only">watch_only</option>
                    <option value="spot_accumulation">spot_accumulation</option>
                    <option value="long_perp">long_perp</option>
                    <option value="short_perp">short_perp</option>
                    <option value="hedge_or_reduce">hedge_or_reduce</option>
                    <option value="no_trade">no_trade</option>
                  </select>
                </label>
                {decisionMutation.isError ? (
                  <span className="badge risk">{errorMessage(decisionMutation.error)}</span>
                ) : null}
                {decisionMutation.isSuccess ? (
                  <span className="badge constructive">decision recorded</span>
                ) : null}
                <button className="button primary" disabled={decisionMutation.isPending} type="submit">
                  Record decision
                </button>
              </form>

              <form className="stack" onSubmit={submitReview}>
                <strong>Outcome review</strong>
                <label className="label">
                  Result
                  <select
                    className="select"
                    value={reviewResult}
                    onChange={(event) => setReviewResult(event.target.value)}
                  >
                    <option value="worked">worked</option>
                    <option value="failed">failed</option>
                    <option value="mixed">mixed</option>
                    <option value="invalidated">invalidated</option>
                    <option value="expired">expired</option>
                    <option value="unknown">unknown</option>
                  </select>
                </label>
                <label className="label">
                  Lessons
                  <textarea
                    className="textarea"
                    value={reviewNotes}
                    onChange={(event) => setReviewNotes(event.target.value)}
                  />
                </label>
                <div className="grid two">
                  <label className="label">
                    MFE
                    <input
                      className="input"
                      inputMode="decimal"
                      onChange={(event) => setReviewMfe(event.target.value)}
                      placeholder="0.12"
                      type="number"
                      step="0.0001"
                      value={reviewMfe}
                    />
                  </label>
                  <label className="label">
                    MAE
                    <input
                      className="input"
                      inputMode="decimal"
                      onChange={(event) => setReviewMae(event.target.value)}
                      placeholder="-0.05"
                      type="number"
                      step="0.0001"
                      value={reviewMae}
                    />
                  </label>
                </div>
                {reviewMutation.isError ? (
                  <span className="badge risk">{errorMessage(reviewMutation.error)}</span>
                ) : null}
                {reviewMutation.isSuccess ? (
                  <span className="badge constructive">review recorded</span>
                ) : null}
                <button className="button" disabled={reviewMutation.isPending} type="submit">
                  Record review
                </button>
              </form>
            </div>
          </Panel>
        ) : null}
      </section>
    </main>
  );
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function levelAuditValues(label: string, values: string[]): string[] {
  return values.map((value) => `${label}: ${value}`);
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function stabilityGuardSummary(guard: JsonRecord) {
  const proposed = asRecord(guard.proposed);
  const rating = stringValue(proposed.rating);
  const direction = stringValue(proposed.direction);
  const confidence = numberValue(proposed.confidence);
  const ageMinutes = numberValue(guard.age_minutes);
  const stance = [rating, direction].filter(Boolean).join(' / ');
  const confidenceText = confidence === null ? '' : ` ${Math.round(confidence * 100)}%`;
  const ageText = ageMinutes === null ? '' : ` at ${ageMinutes.toFixed(1)}m`;
  return stance
    ? `held prior thesis; blocked ${stance}${confidenceText}${ageText}`
    : `held prior thesis${ageText}`;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

type ThesisTone = 'default' | 'constructive' | 'warning' | 'risk';
type ScenarioTone = 'constructive' | 'warning' | 'risk' | 'primary' | 'degraded';

function thesisActionTone(action: string): ThesisTone | 'primary' {
  if (action.includes('avoid') || action.includes('reduce') || action.includes('exit')) {
    return 'warning';
  }
  if (action.includes('long') || action.includes('enter')) {
    return 'constructive';
  }
  return 'primary';
}

function biasTone(bias: string): ThesisTone {
  if (bias === 'defensive') {
    return 'warning';
  }
  if (bias === 'bullish') {
    return 'constructive';
  }
  if (bias === 'bearish') {
    return 'risk';
  }
  return 'default';
}

function scenarioActionKey(scenario: ScenarioResponse): string {
  return scenario.id || `${scenario.thesis_id}:${scenario.condition}`;
}

function persistedScenarioId(scenario: ScenarioResponse): string | null {
  if (!scenario.id) {
    return null;
  }
  if (
    scenario.id.includes(':') &&
    stringValue(scenario.payload.source_context) === 'thesis_brief'
  ) {
    return null;
  }
  return scenario.id;
}

function scenarioLifecycleFeedback(
  action: ScenarioLifecycleAction,
  result: ScenarioLifecycleResult,
): ScenarioActionFeedback {
  if (action === 'evaluate') {
    const evaluation = result as ScenarioEvaluationResponse;
    return {
      tone: scenarioEvaluationTone(evaluation.result),
      message: `Evaluation ${titleCaseValue(evaluation.result)} recorded.`,
      details: [
        `Outcome: ${titleCaseValue(evaluation.result)}`,
        `Data quality: ${titleCaseValue(evaluation.data_quality)}`,
        `Trigger: ${scenarioEvaluationFlagText(evaluation.trigger_hit, 'hit', 'missed')}`,
        `Invalidation: ${scenarioEvaluationFlagText(evaluation.invalidation_hit, 'hit', 'clear')}`,
        'Reliability: this scenario window is updated, not double-counted.',
        ...evaluation.warnings.map(scenarioFeedbackText),
      ],
    };
  }

  if (action === 'compile') {
    const report = result as PlaybookCompileReportResponse;
    if (!report.eligible) {
      return {
        tone: 'warning',
        message: 'Playbook rejected.',
        details: report.rejection_reasons.map(scenarioFeedbackText),
      };
    }
    return {
      tone: 'constructive',
      message: 'Playbook compiled.',
      details: [
        report.playbook ? playbookDirectionDetail(report.playbook) : '',
        report.playbook ? playbookEntryDetail(report.playbook) : '',
        report.playbook ? playbookInvalidationDetail(report.playbook) : '',
        report.playbook ? playbookTargetsDetail(report.playbook) : '',
        'Scope: manual research plan only; no exchange order is placed.',
        ...report.warnings.map(scenarioFeedbackText),
      ].filter(Boolean),
    };
  }

  const backtest = result as BacktestRunResponse;
  return {
    tone: backtest.status === 'completed'
      ? 'constructive'
      : backtest.status === 'failed'
        ? 'risk'
        : 'warning',
    message: `Backtest ${titleCaseValue(backtest.status)}.`,
    details: [
      `Trades: ${backtest.result.trade_count}`,
      backtest.result.total_return_pct === null
        ? ''
        : `Return: ${backtest.result.total_return_pct.toFixed(2)}%`,
      `Data quality: ${titleCaseValue(backtest.data_quality)}`,
      backtestWindowDetail(backtest),
      backtestAssumptionsDetail(backtest),
      ...backtest.warnings.map(scenarioFeedbackText),
    ].filter(Boolean),
  };
}

function scenarioEvaluationFlagText(
  value: boolean | null,
  trueLabel: string,
  falseLabel: string,
): string {
  if (value === true) {
    return trueLabel;
  }
  if (value === false) {
    return falseLabel;
  }
  return 'not evaluated';
}

function playbookDirectionDetail(playbook: CompiledTradePlaybook): string {
  return `Playbook: ${titleCaseValue(playbook.direction)} ${scenarioFeedbackText(playbook.horizon)}`;
}

function playbookEntryDetail(playbook: CompiledTradePlaybook): string {
  const entry = playbook.entry;
  if (entry.type === 'zone' && entry.zone_low !== null && entry.zone_high !== null) {
    return `Entry: ${formatScenarioPrice(entry.zone_low)} to ${formatScenarioPrice(entry.zone_high)}`;
  }
  if (entry.level !== null) {
    return `Entry: ${formatScenarioPrice(entry.level)}`;
  }
  const condition = scenarioFeedbackText(entry.condition);
  return condition ? `Entry: ${condition}` : 'Entry: condition only';
}

function playbookInvalidationDetail(playbook: CompiledTradePlaybook): string {
  if (playbook.invalidation.level !== null) {
    return `Invalidation: ${formatScenarioPrice(playbook.invalidation.level)}`;
  }
  const condition = scenarioFeedbackText(playbook.invalidation.condition);
  return condition ? `Invalidation: ${condition}` : 'Invalidation: not available';
}

function playbookTargetsDetail(playbook: CompiledTradePlaybook): string {
  const targets = playbook.targets
    .map((target) => target.level === null
      ? scenarioFeedbackText(target.label || target.rationale)
      : formatScenarioPrice(target.level))
    .filter(Boolean);
  return targets.length > 0
    ? `Targets: ${targets.join(', ')}`
    : 'Targets: not available';
}

function backtestWindowDetail(backtest: BacktestRunResponse): string {
  return `Range: ${formatScenarioDate(backtest.assumptions.start_at)} to ${formatScenarioDate(backtest.assumptions.end_at)}`;
}

function backtestAssumptionsDetail(backtest: BacktestRunResponse): string {
  return [
    `Timeframe: ${backtest.assumptions.timeframe}`,
    `Fill: ${scenarioFeedbackText(backtest.assumptions.fill_policy)}`,
    `Sizing: ${scenarioFeedbackText(backtest.assumptions.sizing_policy)}`,
  ].join(' | ');
}

function formatScenarioDate(value: string): string {
  return cleanScenarioText(value).slice(0, 10) || 'unknown';
}

function formatScenarioPrice(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 8 })}`;
}

function scenarioEvaluationTone(result: ScenarioEvaluationResponse['result']): ScenarioActionFeedback['tone'] {
  if (result === 'hit' || result === 'mixed') {
    return 'constructive';
  }
  if (result === 'invalidated' || result === 'missed') {
    return 'risk';
  }
  return 'warning';
}

function scenarioFeedbackText(value: string): string {
  return cleanScenarioText(value).replace(/_/g, ' ');
}

function ScenarioRadarCard({
  auth,
  scenario,
  isExpandedScenario,
  index,
  onToggleExpanded,
  thesis,
  lifecycle,
}: {
  auth: WorkspaceRequestContext;
  scenario: ScenarioResponse;
  isExpandedScenario: boolean;
  index: number;
  onToggleExpanded: () => void;
  thesis: ThesisResponse;
  lifecycle: {
    canRun: boolean;
    feedback: ScenarioActionFeedback | undefined;
    onAction: (action: ScenarioLifecycleAction) => void;
    pendingAction: ScenarioLifecycleAction | null;
  };
}) {
  const queryClient = useQueryClient();
  const vm = scenarioDetailViewModel(scenario, index);
  const scenarioId = persistedScenarioId(scenario);
  const playbookId = scenario.latest_playbook?.id ?? null;
  const simulationsQuery = useQuery({
    enabled: Boolean(playbookId && isExpandedScenario),
    queryKey: queryKeys.playbookSimulations(playbookId ?? 'missing-playbook'),
    queryFn: () => listPlaybookSimulations(playbookId ?? '', auth),
  });
  const simulationRuns = simulationsQuery.data ?? [];
  const replaySimulationRuns = replayHistoryRuns(simulationRuns);
  const activeForwardSimulation = activeForwardRun(simulationRuns);
  const highlightedSimulationRun =
    activeForwardSimulation ??
    latestCompletedForwardRun(simulationRuns) ??
    latestReplayRun(simulationRuns) ??
    null;
  const chartQuery = useQuery({
    enabled: Boolean(scenarioId && isExpandedScenario),
    queryKey: queryKeys.scenarioChart(
      scenarioId ?? 'derived-scenario',
      '15m',
      highlightedSimulationRun?.id ?? null,
    ),
    queryFn: () =>
      getScenarioChartProjection(
        scenarioId ?? '',
        {
          interval: '15m',
          limit: 200,
          simulationId: highlightedSimulationRun?.id ?? null,
        },
        auth,
      ),
    refetchInterval:
      vm.triggerStatus === 'triggered' || vm.triggerStatus === 'near_trigger'
        ? 30_000
        : false,
  });
  const simulationDetailQuery = useQuery({
    enabled: Boolean(highlightedSimulationRun?.id && isExpandedScenario),
    queryKey: queryKeys.simulation(highlightedSimulationRun?.id ?? 'missing-simulation'),
    queryFn: () => getSimulation(highlightedSimulationRun?.id ?? '', auth),
    refetchInterval: activeForwardSimulation ? 30_000 : false,
  });
  const simulationMutation = useMutation({
    mutationFn: async (action: PaperSimulationAction) => {
      if (!playbookId) {
        throw new Error('Compile a playbook before starting a paper simulation.');
      }
      if (action === 'start-forward') {
        return createPlaybookSimulation(playbookId, defaultForwardSimulationRequest(), auth);
      }
      if (action === 'run-replay') {
        return createPlaybookSimulation(playbookId, defaultReplaySimulationRequest(), auth);
      }
      const simulationId = simulationDetailQuery.data?.id ?? highlightedSimulationRun?.id;
      if (!simulationId) {
        throw new Error('Select an existing simulation first.');
      }
      if (action === 'refresh') {
        return refreshSimulation(simulationId, auth);
      }
      if (action === 'cancel') {
        return cancelSimulation(simulationId, auth);
      }
      if (action === 'abandon-inconclusive') {
        return closeSimulation(
          simulationId,
          {
            close_policy: 'abandon_inconclusive',
            reason: 'Operator abandoned paper position as inconclusive.',
          },
          auth,
        );
      }
      return closeSimulation(
        simulationId,
        {
          close_policy: 'manual_close',
          reason: 'Operator requested paper position close.',
        },
        auth,
      );
    },
    onSuccess: (result) => {
      if (playbookId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.playbookSimulations(playbookId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.simulation(result.id) });
      if (scenarioId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.scenarioChart(scenarioId, '15m'),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.scenarioChart(scenarioId, '15m', result.id),
        });
      }
    },
  });
  const refreshStateMutation = useMutation({
    mutationFn: () => {
      if (!scenarioId) {
        throw new Error('Derived thesis boundary scenarios cannot refresh live state.');
      }
      return refreshScenarioLiveState(scenarioId, auth);
    },
    onSuccess: () => {
      if (scenarioId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.scenarioChart(scenarioId, '15m'),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.thesisScenarios(thesis.id ?? scenario.thesis_id),
      });
    },
  });
  const band = cleanScenarioText(scenario.probability_band) || 'scenario';
  const action = [vm.actionLabel, vm.actionDetail].filter(Boolean).join(': ');
  const actionToneValue = vm.actionTone;
  const actionText = vm.actionDetail || vm.actionLabel;
  const condition = vm.condition;
  const expected = vm.expected;
  const invalidation = cleanScenarioText(scenario.invalidation || stringValue(scenario.payload.invalidation));
  const riskMap = vm.riskMap.length > 0
    ? vm.riskMap
    : stringList(scenario.payload.risk_map ?? scenario.payload.risk_factors);
  const scenarioName = vm.title || scenarioDisplayName(scenario, condition, expected, action, index);
  const summary = scenarioSummary(scenario.payload, condition, expected);
  const direction = scenarioDirection(scenario, scenarioName, condition, expected, action);
  const directionToneValue = scenarioDirectionTone(direction);
  const impactLabel = scenarioImpactLabel(scenario, expected, riskMap);
  const impactToneValue = scenarioImpactTone(impactLabel);
  const evidence = vm.evidence.length > 0 ? vm.evidence : scenarioEvidence(scenario.payload);
  const watchTriggers = vm.watchTriggers.length > 0
    ? vm.watchTriggers
    : scenarioWatchTriggers(scenario.payload, condition, invalidation);
  const impactOnThesis = vm.impactOnThesis || expected;
  const thesisRelation = scenarioThesisRelation(thesis, scenario);
  const chartProjection = chartQuery.data ?? null;
  const chartBlockers = chartProjection?.live_state.blockers ?? [];
  const compileBlocker = compileBlockerForScenario(scenario, chartProjection?.live_state ?? null);
  const backtestBlocker = backtestBlockerForPlaybook(scenario.latest_playbook);

  return (
    <article className={`scenario-card scenario-card-${directionToneValue}`}>
      <div className="scenario-card-header scenario-decision-header">
        <div className="scenario-title">
          <span className="scenario-index">{index + 1}</span>
          <div className="scenario-title-copy">
            <strong>{scenarioName}</strong>
            <span>{summary}</span>
          </div>
        </div>
        <div className="scenario-badge-row">
          <span className={`badge ${scenarioBandTone(band)}`}>
            {titleCaseValue(band)} probability
          </span>
          <span className={`badge ${directionToneValue}`}>{titleCaseValue(direction)}</span>
          <span className={`badge ${impactToneValue}`}>
            {titleCaseValue(impactLabel)} impact
          </span>
        </div>
      </div>

      <div className={`scenario-thesis-link scenario-thesis-link-${thesisRelation.tone}`}>
        <span>
          <GitBranch aria-hidden size={13} />
          {thesisRelation.label}
        </span>
        <strong>{thesisRelation.detail}</strong>
      </div>

      <div className="scenario-meta-row" aria-label="Scenario provenance">
        <ScenarioMeta label="Horizon" value={vm.horizonLabel} />
        <ScenarioMeta label="Window" value={vm.timeframeLabel} />
        <ScenarioMeta label="As of" value={vm.asOf} />
        <ScenarioMeta label="Timeframe" value={vm.timeframe} />
        <ScenarioMeta label="Source" value={vm.source} />
      </div>

      <div className="scenario-decision-grid">
        <div className="scenario-field">
          <span>Evidence</span>
          {evidence.length > 0 ? (
            <div className="scenario-evidence-grid">
              {evidence.slice(0, 6).map((item) => (
                <span className="scenario-evidence-chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="scenario-empty-line">No structured evidence recorded.</p>
          )}
        </div>

        <div className="scenario-field">
          <span>Watch</span>
          <ul className="scenario-watch-list">
            {watchTriggers.slice(0, 5).map((trigger) => (
              <li key={trigger}>{trigger}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className={`scenario-action scenario-action-${actionToneValue}`}>
        <span className="scenario-action-label">Action</span>
        <StructuredRichText dense value={actionText} />
      </div>

      <div className="scenario-decision-grid">
        <div className="scenario-field">
          <span>Recommendation</span>
          <StructuredRichText
            dense
            value={vm.recommendationSummary || vm.actionLabel}
          />
        </div>

        <div className="scenario-field">
          <span>Evaluation</span>
          <p>{vm.evaluationLabel}</p>
          <p className="small muted">{vm.evaluationDetail}</p>
        </div>
      </div>

      <div className="scenario-decision-grid">
        <div className="scenario-field">
          <span>Reliability</span>
          <p>{vm.reliabilityLabel}</p>
          <p className="small muted">{vm.reliabilityDetail}</p>
        </div>

        <div className="scenario-field">
          <span>Playbook</span>
          <p>{vm.playbookLabel}</p>
          <p className="small muted">{vm.backtestLabel}</p>
          {vm.backtestEvents.length ? (
            <ul className="scenario-watch-list">
              {vm.backtestEvents.map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {lifecycle.canRun ? (
        <ScenarioLifecycleActions
          feedback={lifecycle.feedback}
          compileBlocker={compileBlocker}
          backtestBlocker={backtestBlocker}
          onAction={lifecycle.onAction}
          pendingAction={lifecycle.pendingAction}
        />
      ) : null}

      {scenarioId ? (
        <div className="scenario-chart-panel">
          <div className="scenario-chart-meta">
            <span className="badge primary">Live state</span>
            {chartBlockers.length > 0 ? (
              <span className="badge warning">Review blockers</span>
            ) : null}
            <button
              className="button ghost"
              onClick={onToggleExpanded}
              type="button"
            >
              {isExpandedScenario ? 'Hide chart' : 'Show chart'}
            </button>
            <button
              className="button ghost"
              disabled={refreshStateMutation.isPending}
              onClick={() => refreshStateMutation.mutate()}
              type="button"
            >
              <RefreshCw aria-hidden size={14} />
              {refreshStateMutation.isPending ? 'Refreshing' : 'Refresh state'}
            </button>
          </div>
          {isExpandedScenario ? (
            <>
              <PaperSimulationPanel
                activeForwardRun={activeForwardSimulation}
                blocker={simulationBlockerForPlaybook(scenario.latest_playbook)}
                detail={simulationDetailQuery.data ?? null}
                isLoading={simulationsQuery.isLoading || simulationDetailQuery.isLoading}
                latestRun={highlightedSimulationRun}
                onAction={(action) => simulationMutation.mutate(action)}
                pendingAction={simulationMutation.isPending ? simulationMutation.variables ?? null : null}
                replayRuns={replaySimulationRuns}
                error={simulationMutation.isError ? errorMessage(simulationMutation.error) : null}
              />
              <ScenarioChart
                isLoading={chartQuery.isLoading}
                projection={chartProjection}
                simulation={simulationDetailQuery.data ?? null}
              />
            </>
          ) : null}
          {chartBlockers.length > 0 ? (
            <ul className="scenario-watch-list">
              {chartBlockers.slice(0, 4).map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
          {refreshStateMutation.isError ? (
            <span className="badge risk">{errorMessage(refreshStateMutation.error)}</span>
          ) : null}
        </div>
      ) : null}

      {vm.hardGates.length ? (
        <div className="scenario-field">
          <span>Hard gates</span>
          <ul className="scenario-watch-list">
            {vm.hardGates.slice(0, 4).map((gate) => (
              <li key={`${gate.label}-${gate.status}`}>
                <strong>{gate.label}</strong>: {gate.status}
                {gate.reason ? <span className="muted"> - {gate.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {vm.blockingReasons.length ? (
        <div className="scenario-field">
          <span>Blocking reasons</span>
          <ul className="scenario-watch-list">
            {vm.blockingReasons.slice(0, 4).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="scenario-field">
        <span>Impact on thesis</span>
        <StructuredRichText dense value={impactOnThesis || 'No thesis impact recorded.'} />
      </div>

      {invalidation ? (
        <div className="scenario-field scenario-field-compact">
          <span>Invalidation</span>
          <StructuredRichText dense value={invalidation} />
        </div>
      ) : null}

      {riskMap.length > 0 ? (
        <div className="scenario-risk-row">
          {riskMap.slice(0, 4).map((risk) => (
            <span className="pill warning" key={risk}>
              {cleanScenarioText(risk)}
            </span>
          ))}
        </div>
      ) : null}

      <details className="scenario-debug">
        <summary>Payload</summary>
        <JsonView value={scenario.payload} />
      </details>
    </article>
  );
}

function ScenarioMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="scenario-meta-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PaperSimulationPanel({
  activeForwardRun,
  blocker,
  detail,
  error,
  isLoading,
  latestRun,
  onAction,
  pendingAction,
  replayRuns,
}: {
  activeForwardRun: SimulationRunResponse | null;
  blocker: string | null;
  detail: SimulationDetailResponse | null;
  error: string | null;
  isLoading: boolean;
  latestRun: SimulationRunResponse | null;
  onAction: (action: PaperSimulationAction) => void;
  pendingAction: PaperSimulationAction | null;
  replayRuns: SimulationRunResponse[];
}) {
  const playbook = detail?.playbook_snapshot ?? null;
  const position = detail?.position ?? null;
  const outcome = detail?.outcome ?? null;
  const openPosition = position?.status === 'open' || position?.status === 'partially_closed';
  const activeForward = Boolean(activeForwardRun);
  const status = paperSimulationStatus(detail, latestRun, blocker);
  return (
    <div className="paper-simulation-panel">
      <div className="paper-simulation-header">
        <div>
          <span className="badge primary">Opportunity</span>
          <strong>{paperSimulationTitle(playbook, latestRun)}</strong>
          <p>{status}</p>
        </div>
        <div className="paper-simulation-status">
          {detail ? <span className="badge">{titleCaseValue(detail.mode)}</span> : null}
          {detail ? <span className="badge">{titleCaseValue(detail.status)}</span> : null}
          {detail?.source_drift_after_start ? (
            <span className="badge warning">Source changed after start</span>
          ) : null}
          {replayRuns.length > 0 ? <span className="badge">{replayRuns.length} replay runs</span> : null}
        </div>
      </div>

      {playbook ? (
        <div className="paper-simulation-grid">
          <PaperSimulationFact label="Entry" value={paperEntryLabel(playbook)} />
          <PaperSimulationFact label="Invalidation" value={paperInvalidationLabel(playbook)} />
          <PaperSimulationFact label="Targets" value={paperTargetsLabel(playbook)} />
          <PaperSimulationFact label="Expires" value={paperExpiryLabel(detail ?? latestRun)} />
          <PaperSimulationFact label="Position" value={paperPositionLabel(position)} />
          <PaperSimulationFact label="Realized / Unrealized" value={paperPositionPnlLabel(position, outcome)} />
        </div>
      ) : latestRun ? (
        <div className="paper-simulation-grid">
          <PaperSimulationFact label="Mode" value={titleCaseValue(latestRun.mode)} />
          <PaperSimulationFact label="Status" value={titleCaseValue(latestRun.status)} />
          <PaperSimulationFact label="Started" value={formatScenarioDate(latestRun.started_at)} />
          <PaperSimulationFact label="Expires" value={paperExpiryLabel(latestRun)} />
          <PaperSimulationFact label="Sample" value={titleCaseValue(latestRun.sample_kind)} />
        </div>
      ) : null}

      {outcome ? (
        <div className="paper-simulation-outcome">
          <span>{titleCaseValue(outcome.execution_result)}</span>
          <strong>{paperPnlLabel(outcome)}</strong>
          <p>{outcome.diagnosis_summary}</p>
        </div>
      ) : null}

      {replayRuns.length > 0 ? (
        <div className="paper-simulation-history" aria-label="Replay history">
          <div className="paper-simulation-history-header">
            <span>Replay history</span>
            <strong>{replayRuns.length} runs</strong>
          </div>
          <ul>
            {replayRuns.slice(0, 3).map((run) => (
              <li key={run.id}>
                <strong>{titleCaseValue(run.status)}</strong>
                <span>{paperSimulationRunMeta(run)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="scenario-lifecycle-actions paper-simulation-actions" aria-label="Paper simulation actions">
        <button
          className="button ghost"
          disabled={Boolean(blocker) || Boolean(pendingAction) || activeForward}
          onClick={() => onAction('start-forward')}
          title={blocker ?? undefined}
          type="button"
        >
          <Play aria-hidden size={14} />
          {pendingAction === 'start-forward' ? 'Starting' : 'Start simulation'}
        </button>
        <button
          className="button ghost"
          disabled={Boolean(blocker) || Boolean(pendingAction)}
          onClick={() => onAction('run-replay')}
          title={blocker ?? undefined}
          type="button"
        >
          <ListChecks aria-hidden size={14} />
          {pendingAction === 'run-replay' ? 'Running' : 'Run replay'}
        </button>
        {activeForward ? (
          <button
            className="button ghost"
            disabled={Boolean(pendingAction)}
            onClick={() => onAction('refresh')}
            type="button"
          >
            <RefreshCw aria-hidden size={14} />
            {pendingAction === 'refresh' ? 'Continuing' : 'Continue simulation'}
          </button>
        ) : null}
        {detail && activeForward && !openPosition ? (
          <button
            className="button ghost"
            disabled={Boolean(pendingAction)}
            onClick={() => onAction('cancel')}
            type="button"
          >
            <XCircle aria-hidden size={14} />
            {pendingAction === 'cancel' ? 'Cancelling' : 'Cancel simulation'}
          </button>
        ) : null}
        {detail && openPosition ? (
          <>
            <button
              className="button ghost"
              disabled={Boolean(pendingAction)}
              onClick={() => onAction('close-manual')}
              type="button"
            >
              <Square aria-hidden size={14} />
              {pendingAction === 'close-manual' ? 'Closing' : 'Close paper position'}
            </button>
            <button
              className="button ghost"
              disabled={Boolean(pendingAction)}
              onClick={() => onAction('abandon-inconclusive')}
              type="button"
            >
              <XCircle aria-hidden size={14} />
              {pendingAction === 'abandon-inconclusive' ? 'Abandoning' : 'Abandon inconclusive'}
            </button>
          </>
        ) : null}
      </div>

      {isLoading ? <span className="small muted">Loading simulation state...</span> : null}
      {error ? <span className="badge risk">{error}</span> : null}
      {detail?.events.length ? (
        <details className="paper-simulation-ledger">
          <summary>Open simulation ledger</summary>
          <ul className="scenario-watch-list">
            {detail.events.slice(-8).map((event) => (
              <li key={event.id}>{paperLedgerLine(event)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function PaperSimulationFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="paper-simulation-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScenarioLifecycleActions({
  backtestBlocker,
  compileBlocker,
  feedback,
  onAction,
  pendingAction,
}: {
  backtestBlocker: string | null;
  compileBlocker: string | null;
  feedback: ScenarioActionFeedback | undefined;
  onAction: (action: ScenarioLifecycleAction) => void;
  pendingAction: ScenarioLifecycleAction | null;
}) {
  const pending = Boolean(pendingAction);
  return (
    <div className="scenario-lifecycle">
      <div className="scenario-lifecycle-actions" aria-label="Scenario lifecycle actions">
        <button
          className="button primary"
          disabled={pending}
          onClick={() => onAction('evaluate')}
          type="button"
        >
          <ClipboardCheck aria-hidden size={14} />
          {pendingAction === 'evaluate' ? 'Evaluating' : 'Evaluate'}
        </button>
        <button
          className="button ghost"
          disabled={pending || Boolean(compileBlocker)}
          onClick={() => onAction('compile')}
          title={compileBlocker ?? undefined}
          type="button"
        >
          <ListChecks aria-hidden size={14} />
          {pendingAction === 'compile' ? 'Compiling' : 'Compile playbook'}
        </button>
        <button
          className="button ghost"
          disabled={pending || Boolean(backtestBlocker)}
          onClick={() => onAction('backtest')}
          title={backtestBlocker ?? undefined}
          type="button"
        >
          <Play aria-hidden size={14} />
          {pendingAction === 'backtest' ? 'Running' : 'Run backtest'}
        </button>
      </div>
      {feedback ? (
        <div className={`scenario-action-result scenario-action-result-${feedback.tone}`}>
          <strong>{feedback.message}</strong>
          {feedback.details.length > 0 ? (
            <ul className="scenario-watch-list">
              {feedback.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function compileBlockerForScenario(
  scenario: ScenarioResponse,
  liveState: ScenarioLiveStateResponse | null = null,
): string | null {
  const runtime = scenario.runtime_decision;
  const validityStatus = liveState?.validity_status ?? runtime.validity_status;
  const runtimeBlockers = liveState?.blockers ?? runtime.blocking_reasons;
  if (validityStatus === 'invalidated') {
    return 'Scenario is invalidated.';
  }
  if (validityStatus === 'expired') {
    return 'Scenario is expired.';
  }
  const recommendation = scenario.scenario_recommendation;
  if (!recommendation) {
    return null;
  }
  if (
    recommendation.action_bias === 'neutral' ||
    recommendation.action_bias === 'unknown' ||
    recommendation.blocking_reasons.includes('Scenario is watch-only or not directional.') ||
    runtimeBlockers.includes('Scenario action bias is not actionable.')
  ) {
    return 'Scenario is watch-only or not directional.';
  }
  if (runtimeBlockers.length > 0) {
    return scenarioFeedbackText(runtimeBlockers[0] ?? 'Runtime decision has unresolved blockers.');
  }
  if (recommendation.action === 'avoid') {
    return 'Recommendation is not directional.';
  }
  if (recommendation.action === 'wait' || recommendation.action === 'review') {
    return 'Recommendation action is wait/review.';
  }
  if (recommendation.hard_gates.some((gate) => gate.status !== 'passed')) {
    return 'Hard gates are pending.';
  }
  return null;
}

function backtestBlockerForPlaybook(playbook: ScenarioLatestPlaybook): string | null {
  if (!playbook?.id) {
    return 'Requires compiled playbook';
  }
  if (
    playbook.direction === 'avoid' ||
    !playbookHasNumericEntry(playbook) ||
    playbook.invalidation.level === null ||
    !playbook.targets.some((target) => target.level !== null)
  ) {
    return 'Requires numeric entry, invalidation, and target';
  }
  return null;
}

function playbookHasNumericEntry(playbook: NonNullable<ScenarioLatestPlaybook>): boolean {
  return playbook.entry.level !== null ||
    (playbook.entry.zone_low !== null && playbook.entry.zone_high !== null);
}

function defaultForwardSimulationRequest() {
  return {
    mode: 'forward' as const,
    sample_kind: 'forward_observation' as const,
    fill_policy: 'touch' as const,
    gap_fill_policy: 'requested_price' as const,
    intrabar_policy: 'ambiguous_warning' as const,
    fee_bps: '0',
    slippage_bps: '0',
    position_size: { mode: 'fixed_notional' as const, notional: '1000', quantity: null },
    timeframe: '15m',
  };
}

function defaultReplaySimulationRequest() {
  const endsAt = new Date();
  const startsAt = new Date(endsAt);
  startsAt.setUTCDate(startsAt.getUTCDate() - 7);
  return {
    mode: 'replay' as const,
    sample_kind: 'manual_experiment' as const,
    fill_policy: 'touch' as const,
    gap_fill_policy: 'requested_price' as const,
    intrabar_policy: 'ambiguous_warning' as const,
    fee_bps: '0',
    slippage_bps: '0',
    position_size: { mode: 'fixed_notional' as const, notional: '1000', quantity: null },
    timeframe: '15m',
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  };
}

function simulationBlockerForPlaybook(playbook: ScenarioLatestPlaybook): string | null {
  if (!playbook?.id) {
    return 'Requires compiled playbook';
  }
  if (playbook.status !== 'current') {
    return 'Requires current playbook';
  }
  if (
    playbook.direction === 'avoid' ||
    !playbookHasNumericEntry(playbook) ||
    playbook.invalidation.level === null ||
    !playbook.targets.some((target) => target.level !== null)
  ) {
    return 'Requires numeric entry, invalidation, and target';
  }
  return null;
}

function paperSimulationStatus(
  detail: SimulationDetailResponse | null,
  latestRun: SimulationRunResponse | null,
  blocker: string | null,
): string {
  if (blocker) return blocker;
  const run = detail ?? latestRun;
  if (!run) return 'Ready to simulate';
  if (run.status === 'waiting_for_trigger') return 'Waiting for entry trigger';
  if (run.status === 'position_open') return 'Paper position open';
  if (run.status === 'completed') return `Completed: ${titleCaseValue(run.status_reason ?? 'review')}`;
  if (run.status === 'cancelled') return 'Simulation cancelled';
  if (run.status === 'failed') return `Simulation failed: ${run.failure_reason ?? 'unknown'}`;
  return titleCaseValue(run.status);
}

function paperSimulationTitle(
  playbook: ScenarioLatestPlaybook,
  run: SimulationRunResponse | null,
): string {
  const source = playbook ?? run?.playbook_snapshot ?? null;
  if (!source) return 'Paper simulation';
  return `${source.symbol} ${titleCaseValue(source.direction)} ${titleCaseValue(source.horizon)}`;
}

function paperEntryLabel(playbook: NonNullable<ScenarioLatestPlaybook>): string {
  if (playbook.entry.level !== null) {
    return formatScenarioPrice(playbook.entry.level);
  }
  if (playbook.entry.zone_low !== null && playbook.entry.zone_high !== null) {
    return `${formatScenarioPrice(playbook.entry.zone_low)}-${formatScenarioPrice(playbook.entry.zone_high)}`;
  }
  return 'No numeric entry';
}

function paperInvalidationLabel(playbook: NonNullable<ScenarioLatestPlaybook>): string {
  return playbook.invalidation.level === null
    ? 'No numeric invalidation'
    : formatScenarioPrice(playbook.invalidation.level);
}

function paperTargetsLabel(playbook: NonNullable<ScenarioLatestPlaybook>): string {
  const targets = playbook.targets
    .map((target) => target.level)
    .filter((target): target is number => target !== null)
    .map(formatScenarioPrice);
  return targets.length ? targets.join(' / ') : 'No numeric target';
}

function paperPositionLabel(position: PaperPositionResponse | null): string {
  if (!position) return 'No paper position';
  const entry = position.average_entry_price
    ? ` @ ${position.average_entry_price}`
    : '';
  return `${titleCaseValue(position.status)} ${position.quantity_remaining}${entry}`;
}

function paperExpiryLabel(run: SimulationRunResponse | null): string {
  if (!run) {
    return 'Not started';
  }
  if (run.setup_expiry_at) {
    return formatScenarioDate(run.setup_expiry_at);
  }
  const endsAt = typeof run.evaluation_window.ends_at === 'string'
    ? run.evaluation_window.ends_at
    : null;
  return endsAt ? formatScenarioDate(endsAt) : 'No expiry';
}

function paperPositionPnlLabel(
  position: PaperPositionResponse | null,
  outcome: SimulationDetailResponse['outcome'],
): string {
  const realized = position?.realized_pnl ?? outcome?.realized_pnl ?? null;
  const unrealized = position?.unrealized_pnl ?? null;
  return `${realized ?? '0'} / ${unrealized ?? '0'}`;
}

function paperPnlLabel(outcome: NonNullable<SimulationDetailResponse['outcome']>): string {
  if (outcome.realized_pnl === null) {
    return 'No realized PnL';
  }
  const pct = outcome.realized_pnl_pct === null ? '' : ` (${outcome.realized_pnl_pct})`;
  return `${outcome.realized_pnl}${pct}`;
}

function paperSimulationRunMeta(run: SimulationRunResponse): string {
  const timestamp = run.completed_at ?? run.cancelled_at ?? run.market_time ?? run.started_at;
  const reason = run.status_reason ?? run.sample_kind;
  return `${formatScenarioDate(timestamp)} | ${titleCaseValue(reason)}`;
}

function paperLedgerLine(event: ExecutionEventResponse): string {
  const time = event.market_time ? formatScenarioDate(event.market_time) : formatScenarioDate(event.recorded_at);
  const price = event.price ? ` @ ${event.price}` : '';
  return `${time}: ${titleCaseValue(event.event_type)}${price} - ${scenarioFeedbackText(event.reason_code)}`;
}

type ScenarioThesisRelationTone = 'constructive' | 'warning' | 'risk' | 'primary';

function scenarioThesisRelation(
  thesis: ThesisResponse,
  scenario: ScenarioResponse,
): {
  label: string;
  detail: string;
  tone: ScenarioThesisRelationTone;
} {
  const thesisLabel = thesisRelationLabel(thesis);
  if (scenario.relation_to_thesis === 'invalidates') {
    return {
      label: `Invalidates ${thesisLabel}`,
      detail: 'Guardrail for when this thesis should stop being treated as active.',
      tone: 'risk',
    };
  }

  if (scenario.relation_to_thesis === 'supports') {
    return {
      label: `Supports ${thesisLabel}`,
      detail: 'Confirmation path that would make the current thesis stronger.',
      tone: 'constructive',
    };
  }

  if (scenario.relation_to_thesis === 'challenges') {
    return {
      label: `Challenges ${thesisLabel}`,
      detail: 'Stress-test branch against the current thesis, not a separate thesis.',
      tone: 'warning',
    };
  }

  return {
    label: `Linked to ${thesisLabel}`,
    detail: 'Conditional checkpoint attached to this thesis.',
    tone: 'primary',
  };
}

function thesisRelationLabel(thesis: ThesisResponse): string {
  const stance = directionalStance(
    thesis.direction ||
      thesis.summary.direction ||
      thesis.market_bias ||
      thesis.summary.market_bias,
  );
  if (stance === 'bullish') {
    return 'current LONG thesis';
  }
  if (stance === 'bearish') {
    return 'current SHORT thesis';
  }
  if (stance === 'neutral') {
    return 'current WATCH thesis';
  }
  return 'current thesis';
}

function directionalStance(value: string): 'bullish' | 'bearish' | 'neutral' | 'unknown' {
  const normalized = value.toLowerCase();
  if (textIncludesAny(normalized, ['long', 'bull', 'buy', 'overweight', 'upside'])) {
    return 'bullish';
  }
  if (textIncludesAny(normalized, ['short', 'bear', 'sell', 'underweight', 'downside'])) {
    return 'bearish';
  }
  if (textIncludesAny(normalized, ['watch', 'neutral', 'range', 'sideways', 'no trade', 'wait', 'defensive'])) {
    return 'neutral';
  }
  return 'unknown';
}

function textIncludesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function scenarioHorizonOptions(scenarios: ScenarioResponse[]): ScenarioHorizon[] {
  const available = new Set(scenarios.map((scenario) => scenarioHorizon(scenario)));
  return SCENARIO_HORIZON_FILTER_ORDER.filter((horizon) => available.has(horizon));
}

function scenarioHorizonFilterLabel(horizon: ScenarioHorizon): string {
  if (horizon === 'short_term') {
    return 'Short-term';
  }
  if (horizon === 'mid_term') {
    return 'Mid-term';
  }
  if (horizon === 'long_term') {
    return 'Long-term';
  }
  return 'Unknown';
}

function emptyScenarioFilterLabel(filter: ScenarioHorizonFilter): string {
  if (filter === 'all') {
    return 'No scenarios for this thesis.';
  }
  return `No ${scenarioHorizonFilterLabel(filter).toLowerCase()} scenarios for this thesis.`;
}

function StructuredRichText({
  value,
  dense = false,
}: {
  value: string;
  dense?: boolean;
}) {
  const blocks = parseStructuredText(value);
  if (blocks.length === 0) {
    return <p className={`structured-rich-text${dense ? ' dense' : ''}`}>No details recorded.</p>;
  }
  return (
    <div className={`structured-rich-text${dense ? ' dense' : ''}`}>
      {blocks.map((block, index) => {
        if (block.kind === 'rule') {
          return <hr className="structured-rich-text-rule" key={`${block.kind}-${index}`} />;
        }
        if (block.kind === 'heading') {
          const Tag = headingTag(block.level);
          return (
            <Tag className={`structured-rich-text-heading level-${block.level}`} key={`${block.kind}-${index}`}>
              {renderInlineMarkdown(block.items[0] ?? '')}
            </Tag>
          );
        }
        if (block.kind === 'ordered-list') {
          return (
            <ol className="structured-rich-text-list ordered" key={`${block.kind}-${index}`}>
              {block.items.map((item) => (
                <li key={item}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.kind === 'unordered-list') {
          return (
            <ul className="structured-rich-text-list" key={`${block.kind}-${index}`}>
              {block.items.map((item) => (
                <li key={item}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'table') {
          const [header = [], ...rows] = block.rows;
          return (
            <div className="structured-rich-text-table-wrap" key={`${block.kind}-${index}`}>
              <table className="structured-rich-text-table">
                <thead>
                  <tr>
                    {header.map((cell, cellIndex) => (
                      <th key={`${cellIndex}-${cell}`}>{renderInlineMarkdown(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={`${rowIndex}-${row.join('|')}`}>
                      {header.map((_, cellIndex) => (
                        <td key={`${cellIndex}-${row[cellIndex] ?? ''}`}>
                          {renderInlineMarkdown(row[cellIndex] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={`${block.kind}-${index}`}>{renderInlineMarkdown(block.items[0] ?? '')}</p>;
      })}
    </div>
  );
}

type StructuredTextLevel = 1 | 2 | 3 | 4 | 5 | 6;

type StructuredTextBlock =
  | {
  kind: 'paragraph' | 'ordered-list' | 'unordered-list' | 'heading' | 'rule';
  items: string[];
  level?: StructuredTextLevel;
}
  | {
      kind: 'table';
      items: string[];
      rows: string[][];
    };

function parseStructuredText(value: string): StructuredTextBlock[] {
  const normalized = String(value ?? '')
    .replace(/\r/g, '')
    .trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n\s*\n+/)
    .flatMap<StructuredTextBlock>((chunk) => {
      const lines = chunk
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        return [];
      }
      if (lines.length === 1 && /^-{3,}$/.test(lines[0] ?? '')) {
        return [{ kind: 'rule', items: [] }];
      }
      const tableStart = findMarkdownTableStart(lines);
      if (tableStart > 0) {
        const tableRows = parseMarkdownTable(lines.slice(tableStart));
        if (tableRows.length > 0) {
          return [
            { kind: 'paragraph', items: [lines.slice(0, tableStart).join(' ')] },
            { kind: 'table', items: [], rows: tableRows },
          ];
        }
      }
      const tableRows = parseMarkdownTable(lines);
      if (tableRows.length > 0) {
        return [{ kind: 'table', items: [], rows: tableRows }];
      }
      if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0] ?? '')) {
        const line = lines[0] ?? '';
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          return [{
            kind: 'heading',
            level: headingMatch[1].length as StructuredTextLevel,
            items: [headingMatch[2].trim()],
          }];
        }
      }
      if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
        return [{
          kind: 'ordered-list',
          items: lines.map((line) => line.replace(/^\d+[.)]\s+/, '').trim()).filter(Boolean),
        }];
      }
      if (lines.every((line) => /^[-*•]\s+/.test(line))) {
        return [{
          kind: 'unordered-list',
          items: lines.map((line) => line.replace(/^[-*•]\s+/, '').trim()).filter(Boolean),
        }];
      }

      const joined = lines.join(' ');
      const orderedItems = splitInlineListItems(joined);
      if (orderedItems.length > 1) {
        return [{ kind: 'ordered-list', items: orderedItems }];
      }

      return [{ kind: 'paragraph', items: [joined] }];
    });
}

function findMarkdownTableStart(lines: string[]): number {
  return lines.findIndex((line, index) => (
    line.includes('|') && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1] ?? '')
  ));
}

function parseMarkdownTable(lines: string[]): string[][] {
  if (lines.length < 3 || !lines.every((line) => line.includes('|'))) {
    return [];
  }
  const separatorIndex = lines.findIndex(isMarkdownTableSeparator);
  if (separatorIndex !== 1) {
    return [];
  }
  const rows = lines
    .filter((_, index) => index !== separatorIndex)
    .map(splitMarkdownTableRow);
  const columnCount = rows[0]?.length ?? 0;
  if (columnCount < 2 || rows.some((row) => row.length === 0)) {
    return [];
  }
  return rows.map((row) => {
    if (row.length >= columnCount) {
      return row.slice(0, columnCount);
    }
    return [...row, ...Array<string>(columnCount - row.length).fill('')];
  });
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function renderInlineMarkdown(value: string): ReactNode[] {
  const text = value.trim();
  if (!text) {
    return [];
  }

  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }
    nodes.push(<strong key={`${index}-${match[1]}`}>{match[1]}</strong>);
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function headingTag(level?: StructuredTextLevel): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  switch (level) {
    case 1:
      return 'h1';
    case 2:
      return 'h2';
    case 3:
      return 'h3';
    case 4:
      return 'h4';
    case 5:
      return 'h5';
    default:
      return 'h6';
  }
}

function splitInlineListItems(value: string): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || !/\b1[.)]\s+/.test(normalized)) {
    return [];
  }

  const matches = Array.from(normalized.matchAll(/(?:^|\s)(\d+)[.)]\s+/g));
  if (matches.length < 2) {
    return [];
  }

  return matches
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = index + 1 < matches.length ? (matches[index + 1].index ?? normalized.length) : normalized.length;
      return normalized.slice(start, end).trim();
    })
    .filter(Boolean);
}

function buildScenarioCards(
  thesis: ThesisResponse,
  scenarios: ScenarioResponse[],
): ScenarioResponse[] {
  if (scenarios.length > 0) {
    return scenarios;
  }

  const cards = [...scenarios];
  const confirmation = thesis.confirmation_condition || thesis.summary.confirmation_condition;
  const invalidation = thesis.invalidation_level || thesis.summary.invalidation;

  if (confirmation && !hasBoundaryScenario(cards, confirmation, 'confirmation')) {
    cards.unshift(buildBoundaryScenario(thesis, {
      branchType: 'confirmation',
      title: 'Confirmation setup',
      condition: confirmation,
      expectedBehavior: 'If confirmation prints cleanly, the thesis gains enough support for a first review.',
      invalidation: invalidation || 'Invalid if the market loses the setup before confirmation completes.',
      suggestedAction: thesis.entry_plan_status === 'no_trade'
        ? 'Watch: no trade until confirmation conditions print with follow-through.'
        : `Watch: ${thesis.entry_plan_status_label || 'wait for confirmation before acting.'}`,
      impactOnThesis: 'Strengthens the current thesis if the confirmation stack completes.',
    }));
  }

  if (invalidation && !hasBoundaryScenario(cards, invalidation, 'invalidation')) {
    cards.push(buildBoundaryScenario(thesis, {
      branchType: 'invalidation',
      title: 'Invalidation guardrail',
      condition: invalidation,
      expectedBehavior: 'If this level fails, the thesis should be downgraded, reduced, or stopped.',
      invalidation: confirmation || 'Invalid if the market reclaims confirmation first with stronger evidence.',
      suggestedAction: 'Reduce: stop treating this thesis as actionable once invalidation triggers.',
      impactOnThesis: 'Weakens or cancels the current thesis if the invalidation case confirms.',
    }));
  }

  return cards;
}

function hasBoundaryScenario(
  scenarios: ScenarioResponse[],
  boundaryText: string,
  branchType: 'confirmation' | 'invalidation',
): boolean {
  const needle = normalizeScenarioCompareText(boundaryText);
  if (!needle) {
    return false;
  }

  return scenarios.some((scenario) => {
    const payloadBranchType = normalizeScenarioCompareText(
      stringValue(scenario.payload.branchType) || stringValue(scenario.payload.branch_type),
    );
    if (payloadBranchType === branchType) {
      return true;
    }
    const haystack = normalizeScenarioCompareText([
      scenario.scenario_name,
      scenario.condition,
      scenario.expected_behavior,
      scenario.invalidation,
    ].join(' '));
    return haystack.includes(needle) || needle.includes(haystack);
  });
}

function normalizeScenarioCompareText(value: string): string {
  return cleanScenarioText(value).toLowerCase();
}

function buildBoundaryScenario(
  thesis: ThesisResponse,
  boundary: {
    branchType: 'confirmation' | 'invalidation';
    title: string;
    condition: string;
    expectedBehavior: string;
    invalidation: string;
    suggestedAction: string;
    impactOnThesis: string;
  },
): ScenarioResponse {
  return {
    id: `${thesis.id ?? thesis.symbol}:${boundary.branchType}`,
    workspace_id: thesis.workspace_id,
    thesis_id: thesis.id ?? '',
    scenario_name: boundary.title,
    direction: boundary.branchType === 'confirmation'
      ? thesis.market_bias || thesis.direction || 'neutral'
      : 'risk',
    thesis_impact: boundary.branchType === 'confirmation' ? 'medium' : 'high',
    relation_to_thesis: boundary.branchType === 'confirmation' ? 'supports' : 'invalidates',
    probability_band: 'base',
    suggested_user_action: boundary.suggestedAction,
    condition: boundary.condition,
    expected_behavior: boundary.expectedBehavior,
    invalidation: boundary.invalidation,
    evidence: thesis.summary.key_reasons.slice(0, 3),
    watch_triggers: splitInlineListItems(boundary.condition),
    impact_on_thesis: boundary.impactOnThesis,
    risk_map: thesis.summary.risks.slice(0, 3),
    as_of: thesis.created_at ? thesis.created_at.slice(0, 10) : '',
    timeframe: '',
    horizon: 'unknown',
    timeframe_label: null,
    source: ['thesis_brief'],
    status: 'watching',
    status_reason: '',
    distance_to_trigger: null,
    last_evaluated_at: null,
    trigger_spec: null,
    decision_playbook: null,
    scenario_recommendation: null,
    runtime_decision: {
      version: 'scenario_runtime_decision.v1',
      evaluated_at: '',
      trigger_status: 'needs_review',
      validity_status: 'needs_review',
      recommended_action: 'review',
      confidence: 0,
      matched_conditions: [],
      failed_conditions: [],
      blocking_reasons: ['runtime_decision_missing'],
      risk_notes: [],
      evidence_refs: [],
      source: 'rule_engine_from_decision_playbook',
      playbook_source: 'missing',
      status_reason: 'Runtime decision has not been evaluated.',
      distance_to_trigger: null,
      llm_recommendation: null,
      final_decision: {
        action: 'review',
        reason: 'Runtime decision has not been evaluated.',
        overrides: ['runtime_decision_missing'],
      },
    },
    evaluation_snapshot: {
      version: 'scenario_evaluation_snapshot.v1',
      readiness: 'needs_review',
      planned_evaluation_at: null,
      expected_horizon: 'unknown',
      trigger_observed: null,
      invalidation_observed: null,
      max_favorable_excursion: null,
      max_adverse_excursion: null,
      outcome: 'not_ready',
      notes: ['Scenario recommendation is missing.'],
    },
    latest_evaluation: null,
    evaluation_state: 'not_ready',
    reliability_profile: null,
    latest_playbook: null,
    latest_backtest: null,
    payload: {
      branchType: boundary.branchType,
      source_context: 'thesis_brief',
    },
  };
}

function scenarioDisplayName(
  scenario: ScenarioResponse,
  condition: string,
  expected: string,
  action: string,
  index: number,
): string {
  const payload = scenario.payload;
  const explicit = cleanScenarioText(
    stringValue(payload.scenario_name) ||
      stringValue(payload.scenarioName) ||
      stringValue(payload.name) ||
      stringValue(payload.title),
  );
  if (explicit && !/^(low|medium|high|unknown)\s+probability$/i.test(explicit)) {
    return explicit;
  }

  const text = [condition, expected, action].join(' ').toLowerCase();
  if (text.includes('short squeeze')) {
    return 'Upside Short Squeeze';
  }
  if (
    text.includes('sideways') ||
    text.includes('consolidation') ||
    text.includes('range') ||
    text.includes('chop') ||
    text.includes('mixed')
  ) {
    return 'Sideways Consolidation / No Clear Edge';
  }
  if (
    (text.includes('long') && (text.includes('crowd') || text.includes('cascade'))) ||
    text.includes('break below') ||
    text.includes('support fails') ||
    text.includes('downside')
  ) {
    return 'Long Crowding Breakdown Risk';
  }
  if (text.includes('invalidation') || text.includes('invalid')) {
    return 'Invalidation Risk';
  }
  if (text.includes('contradiction') || text.includes('conflict')) {
    return 'Contradiction Risk';
  }
  if (
    text.includes('break above') ||
    text.includes('reclaim') ||
    text.includes('upside') ||
    text.includes('bullish') ||
    text.includes('confirmation')
  ) {
    return 'Upside Confirmation';
  }
  return `Scenario ${index + 1}`;
}

function scenarioSummary(payload: JsonRecord, condition: string, expected: string): string {
  const explicit = cleanScenarioText(
    stringValue(payload.summary) || stringValue(payload.scenario_summary),
  );
  return limitScenarioText(explicit || condition || expected, 220);
}

function scenarioDirection(
  scenario: ScenarioResponse,
  name: string,
  condition: string,
  expected: string,
  action: string,
): string {
  const payload = scenario.payload;
  const explicit = cleanScenarioText(
    scenario.direction ||
      stringValue(payload.direction) ||
      stringValue(payload.scenario_direction),
  );
  if (explicit) {
    return explicit;
  }

  const text = [name, condition, expected, action].join(' ').toLowerCase();
  if (text.includes('short squeeze')) {
    return 'bullish risk';
  }
  if (
    text.includes('bearish') ||
    text.includes('downside') ||
    text.includes('break below') ||
    text.includes('support fails') ||
    text.includes('cascade') ||
    text.includes('avoid longs')
  ) {
    return 'bearish risk';
  }
  if (
    text.includes('neutral') ||
    text.includes('sideways') ||
    text.includes('range') ||
    text.includes('chop') ||
    text.includes('wait')
  ) {
    return 'neutral';
  }
  if (
    text.includes('bullish') ||
    text.includes('upside') ||
    text.includes('break above') ||
    text.includes('reclaim')
  ) {
    return 'bullish risk';
  }
  return 'neutral';
}

function scenarioDirectionTone(value: string): ScenarioTone {
  const normalized = value.toLowerCase();
  if (normalized.includes('bear') || normalized.includes('downside')) {
    return 'risk';
  }
  if (normalized.includes('bull') || normalized.includes('upside')) {
    return 'constructive';
  }
  if (normalized.includes('mixed') || normalized.includes('fragile')) {
    return 'warning';
  }
  return 'primary';
}

function scenarioImpactLabel(scenario: ScenarioResponse, expected: string, risks: string[]): string {
  const payload = scenario.payload;
  const explicit = cleanScenarioText(
    scenario.thesis_impact ||
      stringValue(payload.thesis_impact) ||
      stringValue(payload.impact) ||
      stringValue(payload.impact_level),
  ).toLowerCase();
  if (explicit.includes('high')) {
    return 'high';
  }
  if (explicit.includes('medium') || explicit.includes('moderate')) {
    return 'medium';
  }
  if (explicit.includes('low')) {
    return 'low';
  }

  const text = [
    stringValue(payload.impact_on_thesis),
    expected,
    ...risks,
  ].join(' ').toLowerCase();
  if (
    text.includes('invalidates') ||
    text.includes('invalidate') ||
    text.includes('breakdown') ||
    text.includes('cascade')
  ) {
    return 'high';
  }
  if (
    text.includes('challenge') ||
    text.includes('reduce') ||
    text.includes('reassess') ||
    risks.length >= 2
  ) {
    return 'medium';
  }
  return 'low';
}

function scenarioImpactTone(value: string): ScenarioTone {
  if (value === 'high') {
    return 'risk';
  }
  if (value === 'medium') {
    return 'warning';
  }
  return 'primary';
}

function scenarioEvidence(payload: JsonRecord): string[] {
  const raw =
    payload.evidence ??
    payload.evidence_items ??
    payload.evidence_chips ??
    payload.observed_evidence;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => cleanScenarioText(item))
      .filter((item) => item && !isScenarioSectionArtifact(item));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as JsonRecord)
      .map(([key, value]) => {
        const cleanValue = cleanScenarioText(String(value));
        return cleanValue ? `${labelFromKey(key)}: ${cleanValue}` : '';
      })
      .filter((item) => item && !isScenarioSectionArtifact(item));
  }
  const text = cleanScenarioText(raw);
  return text && !isScenarioSectionArtifact(text) ? [text] : [];
}

function scenarioWatchTriggers(
  payload: JsonRecord,
  condition: string,
  invalidation: string,
): string[] {
  const triggers = stringList(
    payload.watch_triggers ??
      payload.watchTriggers ??
      payload.watch_conditions ??
      payload.watch ??
      payload.triggers,
  );
  const fallback = [condition, invalidation].map((item) => cleanScenarioText(item)).filter(Boolean);
  return uniqueStrings(triggers.length > 0 ? triggers : fallback);
}

function scenarioBandTone(value: string): ScenarioTone {
  const normalized = value.toLowerCase();
  if (normalized.includes('high')) {
    return 'constructive';
  }
  if (normalized.includes('medium') || normalized.includes('base')) {
    return 'warning';
  }
  if (normalized.includes('low')) {
    return 'degraded';
  }
  return 'primary';
}

function titleCaseValue(value: string): string {
  const clean = value.trim();
  return clean ? `${clean.charAt(0).toUpperCase()}${clean.slice(1)}` : 'Scenario';
}

function cleanScenarioText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*(?:\u2192|->|=>)\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanScenarioText(item))
      .filter(Boolean);
  }
  const text = cleanScenarioText(value);
  return text ? [text] : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isScenarioSectionArtifact(value: string): boolean {
  const normalized = cleanScenarioText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\band\b/g, '&')
    .replace(/[:.]+$/g, '')
    .trim();
  return (
    normalized === '& timeframe' ||
    normalized === 'timeframe' ||
    normalized === 'source & timeframe' ||
    normalized === 'sources & timeframe' ||
    normalized === 'chips & watch triggers' ||
    normalized === 'evidence chips & watch triggers' ||
    normalized === 'chips watch triggers' ||
    normalized.startsWith('setup_type')
  );
}

function labelFromKey(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function limitScenarioText(value: string, maxLength: number): string {
  const clean = cleanScenarioText(value);
  if (clean.length <= maxLength) {
    return clean;
  }
  const clipped = clean.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

function ThesisFact({
  children,
  label,
  wide = false,
}: {
  children: ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <div className={`thesis-fact${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      <div className="thesis-fact-value">{children}</div>
    </div>
  );
}

function ThesisContractStatus({ thesis }: { thesis: ThesisResponse }) {
  const reasons = thesisContractReasons(thesis);
  return (
    <section className={`thesis-contract-status ${thesis.artifact_status}`}>
      <div className="thesis-contract-status-heading">
        <span className={`badge ${thesisTextSourceTone(thesis)}`}>
          {thesisTextSourceTitle(thesis)}
        </span>
        {thesis.artifact_status !== 'valid' ? (
          <span className={`badge ${thesisContractTone(thesis.artifact_status)}`}>
            {thesisContractTitle(thesis.artifact_status)}
          </span>
        ) : null}
        <span className={`badge ${thesisContractTone(thesis.artifact_status)}`}>
          {thesis.compiled_sections.length} compiled sections
        </span>
        {thesis.candidate_schema_version ? (
          <span className="badge mono">{thesis.candidate_schema_version}</span>
        ) : null}
        {thesis.compiler_version ? (
          <span className="badge mono">{thesis.compiler_version}</span>
        ) : null}
      </div>
      {reasons.length > 0 ? (
        <ul>
          {reasons.map((reason) => (
            <li key={reason}>{labelFromKey(reason)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function thesisTextSourceTitle(thesis: ThesisResponse): string {
  if (thesis.thesis_text_source === 'compiled' && thesis.artifact_status === 'degraded') {
    return 'Compiled with caveats';
  }
  if (thesis.thesis_text_source === 'compiled') {
    return 'Compiled thesis';
  }
  if (thesis.thesis_text_source === 'diagnostic') {
    return 'Diagnostic thesis';
  }
  if (thesis.thesis_text_source === 'missing') {
    return 'Thesis text missing';
  }
  return 'Legacy thesis text';
}

function thesisTextSourceTone(thesis: ThesisResponse): ThesisTone | 'primary' {
  if (thesis.thesis_text_source === 'diagnostic' || thesis.artifact_status === 'blocked') {
    return 'risk';
  }
  if (thesis.artifact_status === 'degraded') {
    return 'warning';
  }
  if (thesis.thesis_text_source === 'compiled') {
    return 'constructive';
  }
  return 'primary';
}

function thesisContractTitle(status: ThesisResponse['artifact_status']): string {
  if (status === 'blocked') {
    return 'Blocked thesis';
  }
  if (status === 'degraded') {
    return 'Degraded thesis';
  }
  return 'Legacy thesis';
}

function thesisContractTone(status: ThesisResponse['artifact_status']): ThesisTone | 'primary' {
  if (status === 'blocked') {
    return 'risk';
  }
  if (status === 'degraded') {
    return 'warning';
  }
  return 'primary';
}

function thesisContractReasons(thesis: ThesisResponse): string[] {
  return Array.from(new Set([
    ...thesis.blocked_reasons,
    ...thesis.degradation_reasons,
    ...thesis.validation_issues.map((issue) => issue.message || issue.code),
  ].filter(Boolean))).slice(0, 5);
}

function ThesisBriefKpi({
  children,
  label,
  tone = 'default',
}: {
  children: ReactNode;
  label: string;
  tone?: ThesisTone | 'primary';
}) {
  return (
    <div className={`thesis-brief-kpi thesis-brief-kpi-${tone}`}>
      <span>{label}</span>
      <div className="thesis-brief-kpi-value">{children}</div>
    </div>
  );
}

function TechnicalThesisDetails({
  confidence,
  confidenceSource,
  dataGaps,
  dataQuality,
  dataQualityLabel,
  objectiveLevels,
  quantConfidence,
  setupType,
  stabilityGuard,
}: {
  confidence: number | null;
  confidenceSource: string;
  dataGaps: string[];
  dataQuality: number | null;
  dataQualityLabel: string;
  objectiveLevels: string[];
  quantConfidence: number | null;
  setupType: string;
  stabilityGuard: JsonRecord;
}) {
  return (
    <section className="thesis-technical-details">
      <div className="thesis-evidence-card-header">
        <strong>Technical details</strong>
        <span className="badge primary">audit</span>
      </div>
      <div className="thesis-fact-grid">
        <ThesisFact label="Setup">{setupType || 'unspecified'}</ThesisFact>
        <ThesisFact label="Confidence">
          <ConfidenceBadge value={confidence} />
        </ThesisFact>
        <ThesisFact label="Data quality">
          <DataQualityBadge label={dataQualityLabel} value={dataQuality} />
        </ThesisFact>
        <ThesisFact label="Quant confidence">
          <ConfidenceBadge value={quantConfidence} />
        </ThesisFact>
        <ThesisFact label="Objective levels">
          {objectiveLevels.length > 0 ? objectiveLevels.join(', ') : 'None reported.'}
        </ThesisFact>
        <ThesisFact label="Data gaps">
          {dataGaps.length > 0 ? dataGaps.join(', ') : 'None reported.'}
        </ThesisFact>
        <ThesisFact label="Confidence basis" wide>
          {confidenceSource || 'Not recorded.'}
        </ThesisFact>
        {stabilityGuard.applied === true ? (
          <ThesisFact label="Stability guard" wide>
            <span className="badge primary">{stabilityGuardSummary(stabilityGuard)}</span>
          </ThesisFact>
        ) : null}
      </div>
    </section>
  );
}

function EvidenceAndContradictions({
  contradictingSignalIds,
  keyReasons,
  risks,
  supportingSignalIds,
}: {
  contradictingSignalIds: string[];
  keyReasons: string[];
  risks: string[];
  supportingSignalIds: string[];
}) {
  return (
    <div className="thesis-evidence-layout">
      <div className="thesis-evidence-main-column">
        <EvidenceNarrativeBlock
          title="Key reasons"
          tone="primary"
          values={keyReasons}
        />
        <div className="thesis-evidence-signal-grid">
          <EvidenceSignalRail
            title="Supporting signals"
            tone="constructive"
            values={supportingSignalIds}
          />
          <EvidenceSignalRail
            title="Contradicting signals"
            tone="risk"
            values={contradictingSignalIds}
          />
        </div>
      </div>
      <EvidenceNarrativeBlock
        title="Risks"
        tone="warning"
        values={risks}
      />
    </div>
  );
}

function EvidenceNarrativeBlock({
  title,
  tone,
  values,
}: {
  title: string;
  tone: 'primary' | 'warning';
  values: string[];
}) {
  const cleanedValues = values.map((value) => cleanScenarioText(value)).filter(Boolean);

  return (
    <section className={`thesis-evidence-card thesis-evidence-card-${tone}`}>
      <div className="thesis-evidence-card-header">
        <strong>{title}</strong>
        <span className={`badge ${tone}`}>{cleanedValues.length}</span>
      </div>
      {cleanedValues.length === 0 ? (
        <p className="thesis-evidence-empty">None reported.</p>
      ) : (
        <ol className="thesis-evidence-list">
          {cleanedValues.map((value, index) => (
            <li className={`thesis-evidence-item thesis-evidence-item-${tone}`} key={`${title}-${value}`}>
              <span className="thesis-evidence-index">{index + 1}</span>
              <p>{value}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EvidenceSignalRail({
  title,
  tone,
  values,
}: {
  title: string;
  tone: 'constructive' | 'risk';
  values: string[];
}) {
  return (
    <section className={`thesis-evidence-card thesis-evidence-card-rail thesis-evidence-card-${tone}`}>
      <div className="thesis-evidence-card-header">
        <strong>{title}</strong>
        <span className={`badge ${tone}`}>{values.length}</span>
      </div>
      {values.length === 0 ? (
        <p className="thesis-evidence-empty">No linked signal IDs.</p>
      ) : (
        <div className="thesis-evidence-signal-list">
          {values.map((value) => (
            <IdChip key={value} value={value} />
          ))}
        </div>
      )}
    </section>
  );
}

function EvidenceBlock({
  title,
  values,
  tone,
}: {
  title: string;
  values: string[];
  tone: 'primary' | 'constructive' | 'warning' | 'risk';
}) {
  return (
    <div className="state-card">
      <strong>{title}</strong>
      {values.length === 0 ? (
        <p className="small muted">None reported.</p>
      ) : (
        <div className="top-strip-meta">
          {values.map((value) => (
            <span className={`badge ${tone} mono`} key={value} title={value}>
              <span className="badge-label">{value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

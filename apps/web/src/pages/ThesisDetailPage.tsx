import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FormEvent, type ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  GitBranch,
  Target,
} from 'lucide-react';
import { getResearchRunEvidenceBundle } from '@/services/research-runs';
import {
  getThesis,
  getThesisScenarios,
  recordThesisDecision,
  recordThesisReview,
} from '@/services/theses';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
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
import type {
  JsonRecord,
  ScenarioResponse,
} from '@/types';

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
  const thesis = thesisQuery.data;
  const stabilityGuard = thesis?.stability_guard ?? {};
  if (!thesis) {
    return (
      <main className="page">
        <EmptyState label="Thesis not found." />
      </main>
    );
  }
  const actionSummary =
    thesis.summary.action_summary || thesis.thesis_text || 'No thesis text.';
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
  const invalidation =
    thesis.invalidation_level || thesis.summary.invalidation || 'No invalidation recorded.';
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

                <section className="thesis-brief-summary">
                  <span>Main recommendation</span>
                  <p>{actionSummary}</p>
                </section>

                <section className={`thesis-entry-state${entryPlanIsEmpty ? ' empty' : ''}`}>
                  <span>Entry plan</span>
                  <p>{entryPlanText}</p>
                </section>

                <div className="thesis-boundary-grid">
                  <section className="thesis-boundary thesis-boundary-confirmation">
                    <span>Confirmation</span>
                    <p>{confirmation}</p>
                  </section>
                  <section className="thesis-boundary">
                    <span>Invalidation</span>
                    <p>{invalidation}</p>
                  </section>
                </div>

                <div className="top-strip-meta thesis-brief-actions">
                  <span className="thesis-run-inline">
                    <span>Run</span>
                    <IdChip value={thesis.research_run_id} />
                  </span>
                  {thesis.id ? (
                    <Link
                      className="button primary"
                      to={`${routes.watchlists}?track_thesis=${encodeURIComponent(thesis.id)}`}
                    >
                      Track thesis
                    </Link>
                  ) : null}
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

            <Panel title="Monitor next" description="Follow-up IDs, target zones, and missing data">
              <div className="grid three">
                <EvidenceBlock title="Target zones" tone="constructive" values={thesis.target_zones} />
                <EvidenceBlock title="Monitor next" tone="primary" values={thesis.monitor_next} />
                <EvidenceBlock title="Stale or missing data" tone="warning" values={dataGaps} />
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
              targetZones={thesis.target_zones}
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
            {scenariosQuery.data?.length === 0 ? (
              <EmptyState label="No scenarios for this thesis." />
            ) : null}
            <div className="scenario-radar-list">
              {scenariosQuery.data?.map((scenario, index) => (
                <ScenarioRadarCard
                  index={index}
                  key={scenario.id ?? scenario.condition}
                  scenario={scenario}
                />
              ))}
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
                      placeholder={thesis.target_zones[0] || '110000'}
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

function ScenarioRadarCard({
  scenario,
  index,
}: {
  scenario: ScenarioResponse;
  index: number;
}) {
  const band = cleanScenarioText(scenario.probability_band) || 'scenario';
  const action = cleanScenarioText(
    scenario.suggested_user_action ||
      stringValue(scenario.payload.suggested_action) ||
      'review',
  );
  const actionParts = splitAction(action);
  const actionToneValue = actionTone(action);
  const actionText = actionParts.detail || actionParts.label;
  const condition = cleanScenarioText(
    scenario.condition || stringValue(scenario.payload.condition),
  ) || 'No condition recorded.';
  const expected = cleanScenarioText(
    scenario.expected_behavior ||
      stringValue(scenario.payload.expected_market_behavior) ||
      stringValue(scenario.payload.expected_behavior),
  );
  const invalidation = cleanScenarioText(stringValue(scenario.payload.invalidation));
  const riskMap = stringList(
    scenario.payload.risk_map ?? scenario.payload.risk_factors,
  );
  const scenarioName = scenarioDisplayName(scenario, condition, expected, action, index);
  const summary = scenarioSummary(scenario.payload, condition, expected);
  const direction = scenarioDirection(scenario.payload, scenarioName, condition, expected, action);
  const directionToneValue = scenarioDirectionTone(direction);
  const impactLabel = scenarioImpactLabel(scenario.payload, expected, riskMap);
  const impactToneValue = scenarioImpactTone(impactLabel);
  const evidence = scenarioEvidence(scenario.payload);
  const watchTriggers = scenarioWatchTriggers(scenario.payload, condition, invalidation);
  const impactOnThesis = cleanScenarioText(stringValue(scenario.payload.impact_on_thesis)) || expected;
  const sources = scenarioSources(scenario.payload);
  const asOf = scenarioAsOf(scenario.payload);
  const timeframe = scenarioTimeframe(scenario.payload);

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

      <div className="scenario-meta-row" aria-label="Scenario provenance">
        <ScenarioMeta label="As of" value={asOf} />
        <ScenarioMeta label="Timeframe" value={timeframe} />
        <ScenarioMeta label="Source" value={sources.length > 0 ? sources.join(', ') : 'not recorded'} />
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
        <p>{actionText}</p>
      </div>

      <div className="scenario-field">
        <span>Impact on thesis</span>
        <p>{impactOnThesis || 'No thesis impact recorded.'}</p>
      </div>

      {invalidation ? (
        <div className="scenario-field scenario-field-compact">
          <span>Invalidation</span>
          <p>{invalidation}</p>
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
  payload: JsonRecord,
  name: string,
  condition: string,
  expected: string,
  action: string,
): string {
  const explicit = cleanScenarioText(
    stringValue(payload.direction) || stringValue(payload.scenario_direction),
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

function scenarioImpactLabel(payload: JsonRecord, expected: string, risks: string[]): string {
  const explicit = cleanScenarioText(
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

function scenarioSources(payload: JsonRecord): string[] {
  return uniqueStrings(
    stringList(payload.source ?? payload.sources ?? payload.source_artifacts)
      .flatMap((item) => extractScenarioSourceLabel(item))
      .map((item) => limitScenarioText(item, 120))
      .filter(Boolean),
  );
}

function scenarioAsOf(payload: JsonRecord): string {
  return scenarioMetaValue(
    payload.as_of ??
      payload.asOf ??
      payload.source_timestamp ??
      payload.generated_at ??
      extractScenarioMetaFromSources(payload, /\bas[_\s-]*of\s*:?\s*([^.;]+)/i),
  );
}

function scenarioTimeframe(payload: JsonRecord): string {
  return scenarioMetaValue(
    payload.timeframe ??
      payload.time_frame ??
      payload.horizon ??
      extractScenarioMetaFromSources(payload, /\btime\s*frame\b|\btimeframe\b/i),
  );
}

function scenarioMetaValue(value: unknown): string {
  return cleanScenarioText(value) || 'not recorded';
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

function actionTone(value: string): 'constructive' | 'warning' | 'risk' | 'primary' {
  const normalized = value.toLowerCase();
  if (
    normalized.includes('exit') ||
    normalized.includes('reduce') ||
    normalized.includes('avoid') ||
    normalized.includes('do not')
  ) {
    return 'risk';
  }
  if (normalized.includes('watch') || normalized.includes('monitor')) {
    return 'constructive';
  }
  if (
    normalized.includes('reassess') ||
    normalized.includes('review') ||
    normalized.includes('wait') ||
    normalized.includes('underweight')
  ) {
    return 'warning';
  }
  return 'primary';
}

function splitAction(value: string): { label: string; detail: string } {
  const cleaned = cleanScenarioText(value)
    .replace(
      /^action\s+(watch|review|reassess|monitor|avoid|reduce|exit|wait)\s*[:\-\u2013\u2014]?\s*/i,
      '$1: ',
    )
    .replace(
      /^(?:suggested\s+action|recommended\s+response|recommendation|action)\s*[:\-\u2013\u2014]\s*/i,
      '',
    );
  const match = cleaned.match(
    /^(watch|monitor|review|reassess|avoid|reduce|exit|stand aside|maintain|downgrade|upgrade|record|wait|stay underweight|do not chase)\b[\s:,\-\u2013\u2014]*(.*)$/i,
  );
  if (!match) {
    return { label: 'Action', detail: cleaned };
  }
  const label = match[1].replace(/\b\w/g, (letter) => letter.toUpperCase());
  const detail = cleanScenarioText(match[2]?.replace(/^[\s:,\-\u2013\u2014]+/, '') ?? '');
  return { label, detail };
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

function extractScenarioSourceLabel(value: string): string[] {
  const cleaned = cleanScenarioText(value);
  if (!cleaned || isScenarioSectionArtifact(cleaned)) {
    return [];
  }
  const sourceMatch = cleaned.match(
    /\bsource\s*:\s*(.+?)(?=\btime\s*frame\b|\btimeframe\b|\bas[_\s-]*of\b|$)/i,
  );
  const source = cleanScenarioText(sourceMatch?.[1] ?? cleaned)
    .replace(/^and\s+as[_\s-]*of\s*:?\s*/i, '')
    .replace(/\s*\bsetup_type\b.*$/i, '')
    .trim();
  return source && !isScenarioSectionArtifact(source) ? [source] : [];
}

function extractScenarioMetaFromSources(payload: JsonRecord, pattern: RegExp): string {
  const sourceText = stringList(payload.source ?? payload.sources ?? payload.source_artifacts)
    .filter((item) => !isScenarioSectionArtifact(item))
    .join(' ');
  if (!sourceText) {
    return '';
  }
  if (pattern.source.includes('time')) {
    const match = sourceText.match(/\btime\s*frame\b|\btimeframe\b/i);
    if (!match || match.index === undefined) {
      return '';
    }
    const tail = sourceText
      .slice(match.index)
      .replace(/^\s*(?:time\s*frame|timeframe)\s*:?\s*/i, '');
    return cleanScenarioText(tail.split(/\bas[_\s-]*of\b/i)[0]);
  }
  const match = sourceText.match(pattern);
  return cleanScenarioText(match?.[1] ?? '');
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
  quantConfidence,
  setupType,
  stabilityGuard,
  targetZones,
}: {
  confidence: number | null;
  confidenceSource: string;
  dataGaps: string[];
  dataQuality: number | null;
  dataQualityLabel: string;
  quantConfidence: number | null;
  setupType: string;
  stabilityGuard: JsonRecord;
  targetZones: string[];
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
        <ThesisFact label="Target zones">
          {targetZones.length > 0 ? targetZones.join(', ') : 'None reported.'}
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

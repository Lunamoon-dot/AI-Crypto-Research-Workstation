import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  getSignalModelMonitoringLatest,
  listSignalEvaluationReports,
  listSignals,
} from '@/services/signals';
import { getResearchRunSnapshots } from '@/services/research-runs';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid, DataPair } from '@/components/research/bento';
import { ConfidenceBadge, DirectionBadge, IdChip } from '@/components/research/badges';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatConfidence, formatDateTime, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';
import type {
  SignalEvaluationReportResponse,
  SignalModelMonitoringSnapshotResponse,
  SignalResponse,
} from '@/types';

type DirectionFilter = 'all' | 'bullish' | 'bearish' | 'neutral';
type SignalDirection = Exclude<DirectionFilter, 'all'>;
type DirectionSummary = SignalDirection | 'mixed';
type ReadinessTone = 'constructive' | 'warning' | 'risk' | 'primary' | 'degraded';

type ReadinessStep = {
  detail: string;
  label: string;
  tone: ReadinessTone;
  value: string;
};

type SignalRunGroup = {
  key: string;
  runId: string | null;
  snapshotId: string | null;
  symbol: string;
  observedAt: string | null;
  sources: string[];
  averageHeuristicStrength: number | null;
  directionSummary: DirectionSummary;
  counts: Record<SignalDirection, number>;
  signals: SignalResponse[];
};

function normalizeDirection(value: string): SignalDirection {
  const normalized = value.toLowerCase();
  if (normalized.includes('bull') || normalized.includes('long')) {
    return 'bullish';
  }
  if (normalized.includes('bear') || normalized.includes('short')) {
    return 'bearish';
  }
  return 'neutral';
}

function groupSignalsByRun(signals: SignalResponse[]): SignalRunGroup[] {
  const groups = new Map<string, SignalResponse[]>();

  for (const signal of signals) {
    const key =
      signal.research_run_id ||
      signal.signal_snapshot_id ||
      `${signal.symbol}-${signal.observed_at ?? signal.source_timestamp ?? 'unknown'}`;
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }

  return [...groups.entries()]
    .map(([key, groupSignals]) => {
      const [first] = groupSignals;
      const counts = countDirections(groupSignals);
      const heuristicStrengths = groupSignals
        .map((signal) => signal.heuristic_strength ?? signal.confidence)
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const sources = [
        ...new Set(groupSignals.map((signal) => signal.source).filter(Boolean)),
      ];

      return {
        key,
        runId: first?.research_run_id ?? null,
        snapshotId: first?.signal_snapshot_id ?? null,
        symbol: first?.symbol ?? 'n/a',
        observedAt: latestTimestamp(
          groupSignals.map((signal) => signal.observed_at ?? signal.source_timestamp),
        ),
        sources,
        averageHeuristicStrength: heuristicStrengths.length
          ? heuristicStrengths.reduce((sum, value) => sum + value, 0) /
            heuristicStrengths.length
          : null,
        directionSummary: summarizeDirectionCounts(counts),
        counts,
        signals: groupSignals,
      };
    })
    .sort((left, right) => compareNullableTimestamp(right.observedAt, left.observedAt));
}

function countDirections(signals: SignalResponse[]) {
  return signals.reduce<Record<SignalDirection, number>>(
    (counts, signal) => {
      counts[normalizeDirection(signal.direction)] += 1;
      return counts;
    },
    { bullish: 0, bearish: 0, neutral: 0 },
  );
}

function summarizeDirectionCounts(
  counts: Record<SignalDirection, number>,
): DirectionSummary {
  const nonZero = Object.entries(counts).filter(([, count]) => count > 0);
  return nonZero.length === 1
    ? (nonZero[0][0] as SignalDirection)
    : 'mixed';
}

function latestTimestamp(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function compareNullableTimestamp(left: string | null, right: string | null) {
  return (left ?? '').localeCompare(right ?? '');
}

export function SignalsPage() {
  const auth = useWorkspaceStore();
  const [symbol, setSymbol] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const query = useQuery({
    queryKey: queryKeys.signals({ symbol, limit: 100, includeSnapshotRefs: true }),
    queryFn: () => listSignals({ symbol: symbol || undefined, limit: 100 }, auth),
  });
  const reportsQuery = useQuery({
    queryKey: queryKeys.signalEvaluationReports({
      symbol,
      horizon: 1440,
      limit: 3,
    }),
    queryFn: () =>
      listSignalEvaluationReports(
        { symbol: symbol || undefined, horizon: 1440, limit: 3 },
        auth,
      ),
  });
  const monitoringQuery = useQuery({
    queryKey: queryKeys.signalModelMonitoringLatest(),
    queryFn: () => getSignalModelMonitoringLatest(auth),
  });
  const signals = query.data ?? [];
  const signalGroups = useMemo(
    () => groupSignalsByRun(signals),
    [signals],
  );

  function toggleGroup(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="05 Signals Explorer"
        title="Signal explorer"
        description="Inspect deterministic evidence grouped by research run, with expandable source-level signal detail."
      />

      <BentoGrid>
        <Panel className="span-4" title="Model health">
          <SignalModelHealthSummary snapshot={monitoringQuery.data ?? null} />
        </Panel>

        <Panel className="span-8" title="Signal evaluation">
          <SignalEvaluationSummary
            isLoading={reportsQuery.isLoading || monitoringQuery.isLoading}
            report={reportsQuery.data?.[0] ?? null}
            runCount={signalGroups.length}
            signalCount={signals.length}
            snapshot={monitoringQuery.data ?? null}
          />
        </Panel>

        <Panel
          className="span-12 signals-table-panel"
          title="Signals by run"
          description="Filter by symbol, then expand a run to inspect its source signals"
          action={
            <label className="signal-panel-symbol-filter">
              <span>Symbol</span>
              <input
                className="input"
                placeholder="BTC"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
              />
            </label>
          }
        >
          {query.isLoading ? <LoadingState /> : null}
          {query.isError ? <ErrorState error={query.error} /> : null}
          {!query.isLoading && !query.isError && signals.length === 0 ? (
            <EmptyState label="No signals match the current filters." />
          ) : null}
          <div className="signal-run-list">
            {signalGroups.map((group) => (
              <SignalRunGroupCard
                expanded={expandedGroups.has(group.key)}
                group={group}
                key={group.key}
                onToggle={() => toggleGroup(group.key)}
              />
            ))}
          </div>
        </Panel>

      </BentoGrid>
    </main>
  );
}

function SignalModelHealthSummary({
  snapshot,
}: {
  snapshot: SignalModelMonitoringSnapshotResponse | null;
}) {
  if (!snapshot) {
    return <LoadingState label="Loading model health..." />;
  }
  const dataHealth = snapshot.data_health_json ?? {};
  const activeModel = hasActiveModel(snapshot);
  const alerts = (snapshot.alerts_json ?? [])
    .map(alertLabel)
    .filter((label): label is string => Boolean(label))
    .slice(0, 2);
  return (
    <div className="stack small">
      <div className="top-strip-meta">
        <span className={`badge ${healthTone(snapshot.status)}`}>
          {snapshot.status}
        </span>
        <span className={`badge ${activeModel ? 'constructive' : 'primary'}`}>
          {activeModel ? 'learned model' : 'heuristic only'}
        </span>
      </div>
      <DataPair
        label="Active weights"
        value={<IdChip value={snapshot.active_weight_version} />}
      />
      <DataPair
        label="Active calibrator"
        value={<IdChip value={snapshot.active_calibrator_version} />}
      />
      <DataPair label="Observations" value={formatNumber(snapshot.observation_count)} />
      <DataPair label="Outcome labels" value={formatNumber(snapshot.matured_label_count)} />
      <DataPair
        label="Predictions"
        value={formatNumber(snapshot.publishable_prediction_count)}
      />
      <DataPair
        label="Coverage"
        value={formatConfidence(numberFromRecord(dataHealth, 'coverage_rate'))}
      />
      <DataPair
        label="Parse failures"
        value={formatConfidence(numberFromRecord(dataHealth, 'parse_failure_rate'))}
      />
      {alerts.length ? (
        <div className="signal-health-alerts">
          {alerts.map((alert) => (
            <span className="badge warning" key={alert}>
              {alert}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SignalEvaluationSummary({
  isLoading,
  report,
  runCount,
  signalCount,
  snapshot,
}: {
  isLoading: boolean;
  report: SignalEvaluationReportResponse | null;
  runCount: number;
  signalCount: number;
  snapshot: SignalModelMonitoringSnapshotResponse | null;
}) {
  if (isLoading) {
    return <LoadingState label="Loading signal evaluation..." />;
  }
  const activeModel = hasActiveModel(snapshot);
  if (!report) {
    return (
      <SignalEvaluationReadiness
        activeModel={activeModel}
        report={null}
        runCount={runCount}
        signalCount={signalCount}
        snapshot={snapshot}
      />
    );
  }
  return (
    <div className="stack small">
      <div className="top-strip-meta">
        <span className="badge primary">Heuristic score calibration</span>
        <span className="badge">Not a trading PnL result</span>
        {report.oos_sample_size > 0 ? (
          <span className="badge constructive">Out-of-sample sample</span>
        ) : (
          <span className="badge warning">Insufficient OOS data</span>
        )}
        <span className={`badge ${activeModel ? 'constructive' : 'primary'}`}>
          {activeModel ? 'learned model active' : 'heuristic only'}
        </span>
      </div>
      <SignalEvaluationReadiness
        activeModel={activeModel}
        report={report}
        runCount={runCount}
        signalCount={signalCount}
        snapshot={snapshot}
      />
      <DataPair label="Generated" value={formatDateTime(report.generated_at)} />
      <DataPair label="Horizon" value={`${report.horizon_minutes}m`} />
      <DataPair label="Sample" value={formatNumber(report.sample_size)} />
      <DataPair label="OOS sample" value={formatNumber(report.oos_sample_size)} />
      <DataPair label="Coverage" value={formatConfidence(report.coverage_rate)} />
      <DataPair label="Balanced accuracy" value={formatConfidence(report.balanced_accuracy)} />
      <DataPair label="ECE" value={formatNumber(report.ece)} />
      <DataPair label="Brier" value={formatNumber(report.brier_score)} />
    </div>
  );
}

function SignalEvaluationReadiness({
  activeModel,
  report,
  runCount,
  signalCount,
  snapshot,
}: {
  activeModel: boolean;
  report: SignalEvaluationReportResponse | null;
  runCount: number;
  signalCount: number;
  snapshot: SignalModelMonitoringSnapshotResponse | null;
}) {
  const observationCount = snapshot?.observation_count ?? 0;
  const labelCount = snapshot?.matured_label_count ?? 0;
  const oosCount = report?.oos_sample_size ?? 0;
  const hasVisibleSignals = signalCount > 0;
  const hasObservationGap = hasVisibleSignals && observationCount === 0;
  const steps: ReadinessStep[] = [
    {
      detail: `${formatNumber(runCount)} grouped runs`,
      label: 'Signal rows',
      tone: signalCount > 0 ? 'constructive' : 'warning',
      value: formatNumber(signalCount),
    },
    {
      detail: observationCount > 0 ? 'normalized evaluation rows' : 'not captured yet',
      label: 'V2 observations',
      tone: observationCount > 0 ? 'constructive' : 'warning',
      value: formatNumber(observationCount),
    },
    {
      detail: labelCount > 0 ? 'forward labels available' : 'waiting for outcome labels',
      label: 'V3 labels',
      tone: labelCount > 0 ? 'constructive' : 'warning',
      value: formatNumber(labelCount),
    },
    {
      detail: report ? `${report.horizon_minutes}m horizon` : 'no report row',
      label: 'V4 OOS report',
      tone: oosCount > 0 ? 'constructive' : 'warning',
      value: report ? formatNumber(oosCount) : 'none',
    },
    {
      detail: activeModel ? 'weights or calibrator promoted' : 'empirical probability gated',
      label: 'V5 model',
      tone: activeModel ? 'constructive' : 'primary',
      value: activeModel ? 'active' : 'heuristic',
    },
    {
      detail: snapshot?.generated_at ? formatDateTime(snapshot.generated_at) : 'latest snapshot unavailable',
      label: 'V6 monitor',
      tone: snapshot ? healthTone(snapshot.status) : 'warning',
      value: snapshot?.status ?? 'n/a',
    },
  ];

  return (
    <div className="signal-evaluation-readiness">
      <div className="signal-evaluation-readiness-header">
        <div>
          <strong>{activeModel ? 'Learned evaluation active' : 'Heuristic-only state'}</strong>
          <span>
            {hasObservationGap
              ? 'Explorer signals exist, but evaluation observations are still empty.'
              : 'Evaluation state is derived from observation, label, OOS, model, and monitoring artifacts.'}
          </span>
        </div>
        <span className={`badge ${hasObservationGap ? 'warning' : 'primary'}`}>
          {hasObservationGap ? 'observation gap' : 'pipeline state'}
        </span>
      </div>
      <div className="signal-readiness-grid">
        {steps.map((step) => (
          <div className={`signal-readiness-step ${step.tone}`} key={step.label}>
            <span>{step.label}</span>
            <strong>{step.value}</strong>
            <small>{step.detail}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalRunGroupCard({
  expanded,
  group,
  onToggle,
}: {
  expanded: boolean;
  group: SignalRunGroup;
  onToggle: () => void;
}) {
  return (
    <article className="signal-run-card">
      <div className="signal-run-card-header">
        <button
          aria-expanded={expanded}
          className="signal-run-toggle"
          onClick={onToggle}
          type="button"
        >
          <ChevronDown
            aria-hidden
            className={`signal-run-chevron${expanded ? ' open' : ''}`}
            size={18}
          />
          <span className="signal-run-title">
            <strong>{group.symbol}</strong>
            <span>{formatDateTime(group.observedAt)}</span>
          </span>
          <span className="signal-run-meta">
            <span className="badge">{group.signals.length} signals</span>
            <span className={`badge ${directionSummaryTone(group.directionSummary)}`}>
              {directionSummaryLabel(group.directionSummary)}
            </span>
            <span className="badge primary">
              avg heuristic strength {formatConfidence(group.averageHeuristicStrength)}
            </span>
            <span className="small muted">{group.sources.length} sources</span>
          </span>
        </button>
        {group.snapshotId || group.runId ? (
          <div className="signal-run-actions">
            {group.snapshotId ? (
              <span className="signal-run-id-pair">
                <span className="small muted">Snapshot</span>
                <IdChip value={group.snapshotId} />
              </span>
            ) : null}
            {!group.snapshotId && group.runId ? (
              <span className="signal-run-id-pair">
                <span className="small muted">Run</span>
                <IdChip value={group.runId} />
              </span>
            ) : null}
            {group.runId ? (
              <Link className="button ghost signal-run-open" to={routes.researchRun(group.runId)}>
                Open run
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div className="signal-run-body">
          <SignalSnapshotSummary group={group} />
          <div className="table-wrap signal-run-table-wrap">
            <table className="table signal-run-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Direction</th>
                  <th>Heuristic strength</th>
                  <th>Source</th>
                  <th>Summary</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {group.signals.map((signal) => (
                  <tr key={signal.id ?? `${signal.signal_type}-${signal.source}-${signal.observed_at}`}>
                    <td>{signal.display_name || signal.signal_type}</td>
                    <td><DirectionBadge value={signal.direction} /></td>
                    <td><ConfidenceBadge value={signal.heuristic_strength ?? signal.confidence} /></td>
                    <td>
                      {signal.source}
                      <div className="small muted">{formatDateTime(signal.source_timestamp)}</div>
                    </td>
                    <td>
                      <SignalSummaryCell signal={signal} />
                    </td>
                    <td>
                      {signal.id ? (
                        <Link className="badge primary" to={routes.signal(signal.id)}>
                          open
                        </Link>
                      ) : (
                        <span className="badge">n/a</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SignalSnapshotSummary({ group }: { group: SignalRunGroup }) {
  const auth = useWorkspaceStore();
  const runId = group.runId;
  const snapshotsQuery = useQuery({
    queryKey: queryKeys.researchRunSnapshots(runId ?? 'missing'),
    queryFn: () => getResearchRunSnapshots(runId!, auth),
    enabled: Boolean(runId),
    staleTime: 30_000,
  });
  const snapshot = snapshotsQuery.data?.signal_snapshot ?? null;
  const counts = {
    bullish: snapshot?.bullish_count ?? group.counts.bullish,
    bearish: snapshot?.bearish_count ?? group.counts.bearish,
    neutral: snapshot?.neutral_count ?? group.counts.neutral,
  };
  const snapshotId = snapshot?.id ?? group.snapshotId;
  const signalCount = snapshot?.signal_count ?? group.signals.length;
  const capturedAt = snapshot?.captured_at ?? group.observedAt;

  return (
    <div className="signal-snapshot-summary">
      <div className="signal-snapshot-summary-main">
        <span className="small muted">Signal snapshot</span>
        <IdChip value={snapshotId} />
      </div>
      <div className="signal-snapshot-metrics">
        <SnapshotMetric label="Captured" value={formatDateTime(capturedAt)} />
        <SnapshotMetric label="Signals" value={String(signalCount)} />
        <SnapshotMetric
          label="Bull/Bear/Neutral"
          value={`${counts.bullish}/${counts.bearish}/${counts.neutral}`}
        />
        <SnapshotMetric
          label="Stale/Unknown"
          value={`${snapshot?.stale_count ?? 0}/${snapshot?.unknown_freshness_count ?? 0}`}
        />
        {snapshot?.composite_signal_id ? (
          <span className="signal-snapshot-metric signal-snapshot-metric-id">
            <span>Composite</span>
            <IdChip value={snapshot.composite_signal_id} />
          </span>
        ) : null}
        {snapshotsQuery.isError ? (
          <span className="small muted">Snapshot detail unavailable</span>
        ) : null}
      </div>
    </div>
  );
}

function SignalSummaryCell({ signal }: { signal: SignalResponse }) {
  return (
    <div className="signal-summary-cell">
      <div className="signal-summary-badges">
        <span className={`badge ${confidenceSemanticsTone(signal.confidence_semantics)}`}>
          {confidenceSemanticsLabel(signal.confidence_semantics)}
        </span>
        <span className={`badge ${availabilityTone(signal.availability)}`}>
          {availabilityLabel(signal.availability)}
        </span>
        {signal.confidence_semantics !== 'empirical' ? (
          <span className="badge warning">empirical not published</span>
        ) : null}
      </div>
      <span className="signal-summary-text">
        {formatSignalSummary(signal.summary) || 'n/a'}
      </span>
    </div>
  );
}

function SnapshotMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="signal-snapshot-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function directionSummaryLabel(value: DirectionSummary) {
  return value === 'mixed' ? 'mixed directions' : value;
}

function directionSummaryTone(value: DirectionSummary) {
  if (value === 'bullish') {
    return 'constructive';
  }
  if (value === 'bearish') {
    return 'risk';
  }
  return 'warning';
}

function confidenceSemanticsLabel(value: SignalResponse['confidence_semantics']) {
  if (value === 'empirical') {
    return 'empirical score';
  }
  if (value === 'unavailable') {
    return 'score unavailable';
  }
  return 'heuristic score';
}

function confidenceSemanticsTone(value: SignalResponse['confidence_semantics']): ReadinessTone {
  if (value === 'empirical') {
    return 'constructive';
  }
  if (value === 'unavailable') {
    return 'warning';
  }
  return 'primary';
}

function availabilityLabel(value: SignalResponse['availability']) {
  return value.replace(/_/g, ' ');
}

function availabilityTone(value: SignalResponse['availability']): ReadinessTone {
  if (value === 'valid') {
    return 'constructive';
  }
  if (value === 'error' || value === 'parse_failed') {
    return 'risk';
  }
  return 'warning';
}

function formatSignalSummary(value: string) {
  return value
    .replace(/\(([^)]*?)heuristic_confidence=[^)]+\)/gi, (_match, prefix: string) => {
      const cleanedPrefix = prefix.replace(/,\s*$/, '').trim();
      return cleanedPrefix ? `(${cleanedPrefix})` : '';
    })
    .replace(/\bheuristic_confidence\b/gi, 'heuristic strength')
    .replace(/\s+/g, ' ')
    .trim();
}

function healthTone(status: string): ReadinessTone {
  if (status === 'healthy') {
    return 'constructive';
  }
  if (status === 'critical' || status === 'degraded') {
    return 'risk';
  }
  return 'warning';
}

function hasActiveModel(snapshot: SignalModelMonitoringSnapshotResponse | null) {
  return Boolean(snapshot?.active_weight_version || snapshot?.active_calibrator_version);
}

function numberFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function alertLabel(record: Record<string, unknown>) {
  return (
    stringFromRecord(record, 'message') ??
    stringFromRecord(record, 'alert_type') ??
    stringFromRecord(record, 'type') ??
    stringFromRecord(record, 'status')
  );
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

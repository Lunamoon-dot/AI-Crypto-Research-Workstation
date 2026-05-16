import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { listSignals } from '@/services/signals';
import { getResearchRunSnapshots } from '@/services/research-runs';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BentoGrid } from '@/components/research/bento';
import { ConfidenceBadge, DirectionBadge, IdChip } from '@/components/research/badges';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatConfidence, formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import type { SignalResponse } from '@/types';

type DirectionFilter = 'all' | 'bullish' | 'bearish' | 'neutral';
type SignalDirection = Exclude<DirectionFilter, 'all'>;
type DirectionSummary = SignalDirection | 'mixed';

type SignalRunGroup = {
  key: string;
  runId: string | null;
  snapshotId: string | null;
  symbol: string;
  observedAt: string | null;
  sources: string[];
  averageConfidence: number | null;
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
      const confidences = groupSignals
        .map((signal) => signal.confidence)
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
        averageConfidence: confidences.length
          ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
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
              avg {formatConfidence(group.averageConfidence)}
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
                  <th>Confidence</th>
                  <th>Source</th>
                  <th>Summary</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {group.signals.map((signal) => (
                  <tr key={signal.id ?? `${signal.signal_type}-${signal.source}-${signal.observed_at}`}>
                    <td>{signal.signal_type}</td>
                    <td><DirectionBadge value={signal.direction} /></td>
                    <td><ConfidenceBadge value={signal.confidence} /></td>
                    <td>
                      {signal.source}
                      <div className="small muted">{formatDateTime(signal.source_timestamp)}</div>
                    </td>
                    <td>{signal.summary || 'n/a'}</td>
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

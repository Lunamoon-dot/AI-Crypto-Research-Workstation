import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, ClipboardCheck, Target, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BentoGrid, DataPair } from '@/components/research/bento';
import { IdChip } from '@/components/research/badges';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import {
  getPerformanceAnalytics,
  getPerformanceHealth,
  getPerformanceTrend,
  listPerformanceOutcomes,
} from '@/services/performance';
import { queryKeys } from '@/services/query-keys';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { formatConfidence, formatDate, formatNumber } from '@/lib/format';
import { routes } from '@/lib/routes';

export function PerformanceAnalyticsPage() {
  const auth = useWorkspaceStore();
  const [symbol, setSymbol] = useState('');
  const filters = { symbol: symbol.trim() || undefined, limit: 200 };
  const analytics = useQuery({
    queryKey: queryKeys.performanceAnalytics(filters),
    queryFn: () => getPerformanceAnalytics(filters, auth),
  });
  const outcomes = useQuery({
    queryKey: queryKeys.performanceOutcomes(filters),
    queryFn: () => listPerformanceOutcomes({ ...filters, limit: 50 }, auth),
  });
  const trend = useQuery({
    queryKey: queryKeys.performanceTrend({ days: 90 }),
    queryFn: () => getPerformanceTrend({ days: 90 }, auth),
  });
  const health = useQuery({
    queryKey: queryKeys.performanceHealth({ recent_days: 14, baseline_days: 60 }),
    queryFn: () => getPerformanceHealth({ recent_days: 14, baseline_days: 60 }, auth),
  });
  const reviewCount = analytics.data?.sample_size ?? 0;
  const reviewsNeeded = Math.max(0, 5 - reviewCount);

  return (
    <main className="page">
      <PageHeader
        eyebrow="Outcome Review"
        title="Thesis Reliability"
        description="Recorded thesis outcomes, setup reliability, and lessons for improving decision quality over time."
        action={
          <HeaderStats
            stats={[
              {
                icon: <BarChart3 aria-hidden size={14} />,
                label: 'Reviews',
                meta: analytics.data?.symbol ?? 'all symbols',
                value: analytics.data?.sample_size ?? '...',
              },
              {
                icon: <Target aria-hidden size={14} />,
                label: 'Target hit',
                meta: 'review outcomes',
                tone: 'constructive',
                value: formatConfidence(analytics.data?.hit_rate),
              },
              {
                icon: <Activity aria-hidden size={14} />,
                label: 'Invalidation',
                meta: 'reviewed theses',
                tone: 'risk',
                value: formatConfidence(analytics.data?.invalidation_rate),
              },
              {
                icon: <TrendingUp aria-hidden size={14} />,
                label: 'Data health',
                meta: health.data?.overall_status === 'insufficient_data'
                  ? `${reviewsNeeded || 0} more reviews`
                  : health.data?.recommendation ?? 'loading',
                tone: health.data?.overall_status === 'healthy' ? 'constructive' : 'warning',
                value: healthLabel(health.data?.overall_status),
              },
            ]}
          />
        }
      />

      <Panel title="Scope" description="Filter outcome reviews by thesis symbol.">
        <div className="compact-create">
          <label className="label">
            Symbol
            <input
              className="input"
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="BTC/USDT"
              value={symbol}
            />
          </label>
          <button className="button ghost" onClick={() => setSymbol('')} type="button">
            Clear
          </button>
        </div>
      </Panel>

      <div style={{ height: 14 }} />
      <BentoGrid>
        <Panel className="span-12" title="Next Actions" description="Move the review loop forward from the current sample.">
          <div className="grid three">
            <div className="state-card">
              <strong>{reviewsNeeded > 0 ? `Record ${reviewsNeeded} more review${reviewsNeeded === 1 ? '' : 's'}` : 'Review sample is ready'}</strong>
              <span>
                {reviewsNeeded > 0
                  ? 'Open theses after market outcomes are known and save worked, invalidated, mixed, or unknown.'
                  : 'Use setup insights before trusting a repeated thesis pattern.'}
              </span>
              <Link className="button" to={routes.theses}>
                <ClipboardCheck aria-hidden size={16} />
                Open theses
              </Link>
            </div>
            <div className="state-card">
              <strong>Run a fresh thesis</strong>
              <span>Generate another research artifact before adding new review data.</span>
              <Link className="button" to={routes.researchNew}>
                <Target aria-hidden size={16} />
                Run research
              </Link>
            </div>
            <div className="state-card">
              <strong>Review active scenarios</strong>
              <span>Use scenario monitoring to find thesis conditions that need attention.</span>
              <Link className="button" to={routes.scenarios}>
                <TrendingUp aria-hidden size={16} />
                Scenarios
              </Link>
            </div>
          </div>
        </Panel>

        <Panel className="span-5" title="Review Mix">
          {analytics.isLoading ? <LoadingState /> : null}
          {analytics.isError ? <ErrorState error={analytics.error} /> : null}
          <div className="stack">
            {Object.entries(analytics.data?.result_counts ?? {}).map(([result, count]) => (
              <DataPair key={result} label={result} value={count} />
            ))}
            <DataPair label="Average MFE" value={formatNumber(analytics.data?.average_mfe)} />
            <DataPair label="Average MAE" value={formatNumber(analytics.data?.average_mae)} />
            <DataPair label="Mixed rate" value={formatConfidence(analytics.data?.mixed_rate)} />
          </div>
        </Panel>

        <Panel className="span-7" title="Weekly Review Trend" description="Buckets by thesis creation date.">
          {trend.isLoading ? <LoadingState /> : null}
          {trend.isError ? <ErrorState error={trend.error} /> : null}
          {trend.data?.length === 0 ? <EmptyState label="No trend points yet." /> : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Reviews</th>
                  <th>Target hit</th>
                  <th>MFE</th>
                  <th>MAE</th>
                </tr>
              </thead>
              <tbody>
                {trend.data?.map((point) => (
                  <tr key={point.week_start}>
                    <td>{formatDate(point.week_start)}</td>
                    <td>{point.sample_size}</td>
                    <td>{formatConfidence(point.hit_rate)}</td>
                    <td>{formatNumber(point.average_mfe)}</td>
                    <td>{formatNumber(point.average_mae)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="span-6" title="Setup Signals">
          {analytics.data?.insights.length === 0 ? (
            <EmptyState label="No setup insights yet." />
          ) : null}
          <div className="stack">
            {analytics.data?.insights.map((insight) => (
              <div className="list-row" key={`${insight.insight_type}-${insight.message}`}>
                <div className="row">
                  <strong>{insight.insight_type}</strong>
                  <span className="badge primary">{insight.evidence_count} reviews</span>
                </div>
                <div className="small muted">{insight.message}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="span-6" title="Recorded Lessons">
          {analytics.data?.recent_lessons.length === 0 ? (
            <EmptyState label="No lessons recorded yet." />
          ) : null}
          <div className="stack">
            {analytics.data?.recent_lessons.map((lesson) => (
              <div className="callout" key={lesson}>{lesson}</div>
            ))}
          </div>
        </Panel>

        <Panel className="span-12" title="Outcome Reviews">
          {outcomes.isLoading ? <LoadingState /> : null}
          {outcomes.isError ? <ErrorState error={outcomes.error} /> : null}
          {outcomes.data?.length === 0 ? <EmptyState label="No outcome reviews recorded." /> : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Thesis</th>
                  <th>Symbol</th>
                  <th>Setup</th>
                  <th>Result</th>
                  <th>MFE</th>
                  <th>MAE</th>
                  <th>Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.data?.map((outcome) => (
                  <tr key={outcome.id ?? outcome.thesis_id}>
                    <td><IdChip value={outcome.thesis_id} /></td>
                    <td>{outcome.symbol}</td>
                    <td>{outcome.setup_type}</td>
                    <td><span className={outcome.invalidated ? 'badge risk' : 'badge'}>{outcome.result}</span></td>
                    <td>{formatNumber(outcome.max_favorable_excursion)}</td>
                    <td>{formatNumber(outcome.max_adverse_excursion)}</td>
                    <td>{formatDate(outcome.reviewed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function healthLabel(status: string | undefined): string {
  if (!status) {
    return '...';
  }
  return {
    healthy: 'Healthy',
    insufficient_data: 'Needs data',
    degraded: 'Degraded',
    critical: 'Critical',
  }[status] ?? status.replaceAll('_', ' ');
}

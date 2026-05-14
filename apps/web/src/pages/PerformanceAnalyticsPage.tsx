import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, Target, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { BentoGrid, DataPair, MetricTile } from '@/components/research/bento';
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

  return (
    <main className="page">
      <PageHeader
        eyebrow="Performance Analytics"
        title="Performance"
        description="Review outcome quality, calibration drift, and recent lessons from recorded thesis reviews."
      />

      <Panel title="Scope" description="Filter analytics by a persisted thesis symbol.">
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
        <MetricTile
          className="span-3"
          icon={<BarChart3 size={18} />}
          label="Reviewed"
          value={analytics.data?.sample_size ?? '...'}
          meta={analytics.data?.symbol ?? 'all symbols'}
        />
        <MetricTile
          className="span-3"
          icon={<Target size={18} />}
          label="Hit rate"
          tone="constructive"
          value={formatConfidence(analytics.data?.hit_rate)}
          meta="target outcomes"
        />
        <MetricTile
          className="span-3"
          icon={<Activity size={18} />}
          label="Invalidated"
          tone="risk"
          value={formatConfidence(analytics.data?.invalidation_rate)}
          meta="reviewed theses"
        />
        <MetricTile
          className="span-3"
          icon={<TrendingUp size={18} />}
          label="Health"
          tone={health.data?.overall_status === 'healthy' ? 'constructive' : 'warning'}
          value={health.data?.overall_status ?? '...'}
          meta={health.data?.recommendation ?? 'loading'}
        />

        <Panel className="span-5" title="Outcome Mix">
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

        <Panel className="span-7" title="Trend" description="Weekly buckets by thesis creation date.">
          {trend.isLoading ? <LoadingState /> : null}
          {trend.isError ? <ErrorState error={trend.error} /> : null}
          {trend.data?.length === 0 ? <EmptyState label="No trend points yet." /> : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Sample</th>
                  <th>Hit rate</th>
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

        <Panel className="span-6" title="Retrospective Insights">
          {analytics.data?.insights.length === 0 ? (
            <EmptyState label="No factor insights yet." />
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

        <Panel className="span-6" title="Recent Lessons">
          {analytics.data?.recent_lessons.length === 0 ? (
            <EmptyState label="No lessons recorded yet." />
          ) : null}
          <div className="stack">
            {analytics.data?.recent_lessons.map((lesson) => (
              <div className="callout" key={lesson}>{lesson}</div>
            ))}
          </div>
        </Panel>

        <Panel className="span-12" title="Reviewed Outcomes">
          {outcomes.isLoading ? <LoadingState /> : null}
          {outcomes.isError ? <ErrorState error={outcomes.error} /> : null}
          {outcomes.data?.length === 0 ? <EmptyState label="No reviewed outcomes." /> : null}
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
                    <td className="mono">{outcome.thesis_id}</td>
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

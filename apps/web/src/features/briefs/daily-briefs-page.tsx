'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listDailyBriefs } from '@/api/briefs';
import { queryKeys } from '@/api/query-keys';
import { useAuth } from '@/auth/auth-provider';
import { IdChip } from '@/components/research/badges';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state';
import { formatDate, formatDateTime } from '@/lib/format';

export function DailyBriefsPage() {
  const auth = useAuth();
  const [date, setDate] = useState('');
  const query = useQuery({
    queryKey: queryKeys.dailyBriefs({ date, limit: 50 }),
    queryFn: () => listDailyBriefs({ date: date || undefined, limit: 50 }, auth),
  });

  return (
    <main className="page">
      <PageHeader title="Daily briefs" description="Brief archive from persisted market briefs." />
      <Panel title="Filters">
        <label className="label">
          Date
          <input
            className="input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
      </Panel>
      <div style={{ height: 14 }} />
      <Panel title="Briefs">
        {query.isLoading ? <LoadingState /> : null}
        {query.isError ? <ErrorState error={query.error} /> : null}
        {query.data?.length === 0 ? <EmptyState label="No briefs found." /> : null}
        <div className="stack">
          {query.data?.map((brief) => (
            <div className="list-row" key={brief.id ?? `${brief.title}-${brief.created_at}`}>
              <div className="row">
                <strong>{brief.title || 'Untitled brief'}</strong>
                <span className="badge">{formatDate(brief.brief_date)}</span>
              </div>
              <p className="muted">{brief.summary || 'No summary.'}</p>
              <div className="small muted">
                {brief.watchlist_name || 'default'} | {formatDateTime(brief.created_at)}
              </div>
              <div className="top-strip-meta">
                {brief.thesis_ids.map((id) => <IdChip key={`thesis-${id}`} value={id} />)}
                {brief.signal_ids.map((id) => <IdChip key={`signal-${id}`} value={id} />)}
              </div>
              <div className="stack">
                {brief.key_points.map((point) => (
                  <div className="small" key={point}>{point}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </main>
  );
}
